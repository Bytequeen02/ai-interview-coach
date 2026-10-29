
"""
Adaptive difficulty (Phase 6).
 
The interview starts with the usual difficulty plan (see question_generator._pick_difficulty).
After that, the next question is made one step harder when the candidate has been scoring well,
or one step easier when the candidate has been struggling.
 
Rules (all in code, no AI):
  - only the last WINDOW scored answers are looked at
  - the Introduction question is ignored (a good intro says little about technical depth)
  - placeholder evaluations (is_fallback) are ignored
  - follow-up answers are never counted (they are stored separately)
  - average >= HARDER_AT  -> one step harder, average < EASIER_BELOW -> one step easier
  - the result always stays between Easy and Hard
 
Set the environment variable ADAPTIVE_DIFFICULTY=off to switch this off.
"""
 
import os
from typing import Any, Dict, List
 
LEVELS = ["Easy", "Medium", "Hard"]
WINDOW = 2
HARDER_AT = 7.5
EASIER_BELOW = 5.0
 
ENABLED = os.getenv("ADAPTIVE_DIFFICULTY", "on").strip().lower() != "off"
 
 
def recent_scores(session: Dict[str, Any], window: int = WINDOW) -> List[float]:
    """Overall scores (0 to 10) of the last `window` real, non-introduction answers, oldest first."""
    evaluations = session.get("evaluations") or {}
    scores: List[float] = []
    for question in session.get("questions") or []:
        evaluation = evaluations.get(question["question_id"])
        if evaluation is None or evaluation.get("is_fallback"):
            continue
        if str(question.get("category", "")).strip().lower() == "introduction":
            continue
        try:
            scores.append(float(evaluation["overall_score"]))
        except (KeyError, TypeError, ValueError):
            continue
    return scores[-window:]
 
 
def adapt(base_difficulty: str, scores: List[float]) -> str:
    """The difficulty for the next question, given the planned one and the recent scores."""
    if not ENABLED or not scores or base_difficulty not in LEVELS:
        return base_difficulty
    average = sum(scores) / len(scores)
    index = LEVELS.index(base_difficulty)
    if average >= HARDER_AT:
        index += 1
    elif average < EASIER_BELOW:
        index -= 1
    return LEVELS[max(0, min(len(LEVELS) - 1, index))]
 