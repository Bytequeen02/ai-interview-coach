# AI Interview Coach

An AI-powered mock interview platform built as a college project (CSE518-7b). Candidates
practice interviews with AI-generated questions tailored to their target role, get their
answers evaluated by an LLM across multiple dimensions, and receive a full performance
report at the end.

**Team:**
- **Kashish** — Backend, AI/LLM integration, API design
- **Vanshika** — Frontend, UI/UX

---

## Features

- **Interview setup** — candidate name, target role, experience level, interview type, and number of questions
- **AI-generated questions** — role-aware, category-based (Introduction, Technical, Project-based, Behavioral, HR, Situational), increasing in difficulty as the interview progresses
- **AI answer evaluation** — scores each answer on relevance, technical accuracy, completeness, clarity, and communication, plus written feedback and a model "improved answer"
- **Final interview report** — overall score, category breakdown, strengths, areas for improvement, an AI-written summary, and actionable recommendations
- **Demo-safe by design** — if the AI service is ever unavailable (rate limits, network issues), every AI-dependent feature falls back to safe placeholder data instead of crashing, clearly flagged via `is_fallback: true`

---

## Architecture

```
Candidate (browser)
        │
        ▼
 Frontend (HTML/CSS/JS)  ──── fetch() ────▶  FastAPI Backend  ────▶  Gemini API (LLM)
        │                                          │
        └──────────── renders results ◀────────────┘
                                                     │
                                              In-memory session store
```

The frontend and backend are fully decoupled — they only communicate over the REST API
described in [`backend/API_CONTRACT.md`](./backend/API_CONTRACT.md). Either side can be
rebuilt independently as long as that contract is honored.

---

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | Plain HTML, CSS, JavaScript (no framework/build step) |
| Backend    | Python, FastAPI, Pydantic, Uvicorn |
| AI         | Google Gemini API (`gemini-3.6-flash`) |
| Testing    | Pytest (backend, with mocked AI calls) |
| Session storage | In-memory (swappable for a real DB later — see [Future Scope](#future-scope)) |

---

## Folder Structure

```
ai-interview-coach/
├── README.md                  ← you are here
├── index.html                 ← frontend entry point
├── app.js                     ← frontend logic + API integration layer
├── styles.css                 ← frontend styling
│
└── backend/
    ├── main.py                ← FastAPI app + route handlers
    ├── requirements.txt
    ├── .env.example           ← copy to .env and add your Gemini key
    ├── .gitignore
    ├── API_CONTRACT.md         ← full endpoint-by-endpoint request/response spec
    ├── models/
    │   └── schemas.py          ← all Pydantic request/response models
    ├── prompts/
    │   └── prompts.py          ← LLM prompt templates
    ├── services/
    │   ├── llm_client.py       ← Gemini API wrapper (with retry + timeout handling)
    │   ├── question_generator.py
    │   ├── answer_evaluator.py
    │   ├── report_generator.py
    │   ├── session_store.py    ← in-memory session state
    │   └── json_utils.py       ← robust JSON extraction from LLM output
    └── tests/
        └── test_api.py         ← pytest suite (23 tests, AI calls mocked)
```

---

## Setup & Running Locally

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then edit .env and add your real GEMINI_API_KEY
uvicorn main:app --reload
```

Backend runs at `http://127.0.0.1:8000`.
- Interactive API docs (Swagger): `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/api/health`

Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
(no billing setup required, generous free tier).

### Environment Variables

| Variable          | Required | Default              | Notes                                      |
|--------------------|----------|-----------------------|---------------------------------------------|
| `GEMINI_API_KEY`   | Yes*     | —                      | *App still runs without it — falls back to demo data everywhere |
| `GEMINI_MODEL`     | No       | `gemini-3.6-flash`     | Override to use a different Gemini model    |

### 2. Frontend

No build step — plain HTML/CSS/JS.

1. Make sure the backend is running first (frontend calls `http://127.0.0.1:8000`).
2. Open `index.html` directly in a browser, **or** use the VS Code "Live Server" extension
   for auto-reload while editing (right-click `index.html` → Open with Live Server).

---

## API Endpoints (summary)

| Method | Endpoint                                       | Purpose                          |
|--------|--------------------------------------------------|-----------------------------------|
| GET    | `/api/health`                                    | Liveness + AI-configured check    |
| POST   | `/api/interview/start`                           | Start a session, get question 1   |
| GET    | `/api/interview/{session_id}/next-question`      | Get the current pending question  |
| POST   | `/api/interview/answer`                          | Submit an answer, get AI evaluation |
| GET    | `/api/interview/{session_id}/report`             | Get the final interview report    |

Full request/response schemas, field constraints, and error cases:
**[`backend/API_CONTRACT.md`](./backend/API_CONTRACT.md)**

---

## Testing

```bash
cd backend
pytest -v
```

23 tests covering health check, interview creation (valid/invalid), answer submission,
empty/invalid inputs, invalid sessions, report generation, and AI-response parsing/fallback
behavior. All AI calls are mocked, so tests run instantly with no API key or network access
required.

---

## Frontend ↔ Backend Integration Notes

- The backend generates **one question at a time** — question N+1 is only created after
  question N has been answered. `app.js` fetches the next question just-in-time via
  `next-question`, rather than pre-loading the whole interview.
- Backend evaluation scores are **0–10**; the frontend UI displays **0–100**, so `app.js`
  multiplies every score by 10 when reading the API response.
- Backend enums are strict: `experience_level` must be exactly `Fresher` / `Junior` / `Mid` /
  `Senior`. The UI's friendlier labels (e.g. "0–2 yrs") are mapped to these in `app.js`
  (`mapExperienceLevel()`).
- CORS is wide open (`allow_origins=["*"]`) for local development — **tighten this before
  any production deployment** (see note in `backend/main.py`).
- Every AI-dependent response includes `is_fallback: true/false`. The frontend doesn't need
  to branch on this, but it's useful for debugging demo runs — if results look unusually
  generic, check this flag (it usually means the AI service hit a rate limit).

---

## Future Scope

- Persistent storage (MongoDB/PostgreSQL) instead of in-memory sessions, so interviews
  survive a server restart
- User accounts and interview history across sessions
- Resume/JD-aware question generation (fields already exist in the API, not yet exposed in the UI)
- Voice input and speech-based delivery analysis
- Deployment (backend on a cloud host, frontend as a static site) with locked-down CORS
- Behavioral/situational-only interview mode in the frontend UI (backend already supports it)
