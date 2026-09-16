"""
In-memory session store for the interview MVP.

Design note:
This module exposes a small, deliberately narrow interface
(create_session, get_session, update_session, delete_session, exists).
Every other part of the app talks to sessions ONLY through these
functions and never touches the underlying dict directly.

Why this matters: if you later add MongoDB/SQLite/Postgres, you only
need to rewrite the *inside* of this file (e.g. swap the dict for DB
calls) — main.py and services/*.py do not need to change at all.
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# session_id -> session dict
_SESSIONS: Dict[str, Dict[str, Any]] = {}


def create_session(candidate_info: Dict[str, Any]) -> str:
    """Create a new interview session and return its session_id."""
    session_id = str(uuid.uuid4())
    _SESSIONS[session_id] = {
        "session_id": session_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "candidate_info": candidate_info,
        "questions": [],       # list of QuestionOut-like dicts, in order asked
        "answers": {},         # question_id -> answer text
        "evaluations": {},     # question_id -> Evaluation dict
        "current_index": 0,    # index into `questions` of the question awaiting an answer
        "finished": False,
    }
    return session_id


def exists(session_id: str) -> bool:
    return session_id in _SESSIONS


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    return _SESSIONS.get(session_id)


def add_question(session_id: str, question: Dict[str, Any]) -> None:
    _SESSIONS[session_id]["questions"].append(question)


def record_answer(session_id: str, question_id: int, answer: str) -> None:
    _SESSIONS[session_id]["answers"][question_id] = answer


def record_evaluation(session_id: str, question_id: int, evaluation: Dict[str, Any]) -> None:
    _SESSIONS[session_id]["evaluations"][question_id] = evaluation


def advance(session_id: str) -> None:
    _SESSIONS[session_id]["current_index"] += 1
    total = _SESSIONS[session_id]["candidate_info"]["num_questions"]
    if _SESSIONS[session_id]["current_index"] >= total:
        _SESSIONS[session_id]["finished"] = True


def get_all_questions(session_id: str) -> List[Dict[str, Any]]:
    return _SESSIONS[session_id]["questions"]


def get_all_evaluations(session_id: str) -> List[Dict[str, Any]]:
    session = _SESSIONS[session_id]
    # preserve question order
    return [
        session["evaluations"][q["question_id"]]
        for q in session["questions"]
        if q["question_id"] in session["evaluations"]
    ]


def delete_session(session_id: str) -> None:
    _SESSIONS.pop(session_id, None)


def session_count() -> int:
    """Useful for debugging / health checks."""
    return len(_SESSIONS)
