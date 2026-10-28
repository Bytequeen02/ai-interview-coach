
"""Tests for Phase 4: interviewer follow-up questions.
 
No network and no real AI are used. The AI is replaced by a fake that returns
JSON the test controls, so these tests always give the same result.
 
Run from the backend folder:  python -m pytest test_followups.py -q
"""
 
import json
import re
 
import pytest
from fastapi.testclient import TestClient
 
import main
from prompts.prompts import answer_evaluation_prompt
from services import answer_evaluator, followups, llm_client, session_store
 
LONG_ANSWER = "I built a small web project with Python and Flask, used SQLite, and handled input validation."
FOLLOW_UP = "How did you handle errors in that project?"
INFO = {
    "candidate_name": "Test", "target_role": "Software Engineer", "experience_level": "Fresher",
    "interview_type": "Technical", "num_questions": 3, "mode": "friendly", "company_style": "general",
}
 
 
# ======================= rules (services/followups.py) =======================
 
def test_skipped_and_short_answers_get_no_follow_up():
    assert not followups.is_answer_worth_a_follow_up("")
    assert not followups.is_answer_worth_a_follow_up("(No answer was provided for this question.)")
    assert not followups.is_answer_worth_a_follow_up("I do not know")
    assert followups.is_answer_worth_a_follow_up(LONG_ANSWER)
 
 
def test_can_offer_respects_limits():
    assert followups.can_offer({"follow_ups": {}}, 1, LONG_ANSWER)
    assert not followups.can_offer({"follow_ups": {1: {}}}, 1, LONG_ANSWER)          # one per question
    two = {1: {}, 2: {}}
    assert not followups.can_offer({"follow_ups": two}, 3, LONG_ANSWER)              # two per interview
    assert not followups.can_offer({"follow_ups": {}}, 1, "too short")
    assert followups.can_offer({}, 1, LONG_ANSWER)                                   # no follow_ups key yet
 
 
@pytest.mark.parametrize("raw", [None, 5, "", "null", "None", "n/a", "no follow-up", "Why?", "x" * 400])
def test_unusable_follow_ups_are_dropped(raw):
    assert followups.clean_follow_up(raw, "Tell me about yourself.") is None
 
 
def test_follow_up_is_cleaned():
    assert followups.clean_follow_up('  "How did you test it?"  ', "q") == "How did you test it?"
    # two questions are cut down to the first one
    assert followups.clean_follow_up("How did you test it? And how long did it take?", "q") == "How did you test it?"
 
 
def test_repeating_the_original_or_an_earlier_question_is_dropped():
    original = "Explain how a hash map works."
    assert followups.clean_follow_up("explain how a HASH map works", original) is None
    assert followups.clean_follow_up(FOLLOW_UP, "q", already_asked=[FOLLOW_UP.upper()]) is None
 
 
# ======================= prompt =======================
 
def test_prompt_asks_for_follow_up_only_when_allowed():
    allowed = answer_evaluation_prompt(INFO, "q", "a", None, True)
    blocked = answer_evaluation_prompt(INFO, "q", "a", None, False)
    assert '"follow_up"' in allowed and "ONE short follow-up question" in allowed
    assert "follow_up" not in blocked
 
 
def test_follow_up_tone_follows_the_mode():
    stress = answer_evaluation_prompt({**INFO, "mode": "stress"}, "q", "a", None, True)
    friendly = answer_evaluation_prompt({**INFO, "mode": "friendly"}, "q", "a", None, True)
    assert "challenging" in stress and "challenging" not in friendly
 
 
# ======================= evaluator =======================
 
BASE = {
    "overall_score": 7.0, "relevance": 7, "technical_accuracy": 7, "completeness": 7, "clarity": 7,
    "communication": 7, "strengths": ["a"], "improvements": ["b"], "feedback": "ok", "improved_answer": "better",
}
 
 
def fake_ai(monkeypatch, payload):
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", lambda prompt: json.dumps(payload))
 
 
def test_evaluator_returns_clean_follow_up_text_when_allowed(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "follow_up": f" {FOLLOW_UP} "})
    result = answer_evaluator.evaluate_answer(INFO, "q", LONG_ANSWER, None, allow_follow_up=True)
    assert result["follow_up_text"] == FOLLOW_UP
 
 
def test_evaluator_ignores_follow_up_when_not_allowed(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "follow_up": FOLLOW_UP})
    result = answer_evaluator.evaluate_answer(INFO, "q", LONG_ANSWER, None, allow_follow_up=False)
    assert result["follow_up_text"] is None
 
 
def test_evaluator_null_follow_up_is_none(monkeypatch):
    fake_ai(monkeypatch, {**BASE, "follow_up": None})
    assert answer_evaluator.evaluate_answer(INFO, "q", LONG_ANSWER, None, True)["follow_up_text"] is None
 
 
# ======================= session store =======================
 
def test_follow_up_storage_never_touches_main_answers_or_progress():
    sid = session_store.create_session(INFO)
    session_store.record_answer(sid, 1, "main answer")
    session_store.record_evaluation(sid, 1, {"overall_score": 8.0})
    session_store.advance(sid)
    fid = session_store.add_follow_up(sid, 1, FOLLOW_UP)
    assert fid == "1f1"
    session_store.record_follow_up_answer(sid, 1, "follow-up answer", {"overall_score": 2.0})
    session = session_store.get_session(sid)
    assert session["answers"][1] == "main answer"
    assert session["evaluations"][1]["overall_score"] == 8.0
    assert session["current_index"] == 1
    assert session["follow_ups"][1]["answered"] is True
    assert session_store.get_follow_up(sid, 2) is None
    session_store.delete_session(sid)
 
 
# ======================= full flow through the API =======================
 
class FakeAI:
    """Pretends to be Gemini. The follow-up answer gets a low score (2.0) and every main answer
    gets 8.0, so a report that stays at 8.0 proves follow-ups are not counted in it."""
 
    def __init__(self, follow_up=FOLLOW_UP, fail_evaluation=False):
        self.follow_up = follow_up
        self.fail_evaluation = fail_evaluation
        self.counter = 0
 
    def generate(self, prompt):
        if "Generate exactly ONE interview question" in prompt:
            self.counter += 1
            category = re.search(r"Required question category: (.+)", prompt).group(1).strip()
            difficulty = re.search(r"Required difficulty: (.+)", prompt).group(1).strip()
            return json.dumps({"question": f"Unique question number {self.counter}?", "category": category, "difficulty": difficulty})
        if "Score each dimension" in prompt:
            if self.fail_evaluation:
                raise llm_client.LLMError("rate limited")
            score = 2.0 if f'"{FOLLOW_UP}"' in prompt else 8.0
            return json.dumps({**BASE, "overall_score": score, "relevance": score, "technical_accuracy": score,
                               "completeness": score, "clarity": score, "communication": score,
                               "follow_up": self.follow_up})
        return json.dumps({"strengths": ["s"], "areas_for_improvement": ["a"], "interview_summary": "summary",
                           "recommendations": ["r"]})
 
 
@pytest.fixture
def api(monkeypatch):
    def build(**kwargs):
        ai = FakeAI(**kwargs)
        monkeypatch.setattr(llm_client, "is_configured", lambda: True)
        monkeypatch.setattr(llm_client, "generate", ai.generate)
        return TestClient(main.app)
    return build
 
 
def start(client, n=3):
    body = {"candidate_name": "T", "target_role": "SE", "experience_level": "Fresher",
            "interview_type": "Technical", "num_questions": n}
    data = client.post("/api/interview/start", json=body).json()
    return data["session_id"], data["first_question"]
 
 
def answer(client, sid, qid, text=LONG_ANSWER, follow_up=False, question="q"):
    return client.post("/api/interview/answer", json={
        "session_id": sid, "question_id": qid, "question": question, "answer": text, "is_follow_up": follow_up})
 
 
def test_follow_up_is_offered_answered_and_not_counted_in_the_report(api):
    client = api()
    sid, q1 = start(client, 3)
 
    r = answer(client, sid, 1)
    assert r.status_code == 200
    fu = r.json()["evaluation"]["follow_up"]
    assert fu == {"follow_up_id": "1f1", "question": FOLLOW_UP}
 
    r = answer(client, sid, 1, "I returned clear error messages and logged every exception.", follow_up=True, question="ignored")
    assert r.status_code == 200
    assert r.json()["evaluation"]["overall_score"] == 2.0
    assert r.json()["evaluation"]["follow_up"] is None            # no follow-up to a follow-up
 
    # the same follow-up cannot be answered twice
    assert answer(client, sid, 1, LONG_ANSWER, follow_up=True).status_code == 400
 
    # the interview carries on with question 2, as if nothing happened
    nxt = client.get(f"/api/interview/{sid}/next-question").json()
    assert nxt["question"]["question_id"] == 2 and nxt["progress"] == "2/3"
 
    r = answer(client, sid, 2)
    assert r.json()["evaluation"]["follow_up"]["follow_up_id"] == "2f1"      # 2nd (last allowed) follow-up
    assert answer(client, sid, 2, LONG_ANSWER, follow_up=True).status_code == 200
 
    client.get(f"/api/interview/{sid}/next-question")
    r = answer(client, sid, 3)
    assert r.json()["evaluation"]["follow_up"] is None                        # budget of 2 is used up
    assert r.json()["is_last_question"] is True
 
    report = client.get(f"/api/interview/{sid}/report").json()
    assert report["questions_answered"] == 3
    assert report["overall_score"] == 8.0                                      # follow-up scores (2.0) not counted
 
 
def test_follow_up_for_the_last_question_still_works_after_the_session_finished(api):
    client = api()
    sid, _ = start(client, 1)
    r = answer(client, sid, 1)
    assert r.json()["is_last_question"] is True
    assert r.json()["evaluation"]["follow_up"] is not None
    assert answer(client, sid, 1, LONG_ANSWER, follow_up=True).status_code == 200
    assert client.get(f"/api/interview/{sid}/report").status_code == 200
 
 
def test_follow_up_answer_without_an_offered_follow_up_is_rejected(api):
    client = api(follow_up=None)
    sid, _ = start(client, 2)
    assert answer(client, sid, 1).json()["evaluation"]["follow_up"] is None
    assert answer(client, sid, 1, LONG_ANSWER, follow_up=True).status_code == 400
 
 
def test_unknown_session_follow_up_is_404(api):
    client = api()
    assert answer(client, "does-not-exist", 1, LONG_ANSWER, follow_up=True).status_code == 404
 
 
def test_skipped_answer_gets_no_follow_up_even_if_the_ai_suggests_one(api):
    client = api()
    sid, _ = start(client, 2)
    r = answer(client, sid, 1, "(No answer was provided for this question.)")
    assert r.status_code == 200 and r.json()["evaluation"]["follow_up"] is None
 
 
def test_failed_ai_evaluation_gives_no_follow_up_and_does_not_crash(api):
    client = api(fail_evaluation=True)
    sid, _ = start(client, 2)
    r = answer(client, sid, 1)
    assert r.status_code == 200
    assert r.json()["evaluation"]["is_fallback"] is True
    assert r.json()["evaluation"]["follow_up"] is None
 
 
def test_normal_flow_without_is_follow_up_still_works(api):
    client = api()
    sid, _ = start(client, 2)
    r = client.post("/api/interview/answer", json={"session_id": sid, "question_id": 1, "question": "q", "answer": LONG_ANSWER})
    assert r.status_code == 200