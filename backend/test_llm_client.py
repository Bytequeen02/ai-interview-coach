
"""Tests for services/llm_client.py reading Gemini's response. No network is used.
 
Run from the backend folder:  python -m pytest test_llm_client.py -q
"""
 
import pytest
 
from services import llm_client
 
 
class FakeResponse:
    def __init__(self, body, status=200):
        self._body = body
        self.status_code = status
        self.text = str(body)
 
    def json(self):
        return self._body
 
 
@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setattr(llm_client, "GEMINI_API_KEY", "test-key")
 
 
def reply(monkeypatch, body, status=200):
    monkeypatch.setattr(llm_client.httpx, "post", lambda *a, **k: FakeResponse(body, status))
 
 
def test_single_part_text(monkeypatch):
    reply(monkeypatch, {"candidates": [{"content": {"parts": [{"text": " hello "}]}}]})
    assert llm_client.generate("p") == "hello"
 
 
def test_all_text_parts_are_joined_and_thought_parts_skipped(monkeypatch):
    reply(monkeypatch, {"candidates": [{"content": {"parts": [
        {"text": "thinking...", "thought": True},
        {"text": '{"a": '},
        {"text": "1}"},
    ]}}]})
    assert llm_client.generate("p") == '{"a": 1}'
 
 
def test_max_tokens_is_reported(monkeypatch, capsys):
    reply(monkeypatch, {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": '{"a":'}]}}]})
    llm_client.generate("p")
    assert "output token limit" in capsys.readouterr().out
 
 
def test_empty_or_odd_shapes_raise_llm_error(monkeypatch):
    for body in [{}, {"candidates": []}, {"candidates": [{"content": {"parts": []}}]}, {"candidates": [{"content": {}}]}]:
        reply(monkeypatch, body)
        with pytest.raises(llm_client.LLMError):
            llm_client.generate("p")
 
 
def test_non_200_raises(monkeypatch):
    reply(monkeypatch, {"error": "bad"}, status=400)
    with pytest.raises(llm_client.LLMError):
        llm_client.generate("p")
 
 
def test_missing_key_raises(monkeypatch):
    monkeypatch.setattr(llm_client, "GEMINI_API_KEY", None)
    with pytest.raises(llm_client.LLMError):
        llm_client.generate("p")
 
 
# ======================= retries =======================
 
class RetryResponse(FakeResponse):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body, status)
        self.headers = headers or {}
 
 
OK_BODY = {"candidates": [{"content": {"parts": [{"text": "fine"}]}}]}
 
 
def sequence(monkeypatch, responses):
    """Each call to httpx.post returns the next response. Sleeping is recorded, not done."""
    calls = {"n": 0}
    waits = []
 
    def fake_post(*args, **kwargs):
        response = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        return response
 
    monkeypatch.setattr(llm_client.httpx, "post", fake_post)
    monkeypatch.setattr(llm_client.time, "sleep", lambda seconds: waits.append(seconds))
    return calls, waits
 
 
def test_a_temporary_error_is_retried_and_then_succeeds(monkeypatch):
    calls, waits = sequence(monkeypatch, [RetryResponse({}, 429), RetryResponse({}, 503), RetryResponse(OK_BODY)])
    assert llm_client.generate("p") == "fine"
    assert calls["n"] == 3
    assert waits == [2.0, 4.0]
 
 
def test_retry_after_header_is_used_but_capped(monkeypatch):
    calls, waits = sequence(monkeypatch, [
        RetryResponse({}, 429, {"Retry-After": "7"}),
        RetryResponse({}, 429, {"Retry-After": "500"}),
        RetryResponse(OK_BODY),
    ])
    llm_client.generate("p")
    assert waits == [7.0, float(llm_client.MAX_WAIT_SECONDS)]
 
 
def test_it_gives_up_after_the_last_attempt(monkeypatch):
    calls, waits = sequence(monkeypatch, [RetryResponse({}, 429)])
    with pytest.raises(llm_client.LLMError):
        llm_client.generate("p")
    assert calls["n"] == llm_client.MAX_ATTEMPTS
    assert len(waits) == llm_client.MAX_ATTEMPTS - 1
 
 
def test_real_errors_are_not_retried(monkeypatch):
    calls, waits = sequence(monkeypatch, [RetryResponse({"error": "bad key"}, 400)])
    with pytest.raises(llm_client.LLMError):
        llm_client.generate("p")
    assert calls["n"] == 1 and waits == []
 
 
def test_a_network_error_is_retried(monkeypatch):
    waits = []
    attempts = {"n": 0}
 
    def flaky(*args, **kwargs):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise llm_client.httpx.ConnectError("no network")
        return RetryResponse(OK_BODY)
 
    monkeypatch.setattr(llm_client.httpx, "post", flaky)
    monkeypatch.setattr(llm_client.time, "sleep", lambda seconds: waits.append(seconds))
    assert llm_client.generate("p") == "fine"
    assert attempts["n"] == 3
 