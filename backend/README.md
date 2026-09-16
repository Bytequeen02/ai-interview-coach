# AI Interview Coach — Backend

FastAPI backend for the AI Interview Coach college project (CSE518-7b).

This README is for quick setup and orientation. For the full endpoint-by-endpoint
request/response spec, see **[API_CONTRACT.md](./API_CONTRACT.md)**.

---

## Tech Stack

- **Framework:** FastAPI
- **Validation:** Pydantic (all request/response shapes are defined in `models/schemas.py`)
- **Docs:** Auto-generated Swagger UI at `/docs` and ReDoc at `/redoc` once the server is running

---

## Project Structure

```
backend/
├── main.py                  # FastAPI app + route handlers (thin — validation + delegation only)
├── models/
│   └── schemas.py           # All Pydantic request/response models
├── services/
│   ├── llm_client.py        # LLM configuration / calls
│   ├── question_generator.py
│   ├── answer_evaluator.py
│   ├── report_generator.py
│   └── session_store.py     # In-memory session state
└── tests/
    └── test_api.py
```

---

## Running Locally

```bash
# from the backend/ directory (same folder as main.py)
pip install -r requirements.txt
uvicorn main:app --reload
```

Server runs at `http://127.0.0.1:8000` by default.

- Interactive Swagger docs: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/api/health`

---

## CORS

CORS is currently **wide open** (`allow_origins=["*"]`) for local development, so the
frontend can call the API from any localhost port (Vite on `5173`, CRA on `3000`, etc.)
without extra config.

> ⚠️ **Before production:** replace `allow_origins=["*"]` with the exact deployed frontend
> origin(s) and reconsider `allow_credentials` if cookies/auth get added later.

---

## Typical Frontend Flow

1. **Start an interview** → `POST /api/interview/start`
   Get back a `session_id` and the first question.
2. **Get the current question** → `GET /api/interview/{session_id}/next-question`
   (Also used to re-fetch the current question if needed — e.g. after a refresh.)
3. **Submit an answer** → `POST /api/interview/answer`
   Get back the AI evaluation for that answer and whether it was the last question.
4. Repeat steps 2–3 until `finished: true` / `is_last_question: true`.
5. **Get the final report** → `GET /api/interview/{session_id}/report`

Full field-level detail for every step is in `API_CONTRACT.md`.

---

## Notes for Frontend Integration

- All session state is currently **in-memory** on the server (`session_store.py`) — restarting
  the backend clears all active sessions.
- Every AI-dependent endpoint (`question_generator`, `answer_evaluator`, `report_generator`)
  has a fallback path and returns `is_fallback: true` when the AI call failed and a safe
  placeholder was used instead. The frontend doesn't need to handle this specially, but it's
  useful to know if answers/questions look generic during testing — check `is_fallback`.
- `question_id` in `answer` submissions **must** match the currently pending question for that
  session, or the API returns a `400`. Always fetch the question via `next-question` before
  submitting an answer for it.

---

## Questions?

Ping the backend dev directly — this README + `API_CONTRACT.md` cover the current state of
all 6 endpoints as of this version. If a field is missing or behaving unexpectedly, it's
probably a bug worth flagging rather than intentional.
