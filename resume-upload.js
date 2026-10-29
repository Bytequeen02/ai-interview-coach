/* =========================================================================
   PREPLINE — RESUME UPLOAD (Phase 3)
   -------------------------------------------------------------------------
   Optional field on the interview setup screen. PDF only, maximum 2 MB.
   The file is sent to POST /api/resume/parse (multipart, one "file" field) and
   the text that comes back is kept in state.candidate.resumeText. app.js sends
   it as resume_text when the questions are generated.

   Privacy (API.md section 5): the server reads the file in memory and discards it.
   The text is never saved in history.

   Backend: Ankita's backend/resume.py. Until it is merged, uploading shows
   "Resume upload isn't available on the server yet." Open the page with
   ?mock=phase3 to see the flow with sample text (phase3-mock.js).

   Needs from app.js: state, CONFIG.API_BASE_URL.
   ========================================================================= */
window.ResumeUpload = (() => {
  "use strict";

  const MAX_BYTES = 2 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  const useMock = () => !!(window.Phase3Mock && Phase3Mock.active);

  /* ============================ API LAYER ============================ */
  // -> { text, char_count, truncated }
  async function apiResumeParse(file) {
    if (useMock()) return Phase3Mock.resume.parse(file);
    const form = new FormData();
    form.append("file", file);
    let res;
    try {
      res = await fetch(`${CONFIG.API_BASE_URL}/api/resume/parse`, { method: "POST", body: form });
    } catch (err) {
      throw new Error("Could not reach the backend. Is the FastAPI server running?");
    }
    if (!res.ok) {
      if (res.status === 404) throw new Error("Resume upload isn't available on the server yet.");
      const data = await res.json().catch(() => ({}));
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : `Could not read the resume (${res.status}).`);
    }
    return res.json();
  }

  /* ============================ UI STATES ============================ */
  function show(which) {
    $("resumeEmpty").hidden = which !== "empty";
    $("resumeLoading").hidden = which !== "loading";
    $("resumeAdded").hidden = which !== "added";
  }

  function showError(message) {
    const box = $("resumeError");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function remove() {
    state.candidate.resumeText = null;
    $("resumeInput").value = "";
    showError("");
    show("empty");
  }

  function validate(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) return "Please choose a PDF file.";
    if (file.size === 0) return "That file is empty.";
    if (file.size > MAX_BYTES) return "That file is larger than 2 MB. Please choose a smaller PDF.";
    return "";
  }

  async function onPick() {
    const input = $("resumeInput");
    const file = input.files && input.files[0];
    if (!file) return;

    showError("");
    const problem = validate(file);
    if (problem) {
      input.value = "";
      showError(problem);
      return;
    }

    show("loading");
    // Do not let the person continue to the interview while the text is still being read.
    const next = $("beginInterview");
    const wasDisabled = next.disabled;
    next.disabled = true;
    try {
      const data = await apiResumeParse(file);
      const text = String(data.text || "").trim();
      if (!text) throw new Error("No text could be read from that PDF.");
      state.candidate.resumeText = text;
      $("resumeFileName").textContent = file.name;
      const note = $("resumeNote");
      note.textContent = data.truncated ? "Your resume is long, so only the first part will be used." : "";
      note.hidden = !data.truncated;
      show("added");
    } catch (err) {
      state.candidate.resumeText = null;
      showError(err.message || "Could not read that resume.");
      show("empty");
    } finally {
      next.disabled = wasDisabled;
      input.value = ""; // lets the same file be chosen again after Remove
    }
  }

  $("resumeInput").addEventListener("change", onPick);
  $("resumeRemove").addEventListener("click", remove);

  return { reset: remove };
})();
