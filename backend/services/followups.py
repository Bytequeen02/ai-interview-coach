
"""
Rules for interviewer follow-up questions (Phase 4).
 
Pure functions only: no AI calls and no network. The AI is asked to *suggest*
a follow-up question inside the normal evaluation, but whether a follow-up is
really offered is decided here, in code, so the rules are always the same:
 
  - at most one follow-up per main question
  - at most MAX_FOLLOW_UPS_PER_INTERVIEW in the whole interview
  - never for a skipped or very short answer
  - never when the AI evaluation failed (placeholder result)
"""
 
import re
from typing import Any, Dict, Iterable, Optional
 
MAX_FOLLOW_UPS_PER_INTERVIEW = 2
MIN_ANSWER_WORDS = 5
MIN_FOLLOW_UP_CHARS = 10
MAX_FOLLOW_UP_CHARS = 300
 
# The frontend sends this text when the candidate skips a question.
NO_ANSWER_MARKER = "(No answer was provided"
 
_EMPTY_WORDS = {"", "null", "none", "n/a", "no", "no follow-up", "no follow up", "false"}
 
 
def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))
 
 
def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", " ".join((text or "").lower().split()))
 
 
def is_answer_worth_a_follow_up(answer: str) -> bool:
    """False for a skipped answer and for answers that are too short to probe."""
    text = (answer or "").strip()
    if not text or text.startswith(NO_ANSWER_MARKER):
        return False
    return _word_count(text) >= MIN_ANSWER_WORDS
 
 
def can_offer(session: Dict[str, Any], question_id: int, answer: str) -> bool:
    """True if a follow-up may still be offered for this main question."""
    follow_ups = session.get("follow_ups") or {}
    if question_id in follow_ups:
        return False
    if len(follow_ups) >= MAX_FOLLOW_UPS_PER_INTERVIEW:
        return False
    return is_answer_worth_a_follow_up(answer)
 
 
def clean_follow_up(
    raw: Any,
    original_question: str,
    already_asked: Iterable[str] = (),
) -> Optional[str]:
    """Turns whatever the AI returned into one clean question, or None."""
    if not isinstance(raw, str):
        return None
    text = " ".join(raw.split()).strip().strip("\"'").strip()
    if text.lower().rstrip(".") in _EMPTY_WORDS:
        return None
    if text.count("?") > 1:  # keep it to a single question
        text = text[: text.index("?") + 1]
    if not (MIN_FOLLOW_UP_CHARS <= len(text) <= MAX_FOLLOW_UP_CHARS):
        return None
    normalized = _normalize(text)
    if normalized == _normalize(original_question):
        return None
    if normalized in {_normalize(item) for item in already_asked}:
        return None
    return text