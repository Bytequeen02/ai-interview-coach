"""
Test suite for the AI Interview Coach backend.

Design notes:
- Uses FastAPI's TestClient (sync, no running server needed).
- AI calls are monkeypatched so tests are fast, deterministic, and never
  depend on a real GEMINI_API_KEY or network access — anyone (including
  Vanshika) can run `pytest` immediately after cloning the repo.
- Tests that specifically exercise the FALLBACK path monkeypatch
  llm_client.is_configured() to return False.
- Tests that exercise the AI-success path monkeypatch llm_client.generate()
  to return a canned valid JSON string.

Run with:  pytest -v   (from the backend/ directory)
"""

import json

import pytest
from fastapi.testclient import TestClient

import main
from services import llm_client, session_store
from services.json_utils import extract_json

client = TestClient(main.app)

VALID_START_PAYLOAD = {
    "candidate_name": "Test Candidate",
    "target_role": "Backend Developer",
    "experience_level": "Fresher",
    "interview_type": "Technical",
    "num_questions": 2,
}


# ---------------------------------------------------------------------------
# 1. Health endpoint
# ---------------------------------------------------------------------------

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "llm_configured" in body
    assert "active_sessions" in body


# ---------------------------------------------------------------------------
# 2. Interview creation (valid) — forced fallback path for determinism
# ---------------------------------------------------------------------------

def test_start_interview_valid(monkeypatch):
    monkeypatch.setattr(llm_client, "is_configured", lambda: False)

    response = client.post("/api/interview/start", json=VALID_START_PAYLOAD)
    assert response.status_code == 200
    body = response.json()

    assert "session_id" in body and len(body["session_id"]) > 0
    assert body["total_questions"] == 2
    assert body["first_question"]["question_id"] == 1
    assert body["first_question"]["category"] == "Introduction"
    assert body["first_question"]["is_fallback"] is True


# ---------------------------------------------------------------------------
# 3. Invalid interview request
# ---------------------------------------------------------------------------

def test_start_interview_missing_field():
    payload = {k: v for k, v in VALID_START_PAYLOAD.items() if k != "target_role"}
    response = client.post("/api/interview/start", json=payload)
    assert response.status_code == 422
    assert any(err["loc"][-1] == "target_role" for err in response.json()["detail"])


def test_start_interview_invalid_num_questions():
    payload = {**VALID_START_PAYLOAD, "num_questions": 0}
    response = client.post("/api/interview/start", json=payload)
    assert response.status_code == 422


def test_start_interview_invalid_experience_level():
    payload = {**VALID_START_PAYLOAD, "experience_level": "Expert"}  # not a valid enum value
    response = client.post("/api/interview/start", json=payload)
    assert response.status_code == 422


def test_start_interview_blank_candidate_name():
    payload = {**VALID_START_PAYLOAD, "candidate_name": "   "}
    response = client.post("/api/interview/start", json=payload)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# 4. Answer submission (valid) — mocked AI success path
# ---------------------------------------------------------------------------

FAKE_EVALUATION_JSON = json.dumps({
    "overall_score": 8.0,
    "relevance": 8,
    "technical_accuracy": 8,
    "completeness": 8,
    "clarity": 8,
    "communication": 8,
    "strengths": ["Clear explanation", "Good example"],
    "improvements": ["Could be more concise"],
    "feedback": "Solid answer overall.",
    "improved_answer": "An even stronger version of the answer.",
})


def _start_session(monkeypatch, num_questions=2):
    monkeypatch.setattr(llm_client, "is_configured", lambda: False)  # deterministic question gen
    payload = {**VALID_START_PAYLOAD, "num_questions": num_questions}
    response = client.post("/api/interview/start", json=payload)
    return response.json()["session_id"]


def test_answer_submission_valid(monkeypatch):
    session_id = _start_session(monkeypatch)

    # Now simulate a working AI for the evaluation call.
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", lambda prompt: FAKE_EVALUATION_JSON)

    response = client.post("/api/interview/answer", json={
        "session_id": session_id,
        "question_id": 1,
        "question": "Tell me about yourself.",
        "answer": "I am a backend developer with FastAPI experience.",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["evaluation"]["overall_score"] == 8.0
    assert body["evaluation"]["is_fallback"] is False
    assert body["is_last_question"] is False


# ---------------------------------------------------------------------------
# 5. Empty answer
# ---------------------------------------------------------------------------

def test_empty_answer_rejected(monkeypatch):
    session_id = _start_session(monkeypatch)
    response = client.post("/api/interview/answer", json={
        "session_id": session_id,
        "question_id": 1,
        "question": "Tell me about yourself.",
        "answer": "",
    })
    assert response.status_code == 422


def test_whitespace_only_answer_rejected(monkeypatch):
    session_id = _start_session(monkeypatch)
    response = client.post("/api/interview/answer", json={
        "session_id": session_id,
        "question_id": 1,
        "question": "Tell me about yourself.",
        "answer": "    ",
    })
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# 6. Invalid session
# ---------------------------------------------------------------------------

def test_answer_invalid_session():
    response = client.post("/api/interview/answer", json={
        "session_id": "nonexistent-session-id",
        "question_id": 1,
        "question": "x",
        "answer": "x",
    })
    assert response.status_code == 404


def test_next_question_invalid_session():
    response = client.get("/api/interview/nonexistent-session-id/next-question")
    assert response.status_code == 404


def test_report_invalid_session():
    response = client.get("/api/interview/nonexistent-session-id/report")
    assert response.status_code == 404


def test_answer_wrong_question_id(monkeypatch):
    session_id = _start_session(monkeypatch)
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", lambda prompt: FAKE_EVALUATION_JSON)

    # question_id 2 doesn't exist yet — question 1 is still pending
    response = client.post("/api/interview/answer", json={
        "session_id": session_id,
        "question_id": 2,
        "question": "x",
        "answer": "some answer",
    })
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# 7. Report generation
# ---------------------------------------------------------------------------

def test_report_before_interview_finished(monkeypatch):
    session_id = _start_session(monkeypatch)
    response = client.get(f"/api/interview/{session_id}/report")
    assert response.status_code == 400


FAKE_REPORT_JSON = json.dumps({
    "strengths": ["Consistent technical depth", "Good communication"],
    "areas_for_improvement": ["Could structure answers better"],
    "interview_summary": "The candidate performed well overall with strong fundamentals.",
    "recommendations": ["Practice the STAR method for behavioral questions."],
})


def test_full_flow_and_report(monkeypatch):
    session_id = _start_session(monkeypatch, num_questions=2)

    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", lambda prompt: FAKE_EVALUATION_JSON)

    r1 = client.post("/api/interview/answer", json={
        "session_id": session_id, "question_id": 1, "question": "x", "answer": "answer one",
    })
    assert r1.status_code == 200
    assert r1.json()["is_last_question"] is False

    nq = client.get(f"/api/interview/{session_id}/next-question")
    assert nq.status_code == 200
    assert nq.json()["question"]["question_id"] == 2

    r2 = client.post("/api/interview/answer", json={
        "session_id": session_id, "question_id": 2, "question": "x", "answer": "answer two",
    })
    assert r2.status_code == 200
    assert r2.json()["is_last_question"] is True

    # Now switch the mocked AI response to the report-shaped JSON for the report call.
    monkeypatch.setattr(llm_client, "generate", lambda prompt: FAKE_REPORT_JSON)

    report = client.get(f"/api/interview/{session_id}/report")
    assert report.status_code == 200
    body = report.json()
    assert body["questions_answered"] == 2
    assert body["overall_score"] == 8.0  # average of two 8.0 evaluations
    assert body["is_fallback"] is False
    assert body["interview_summary"] == "The candidate performed well overall with strong fundamentals."

    # Answering again after finishing must be rejected.
    r3 = client.post("/api/interview/answer", json={
        "session_id": session_id, "question_id": 3, "question": "x", "answer": "too late",
    })
    assert r3.status_code == 400


# ---------------------------------------------------------------------------
# 8. AI response parsing / validation (json_utils robustness)
# ---------------------------------------------------------------------------

def test_extract_json_plain():
    assert extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_with_markdown_fence():
    text = '```json\n{"a": 1, "b": 2}\n```'
    assert extract_json(text) == {"a": 1, "b": 2}


def test_extract_json_with_preamble_text():
    text = 'Sure, here is the result:\n{"a": 1}\nHope that helps!'
    assert extract_json(text) == {"a": 1}


def test_extract_json_with_trailing_comma():
    text = '{"a": 1, "b": 2,}'
    assert extract_json(text) == {"a": 1, "b": 2}


def test_extract_json_unparseable_returns_none():
    assert extract_json("this is not json at all") is None


def test_extract_json_empty_string_returns_none():
    assert extract_json("") is None


# ---------------------------------------------------------------------------
# Evaluation fallback safety (malformed/partial AI output must not crash)
# ---------------------------------------------------------------------------

def test_evaluation_falls_back_on_malformed_ai_json(monkeypatch):
    session_id = _start_session(monkeypatch)
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)
    monkeypatch.setattr(llm_client, "generate", lambda prompt: "not valid json {{{")

    response = client.post("/api/interview/answer", json={
        "session_id": session_id, "question_id": 1, "question": "x", "answer": "some answer",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["evaluation"]["is_fallback"] is True
    assert 0 <= body["evaluation"]["overall_score"] <= 10


def test_evaluation_falls_back_on_llm_error(monkeypatch):
    session_id = _start_session(monkeypatch)
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)

    def raise_error(prompt):
        raise llm_client.LLMError("simulated network failure")

    monkeypatch.setattr(llm_client, "generate", raise_error)

    response = client.post("/api/interview/answer", json={
        "session_id": session_id, "question_id": 1, "question": "x", "answer": "some answer",
    })
    assert response.status_code == 200
    assert response.json()["evaluation"]["is_fallback"] is True
