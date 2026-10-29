
"""
Session history: scores and counts only, saved in a small SQLite file.
 
What is stored: the kind of session, date, role, mode, company style, the overall score and
the per-section scores, plus numeric counts from attention monitoring and speech analysis.
What is never stored: answers, transcripts, video, resume text or names.
 
There is no login. The browser makes a random user_id (UUID) and keeps it in localStorage.
The history of one user_id can be read and deleted by anyone who knows that id.
"""
 
import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
 
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator
 
router = APIRouter(prefix="/api/history", tags=["History"])
 
DB_PATH = Path(os.getenv("HISTORY_DB_PATH") or Path(__file__).parent / "data" / "history.db")
LIST_LIMIT = 50           # how many sessions GET returns
KEEP_PER_USER = 200       # older sessions of one user are removed after this many
USER_ID_PATTERN = r"^[A-Za-z0-9_-]{8,64}$"
 
_ID_RE = re.compile(USER_ID_PATTERN)
 
 
def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sessions (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               user_id TEXT NOT NULL,
               kind TEXT NOT NULL,
               created_at TEXT NOT NULL,
               role TEXT,
               mode TEXT,
               company_style TEXT,
               overall_score REAL NOT NULL,
               sections TEXT NOT NULL,
               attention TEXT NOT NULL,
               speech TEXT NOT NULL
           )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, id)")
    return conn
 
 
def _numbers_only(value: Any) -> Dict[str, float]:
    """Keeps only numeric values, so no text can end up in the history by accident."""
    if not isinstance(value, dict):
        return {}
    clean: Dict[str, float] = {}
    for key, item in list(value.items())[:30]:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            continue
        clean[str(key)[:50]] = item
    return clean
 
 
class HistorySave(BaseModel):
    user_id: str = Field(..., pattern=USER_ID_PATTERN)
    kind: Literal["interview", "aptitude"]
    created_at: Optional[str] = Field(default=None, max_length=40)
    role: Optional[str] = Field(default=None, max_length=150)
    mode: Optional[str] = Field(default=None, max_length=30)
    company_style: Optional[str] = Field(default=None, max_length=30)
    overall_score: float = Field(..., ge=0, le=100)
    sections: Optional[Dict[str, Any]] = None
    attention: Optional[Dict[str, Any]] = None
    speech: Optional[Dict[str, Any]] = None
 
    @field_validator("sections", "attention", "speech")
    @classmethod
    def only_numbers(cls, value):
        return _numbers_only(value)
 
 
def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row[0],
        "kind": row[1],
        "created_at": row[2],
        "role": row[3],
        "mode": row[4],
        "company_style": row[5],
        "overall_score": row[6],
        "sections": json.loads(row[7]),
        "attention": json.loads(row[8]),
        "speech": json.loads(row[9]),
    }
 
 
@router.post("/save")
def save_session(payload: HistorySave):
    created_at = payload.created_at or datetime.now(timezone.utc).isoformat()
    with closing(_connect()) as conn:
        with conn:
            cursor = conn.execute(
                """INSERT INTO sessions
                   (user_id, kind, created_at, role, mode, company_style, overall_score, sections, attention, speech)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    payload.user_id, payload.kind, created_at, payload.role, payload.mode, payload.company_style,
                    payload.overall_score,
                    json.dumps(payload.sections or {}), json.dumps(payload.attention or {}), json.dumps(payload.speech or {}),
                ),
            )
            new_id = cursor.lastrowid
            conn.execute(
                """DELETE FROM sessions WHERE user_id = ? AND id NOT IN
                   (SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT ?)""",
                (payload.user_id, payload.user_id, KEEP_PER_USER),
            )
    return {"ok": True, "id": new_id}
 
 
@router.get("")
def list_sessions(user_id: str = Query(..., pattern=USER_ID_PATTERN)):
    with closing(_connect()) as conn:
        rows = conn.execute(
            """SELECT id, kind, created_at, role, mode, company_style, overall_score, sections, attention, speech
               FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT ?""",
            (user_id, LIST_LIMIT),
        ).fetchall()
    return {"sessions": [_row_to_dict(r) for r in rows]}
 
 
@router.delete("")
def delete_history(user_id: str = Query(..., pattern=USER_ID_PATTERN)):
    with closing(_connect()) as conn:
        with conn:
            cursor = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return {"ok": True, "deleted": cursor.rowcount}