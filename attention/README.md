# Attention monitor — guide for the team

Ankita built this. It watches a `<video>` the interview page already opened and reports whether the candidate's head stays toward the screen.

It does not open the camera, record video, upload frames, or call the backend. It does not speak. It does not calculate a cheating score or any attention score. Say "potential attention change" or "possible distraction".

## Open it the right way

Use **Live Server** or **localhost**. Example:

```bash
py -3.11 -m http.server 5500
```

Then open `http://127.0.0.1:5500/`.

Do not open the files with `file://`. This module is an ES module (`import`). Browsers block those imports, and the face model, from a `file://` page.

## What loads, and when

Before the user clicks **Begin interview**, the interview page loads only its own HTML, CSS, and scripts (`index.html`, `styles.css`, `app.js`, `speech.js`). It does **not** open the camera and does **not** download the face model.

The setup screen has a checkbox, **Use camera attention monitoring**, on by default. If the user unchecks it, the interview never calls `getUserMedia` and never loads the detector.

If the box stays checked, **Begin interview** then loads:

| Piece | Where it comes from |
|---|---|
| Library | `@mediapipe/tasks-vision@0.10.32` from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32` |
| WASM runtime | same package, `/wasm` (GPU, then CPU if GPU fails) |
| Face model | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` |

No webcam frame or image is uploaded or stored. Processing stays in the browser. While the dock is visible it says: "Camera attention monitoring is on. Video is processed on your device and is not uploaded or saved."

## Who touches what

| Person | Do this | Do not do this |
|---|---|---|
| Ankita | `attention/` — detection, statuses, events, summary | — |
| Vanshika | Restyle `#attentionDock` and the report section if needed | Do not open a second camera |
| Kashish | Optional: store `getSummary()` on the report API | Do not expect a video file. There isn't one |

`app.js` owns the interview camera. `attention/demo.html` opens a camera only on that test page.

## What the status means

Head orientation only. Blinks, closed eyes, and looking down (thinking or notes) stay `ATTENTIVE`. Iris position is not treated as eye tracking.

| Situation | Status |
|---|---|
| One face, head toward the screen | `ATTENTIVE` |
| Head turned aside or up, after the grace period | `LOOKING_AWAY` (potential attention change) |
| No face, after the grace period is also stored as an episode | `FACE_NOT_DETECTED` |
| Two or more faces | `MULTIPLE_FACES` |
| Camera denied, track ended, or model failed | `UNAVAILABLE` |

A brief glance is not stored. A hard head turn confirms in about 0.45 s. A milder turn confirms after about 1.2 s. Turning back for about 0.4 s returns to `ATTENTIVE`. One continuous turn is one event, not one event per frame.

If the video track ends, the loop stops, listeners are removed, and the status becomes `UNAVAILABLE`. That gap is stored until the interview stops the monitor. The module does not stop camera tracks itself. The page does, so the camera light goes off.

## Report object

`getSummary()` after `stop()`:

```js
{
  totalMonitoringMs: 120000,
  disclaimer: "Looking away is a potential attention change. ...",
  measured: {
    totalMonitoringMs: 120000,
    lookingAway: { label: "Potential attention change", count: 1, totalMs: 3000, events: [] },
    faceNotVisible: { label: "Face not visible", count: 0, totalMs: 0, events: [] },
    multipleFaces: { label: "Multiple faces", count: 0, totalMs: 0, events: [] },
    unavailable: { label: "Monitoring unavailable", count: 0, totalMs: 0, events: [] }
  },
  estimates: []
}
```

`measured` is what the camera actually timed. `estimates` is always empty. There is no overall score.

## Files

| File | Role |
|---|---|
| `attention/attentionMonitor.js` | Import this. No build step. |
| `attention/demo.html` | Manual webcam test. |
| `attention/test-status.mjs` | Automated checks. No camera. |

## Test

```bash
node attention/test-status.mjs
```

Expected: `attention status tests passed`.

### Manual webcam checklist

Hard-refresh (Ctrl+F5), then use Live Server or `http://127.0.0.1:5500/`.

- [ ] Face visible and head toward the screen → `ATTENTIVE`, silent badge only
- [ ] Cover or leave the frame and hold it → `FACE_NOT_DETECTED`, then a face-not-visible row on the report
- [ ] Turn your head and hold it → `LOOKING_AWAY`. Looking down or closing your eyes stays `ATTENTIVE`
- [ ] A quick glance → no new report row. A held turn → exactly one row
- [ ] Two people in frame → `MULTIPLE_FACES`
- [ ] Poor lighting → status may become `FACE_NOT_DETECTED` or stay `ATTENTIVE`. Do not treat either as a score
- [ ] Deny camera permission → `UNAVAILABLE`, interview questions still run
- [ ] Unplug or disable the camera mid-interview → `UNAVAILABLE`, and an unavailable period on the report
- [ ] Uncheck monitoring on the setup screen → camera never turns on, model is not requested
- [ ] End the interview → camera light goes off
