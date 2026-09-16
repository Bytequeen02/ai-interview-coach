"""
Prompt templates for the AI Interview Coach.

Kept separate from route/service logic so prompts can be tuned
independently and reused. Every prompt instructs the model to return
ONLY JSON — parsing safety net still lives in services/json_utils.py
because LLMs don't always obey perfectly.

Functions added incrementally per phase:
  - question_generation_prompt   (Phase 4)
  - answer_evaluation_prompt     (Phase 5)
  - final_report_prompt          (Phase 6)
"""

from typing import Any, Dict, List


def question_generation_prompt(
    candidate_info: Dict[str, Any],
    previous_questions: List[str],
    category: str,
    difficulty: str,
    question_number: int,
    total_questions: int,
) -> str:
    resume_section = ""
    if candidate_info.get("resume_text"):
        resume_section = f"\nCandidate's resume:\n{candidate_info['resume_text']}\n"

    jd_section = ""
    if candidate_info.get("job_description"):
        jd_section = f"\nJob description:\n{candidate_info['job_description']}\n"

    prev_section = ""
    if previous_questions:
        numbered = "\n".join(f"- {q}" for q in previous_questions)
        prev_section = (
            f"\nQuestions already asked in this interview (do NOT repeat these "
            f"or ask something too similar):\n{numbered}\n"
        )

    return f"""You are an experienced, professional interviewer conducting a {candidate_info['interview_type']} interview
for the role of "{candidate_info['target_role']}". The candidate's experience level is
{candidate_info['experience_level']}.

This is question {question_number} of {total_questions}.
Required question category: {category}
Required difficulty: {difficulty}
{resume_section}{jd_section}{prev_section}
Generate exactly ONE interview question that:
- Matches the required category and difficulty
- Is appropriate for a {candidate_info['experience_level']} candidate applying for {candidate_info['target_role']}
- Is specific and realistic (not generic filler)
- Does not repeat previous questions
- If resume or job description context is provided, use it to make the question more relevant

Respond with ONLY a single JSON object in exactly this shape, and nothing else
(no markdown fences, no explanation before or after):

{{
  "question": "the interview question text",
  "category": "{category}",
  "difficulty": "{difficulty}"
}}
"""


def answer_evaluation_prompt(
    candidate_info: Dict[str, Any],
    question: str,
    answer: str,
) -> str:
    return f"""You are an experienced, fair, and detail-oriented interviewer evaluating a candidate's
answer during a {candidate_info['interview_type']} interview for the role of
"{candidate_info['target_role']}" ({candidate_info['experience_level']} level).

Question asked:
"{question}"

Candidate's answer:
"{answer}"

Evaluate the answer strictly against the question that was actually asked — do not reward
length or confident tone alone. Judge on:
1. Relevance — does it actually answer the question?
2. Technical accuracy — is the content correct (if a technical claim is made)?
3. Completeness — does it cover the key points expected?
4. Clarity — is it easy to follow and well organized?
5. Communication — professional tone, structure, conciseness.

Score each dimension from 1 to 10 (use 1 if the answer is blank, nonsensical, or completely
off-topic). Compute overall_score as a reasonable weighted average, rounded to 1 decimal place.

Also provide:
- 2-4 specific strengths (what the candidate did well)
- 2-4 specific improvements (what's missing or weak)
- a short (2-4 sentence) feedback paragraph written directly to the candidate
- an improved_answer: a stronger model answer to the SAME question, appropriate for the
  candidate's stated experience level

Respond with ONLY a single JSON object in exactly this shape, and nothing else
(no markdown fences, no explanation before or after):

{{
  "overall_score": 7.5,
  "relevance": 8,
  "technical_accuracy": 7,
  "completeness": 7,
  "clarity": 8,
  "communication": 7,
  "strengths": ["...", "..."],
  "improvements": ["...", "..."],
  "feedback": "...",
  "improved_answer": "..."
}}
"""


def final_report_prompt(
    candidate_info: Dict[str, Any],
    qa_pairs: List[Dict[str, Any]],
) -> str:
    """
    qa_pairs: list of {"question": str, "category": str, "answer": str,
                        "overall_score": float}
    """
    transcript_lines = []
    for i, qa in enumerate(qa_pairs, start=1):
        transcript_lines.append(
            f"Q{i} ({qa['category']}, scored {qa['overall_score']}/10): {qa['question']}\n"
            f"Candidate's answer: {qa['answer']}\n"
        )
    transcript = "\n".join(transcript_lines)

    return f"""You are an experienced interview coach writing a final performance report for a candidate
who just completed a {candidate_info['interview_type']} interview for the role of
"{candidate_info['target_role']}" ({candidate_info['experience_level']} level).

Below is the full transcript of questions, the candidate's answers, and the score each
answer received during evaluation:

{transcript}

Based on the FULL interview (not just one answer), write:
1. strengths: 3-5 recurring strong points across the interview (specific, not generic)
2. areas_for_improvement: 3-5 recurring weak points the candidate should work on
3. interview_summary: a concise (4-6 sentence) honest summary of overall performance
4. recommendations: 3-5 concrete, actionable suggestions for improving future interview performance

Respond with ONLY a single JSON object in exactly this shape, and nothing else
(no markdown fences, no explanation before or after):

{{
  "strengths": ["...", "..."],
  "areas_for_improvement": ["...", "..."],
  "interview_summary": "...",
  "recommendations": ["...", "..."]
}}
"""
