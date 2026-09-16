"""
Robust JSON extraction from LLM text output.

LLMs frequently wrap JSON in markdown code fences, add a sentence of
preamble/postamble, or produce near-JSON with trailing commas. This
module tries a sequence of increasingly forgiving strategies so the
rest of the app doesn't have to deal with malformed AI output.

Returns None (never raises) if nothing usable could be extracted —
callers are expected to fall back to safe demo data in that case.
"""

import json
import re
from typing import Any, Dict, Optional


def extract_json(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None

    # Strategy 1: the whole string is already valid JSON.
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: strip ```json ... ``` or ``` ... ``` code fences.
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: grab the first {...} block (handles stray preamble/postamble text).
    brace_match = re.search(r"\{.*\}", text, re.DOTALL)
    if brace_match:
        candidate = brace_match.group(0)
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            # Strategy 4: fix common issues — trailing commas before } or ].
            fixed = re.sub(r",\s*([}\]])", r"\1", candidate)
            try:
                return json.loads(fixed)
            except (json.JSONDecodeError, ValueError):
                pass

    return None
