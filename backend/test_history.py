
"""Tests for the session history API. A temporary database file is used, so nothing real is touched.
 
Run from the backend folder:  python -m pytest test_history.py -q
"""
 
import uuid
 
import pytest
from fastapi.testclient import TestClient
 
import history
import main
 
 
@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(history, "DB_PATH", tmp_path / "test_history.db")
    return TestClient(main.app)
 
 
def new_user():
    return str(uuid.uuid4())
 
 
def body(user_id, **extra):
    data = {"user_id": user_id, "kind": "interview", "overall_score": 72, "role": "Software Engineer"}
    data.update(extra)
    return data
 
 
def test_save_then_list_newest_first(client):
    user = new_user()
    first = client.post("/api/history/save", json=body(user, overall_score=60)).json()
    second = client.post("/api/history/save", json=body(user, overall_score=80, kind="aptitude")).json()
    assert first["ok"] is True and second["id"] > first["id"]
    sessions = client.get("/api/history", params={"user_id": user}).json()["sessions"]
    assert [s["overall_score"] for s in sessions] == [80, 60]
    assert sessions[0]["kind"] == "aptitude"
 
 
def test_all_fields_are_returned(client):
    user = new_user()
    client.post("/api/history/save", json=body(
        user, created_at="2026-10-24T10:30:00Z", mode="strict", company_style="product",
        sections={"relevance": 80, "clarity": 70},
        attention={"lookingAwayCount": 2, "faceNotVisibleCount": 0},
        speech={"avgWpm": 128, "fillerTotal": 9},
    ))
    s = client.get("/api/history", params={"user_id": user}).json()["sessions"][0]
    assert s["created_at"] == "2026-10-24T10:30:00Z"
    assert (s["role"], s["mode"], s["company_style"]) == ("Software Engineer", "strict", "product")
    assert s["sections"] == {"relevance": 80, "clarity": 70}
    assert s["attention"] == {"lookingAwayCount": 2, "faceNotVisibleCount": 0}
    assert s["speech"] == {"avgWpm": 128, "fillerTotal": 9}
 
 
def test_only_required_fields_are_needed(client):
    user = new_user()
    r = client.post("/api/history/save", json={"user_id": user, "kind": "aptitude", "overall_score": 50})
    assert r.status_code == 200
    s = client.get("/api/history", params={"user_id": user}).json()["sessions"][0]
    assert s["sections"] == {} and s["attention"] == {} and s["speech"] == {}
    assert s["created_at"]            # filled in by the server
 
 
def test_one_users_data_never_mixes_with_another(client):
    a, b = new_user(), new_user()
    client.post("/api/history/save", json=body(a, overall_score=10))
    client.post("/api/history/save", json=body(b, overall_score=90))
    assert [s["overall_score"] for s in client.get("/api/history", params={"user_id": a}).json()["sessions"]] == [10]
    assert [s["overall_score"] for s in client.get("/api/history", params={"user_id": b}).json()["sessions"]] == [90]
 
 
def test_delete_removes_only_that_users_history(client):
    a, b = new_user(), new_user()
    client.post("/api/history/save", json=body(a))
    client.post("/api/history/save", json=body(a))
    client.post("/api/history/save", json=body(b))
    r = client.delete("/api/history", params={"user_id": a}).json()
    assert r == {"ok": True, "deleted": 2}
    assert client.get("/api/history", params={"user_id": a}).json()["sessions"] == []
    assert len(client.get("/api/history", params={"user_id": b}).json()["sessions"]) == 1
 
 
def test_text_can_never_be_stored_in_the_number_fields(client):
    user = new_user()
    client.post("/api/history/save", json=body(
        user,
        sections={"clarity": 70, "note": "my private answer", "flag": True},
        attention={"count": 2, "transcript": "hello"},
        speech={"avgWpm": 120, "words": ["a", "b"]},
    ))
    s = client.get("/api/history", params={"user_id": user}).json()["sessions"][0]
    assert s["sections"] == {"clarity": 70}
    assert s["attention"] == {"count": 2}
    assert s["speech"] == {"avgWpm": 120}
 
 
@pytest.mark.parametrize("bad", [
    {"kind": "chat"},
    {"overall_score": -1},
    {"overall_score": 101},
    {"overall_score": "high"},
    {"user_id": "short"},
    {"user_id": "has spaces in it and ;drop"},
])
def test_bad_input_is_rejected(client, bad):
    payload = body(new_user())
    payload.update(bad)
    assert client.post("/api/history/save", json=payload).status_code == 422
 
 
def test_list_and_delete_need_a_valid_user_id(client):
    assert client.get("/api/history").status_code == 422
    assert client.get("/api/history", params={"user_id": "x"}).status_code == 422
    assert client.delete("/api/history", params={"user_id": "x"}).status_code == 422
 
 
def test_unknown_user_gets_an_empty_list(client):
    assert client.get("/api/history", params={"user_id": new_user()}).json() == {"sessions": []}
 
 
def test_list_is_limited_and_old_sessions_are_trimmed(client, monkeypatch):
    monkeypatch.setattr(history, "LIST_LIMIT", 3)
    monkeypatch.setattr(history, "KEEP_PER_USER", 5)
    user = new_user()
    for score in range(8):
        client.post("/api/history/save", json=body(user, overall_score=score))
    assert [s["overall_score"] for s in client.get("/api/history", params={"user_id": user}).json()["sessions"]] == [7, 6, 5]
    monkeypatch.setattr(history, "LIST_LIMIT", 50)
    assert len(client.get("/api/history", params={"user_id": user}).json()["sessions"]) == 5   # only 5 are kept
 
 
def test_sql_in_a_text_field_is_just_text(client):
    user = new_user()
    client.post("/api/history/save", json=body(user, role="x'); DROP TABLE sessions; --"))
    s = client.get("/api/history", params={"user_id": user}).json()["sessions"]
    assert s[0]["role"] == "x'); DROP TABLE sessions; --"
 