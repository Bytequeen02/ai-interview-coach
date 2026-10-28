"""Tests for the Phase 3 STAR check. No network and no real AI are used:
the AI call is replaced by a fake that returns whatever JSON the test wants.
 
Run from the backend folder:  python -m pytest test_star.py -q
"""
 
import json
 
import pytest
 
from prompts.prompts import answer_evaluation_prompt, is_star_category, question_generation_prompt
from services import answer_evaluator, llm_client
 
INFO = {
    "candidate_name": "Test",
    "target_role": "Software Engineer",
    "experience_level": "Fresher",
    "interview_type": "HR",
    "num_questions": 5,
    "mode": "friendly",
    "company_style": "general",
}
 
BASE = {
    "overall_score": 7.0, "relevance": 7, "technical_accuracy": 7, "completeness": 7,
    "clarity": 7, "communication": 7, "strengths": ["a"], "improvements": ["b"],
    "feedback": "ok", "improved_answer": "better",
}
 
 
def fake_ai(monkeypatch, payload):
    """Make the evaluator think the AI returned `payload` (a dict or a raw string)."""
    text = payload if isinstance(payload, str) else json.dumps(payload)
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", lambda prompt: text)
 
 
def evaluate(category):
    return answer_evaluator.evaluate_answer(INFO, "Tell me about a time...", "my answer", category)
 
 
# ---------- which questions get a STAR check ----------
 
def test_only_behavioral_questions_use_star():
    assert is_star_category("Behavioral")
    assert is_star_category("behavioral ")
    for other in ["Technical", "HR", "Situational", "Introduction", "Project-based", None, ""]:
        assert not is_star_category(other)
 
 
# ---------- prompts ----------
 
def test_behavioral_evaluation_prompt_asks_for_star():
    text = answer_evaluation_prompt(INFO, "q", "a", "Behavioral")
    assert "STAR check" in text
    assert '"star": {"situation"' in text
    assert "does not change the scoring standard" in text
 
 
def test_other_categories_do_not_mention_star():
    for category in ["Technical", "HR", None]:
        text = answer_evaluation_prompt(INFO, "q", "a", category)
        assert "STAR" not in text and '"star"' not in text
 
 
def test_behavioral_question_prompt_asks_for_a_past_experience():
    behavioral = question_generation_prompt(INFO, [], "Behavioral", "Easy", 3, 5)
    technical = question_generation_prompt(INFO, [], "Technical", "Easy", 3, 5)
    assert "specific past experience" in behavioral
    assert "specific past experience" not in technical
 
 
def test_json_example_is_valid_shape_for_both_prompt_kinds():
    text = answer_evaluation_prompt(INFO, "q", "a", "Behavioral")
    start = text.rindex("{\n  \"overall_score\"")
    example = text[start:].strip()
    parsed = json.loads(example.replace("...", "x"))
    assert set(parsed["star"]) == {"situation", "task", "action", "result", "tip"}
 
 
# ---------- parsing the AI output ----------
 
def test_behavioral_answer_gets_star(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "star": {"situation": True, "task": True, "action": True, "result": False, "tip": " Add the result. "}})
    result = evaluate("Behavioral")
    assert result["star"] == {"situation": True, "task": True, "action": True, "result": False, "tip": "Add the result."}
    assert result["is_fallback"] is False
 
 
def test_technical_answer_never_gets_star_even_if_ai_returns_one(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "star": {"situation": True, "task": True, "action": True, "result": True, "tip": ""}})
    assert evaluate("Technical")["star"] is None
 
 
def test_missing_star_block_becomes_none_without_failing_the_evaluation(monkeypatch):
    fake_ai(monkeypatch, BASE)
    result = evaluate("Behavioral")
    assert result["star"] is None
    assert result["overall_score"] == 7.0
    assert result["is_fallback"] is False
 
 
@pytest.mark.parametrize("bad", [
    "not a dict",
    {"situation": True, "task": True, "action": True},          # result missing
    {"situation": True, "task": True, "result": True},          # action missing
    ["situation", "task"],
    None,
])
def test_malformed_star_becomes_none(monkeypatch, bad):
    fake_ai(monkeypatch, {**BASE, "star": bad})
    result = evaluate("Behavioral")
    assert result["star"] is None
    assert result["overall_score"] == 7.0
 
 
def test_string_booleans_and_missing_tip_are_handled(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "star": {"situation": "true", "task": "false", "action": 1, "result": None}})
    star = evaluate("Behavioral")["star"]
    assert star == {"situation": True, "task": False, "action": False, "result": False, "tip": ""}
 
 
def test_very_long_tip_is_cut(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "star": {"situation": True, "task": True, "action": True, "result": True, "tip": "x" * 1000}})
    assert len(evaluate("Behavioral")["star"]["tip"]) == 300
 
 
# ---------- failures never crash the interview ----------
 
def test_unparseable_ai_output_falls_back_with_star_none(monkeypatch):
    fake_ai(monkeypatch, "this is not json at all")
    result = evaluate("Behavioral")
    assert result["is_fallback"] is True
    assert result["star"] is None
 
 
def test_ai_error_falls_back_with_star_none(monkeypatch):
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
 
    def boom(prompt):
        raise llm_client.LLMError("rate limited")
 
    monkeypatch.setattr(llm_client, "generate", boom)
    result = evaluate("Behavioral")
    assert result["is_fallback"] is True
    assert result["star"] is None
 
 
def test_no_api_key_falls_back(monkeypatch):
    monkeypatch.setattr(llm_client, "is_configured", lambda: False)
    result = evaluate("Behavioral")
    assert result["is_fallback"] is True and result["star"] is None