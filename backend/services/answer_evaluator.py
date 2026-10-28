
"""
AI-based answer evaluation (Feature 4 — the core AI feature of this project).
 
Design principle: never let a malformed/missing LLM response crash the
interview, and never disguise a fallback result as a real evaluation.
"""
 
from typing import Any, Dict, Optional
 
from prompts.prompts import answer_evaluation_prompt, is_star_category
from services import llm_client
from services.followups import clean_follow_up
from services.json_utils import extract_json
 
REQUIRED_NUMERIC_FIELDS = [
    "overall_score",
    "relevance",
    "technical_accuracy",
    "completeness",
    "clarity",
    "communication",
]
 
 
def _clamp(value: Any, lo: float = 0, hi: float = 10, default: float = 5) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))
 
 
STAR_KEYS = ("situation", "task", "action", "result")
 
 
def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False
 
 
def _normalize_star(raw: Any) -> Optional[Dict[str, Any]]:
    """Returns a clean STAR dict, or None when the AI output is missing or malformed.
    We never guess missing parts: a partial or broken STAR block becomes None."""
    if not isinstance(raw, dict) or not all(key in raw for key in STAR_KEYS):
        return None
    star: Dict[str, Any] = {key: _as_bool(raw[key]) for key in STAR_KEYS}
    tip = raw.get("tip")
    star["tip"] = tip.strip()[:300] if isinstance(tip, str) else ""
    return star
 
 
def _validate_and_normalize(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Ensures every field the schema needs is present and in range,
    filling in safe defaults for anything missing rather than rejecting
    the whole evaluation over one bad field."""
    normalized: Dict[str, Any] = {}
    for field in REQUIRED_NUMERIC_FIELDS:
        normalized[field] = round(_clamp(parsed.get(field)), 1)
 
    strengths = parsed.get("strengths")
    normalized["strengths"] = strengths if isinstance(strengths, list) and strengths else [
        "Answer addressed the question."
    ]
 
    improvements = parsed.get("improvements")
    normalized["improvements"] = improvements if isinstance(improvements, list) and improvements else [
        "Could provide more specific detail or examples."
    ]
 
    normalized["feedback"] = (
        parsed.get("feedback") or "The answer was received and scored, but detailed feedback text was missing from the AI response."
    )
    normalized["improved_answer"] = (
        parsed.get("improved_answer") or "No improved answer example was returned by the AI for this response."
    )
    normalized["is_fallback"] = False
    normalized["star"] = None  # filled in by evaluate_answer for behavioural questions
    normalized["follow_up_text"] = None  # filled in by evaluate_answer when a follow-up is allowed
    return normalized
 
 
def _fallback_evaluation() -> Dict[str, Any]:
    """Used only when the LLM is unconfigured/unavailable or returns
    something we can't parse at all. Clearly marked as fallback so the
    frontend/demo never presents this as a genuine AI evaluation."""
    return {
        "overall_score": 5.0,
        "relevance": 5.0,
        "technical_accuracy": 5.0,
        "completeness": 5.0,
        "clarity": 5.0,
        "communication": 5.0,
        "strengths": ["Answer was submitted successfully."],
        "improvements": ["AI evaluation is temporarily unavailable — this is a placeholder score, not a real assessment."],
        "feedback": (
            "Automatic AI evaluation could not be completed right now (the AI service was "
            "unavailable or returned an unusable response). This is a neutral placeholder "
            "score, not a genuine evaluation of your answer."
        ),
        "improved_answer": "Not available — AI evaluation service was unavailable for this answer.",
        "is_fallback": True,
        "star": None,
        "follow_up_text": None,
    }
 
 
def evaluate_answer(
    candidate_info: Dict[str, Any],
    question: str,
    answer: str,
    category: Any = None,
    allow_follow_up: bool = False,
) -> Dict[str, Any]:
    """
    Returns a dict shaped like schemas.Evaluation (including is_fallback), plus
    `follow_up_text`: a cleaned follow-up question suggested by the AI, or None.
    The caller decides whether to actually offer it (see services/followups.py).
    `category` is the question's category. Behavioural questions also get a STAR check.
    """
    if llm_client.is_configured():
        try:
            prompt = answer_evaluation_prompt(candidate_info, question, answer, category, allow_follow_up)
            raw = llm_client.generate(prompt)
            parsed = extract_json(raw)
            if parsed and any(f in parsed for f in REQUIRED_NUMERIC_FIELDS):
                result = _validate_and_normalize(parsed)
                if is_star_category(category):
                    result["star"] = _normalize_star(parsed.get("star"))
                if allow_follow_up:
                    result["follow_up_text"] = clean_follow_up(parsed.get("follow_up"), question)
                return result
            print(f"[LLM WARNING - could not parse the evaluation, using placeholder] first 200 chars: {str(raw)[:200]!r}")
        except llm_client.LLMError as exc:
            print(f"[LLM ERROR - falling back to placeholder evaluation] {exc}")
 
    return _fallback_evaluation()