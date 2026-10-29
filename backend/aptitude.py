
"""
Aptitude round (quant, logical, verbal): question bank, round creation and scoring.
 
Scoring is done in code only. The AI is never used here, so the same answers always
give the same score. The correct answers stay on the server: /start never sends
answer_index or the explanation, only /submit returns them (in the review).
 
Rounds are kept in memory (like interview sessions). They are lost when the server restarts.
"""
 
import json
import random
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
 
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
 
router = APIRouter(prefix="/api/aptitude", tags=["Aptitude"])
 
BANK_PATH = Path(__file__).parent / "aptitude_data" / "questions.json"
SECTIONS = ["quant", "logical", "verbal"]
SECONDS_PER_QUESTION = 60
MAX_QUESTIONS_PER_ROUND = 60
MAX_STORED_ROUNDS = 1000
 
 
def _load_bank() -> List[Dict[str, Any]]:
    with open(BANK_PATH, encoding="utf-8") as f:
        bank = json.load(f)
    for item in bank:
        if len(item["options"]) != 4 or not 0 <= item["answer_index"] < 4:
            raise ValueError(f"Bad question in the bank: {item['id']}")
    return bank
 
 
BANK: List[Dict[str, Any]] = _load_bank()
 
# round_id -> {"questions": [...], "result": dict or None}. Oldest rounds are dropped first.
_ROUNDS: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
 
 
# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
 
class StartRequest(BaseModel):
    sections: List[Literal["quant", "logical", "verbal"]] = Field(default_factory=lambda: list(SECTIONS), min_length=1)
    count: int = Field(default=20, ge=1, le=MAX_QUESTIONS_PER_ROUND)
    difficulty: Literal["easy", "medium", "hard", "mixed"] = "mixed"
 
 
class AnswerIn(BaseModel):
    id: str
    selected_index: Optional[int] = Field(default=None, ge=0, le=3)  # null = skipped
 
 
class SubmitRequest(BaseModel):
    round_id: str
    answers: List[AnswerIn] = Field(default_factory=list)
    time_taken_seconds: Optional[int] = Field(default=None, ge=0)
 
 
# ---------------------------------------------------------------------------
# Choosing the questions
# ---------------------------------------------------------------------------
 
def choose_questions(
    sections: List[str], count: int, difficulty: str, rng: Optional[random.Random] = None
) -> List[Dict[str, Any]]:
    """Spread `count` questions over the chosen sections. If a section runs out,
    the rest is taken from the other chosen sections. Returns fewer than `count`
    only when the bank itself has fewer matching questions."""
    rng = rng or random.Random()
    ordered_sections = list(dict.fromkeys(sections))  # remove duplicates, keep the order asked for
    pools = {
        s: [q for q in BANK if q["section"] == s and (difficulty == "mixed" or q["difficulty"] == difficulty)]
        for s in ordered_sections
    }
    for pool in pools.values():
        rng.shuffle(pool)
 
    total_available = sum(len(p) for p in pools.values())
    count = min(count, total_available)
 
    base, extra = divmod(count, len(ordered_sections))
    taken: Dict[str, List[Dict[str, Any]]] = {}
    for i, s in enumerate(ordered_sections):
        quota = base + (1 if i < extra else 0)
        taken[s] = pools[s][:quota]
        pools[s] = pools[s][quota:]
 
    missing = count - sum(len(t) for t in taken.values())
    for s in ordered_sections:           # fill the gap from sections that still have questions
        while missing > 0 and pools[s]:
            taken[s].append(pools[s].pop())
            missing -= 1
 
    chosen: List[Dict[str, Any]] = []
    for s in ordered_sections:
        rng.shuffle(taken[s])
        chosen.extend(taken[s])
    return chosen
 
 
# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
 
def score_round(questions: List[Dict[str, Any]], answers: List[AnswerIn]) -> Dict[str, Any]:
    chosen_by_id = {a.id: a.selected_index for a in answers}  # a repeated id: the last one wins
    by_section: Dict[str, Dict[str, int]] = {}
    review = []
    correct = wrong = skipped = 0
 
    for q in questions:
        selected = chosen_by_id.get(q["id"])
        is_correct = selected is not None and selected == q["answer_index"]
        section = by_section.setdefault(q["section"], {"correct": 0, "total": 0})
        section["total"] += 1
        if selected is None:
            skipped += 1
        elif is_correct:
            correct += 1
            section["correct"] += 1
        else:
            wrong += 1
        review.append({
            "id": q["id"],
            "section": q["section"],
            "question": q["question"],
            "options": q["options"],
            "selected_index": selected,
            "correct_index": q["answer_index"],
            "explanation": q["explanation"],
            "is_correct": is_correct,
        })
 
    total = len(questions)
    return {
        "total": total,
        "correct": correct,
        "wrong": wrong,
        "skipped": skipped,
        "percent": round(correct / total * 100, 1) if total else 0.0,
        "by_section": by_section,
        "review": review,
    }
 
 
# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
 
@router.post("/start")
def start_round(payload: StartRequest):
    questions = choose_questions(payload.sections, payload.count, payload.difficulty)
    if not questions:
        raise HTTPException(status_code=400, detail="No questions are available for this selection.")
 
    round_id = uuid.uuid4().hex[:12]
    _ROUNDS[round_id] = {"questions": questions, "result": None}
    while len(_ROUNDS) > MAX_STORED_ROUNDS:
        _ROUNDS.popitem(last=False)
 
    return {
        "round_id": round_id,
        "duration_seconds": SECONDS_PER_QUESTION * len(questions),
        "questions": [
            {"id": q["id"], "section": q["section"], "question": q["question"], "options": q["options"]}
            for q in questions
        ],
    }
 
 
@router.post("/submit")
def submit_round(payload: SubmitRequest):
    entry = _ROUNDS.get(payload.round_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Invalid round_id.")
    if entry["result"] is None:
        entry["result"] = score_round(entry["questions"], payload.answers)
    # A second submit (for example a retry after a network error) returns the same result.
    return entry["result"]