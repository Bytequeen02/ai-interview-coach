# Video interview UI — run and test

## Run locally (Windows PowerShell)

Keep the FastAPI backend running in one terminal:

```powershell
cd .\backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

In a second terminal, from the project root:

```powershell
python -m http.server 5500
```

Open `http://localhost:5500`. Camera permissions require a secure context such as `localhost` (or HTTPS); do not use a LAN IP for local testing.

## Manual checklist

1. Complete setup and choose **Begin interview**. The video lobby appears; no permission should be requested yet.
2. Choose **Start video interview** and allow camera/microphone access.
3. Check live preview, timer, question progress, replay, typing/dictation and answer submission.
4. Toggle camera and microphone. Camera-off should hide the preview and disable the video track; microphone mute disables the stream audio track.
5. End the interview and confirm the camera/microphone indicator turns off.
6. Deny permission and verify the explanatory message appears.
7. Complete a full interview and verify the camera is released before the report view.

No video is recorded or uploaded by this implementation. Real-device and cross-browser checks must still be done by the team.

## Current limitations

- Attention monitoring is an integration bridge only; it does not perform computer vision. Ankita's module must be registered with `AttentionBridge.register({ start(stream, onEvent), stop() })`.
- Proposed event types: `face_detected`, `face_not_detected`, `looking_away`, `multiple_faces`; optional `message` is supported.
- Browser speech recognition may request its own microphone permission. The app disables the dictation button while the interview microphone is muted, but browser-specific behavior needs real-device testing.
- Ending early stops the session and returns to the landing screen; it does not request a final backend report because the existing API contract has no finish-early endpoint.
