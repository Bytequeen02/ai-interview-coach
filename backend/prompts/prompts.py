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
 
Phase 2 adds two optional settings read from candidate_info:
  - mode           friendly | strict | stress   (interviewer tone)
  - company_style  general | service | product  (question style)
Missing or unknown values fall back to friendly / general, so old
requests behave exactly as before. Mode and company style change the
WORDING of questions and feedback only, never the scoring standard.
"""
 
from typing import Any, Dict, List
 
# ---------------------------------------------------------------------------
# Phase 2: interviewer mode and company style
# ---------------------------------------------------------------------------
 
DEFAULT_MODE = "friendly"
DEFAULT_COMPANY_STYLE = "general"
 
# How the interviewer phrases the QUESTION.
MODE_QUESTION_STYLE: Dict[str, str] = {
    "friendly": (
        "Interviewer persona: friendly and encouraging. Phrase the question warmly and "
        "conversationally, as if putting the candidate at ease. A very short friendly phrase "
        "is fine, but the question itself must stay clear and brief."
    ),
    "strict": (
        "Interviewer persona: strict and formal. Phrase the question directly and precisely, "
        "with no small talk and no softening. It should expect a specific, well-structured answer."
    ),
    "stress": (
        "Interviewer persona: fast-paced and high-pressure. Keep the question short "
        "(ideally under 25 words), direct and challenging, and probe depth, trade-offs or "
        "edge cases. The pressure must come only from pace and difficulty, never from insults, "
        "sarcasm, personal remarks or anything demeaning."
    ),
}
 
# How the FEEDBACK text is written (scores are NOT affected).
MODE_FEEDBACK_STYLE: Dict[str, str] = {
    "friendly": (
        "Write the feedback in a warm, encouraging tone: start with what worked, then frame "
        "the weak points as clear next steps."
    ),
    "strict": (
        "Write the feedback in a direct, formal tone: state plainly and precisely what was "
        "missing, without padding or excessive praise."
    ),
    "stress": (
        "Write the feedback in a brisk, no-nonsense tone and include one line on how concise "
        "and direct the answer was. Stay respectful and constructive, with no insults or mockery."
    ),
}
 
# What kind of questions a company type tends to ask.
COMPANY_QUESTION_STYLE: Dict[str, str] = {
    "general": "",
    "service": (
        "Company style: service-based (IT services) companies. Favour practical fundamentals "
        "(core CS subjects, SQL, OOP, the basics of the role's tools), teamwork, client "
        "communication, adaptability and willingness to learn quickly. Avoid very deep system "
        "design or competitive-programming puzzles."
    ),
    "product": (
        "Company style: product-based companies. Favour problem-solving, data structures and "
        "algorithms thinking, depth of understanding, design trade-offs, ownership and "
        "measurable impact. Prefer 'why' and 'what if' questions over plain definitions."
    ),
}
 
# How advice is framed for each company type.
COMPANY_FEEDBACK_STYLE: Dict[str, str] = {
    "general": "",
    "service": (
        "Frame the advice for a service-based company interview (clear explanations, practical "
        "examples, teamwork, communication)."
    ),
    "product": (
        "Frame the advice for a product-based company interview (depth, trade-offs, problem-solving "
        "process, impact)."
    ),
}
 
 
def _mode(candidate_info: Dict[str, Any]) -> str:
    value = str(candidate_info.get("mode") or DEFAULT_MODE).lower()
    return value if value in MODE_QUESTION_STYLE else DEFAULT_MODE
 
 
def _company_style(candidate_info: Dict[str, Any]) -> str:
    value = str(candidate_info.get("company_style") or DEFAULT_COMPANY_STYLE).lower()
    return value if value in COMPANY_QUESTION_STYLE else DEFAULT_COMPANY_STYLE
 
 
def _question_style_section(candidate_info: Dict[str, Any], category: str = "") -> str:
    lines = [MODE_QUESTION_STYLE[_mode(candidate_info)]]
    company = COMPANY_QUESTION_STYLE[_company_style(candidate_info)]
    if company:
        lines.append(company)
    if category == "Introduction":
        lines.append(
            "This is the Introduction question: keep it a simple opening prompt such as "
            "'tell me about yourself'. Company style may only lightly shape it, and it must "
            "not turn into a technical quiz."
        )
    lines.append(
        "The required category and difficulty above, and the candidate's experience level, "
        "always take priority over style."
    )
    return "\nInterview style:\n" + "\n".join(f"- {line}" for line in lines) + "\n"
 
 
def _tone_section(candidate_info: Dict[str, Any], for_report: bool = False) -> str:
    """Tone instructions for evaluation feedback and the final report."""
    lines = [
        "Use exactly the same fair scoring standard in every interviewer mode and company "
        "style. Mode and style change only the tone and framing of the written text, "
        "never the scores or what counts as a good answer.",
        MODE_FEEDBACK_STYLE[_mode(candidate_info)],
    ]
    company = COMPANY_FEEDBACK_STYLE[_company_style(candidate_info)]
    if company:
        lines.append(company)
    if for_report:
        lines.append("Apply this tone to the interview_summary and the recommendations.")
    else:
        lines.append("Apply this tone to the feedback paragraph (the improved_answer stays a neutral model answer).")
    return "\n".join(f"- {line}" for line in lines)
 
 
# ---------------------------------------------------------------------------
# Phase 3: STAR checklist for behavioural questions
# ---------------------------------------------------------------------------
 
# Only "Behavioral" questions ask for a real past experience, so only those get a
# STAR check. Technical, HR (e.g. "why this company") and Situational (hypothetical)
# questions do not.
STAR_CATEGORIES = {"behavioral"}
 
 
def is_star_category(category: Any) -> bool:
    return str(category or "").strip().lower() in STAR_CATEGORIES
 
 
_STAR_INSTRUCTIONS = """
This is a behavioural question, so also run a STAR check on the answer. Mark each part true
only if it is clearly present in the candidate's own words, otherwise false:
- situation: the answer describes the context of ONE specific real example
- task: it says what the candidate's own goal or responsibility was
- action: it describes concrete steps the candidate personally took (not just "we")
- result: it states the outcome, ideally with a measurable effect or a clear lesson learned
Add a "tip": one short sentence about the single most useful missing part. If all four are
present, the tip should suggest making the result more specific or measurable.
The STAR check is an extra checklist. It does not change the scoring standard above.
"""
 
_STAR_JSON_FIELD = ''',
  "star": {"situation": true, "task": true, "action": true, "result": false, "tip": "..."}'''
 
 
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
 
    style_section = _question_style_section(candidate_info, category)
    category_rule = ""
    if is_star_category(category):
        category_rule = (
            "- Asks about ONE specific past experience (for example 'Tell me about a time when...') "
            "so the candidate can answer with a real example\n"
        )
 
    return f"""You are an experienced, professional interviewer conducting a {candidate_info['interview_type']} interview
for the role of "{candidate_info['target_role']}". The candidate's experience level is
{candidate_info['experience_level']}.
 
This is question {question_number} of {total_questions}.
Required question category: {category}
Required difficulty: {difficulty}
{style_section}{resume_section}{jd_section}{prev_section}
Generate exactly ONE interview question that:
- Matches the required category and difficulty
- Is appropriate for a {candidate_info['experience_level']} candidate applying for {candidate_info['target_role']}
- Is specific and realistic (not generic filler)
- Does not repeat previous questions
- If resume or job description context is provided, use it to make the question more relevant
- Follows the interviewer persona and company style described above
- Asks ONE question about ONE topic: no multi-part questions, at most two sentences
- Does not praise, thank or comment on earlier answers (you have not seen them) and does not
  include hints or the answer inside the question
{category_rule}
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
    category: Any = None,
) -> str:
    tone_section = _tone_section(candidate_info)
    use_star = is_star_category(category)
    star_section = _STAR_INSTRUCTIONS if use_star else ""
    star_field = _STAR_JSON_FIELD if use_star else ""
 
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
 
Tone and scoring rules:
{tone_section}
{star_section}
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
  "improved_answer": "..."{star_field}
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
    tone_section = _tone_section(candidate_info, for_report=True)
 
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
 
Tone rules:
{tone_section}
 
Respond with ONLY a single JSON object in exactly this shape, and nothing else
(no markdown fences, no explanation before or after):
 
{{
  "strengths": ["...", "..."],
  "areas_for_improvement": ["...", "..."],
  "interview_summary": "...",
  "recommendations": ["...", "..."]
}}
"""