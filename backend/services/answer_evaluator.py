"""
AI-based answer evaluation (Feature 4 — the core AI feature of this project).

Design principle: never let a malformed/missing LLM response crash the
interview, and never disguise a fallback result as a real evaluation.
"""

from typing import Any, Dict

from prompts.prompts import answer_evaluation_prompt
from services import llm_client
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
    }


def evaluate_answer(candidate_info: Dict[str, Any], question: str, answer: str) -> Dict[str, Any]:
    """
    Returns a dict shaped like schemas.Evaluation (including is_fallback).
    """
    if llm_client.is_configured():
        try:
            prompt = answer_evaluation_prompt(candidate_info, question, answer)
            raw = llm_client.generate(prompt)
            parsed = extract_json(raw)
            if parsed and any(f in parsed for f in REQUIRED_NUMERIC_FIELDS):
                return _validate_and_normalize(parsed)
        except llm_client.LLMError as exc:
            print(f"[LLM ERROR - falling back to placeholder evaluation] {exc}")

    return _fallback_evaluation()
