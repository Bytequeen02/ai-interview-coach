window.VideoInterviewUI = (() => {
  let seconds = 0, timer = null;
  const $ = id => document.getElementById(id);
  function setMessage(text, isError=false) {
    $("cameraMessage").textContent = text;
    $("cameraMessage").classList.toggle("is-error", isError);
  }
  async function startInterview() {
    const button = $("startVideoInterview");
    button.disabled = true;
    setMessage("Requesting camera and microphone permission…");
    try {
      const stream = await CameraManager.start();
      $("candidateVideo").srcObject = stream;
      $("cameraPlaceholder").hidden = true;
      $("videoError").textContent = "";
      setMessage("Camera and microphone are ready.");
      await startInterviewFlow();
    } catch (err) {
      setMessage(err.message || "Unable to start video interview.", true);
      $("videoError").textContent = err.message || "Unable to access camera.";
      CameraManager.stop();
    } finally {
      button.disabled = false;
    }
  }
  function onInterviewStarted() {
    seconds = 0; renderClock();
    if (timer) clearInterval(timer);
    timer = setInterval(() => { seconds++; renderClock(); }, 1000);
    const stream = CameraManager.getStream();
    if (stream) {
      $("candidateVideo").srcObject = stream;
      $("cameraPlaceholder").hidden = CameraManager.cameraEnabled;
    }
  }
  function renderClock() {
    const time = `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
    $("videoClock").textContent = time;
    $("qTimer").textContent = time;
  }
  function toggleCamera() {
    const enabled = !CameraManager.cameraEnabled;
    CameraManager.setCamera(enabled);
    $("cameraToggle").textContent = enabled ? "📷 Camera on" : "🚫 Camera off";
    $("cameraPlaceholder").hidden = enabled;
  }
  function toggleMicrophone() {
    const enabled = !CameraManager.microphoneEnabled;
    CameraManager.setMicrophone(enabled);
    $("microphoneToggle").textContent = enabled ? "🎙️ Mic on" : "🔇 Mic muted";
    const mic = $("micBtn");
    if (mic) { mic.disabled = !enabled; mic.title = enabled ? "" : "Unmute the microphone to use dictation"; }
  }
  function endCamera() {
    if (timer) clearInterval(timer);
    timer = null;
    if (typeof finishAttention === "function") finishAttention(); // stop attention monitor before the camera is released
    CameraManager.stop();
    $("candidateVideo").srcObject = null;
    $("cameraPlaceholder").hidden = false;
    $("cameraToggle").textContent = "📷 Camera on";
    $("microphoneToggle").textContent = "🎙️ Mic on";
  }
  $("startVideoInterview").addEventListener("click", startInterview);
  $("cameraToggle").addEventListener("click", toggleCamera);
  $("microphoneToggle").addEventListener("click", toggleMicrophone);
  $("endVideoInterview").addEventListener("click", () => {
    if (confirm("End this interview now? Unsaved answer text may be lost.")) {
      endCamera(); VoiceUtils.stopSpeaking(); VoiceUtils.stopListening();
      showView("view-landing");
    }
  });
  window.addEventListener("beforeunload", endCamera);
  return { onInterviewStarted, endCamera };
})();