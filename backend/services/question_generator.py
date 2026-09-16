"""
AI-based interview question generation, with a safe fallback bank.

Design principle (per project rules): if the LLM is unavailable or
returns something unusable, the interview must still work. Fallback
questions are clearly tagged (`is_fallback: True`) so we never present
canned data as if it were an AI result.
"""

import itertools
from typing import Any, Dict, List

from prompts.prompts import question_generation_prompt
from services import llm_client
from services.json_utils import extract_json

# ---------------------------------------------------------------------------
# Fallback question bank (used only if AI generation is unavailable/fails)
# ---------------------------------------------------------------------------

FALLBACK_QUESTIONS: Dict[str, List[str]] = {
    "Introduction": [
        "Tell me about yourself and your journey towards becoming a {target_role}.",
        "Walk me through your resume, highlighting what's most relevant to this {target_role} role.",
    ],
    "Technical": [
        "What are the core technical skills required for a {target_role}, and how have you developed them?",
        "Describe a challenging technical problem you solved recently and walk me through your approach.",
        "What tools or technologies do you consider essential for a {target_role}, and why?",
        "How do you approach debugging a difficult issue in a system you didn't build yourself?",
    ],
    "Project-based": [
        "Describe a project you're proud of. What was your specific role, and what challenges did you face?",
        "Tell me about a project where you had to learn a new technology quickly. How did you approach it?",
    ],
    "Behavioral": [
        "Describe a time you disagreed with a teammate. How did you handle it?",
        "Tell me about a time you failed at something important. What did you learn from it?",
        "Describe a situation where you had to manage multiple priorities under a tight deadline.",
    ],
    "HR": [
        "Why do you want to work as a {target_role} with us?",
        "Where do you see yourself professionally in the next 3-5 years?",
        "What are your salary expectations, and how did you arrive at that number?",
    ],
    "Situational": [
        "If you were given a task with an unclear deadline and conflicting priorities, how would you handle it?",
        "How would you handle a situation where you disagreed with your manager's technical decision?",
    ],
}

# Category sequences per interview type. "Introduction" always leads.
_CATEGORY_SEQUENCES: Dict[str, List[str]] = {
    "Technical": ["Technical", "Project-based"],
    "Behavioral": ["Behavioral", "Situational"],
    "HR": ["HR", "Behavioral"],
    "Mixed": ["Technical", "Project-based", "Behavioral", "HR", "Situational"],
}


def _pick_category(question_number: int, interview_type: str) -> str:
    """1-indexed question_number. Question 1 is always Introduction."""
    if question_number == 1:
        return "Introduction"
    sequence = _CATEGORY_SEQUENCES.get(interview_type, _CATEGORY_SEQUENCES["Mixed"])
    cycler = itertools.cycle(sequence)
    category = next(cycler)
    for _ in range(question_number - 2):  # advance to the right position
        category = next(cycler)
    return category


def _pick_difficulty(question_number: int, total_questions: int, experience_level: str) -> str:
    progress = question_number / max(total_questions, 1)
    if experience_level == "Fresher":
        return "Easy" if progress <= 0.5 else "Medium"
    if experience_level == "Junior":
        return "Medium" if progress <= 0.7 else "Hard" if progress > 0.85 else "Medium"
    # Mid / Senior
    return "Medium" if progress <= 0.4 else "Hard"


def _fallback_question(
    category: str, difficulty: str, question_id: int, target_role: str, previous_texts: List[str]
) -> Dict[str, Any]:
    bank = FALLBACK_QUESTIONS.get(category, FALLBACK_QUESTIONS["Technical"])
    for template in bank:
        text = template.format(target_role=target_role)
        if text not in previous_texts:
            return {
                "question_id": question_id,
                "question": text,
                "category": category,
                "difficulty": difficulty,
                "is_fallback": True,
            }
    # every template in the bank already used — reuse the first one rather than crash
    return {
        "question_id": question_id,
        "question": bank[0].format(target_role=target_role),
        "category": category,
        "difficulty": difficulty,
        "is_fallback": True,
    }


def generate_question(
    candidate_info: Dict[str, Any],
    previous_questions: List[Dict[str, Any]],
    question_number: int,
    total_questions: int,
) -> Dict[str, Any]:
    """
    Returns a dict shaped like schemas.QuestionOut (plus is_fallback):
    {question_id, question, category, difficulty, is_fallback}
    """
    category = _pick_category(question_number, candidate_info["interview_type"])
    difficulty = _pick_difficulty(question_number, total_questions, candidate_info["experience_level"])
    previous_texts = [q["question"] for q in previous_questions]

    if llm_client.is_configured():
        try:
            prompt = question_generation_prompt(
                candidate_info=candidate_info,
                previous_questions=previous_texts,
                category=category,
                difficulty=difficulty,
                question_number=question_number,
                total_questions=total_questions,
            )
            raw = llm_client.generate(prompt)
            parsed = extract_json(raw)
            if parsed and parsed.get("question") and parsed["question"] not in previous_texts:
                return {
                    "question_id": question_number,
                    "question": parsed["question"].strip(),
                    "category": parsed.get("category", category),
                    "difficulty": parsed.get("difficulty", difficulty),
                    "is_fallback": False,
                }
        except llm_client.LLMError as exc:
            print(f"[LLM ERROR - falling back to demo question] {exc}")  # visible in terminal for debugging

    return _fallback_question(
        category, difficulty, question_number, candidate_info["target_role"], previous_texts
    )
