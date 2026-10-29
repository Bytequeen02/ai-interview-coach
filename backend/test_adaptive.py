
"""Tests for adaptive difficulty. No network and no real AI are used.
 
Run from the backend folder:  python -m pytest test_adaptive.py -q
"""
 
import json
import re
 
import pytest
from fastapi.testclient import TestClient
 
import main
from services import adaptive, llm_client, question_generator
 
INFO = {
    "candidate_name": "T", "target_role": "Software Engineer", "experience_level": "Fresher",
    "interview_type": "Technical", "num_questions": 4, "mode": "friendly", "company_style": "general",
}
 
 
# ======================= adapt() =======================
 
@pytest.mark.parametrize("base,scores,expected", [
    ("Medium", [9, 8], "Hard"),          # doing well -> harder
    ("Easy", [8.0], "Medium"),
    ("Medium", [3, 4], "Easy"),          # struggling -> easier
    ("Hard", [2], "Medium"),
    ("Medium", [6, 7], "Medium"),        # in between -> unchanged
    ("Medium", [7.4], "Medium"),         # just under the "harder" line
    ("Medium", [7.5], "Hard"),           # exactly on the line
    ("Medium", [5.0], "Medium"),         # exactly on the "easier" line is still fine
    ("Medium", [4.9], "Easy"),
    ("Hard", [10, 10], "Hard"),          # never above Hard
    ("Easy", [0, 1], "Easy"),            # never below Easy
])
def test_adapt(base, scores, expected):
    assert adaptive.adapt(base, scores) == expected
 
 
def test_no_scores_or_unknown_difficulty_changes_nothing():
    assert adaptive.adapt("Medium", []) == "Medium"
    assert adaptive.adapt("Extreme", [9, 9]) == "Extreme"
 
 
def test_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(adaptive, "ENABLED", False)
    assert adaptive.adapt("Medium", [10, 10]) == "Medium"
 
 
# ======================= recent_scores() =======================
 
def session(*items):
    """items: (question_id, category, evaluation or None)"""
    return {
        "questions": [{"question_id": qid, "category": cat} for qid, cat, _ in items],
        "evaluations": {qid: ev for qid, _, ev in items if ev is not None},
    }
 
 
def ev(score, fallback=False):
    return {"overall_score": score, "is_fallback": fallback}
 
 
def test_introduction_is_ignored():
    s = session((1, "Introduction", ev(9.5)), (2, "Technical", ev(4.0)))
    assert adaptive.recent_scores(s) == [4.0]
 
 
def test_placeholder_evaluations_are_ignored():
    s = session((1, "Introduction", ev(8)), (2, "Technical", ev(5.0, fallback=True)), (3, "Technical", ev(8.0)))
    assert adaptive.recent_scores(s) == [8.0]
 
 
def test_only_the_last_two_are_used_in_order():
    s = session((1, "Introduction", ev(7)), (2, "Technical", ev(3)), (3, "Technical", ev(8)), (4, "Technical", ev(9)))
    assert adaptive.recent_scores(s) == [8.0, 9.0]
 
 
def test_unanswered_questions_and_empty_sessions():
    assert adaptive.recent_scores({}) == []
    assert adaptive.recent_scores(session((1, "Introduction", None), (2, "Technical", None))) == []
 
 
# ======================= question generator =======================
 
def test_generator_uses_the_scores_for_the_difficulty(monkeypatch):
    monkeypatch.setattr(llm_client, "is_configured", lambda: False)      # uses the fallback question bank
    base = question_generator.generate_question(INFO, [], 3, 4)["difficulty"]
    harder = question_generator.generate_question(INFO, [], 3, 4, previous_scores=[9, 9])["difficulty"]
    easier = question_generator.generate_question(INFO, [], 3, 4, previous_scores=[2, 3])["difficulty"]
    assert (base, harder, easier) == ("Medium", "Hard", "Easy")
 
 
def test_generator_without_scores_keeps_the_planned_difficulty(monkeypatch):
    monkeypatch.setattr(llm_client, "is_configured", lambda: False)
    plain = question_generator.generate_question(INFO, [], 2, 4)
    assert plain["difficulty"] == "Easy"
 
 
# ======================= full flow through the API =======================
 
class FakeAI:
    def __init__(self, score):
        self.score = score
        self.counter = 0
 
    def generate(self, prompt):
        if "Generate exactly ONE interview question" in prompt:
            self.counter += 1
            category = re.search(r"Required question category: (.+)", prompt).group(1).strip()
            difficulty = re.search(r"Required difficulty: (.+)", prompt).group(1).strip()
            return json.dumps({"question": f"Unique question {self.counter}?", "category": category, "difficulty": difficulty})
        if "Score each dimension" in prompt:
            s = self.score
            return json.dumps({"overall_score": s, "relevance": s, "technical_accuracy": s, "completeness": s,
                               "clarity": s, "communication": s, "strengths": ["a"], "improvements": ["b"],
                               "feedback": "ok", "improved_answer": "better", "follow_up": None})
        return json.dumps({"strengths": ["s"], "areas_for_improvement": ["a"], "interview_summary": "x", "recommendations": ["r"]})
 
 
def run_interview(monkeypatch, score):
    ai = FakeAI(score)
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", ai.generate)
    client = TestClient(main.app)
    start = client.post("/api/interview/start", json={
        "candidate_name": "T", "target_role": "SE", "experience_level": "Fresher",
        "interview_type": "Technical", "num_questions": 4}).json()
    sid, difficulties = start["session_id"], [start["first_question"]["difficulty"]]
    question = start["first_question"]
    for _ in range(3):
        client.post("/api/interview/answer", json={"session_id": sid, "question_id": question["question_id"],
                                                    "question": question["question"], "answer": "my answer here"})
        question = client.get(f"/api/interview/{sid}/next-question").json()["question"]
        difficulties.append(question["difficulty"])
    return difficulties
 
 
def test_strong_answers_make_later_questions_harder(monkeypatch):
    # Q1 Introduction (Easy), Q2 planned Easy, Q3 planned Medium, Q4 planned Medium
    assert run_interview(monkeypatch, 9.0) == ["Easy", "Easy", "Hard", "Hard"]
 
 
def test_weak_answers_make_later_questions_easier(monkeypatch):
    assert run_interview(monkeypatch, 2.0) == ["Easy", "Easy", "Easy", "Easy"]
 
 
def test_average_answers_keep_the_plan(monkeypatch):
    assert run_interview(monkeypatch, 6.0) == ["Easy", "Easy", "Medium", "Medium"]
 