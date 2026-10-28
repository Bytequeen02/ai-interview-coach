
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