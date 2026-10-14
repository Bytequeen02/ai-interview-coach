# Attention monitor — guide for the team

Ankita built this. Read it before changing the webcam, the interview screen, or the report.

The module watches a `<video>` and reports whether the candidate is facing the screen. It does **not** open the camera, record video, upload frames, or call the backend. Do not label the result as cheating. Say attention or possible distraction.

## Who touches what

| Person | Do this | Do not do this |
|---|---|---|
| Ankita | `attention/` — detection, statuses, events, summary shape | — |
| Vanshika | Restyle `#attentionDock` and the report section if needed | Do not call `getUserMedia` again. One camera already exists. |
| Kashish | Optional: store `getSummary()` on the report API | Do not run a second face model on the server. No video is available to send. |

The interview is already wired. `app.js` opens the camera when the interview starts, keeps that one stream across questions and feedback, and writes the summary onto the report. `attention/demo.html` is only the manual test page. It also opens a camera, but only for that page.

## Files

| File | Role |
|---|---|
| `attention/attentionMonitor.js` | Import this. No build step. |
| `attention/demo.html` | Manual webcam test. |
| `attention/test-status.mjs` | Automated checks. No camera. |
| `attention/WORK-REPORT.md` | Full write-up of the task, the stack, and how detection works. |

## Camera rules

1. Call `getUserMedia` once. Set `video.srcObject`. The interview id is `#interviewVideo`.
2. Pass that same element to `createAttentionMonitor`.
3. On the report, call `stop()`, then `getSummary()`, then stop the tracks, then `destroy()`.
4. `stop()` and `destroy()` do not stop tracks. The page must stop them.
5. `start()` after `destroy()` throws. Create a new monitor for the next interview.
6. Calling `stop()` twice does not record a second event.
7. Keep one monitor for the whole interview. Do not restart it per question.
8. If `getUserMedia` fails, skip `start()`. The interview must continue. Status is `UNAVAILABLE`.

`window.AttentionMonitor.createAttentionMonitor` is the same function after the module loads.

## Plug-in

```html
<video id="interviewVideo" playsinline muted autoplay></video>

<script type="module">
  import { createAttentionMonitor, preloadAttentionEngine } from "./attention/attentionMonitor.js";

  await preloadAttentionEngine();
  const video = document.querySelector("#interviewVideo");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const monitor = createAttentionMonitor({
    video,
    onStatusChange(snapshot) {
      // snapshot.status, snapshot.message, snapshot.direction
    },
    onLookingAwayEnd(event) {
      // event.direction, event.startIso, event.endIso, event.durationMs
    },
  });
  await monitor.start();

  monitor.stop();
  const attention = monitor.getSummary();
  for (const track of stream.getTracks()) track.stop();
  monitor.destroy();
</script>
```

`app.js` already does this. Copy the block only if you build a new page.

Spoken lines (“You’re looking down…”) live in `app.js` (`speakAttentionAlert`). They use `SpeechSynthesisUtterance` and do not cancel the interview question. The module itself does not speak.

## Live snapshot

`onStatusChange` runs when `status` changes. `onFrame` runs about 10 times a second.

| Field | Meaning |
|---|---|
| `status` | `ATTENTIVE`, `LOOKING_AWAY`, `FACE_NOT_DETECTED`, `MULTIPLE_FACES`, `UNAVAILABLE` |
| `message` | Short line. Safe to show as-is. |
| `direction` | `center`, `down`, `up`, `left`, `right`, `closed` |
| `cue` | `ok` facing the screen, `warn` during grace, `away` once confirmed |
| `faceCount` | Faces in this frame |
| `lifecycle` | `idle`, `running`, `released` |
| `pose` | Smoothed yaw, pitch, gaze. Optional. |

| Situation | Status |
|---|---|
| One face, looking at the screen | `ATTENTIVE` |
| Looking down, up, aside, or eyes closed, after the grace period | `LOOKING_AWAY` |
| No face | `FACE_NOT_DETECTED` |
| Two or more faces | `MULTIPLE_FACES` |
| Camera denied, stream ended, or model failed | `UNAVAILABLE` |

A glance under the grace period stays `ATTENTIVE` (`cue` may be `warn`). A clear look down or closed eyes confirms in about 0.45 s. A milder look confirms after about 1.2 s. Looking back for about 0.4 s returns to `ATTENTIVE`.

## Report object

Call `getSummary()` after `stop()`. This is the object to show, and the object to store if the backend later wants it. Do not send the video.

```js
{
  finalStatus: "ATTENTIVE",
  sessionStartedAtMs: 1710000000000,
  sessionStartedAtIso: "2026-10-14T07:30:00.000Z",
  totalLookingAwayEvents: 2,
  totalLookingAwayMs: 8400,
  byDirection: [
    { direction: "down", label: "Looked down", count: 1, durationMs: 3500 },
    { direction: "left", label: "Looked left", count: 1, durationMs: 4900 }
  ],
  events: [
    {
      direction: "down",
      startMs: 1710000001000,
      endMs: 1710000004500,
      startIso: "2026-10-14T07:30:01.000Z",
      endIso: "2026-10-14T07:30:04.500Z",
      durationMs: 3500,
      ongoing: false
    }
  ]
}
```

`direction` on an event is `down`, `up`, `left`, `right`, or `closed`. `byDirection` is the “how many times, which way” tally. The report page already renders it.

## Dependency

Loaded inside `attentionMonitor.js`. No npm install.

- Google MediaPipe Tasks Vision
- Package `@mediapipe/tasks-vision@0.10.32` from jsDelivr
- Face Landmarker model `face_landmarker.task` (float16)
- WASM runtime, GPU then CPU

Serve the site over HTTP. `file://` will not load the model. The longer explanation is in `WORK-REPORT.md`.

## Test

```bash
node attention/test-status.mjs
```

Expected: `attention status tests passed`.

Manual, after Ctrl+F5, on `http://127.0.0.1:5500/attention/demo.html`:

- One person facing the screen → `ATTENTIVE`
- Hold a look down, aside, or close the eyes for about a second → `LOOKING_AWAY`, and a row in the side tally
- Look back → `ATTENTIVE`
- A quick glance → no new row
- Leave the frame → `FACE_NOT_DETECTED`
- Two people → `MULTIPLE_FACES`
- Deny the camera → `UNAVAILABLE`, page stays up
- Stop → tally stays, camera light goes off
