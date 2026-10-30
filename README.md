# Prepline: AI Mock Interview Coach

A practice tool for placement interviews. The candidate picks a role, sits a video interview with an AI interviewer (voice or typed answers), and gets a score and written feedback for every answer, plus a final report. It also has a timed aptitude round and a history of past sessions.

College project (CSE518-7b).

## What it does

**Interview**
- AI-generated questions for the chosen role, experience level and interview type (Technical, HR, Mixed).
- Interviewer mode: friendly, strict or stress (changes the tone of questions and feedback, never the scoring standard).
- Company style: general, service-based or product-based.
- Optional resume upload (PDF). The questions can then use the candidate's projects and skills.
- Voice input and read-aloud questions (Chrome or Edge).
- Every answer gets scores for relevance, technical accuracy, completeness, clarity and communication, written feedback, and a stronger sample answer.
- Behavioural answers get a STAR checklist (Situation, Task, Action, Result) with a tip.
- The interviewer can ask one short follow-up question after an answer (at most 2 per interview).
- Question difficulty adapts: it goes one step up after strong answers and one step down after weak ones.
- Final report: overall score, category scores, strengths, areas to improve, recommendations.

**Attention monitoring (optional, runs in the browser)**
- Uses MediaPipe Face Landmarker on the interview video. It reports whether a face is visible, whether more than one face is visible, and whether the head is turned away for a sustained time.
- It measures **head orientation only**, not eye tracking. Events are called "potential attention changes". Nothing is called cheating, and no attention score is calculated.
- Video is processed on the device. It is never uploaded or saved.

**Speech information**
- Words per minute and filler words for each answer. These are measurements shown for information, not scores.

**Aptitude round**
- 45 original questions (quantitative, logical reasoning, verbal), timed, scored automatically by code (no AI), with a worked explanation for every question.

**History**
- Scores and counts from past sessions with a simple chart. Stored in a small local SQLite file. Answers, transcripts, video and resume text are never stored.

## Project layout

```
index.html, styles.css, app.js      main page and interview flow
camera.js, video-ui.js              camera and video interview screen
speech.js                           voice input and read-aloud
aptitude.js, history.js             aptitude round and history screens
interview-options.js                follow-up, STAR and speech panels
resume-upload.js                    resume upload
attention/                          attention monitoring module (MediaPipe)
speech-analysis/                    words per minute and filler words
backend/
    main.py                         FastAPI app
    models/schemas.py               request and response shapes
    prompts/prompts.py              prompts for questions, evaluation and the report
    services/                       LLM client, question generator, answer evaluator,
                                    report generator, follow-ups, adaptive difficulty, sessions
    aptitude.py, aptitude_data/     aptitude round and question bank
    history.py                      session history
    resume.py                       resume (PDF) reading
API.md                              request and response contract between frontend and backend
```

Files named `*-mock.js` are development helpers. They only switch on when the page is opened with `?mock=phase2` or `?mock=phase3`, and are not used otherwise.

## Setup (Windows)

You need Python 3.10 or newer, a Google Gemini API key, and Google Chrome (voice input needs Chrome or Edge).

```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r backend\requirements.txt
```

Create `backend\.env` (see `backend\.env.example`):

```
GEMINI_API_KEY=your_key_here
# optional
GEMINI_MODEL=
ADAPTIVE_DIFFICULTY=on
```

## Run

Two terminals, both with the virtual environment active.

Backend (in the `backend` folder):
```powershell
cd backend
python -m uvicorn main:app --reload
```

Frontend (in the project root):
```powershell
python -m http.server 5500
```

Open **http://127.0.0.1:5500** in Chrome. Do not open `index.html` by double-clicking: the attention module needs the page to be served over http.

API documentation (Swagger): http://127.0.0.1:8000/docs

## Tests

```powershell
cd backend
python -m pytest -q                          # backend tests (no real AI calls are made)
cd ..
node attention/test-status.mjs               # attention logic
node speech-analysis/test-speech.mjs         # speech analysis
```

Manual check scripts (they need the backend running and a valid API key) are in `backend/`: `check_modes.py`, `check_star.py`, `check_followups.py`, `check_adaptive.py`, `check_aptitude.py`, and `check_consistency.py` (scores the same answers several times to see how stable the scoring is).

## Privacy and fairness

- Video and webcam frames are processed in the browser and are never uploaded or stored.
- A resume PDF is read in memory and thrown away.
- History keeps scores and counts only.
- Attention events are neutral observations. Looking away does not prove anything, and the report says so.
- The scoring standard is the same in every interviewer mode and company style.

## Known limitations

- Answer scores and feedback come from an AI model, so they can vary a little from run to run and can be wrong. They are practice feedback, not a hiring decision.
- Head-orientation thresholds were tuned by hand on a few people. No accuracy figure is claimed.
- Filler word matching is approximate.
- Interview sessions are kept in memory and are lost when the server restarts.
- There is no login. History belongs to a random id stored in the browser.
- Voice input needs Chrome or Edge and an internet connection.
- Scanned (image-only) PDFs cannot be read as resumes.
- Not deployed: it runs on localhost.

## Team

- Kashish: backend, AI integration, scoring and prompts, API design
- Vanshika: frontend and user interface