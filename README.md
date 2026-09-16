# Prepline — AI Mock Interview Coach (Frontend)

Vamshika's part: Frontend + UI/UX for the CSE project.

## Files

- `index.html` — page structure (all screens: landing, setup, interview, loading, feedback, report)
- `styles.css` — all styling (navy/gold theme, layout, responsive rules)
- `app.js` — app logic, state management, and the mock API layer

## How to run

No build step needed — it's plain HTML/CSS/JS.

1. Open this folder in VS Code.
2. Install the **Live Server** extension (if you don't have it).
3. Right-click `index.html` → **Open with Live Server**.

(Opening `index.html` directly by double-clicking also works, but Live Server gives auto-reload while editing.)

## Backend integration (for Kashish)

All backend calls go through **three functions near the top of `app.js`**, inside the section marked `API LAYER`:

- `apiGenerateQuestions(payload)` → should return `[{ id, text, category }]`
- `apiEvaluateAnswer(payload)` → should return `{ relevance, technical_accuracy, clarity, communication, overall, feedback, improved_answer }`
- `apiFinalizeReport(payload)` → should return `{ readiness, summary }`

Each currently calls a `mock*()` function as a placeholder. To connect the real FastAPI backend:

1. Set `CONFIG.API_BASE_URL` at the top of `app.js` to your backend URL.
2. In each `api*` function, uncomment the `fetch(...)` block and delete the `return mock...(...)` line.
3. Keep the return shape the same — nothing else in the file needs to change.

## Current mock behavior

- Questions come from a small hardcoded bank (`QUESTION_BANK` in `app.js`), with role-aware selection: typing "Data Analyst", "Frontend", or "Product Manager" pulls a curated question set; any other role gets generic questions with the role name filled in; leaving role blank uses a general Software Engineer set.
- Scores are computed from simple heuristics (answer length, keyword overlap with the question, filler-word count) — good enough to demo the full flow believably until real LLM scoring is wired in.
- Questions scored below 60 show a "correct / model answer" on the final report.
