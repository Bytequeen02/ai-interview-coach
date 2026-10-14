# Ankita Sharma — Attention monitoring

College project: Prepline / AI Mock Interview Coach (CSE518).

Owner of this part: **Ankita**.  
Assigned by: **Kashish**.  
Frontend owner for the rest of the interview UI: **Vanshika**.  
Questions, scoring, and the report API: **Kashish**.

Status: **complete on Ankita’s side.** The browser watches the webcam, names the attention state, and writes a structured summary on the interview report. Nothing from this part is still unbuilt.

---

## 1. What the task was

During a mock interview, notice whether the candidate is looking at the screen. This is an attention signal. It is not a cheating verdict. The UI must never say “cheating”.

Required behaviour:

1. **Face detection** — one face, no face, or more than one face.
2. **Head pose and gaze** — looking at the screen versus looking away. Normal small eye movement must not raise an alert.
3. **Looking-away events** — each confirmed look records a direction, a start time, an end time, and a duration. A short glance is ignored.
4. **Five statuses**
   - `ATTENTIVE`
   - `LOOKING_AWAY`
   - `FACE_NOT_DETECTED`
   - `MULTIPLE_FACES`
   - `UNAVAILABLE` (camera denied, stream died, or the model failed)
5. **Reusable module** — it reads a `<video>` that the page already opened. It must not call `getUserMedia` itself, so Vanshika can share one camera.
6. **End-of-interview summary** — how many times the person looked away, in which direction, and for how long.
7. **MediaPipe Face Landmarker** (or a maintained equivalent), with tests, without breaking the existing question-and-answer interview.

Constraints that were part of the task:

- Process frames in the browser. Do not record or upload video.
- Do not send face images to the backend.
- If the camera is denied, the interview questions must still work.

---

## 2. What is done

| Requirement | Where it lives | Done |
|---|---|---|
| Face present / missing / multiple | `attentionMonitor.js` | Yes |
| Head pose and gaze, with grace so a glance is not recorded | `attentionMonitor.js` | Yes |
| Event log: direction, start, end, duration | `getSummary()` | Yes |
| All five statuses | `AttentionStatus` | Yes |
| Shared `<video>`, module never opens the camera | `attentionMonitor.js` | Yes |
| Interview uses that shared camera | `app.js` `startAttention()` | Yes |
| Report shows count, direction, and duration | `renderAttentionReport()` | Yes |
| MediaPipe Face Landmarker | CDN inside the module | Yes |
| Automated tests, no camera needed | `attention/test-status.mjs` | Yes |
| Existing interview still runs if the camera fails | `app.js` | Yes |

Also done after the original list, because the live camera needed it:

- Side glance (eyes aside, head still forward) counts as looking away.
- A slight look down, and fully closed eyes, count as looking away. A blink does not.
- Spoken alert when attention changes, without cutting off the interview question.
- Direction tally on the demo and on the final report: Looked down, Looked up, Looked left, Looked right, Eyes closed.
- The face model downloads when the page opens, so detection starts as soon as the camera is on.

Not part of this task, and not done here: saving `getSummary()` into Kashish’s database. The summary is on the browser report only. If the team wants it stored on the server, that is a backend change.

---

## 3. Tech stack

This feature does not call the FastAPI or Gemini APIs. Those stay Kashish’s path for questions and scoring.

| Piece | What it is |
|---|---|
| Language | Plain JavaScript. No npm, no build step. |
| Page | HTML + CSS. Served over HTTP (`python -m http.server`), not `file://`. |
| Library | **Google MediaPipe Tasks Vision** |
| Package | `@mediapipe/tasks-vision` **version 0.10.32** |
| How it is loaded | ESM from jsDelivr: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32` |
| Classes used | `FaceLandmarker`, `FilesetResolver` |
| Runtime | MediaPipe WASM from the same package (`/wasm`). GPU first, CPU if GPU fails. |
| Model | Face Landmarker float16: `face_landmarker.task` from `storage.googleapis.com/mediapipe-models/...` |
| Model settings | `runningMode: "VIDEO"`, `numFaces: 2`, facial transformation matrix on, blendshapes off |
| Camera API | Browser `navigator.mediaDevices.getUserMedia`. Called by `app.js` and by `attention/demo.html`, never by the module. |
| Spoken alert | Browser Web Speech API, `SpeechSynthesisUtterance`. Not `VoiceUtils.speak`, so the current question is not cancelled. |
| Tests | Node, `node attention/test-status.mjs` |

---

## 4. How detection works

1. The page asks for the webcam and plays it in a `<video>` element.
2. `preloadAttentionEngine()` downloads the Face Landmarker and starts the WASM runtime.
3. About 10 times a second, `detectForVideo(video, timestamp)` returns face landmarks (nose, eye corners, eyelids, iris) and a face count.
4. The module turns those points into numbers:
   - **yaw** — nose shifted left or right between the eyes
   - **pitch** — nose shifted up or down between the eyes and the mouth
   - **gazeX / gazeY** — where the iris sits inside the eye
   - **eyeOpen** — eyelid gap; below 0.14 means the eyes are closed
5. Rules, in order:
   - eyes closed → direction `closed`
   - iris or head down → `down`
   - iris or head up → `up`
   - both eyes agree on a side, or the head turns → `left` or `right`
   - otherwise → `center` (`ATTENTIVE`)
6. A number is smoothed so one noisy frame does not flip the status.
7. Grace period: a strong look (phone down, eyes closed, hard turn) confirms in about **0.45 s**. A milder look confirms in about **1.2 s**. Looking back for about **0.4 s** returns to `ATTENTIVE`. Anything shorter is not stored.
8. `stop()` closes the open event once. `getSummary()` returns the list plus `byDirection` (count and total time per direction).

No frame is saved. The landmarks exist only for that calculation.

---

## 5. Files

| File | Role |
|---|---|
| `attention/attentionMonitor.js` | The reusable module. Import this. |
| `attention/demo.html` | Standalone camera page for manual testing. |
| `attention/test-status.mjs` | Automated checks. |
| `attention/README.md` | Short guide for Kashish and Vanshika. |
| `app.js` | Starts one camera for the real interview, speaks alerts, paints the report. |
| `index.html` | Attention dock on the interview, Attention section on the report. |
| `styles.css` | Dock and report styles. |

---

## 6. How to show it

From `ai-interview-coach`:

```bash
py -3.11 -m http.server 5500
node attention/test-status.mjs
```

- Demo: `http://127.0.0.1:5500/attention/demo.html`
- Interview: `http://127.0.0.1:5500/` (the report section appears after the interview finishes; the question API must be running)

Hard-refresh with Ctrl+F5 after a code change. Hold a look for about a second before it is counted.
