"""
LLM client wrapper.

This is the ONLY file in the project that knows we are using Google
Gemini. Every other module calls `generate(prompt)` and gets plain
text back. If you ever switch providers (OpenAI, Anthropic, etc.),
only this file needs to change.

Uses Gemini's REST API directly via httpx, so we don't need to
depend on a provider-specific SDK.
"""

import os
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

TIMEOUT_SECONDS = 60


class LLMError(Exception):
    """Raised when the LLM call fails or returns something unusable."""


def is_configured() -> bool:
    """True if an API key is present. Lets routes/services decide
    whether to attempt an AI call or go straight to fallback data."""
    return bool(GEMINI_API_KEY)


def generate(prompt: str) -> str:
    """
    Send `prompt` to Gemini and return the raw text response.

    Raises LLMError on any failure (missing key, network error,
    non-200 response, empty/malformed response body). Callers are
    expected to catch LLMError and fall back to safe demo behavior —
    per project rules, we NEVER fake an AI result as if it were real.
    """
    if not GEMINI_API_KEY:
        raise LLMError("GEMINI_API_KEY is not set in the environment (.env).")

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": 2048,
        },
    }

    # Gemini occasionally returns 503 (overloaded) or 429 (rate limited) under
    # normal load — these are transient, not real failures, so retry briefly
    # before giving up and falling back to demo data.
    max_attempts = 3
    last_error: str = ""

    for attempt in range(1, max_attempts + 1):
        try:
            response = httpx.post(
                GEMINI_URL,
                params={"key": GEMINI_API_KEY},
                json=payload,
                timeout=TIMEOUT_SECONDS,
            )
        except httpx.RequestError as exc:
            last_error = f"Network error calling Gemini: {exc}"
            if attempt < max_attempts:
                time.sleep(2 * attempt)
                continue
            raise LLMError(last_error) from exc

        if response.status_code in (503, 429) and attempt < max_attempts:
            last_error = f"Gemini API returned status {response.status_code} (transient), retrying..."
            print(f"[LLM RETRY {attempt}/{max_attempts}] {last_error}")
            time.sleep(2 * attempt)
            continue

        if response.status_code != 200:
            raise LLMError(
                f"Gemini API returned status {response.status_code}: {response.text[:300]}"
            )

        try:
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, ValueError) as exc:
            raise LLMError(f"Unexpected Gemini response shape: {exc}") from exc

        if not text or not text.strip():
            raise LLMError("Gemini returned an empty response.")

        return text.strip()

    raise LLMError(last_error or "Gemini API failed after retries.")
