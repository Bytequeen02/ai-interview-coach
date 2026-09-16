"""
Final Interview Report generation (Feature 6).

Scoring (overall_score, category_scores) is computed deterministically
from the stored evaluations — never left to the AI to "recalculate",
so numbers are always consistent and reproducible. The AI is used only
for the qualitative parts: synthesized strengths/improvements across
the whole interview, a narrative summary, and recommendations.
"""

from typing import Any, Dict, List

from prompts.prompts import final_report_prompt
from services import llm_client
from services.json_utils import extract_json


def _round1(value: float) -> float:
    return round(value, 1)


def _compute_scores(evaluations: List[Dict[str, Any]]) -> Dict[str, float]:
    n = len(evaluations)
    overall = sum(e["overall_score"] for e in evaluations) / n
    category_scores = {
        "technical": _round1(sum(e["technical_accuracy"] for e in evaluations) / n),
        "communication": _round1(sum(e["communication"] for e in evaluations) / n),
        "clarity": _round1(sum(e["clarity"] for e in evaluations) / n),
        "relevance": _round1(sum(e["relevance"] for e in evaluations) / n),
        "completeness": _round1(sum(e["completeness"] for e in evaluations) / n),
    }
    return {"overall_score": _round1(overall), "category_scores": category_scores}


def _dedupe_top(items_lists: List[List[str]], top_n: int = 5) -> List[str]:
    """Flatten strengths/improvements from all evaluations, dedupe, cap length."""
    seen = []
    for items in items_lists:
        for item in items:
            if item not in seen:
                seen.append(item)
    return seen[:top_n]


def _fallback_qualitative(candidate_info: Dict[str, Any], overall_score: float) -> Dict[str, Any]:
    return {
        "strengths": ["Completed the full interview and engaged with every question."],
        "areas_for_improvement": [
            "AI-generated qualitative analysis is temporarily unavailable — this is a placeholder summary, not a real assessment."
        ],
        "interview_summary": (
            f"The candidate completed the interview for the {candidate_info['target_role']} "
            f"role with an average score of {overall_score}/10. A detailed AI-generated summary "
            f"could not be produced right now because the AI service was unavailable or returned "
            f"an unusable response."
        ),
        "recommendations": [
            "Review the per-question feedback and improved answers from each evaluation for detailed guidance."
        ],
        "is_fallback": True,
    }


def generate_report(session: Dict[str, Any]) -> Dict[str, Any]:
    """
    session: the full session dict from session_store (must have finished=True
    and at least one evaluation).
    Returns a dict shaped like schemas.FinalReport (minus session_id/candidate_name/
    target_role, which the caller fills in from session/candidate_info directly).
    """
    candidate_info = session["candidate_info"]
    questions = session["questions"]
    evaluations_by_qid = session["evaluations"]
    answers_by_qid = session["answers"]

    evaluations = [evaluations_by_qid[q["question_id"]] for q in questions if q["question_id"] in evaluations_by_qid]
    scores = _compute_scores(evaluations)

    qa_pairs = [
        {
            "question": q["question"],
            "category": q["category"],
            "answer": answers_by_qid.get(q["question_id"], ""),
            "overall_score": evaluations_by_qid[q["question_id"]]["overall_score"],
        }
        for q in questions
        if q["question_id"] in evaluations_by_qid
    ]

    qualitative = None
    if llm_client.is_configured():
        try:
            prompt = final_report_prompt(candidate_info, qa_pairs)
            raw = llm_client.generate(prompt)
            parsed = extract_json(raw)
            if parsed and parsed.get("interview_summary"):
                qualitative = {
                    "strengths": parsed.get("strengths") or _dedupe_top([e["strengths"] for e in evaluations]),
                    "areas_for_improvement": parsed.get("areas_for_improvement")
                    or _dedupe_top([e["improvements"] for e in evaluations]),
                    "interview_summary": parsed["interview_summary"],
                    "recommendations": parsed.get("recommendations") or ["Practice structuring answers using the STAR method."],
                    "is_fallback": False,
                }
        except llm_client.LLMError as exc:
            print(f"[LLM ERROR - falling back to placeholder report] {exc}")

    if qualitative is None:
        qualitative = _fallback_qualitative(candidate_info, scores["overall_score"])

    return {
        "overall_score": scores["overall_score"],
        "category_scores": scores["category_scores"],
        "strengths": qualitative["strengths"],
        "areas_for_improvement": qualitative["areas_for_improvement"],
        "interview_summary": qualitative["interview_summary"],
        "recommendations": qualitative["recommendations"],
        "questions_answered": len(evaluations),
        "is_fallback": qualitative["is_fallback"],
    }
