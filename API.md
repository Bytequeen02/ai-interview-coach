# API contract

This file is the single source of truth for how the frontend and the backend talk to each other.
If you change a field, change it here first and tell the team.

**Owners**
- Backend (`backend/main.py`, prompts, interview logic): Kashish
- Frontend (`app.js`, `index.html`, `styles.css`): Vanshika
- Aptitude, history and resume routers, speech analysis module: Ankita

**Conventions**
- Base URL (local): `http://127.0.0.1:8000`
- All requests and responses are JSON, except the resume upload (multipart).
- Errors use FastAPI's default shape: `{ "detail": "human readable message" }` with a 4xx or 5xx status.
- New request fields are **optional**. If a field is missing, the backend uses the old behaviour, so older frontend code keeps working.
- Privacy: no video, no webcam frames, no transcripts and no resume files are stored. History stores scores and counts only.
- Wording: attention events are called "potential attention changes". Nothing in the product calls a candidate a cheater.

---

## 1. Interview (existing, extended)

Source of truth for the existing parts: `backend/main.py` and `backend/models/schemas.py`.
The frontend wrappers are `apiGenerateQuestions`, `apiEvaluateAnswer` and `apiFinalizeReport` in `app.js`.

The backend is **session based** and hands out **one question at a time**.

Flow: `start` -> (`answer` -> `next-question`) repeated -> `report`.

### 1.1 Start (`POST /api/interview/start`)

Request
```json
{
  "candidate_name": "Kashish",
  "target_role": "Software Engineer",
  "experience_level": "Fresher",
  "interview_type": "Technical",
  "num_questions": 5,
  "resume_text": null,
  "job_description": null,
  "mode": "friendly",
  "company_style": "general"
}
```

| Field | Status | Values |
|---|---|---|
| `candidate_name`, `target_role`, `num_questions` | existing | free text, free text, integer |
| `experience_level` | existing | `Fresher`, `Junior`, `Mid`, `Senior` (the UI maps "0-2 yrs" to `Junior` etc.) |
| `interview_type` | existing | `Technical`, `HR`, `Mixed` |
| `resume_text` | existing, optional | max 8000 characters. Plain text from `/api/resume/parse`, or `null` |
| `job_description` | existing, optional | max 4000 characters |
| `mode` | **new, optional** | `friendly` (default), `strict`, `stress`. Any other value returns 422. |
| `company_style` | **new, optional** | `general` (default), `service`, `product`. Any other value returns 422. |

Response
```json
{
  "session_id": "a1b2c3",
  "total_questions": 5,
  "first_question": { "question_id": 1, "question": "Tell me about yourself.", "category": "Introduction", "difficulty": "Easy", "is_fallback": false }
}
```

### 1.2 Next question (`GET /api/interview/{session_id}/next-question`)

Response
```json
{
  "session_id": "a1b2c3",
  "finished": false,
  "question": { "question_id": 2, "question": "...", "category": "Technical", "difficulty": "Easy", "is_fallback": false },
  "progress": "2/5"
}
```
When `finished` is `true`, `question` is `null`.

### 1.3 Answer (`POST /api/interview/answer`)

Request
```json
{
  "session_id": "a1b2c3",
  "question_id": 1,
  "question": "Tell me about yourself.",
  "answer": "text of the answer",
  "is_follow_up": false
}
```

Response
```json
{
  "session_id": "a1b2c3",
  "question_id": 1,
  "evaluation": {
    "relevance": 8.0,
    "technical_accuracy": 7.0,
    "clarity": 7.5,
    "communication": 7.2,
    "overall_score": 7.4,
    "completeness": 7.0,
    "strengths": ["..."],
    "improvements": ["..."],
    "feedback": "short feedback text",
    "improved_answer": "a stronger way to say it",
    "is_fallback": false,
    "follow_up": { "follow_up_id": "1f1", "question": "Can you give a concrete example?" },
    "star": { "situation": true, "task": false, "action": true, "result": false, "tip": "Add the result with a number." }
  },
  "is_last_question": false
}
```

- Scores are **0 to 10 floats** in the backend. The frontend multiplies by 10 for display.
- `question_id` is an **integer** (1, 2, 3...). The backend only accepts the current pending question.

| Field | Status | Notes |
|---|---|---|
| `is_follow_up` (request) | **new, optional** | `true` when the answer is for a follow-up question. In that case `question_id` is the id of the **parent** question, and `question` is the follow-up text. |
| `evaluation.follow_up` | **new, optional** | object, or `null` when there is no follow-up. Limit: at most 1 follow-up per question and about 2 per interview. The server enforces this. |
| `evaluation.star` | **new, optional** | only for questions whose `category` is `Behavioral`, otherwise `null`. Each of `situation`, `task`, `action`, `result` is true/false, and `tip` is one short sentence (max 300 characters). If the model output is missing or malformed, the server returns `null`, never an error. The STAR check does not change the numeric scores. |

> Kashish (implementation note): a follow-up answer must be handled **before** the "already finished" check and the "expected question_id" check in `submit_answer`, and it must **not** call `session_store.advance`. Otherwise a follow-up for question 1 (sent after the session already moved on) is rejected. A follow-up answer is scored and stored, but does not change which question is pending.

### 1.4 Final report (`GET /api/interview/{session_id}/report`)

Only works once the interview is finished. The frontend currently uses `overall_score` (0 to 10, shown as 0 to 100) and `interview_summary`.

Full response (`FinalReport` in `models/schemas.py`):
```json
{
  "session_id": "a1b2c3",
  "candidate_name": "Kashish",
  "target_role": "Software Engineer",
  "overall_score": 7.2,
  "category_scores": { "technical": 7.0, "communication": 7.5, "clarity": 7.1, "relevance": 7.4, "completeness": 6.9 },
  "strengths": ["..."],
  "areas_for_improvement": ["..."],
  "interview_summary": "...",
  "recommendations": ["..."],
  "questions_answered": 5,
  "is_fallback": false
}
```

`is_fallback: true` on a question, an evaluation or the report means the AI was unavailable and a placeholder was used. The UI should not present it as a genuine AI result.

---

## 2. Aptitude round (new, Ankita's router: `backend/aptitude.py`)

### 2.1 Start (`POST /api/aptitude/start`)

Request
```json
{ "sections": ["quant", "logical", "verbal"], "count": 20, "difficulty": "mixed" }
```
`difficulty`: `easy`, `medium`, `hard`, `mixed`.

Response
```json
{
  "round_id": "abc123",
  "duration_seconds": 1200,
  "questions": [
    { "id": "q101", "section": "quant", "question": "...", "options": ["A", "B", "C", "D"] }
  ]
}
```
- `duration_seconds` is 60 seconds per question.
- The correct answer and the explanation are **never** sent here.
- If `count` is larger than the question bank, the server returns as many questions as it has.

### 2.2 Submit (`POST /api/aptitude/submit`)

Request
```json
{
  "round_id": "abc123",
  "answers": [ { "id": "q101", "selected_index": 2 }, { "id": "q102", "selected_index": null } ],
  "time_taken_seconds": 845
}
```
`selected_index: null` means the question was skipped.

Response
```json
{
  "total": 20, "correct": 12, "wrong": 5, "skipped": 3, "percent": 60.0,
  "by_section": { "quant": { "correct": 4, "total": 7 }, "logical": { "correct": 5, "total": 7 }, "verbal": { "correct": 3, "total": 6 } },
  "review": [
    { "id": "q101", "question": "...", "options": ["A", "B", "C", "D"],
      "selected_index": 2, "correct_index": 1, "explanation": "...", "is_correct": false }
  ]
}
```
- Scoring is done in code only. The LLM is not involved.
- Unknown `round_id` returns `404`.

---

## 3. Speech analysis (new, frontend module: `speech-analysis/speechAnalyzer.js`)

Not an HTTP endpoint. It is a plain JavaScript function.

```js
import { analyzeSpeech } from "./speech-analysis/speechAnalyzer.js";

analyzeSpeech({ transcript: "um so I built a project...", durationSeconds: 42 });
```

Returns
```json
{
  "wordCount": 96,
  "wordsPerMinute": 137,
  "fillerWords": { "um": 2, "like": 3 },
  "fillerTotal": 5,
  "fillerPerMinute": 7.1,
  "note": "Filler word matching is approximate."
}
```
- `wordsPerMinute` and `fillerPerMinute` are `null` when `durationSeconds < 5` or there are fewer than 15 words.
- These are measurements, not scores. The UI shows them as information only.

---

## 4. History (new, Ankita's router: `backend/history.py`)

`user_id` is a random UUID created in the browser and stored in `localStorage` as `prepline_user_id`. There is no login.

### 4.1 Save (`POST /api/history/save`)
```json
{
  "user_id": "uuid",
  "kind": "interview",
  "created_at": "2026-10-24T10:30:00Z",
  "role": "Software Engineer",
  "mode": "friendly",
  "company_style": "general",
  "overall_score": 72,
  "sections": { "relevance": 80, "clarity": 70 },
  "attention": { "lookingAwayCount": 2, "faceNotVisibleCount": 0 },
  "speech": { "avgWpm": 128, "fillerTotal": 9 }
}
```
`kind` is `interview` or `aptitude`. `overall_score` and the numbers in `sections` are **0 to 100 integers** (the UI scale, not the backend's 0 to 10). All fields except `user_id`, `kind` and `overall_score` are optional.
Response: `{ "ok": true, "id": 1 }`

### 4.2 List (`GET /api/history?user_id=...`)
Response: `{ "sessions": [ ...same shape as save, plus "id"... ] }`, newest first, at most 50.

### 4.3 Delete (`DELETE /api/history?user_id=...`)
Deletes everything stored for that user. Response: `{ "ok": true }`

Stored: scores and counts only. Never answers, transcripts, video or resume text.

---

## 5. Resume (new, Ankita's router: `backend/resume.py`)

### 5.1 Parse (`POST /api/resume/parse`)

Multipart form with a single `file` field. PDF only, maximum 2 MB.

Response
```json
{ "text": "first 6000 characters of the resume text", "char_count": 5400, "truncated": false }
```
- The file is read in memory and discarded. Nothing is written to disk.
- `400` with a clear message for: not a PDF, too large, or a scanned PDF with no extractable text.
- The frontend sends this text as `resume_text` in section 1.1.

---

## 6. Attention monitoring (already merged)

Frontend only. No backend calls. It reads the interview camera stream that `VideoInterviewUI` opened and never opens a camera itself.
See `attention/README.md` for statuses, the event schema and the summary object.

---

## Change log
- Initial version: sections 1 to 6.
- Section 1 aligned with `main.py` and `schemas.py`: one question at a time, integer `question_id`, 0 to 10 scores, `resume_text` and `job_description` already existed.