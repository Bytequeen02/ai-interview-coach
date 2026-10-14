/* CameraManager: one shared stream for the interview and attention module. */
window.CameraManager = (() => {
  let stream = null;
  let cameraEnabled = true;
  let microphoneEnabled = true;
  async function start() {
    if (stream && stream.getTracks().some(t => t.readyState === "live")) return stream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera access is not supported here. Open the app on localhost in a modern browser.");
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraEnabled = true; microphoneEnabled = true;
      return stream;
    } catch (error) {
      const messages = {
        NotAllowedError: "Camera/microphone permission was denied. Allow access in your browser settings and try again.",
        NotFoundError: "No camera or microphone was found. Connect a device and try again, or go back to setup.",
        NotReadableError: "The camera or microphone is busy in another app. Close that app and try again.",
        OverconstrainedError: "The selected camera settings are unavailable. Check your device and try again."
      };
      throw new Error(messages[error.name] || "Could not access your camera/microphone. Check browser permissions and try again.");
    }
  }
  function setCamera(enabled) {
    cameraEnabled = !!enabled;
    if (stream) stream.getVideoTracks().forEach(t => { t.enabled = cameraEnabled; });
    return cameraEnabled;
  }
  function setMicrophone(enabled) {
    microphoneEnabled = !!enabled;
    if (stream) stream.getAudioTracks().forEach(t => { t.enabled = microphoneEnabled; });
    return microphoneEnabled;
  }
  function getStream() { return stream; }
  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; cameraEnabled = false; microphoneEnabled = false;
  }
  return { start, setCamera, setMicrophone, getStream, stop, get cameraEnabled(){return cameraEnabled;}, get microphoneEnabled(){return microphoneEnabled;} };
})();
