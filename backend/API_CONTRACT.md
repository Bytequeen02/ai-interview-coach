# API Contract — AI Interview Coach Backend

Base URL (local dev): `http://127.0.0.1:8000`

All request/response bodies are JSON. All endpoints are prefixed with `/api` except the
two health/root endpoints.

---

## Table of Contents

1. [Health Check](#1-health-check)
2. [Root](#2-root)
3. [Start Interview](#3-start-interview)
4. [Get Next Question](#4-get-next-question)
5. [Submit Answer](#5-submit-answer)
6. [Get Final Report](#6-get-final-report)
7. [Common Enums](#7-common-enums)
8. [Error Response Format](#8-error-response-format)

---

## 1. Health Check

**`GET /api/health`**

Basic liveness check. Also tells you if the LLM key is configured on the server.

**Response `200 OK`**
```json
{
  "status": "ok",
  "llm_configured": true,
  "active_sessions": 3
}
```

---

## 2. Root

**`GET /`**

**Response `200 OK`**
```json
{
  "message": "AI Interview Coach API is running. See /docs for API documentation."
}
```

---

## 3. Start Interview

**`POST /api/interview/start`**

Creates a new interview session and returns the first AI-generated question.

### Request Body

| Field              | Type   | Required | Constraints                          | Notes                                  |
|--------------------|--------|----------|---------------------------------------|-----------------------------------------|
| `candidate_name`   | string | ✅       | 1–100 chars, non-blank                |                                          |
| `target_role`      | string | ✅       | 1–150 chars, non-blank                | e.g. `"Backend Developer"`              |
| `experience_level` | enum   | ✅       | `Fresher` \| `Junior` \| `Mid` \| `Senior` | See [enums](#7-common-enums)        |
| `interview_type`   | enum   | ✅       | `Technical` \| `Behavioral` \| `HR` \| `Mixed` | See [enums](#7-common-enums)   |
| `num_questions`    | int    | ✅       | 1–15                                   | Total questions for the session         |
| `resume_text`      | string | ❌       | max 8000 chars                        | Optional, improves question relevance   |
| `job_description`  | string | ❌       | max 4000 chars                        | Optional, improves question relevance   |

```json
{
  "candidate_name": "Riya Sharma",
  "target_role": "Backend Developer",
  "experience_level": "Fresher",
  "interview_type": "Technical",
  "num_questions": 5,
  "resume_text": "Optional resume text...",
  "job_description": "Optional JD text..."
}
```

### Response `200 OK`

```json
{
  "session_id": "a1b2c3d4-...",
  "total_questions": 5,
  "first_question": {
    "question_id": 1,
    "question": "Can you walk me through a project where you used REST APIs?",
    "category": "Technical",
    "difficulty": "Medium",
    "is_fallback": false
  }
}
```

### Errors

| Status | When |
|--------|------|
| `422`  | Validation error — missing/blank required field, `num_questions` out of range 1–15, string too long, invalid enum value |

Save `session_id` — it's required for every subsequent call.

---

## 4. Get Next Question

**`GET /api/interview/{session_id}/next-question`**

Fetches the current pending question for the session (generates it on first call for that
slot). Safe to call again to re-fetch the same current question (e.g. after a page refresh).

### Path Parameters

| Param        | Type   | Notes                        |
|--------------|--------|-------------------------------|
| `session_id` | string | From `start` response         |

### Response `200 OK` — more questions remain

```json
{
  "session_id": "a1b2c3d4-...",
  "finished": false,
  "question": {
    "question_id": 2,
    "question": "How do you handle authentication in a REST API?",
    "category": "Technical",
    "difficulty": "Medium",
    "is_fallback": false
  },
  "progress": "2/5"
}
```

### Response `200 OK` — interview already finished

```json
{
  "session_id": "a1b2c3d4-...",
  "finished": true,
  "question": null,
  "progress": "5/5"
}
```

### Errors

| Status | When                                  | Body                                      |
|--------|----------------------------------------|--------------------------------------------|
| `404`  | `session_id` doesn't exist            | `{"detail": "Invalid session_id."}`        |

---

## 5. Submit Answer

**`POST /api/interview/answer`**

Submits the candidate's answer to the current pending question and returns the AI evaluation.

### Request Body

| Field         | Type   | Required | Constraints        | Notes                                                        |
|---------------|--------|----------|---------------------|----------------------------------------------------------------|
| `session_id`  | string | ✅       |                     |                                                                  |
| `question_id` | int    | ✅       |                     | Must match the currently pending question (see below)          |
| `question`    | string | ✅       |                     | The question text being answered                                |
| `answer`      | string | ✅       | min 1 char, non-blank | Candidate's answer text                                       |

```json
{
  "session_id": "a1b2c3d4-...",
  "question_id": 2,
  "question": "How do you handle authentication in a REST API?",
  "answer": "I typically use JWT tokens with..."
}
```

### Response `200 OK`

```json
{
  "session_id": "a1b2c3d4-...",
  "question_id": 2,
  "evaluation": {
    "overall_score": 7.5,
    "relevance": 8,
    "technical_accuracy": 7,
    "completeness": 7,
    "clarity": 8,
    "communication": 7.5,
    "strengths": ["Clear explanation of JWT flow", "Mentioned token expiry"],
    "improvements": ["Could mention refresh tokens", "Discuss HTTPS requirement"],
    "feedback": "Good foundational answer, but missing a few security details.",
    "improved_answer": "A stronger answer would also cover...",
    "is_fallback": false
  },
  "is_last_question": false
}
```

All score fields (`overall_score`, `relevance`, `technical_accuracy`, `completeness`,
`clarity`, `communication`) are floats in the range **0–10**.

### Errors

| Status | When                                                                 | Body (example)                                                                                       |
|--------|------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `404`  | `session_id` doesn't exist                                            | `{"detail": "Invalid session_id."}`                                                                     |
| `404`  | `question_id` not found for this session                              | `{"detail": "Question not found for this session. Call next-question first."}`                        |
| `400`  | Session already finished                                              | `{"detail": "This interview session has already finished."}`                                            |
| `400`  | `question_id` doesn't match the currently pending question             | `{"detail": "question_id 3 is not the current pending question (expected 2). Fetch the current question via next-question before submitting an answer."}` |
| `422`  | `answer` blank/missing, or other validation error                     | Standard FastAPI validation error                                                                       |

> **Frontend note:** Always call `next-question` first to get the current `question_id` and
> `question` text, then submit those exact values in the answer request. Submitting an answer
> for a question that isn't currently pending will fail with `400`.

---

## 6. Get Final Report

**`GET /api/interview/{session_id}/report`**

Returns the full interview summary once all questions have been answered.

### Path Parameters

| Param        | Type   | Notes                |
|--------------|--------|------------------------|
| `session_id` | string | From `start` response |

### Response `200 OK`

```json
{
  "session_id": "a1b2c3d4-...",
  "candidate_name": "Riya Sharma",
  "target_role": "Backend Developer",
  "overall_score": 7.2,
  "category_scores": {
    "technical": 7.5,
    "communication": 7.0,
    "clarity": 7.5,
    "relevance": 7.0,
    "completeness": 7.0
  },
  "strengths": ["Strong grasp of REST fundamentals", "Clear communication"],
  "areas_for_improvement": ["Deeper security knowledge", "More concrete examples"],
  "interview_summary": "The candidate demonstrated solid foundational knowledge...",
  "recommendations": ["Review OAuth2 and JWT best practices", "Practice explaining trade-offs out loud"],
  "questions_answered": 5,
  "is_fallback": false
}
```

### Errors

| Status | When                                             | Body (example)                                                                                          |
|--------|----------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| `404`  | `session_id` doesn't exist                        | `{"detail": "Invalid session_id."}`                                                                          |
| `400`  | Interview not finished yet                         | `{"detail": "Interview not finished yet (3/5 questions answered). Submit remaining answers before requesting the report."}` |
| `400`  | No answers evaluated yet for this session           | `{"detail": "No answers have been evaluated for this session."}`                                            |

---

## 7. Common Enums

**`ExperienceLevel`**: `Fresher` · `Junior` · `Mid` · `Senior`

**`InterviewType`**: `Technical` · `Behavioral` · `HR` · `Mixed`

**`QuestionCategory`**: `Introduction` · `Technical` · `Project-based` · `Behavioral` · `HR` · `Situational`

**`Difficulty`**: `Easy` · `Medium` · `Hard`

> Send/expect these exact string values (case-sensitive) — they're the enum's `value`, not
> the enum name.

---

## 8. Error Response Format

Most explicit errors (`400`, `404`) return:

```json
{
  "detail": "Human-readable message describing what went wrong."
}
```

Validation errors (`422`, from Pydantic) return FastAPI's standard shape:

```json
{
  "detail": [
    {
      "loc": ["body", "num_questions"],
      "msg": "ensure this value is less than or equal to 15",
      "type": "value_error.number.not_le"
    }
  ]
}
```

---

## `is_fallback` Flag — What It Means

Several responses (`QuestionOut`, `Evaluation`, `FinalReport`) include an `is_fallback: bool`
field. When `true`, it means the underlying AI call failed and the backend used a safe,
generic placeholder instead of a real AI-generated result. The frontend doesn't need to
handle this specially — the response shape is identical either way — but it's worth logging
or noting during testing/demos if results look unusually generic.
