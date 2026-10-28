/* =========================================================================
   PHASE 2 MOCK — TEMPORARY
   -------------------------------------------------------------------------
   Fills in the Phase 2 data the backend does not produce yet, so the UI can be
   seen and tested. It is OFF by default. Turn it on by opening the page with
   ?mock=phase2 on the end of the address, for example:
       http://127.0.0.1:5500/index.html?mock=phase2
   A small "Mock data on" badge is shown while it is active, so fake follow-ups
   are never mistaken for real ones.

   What it adds (only where the backend sent nothing):
     - evaluation.follow_up  on questions 1 and 3 of an interview (max 2 per interview, like the server rule)
     - evaluation.star       on every question that is not "Technical"
     - analyzeSpeech()       same return shape as Ankita's module (API.md section 3),
                             used only when speech-analysis/speechAnalyzer.js does not exist yet

   The backend (Kashish) still has to be running for the rest of the interview:
   this file only adds to the real responses, it does not replace them.

   TO REMOVE THE MOCK LATER:
     1. Delete this file
     2. Delete the <script src="interview-options-mock.js"> line in index.html
   Nothing else depends on it (app.js and interview-options.js check that it exists first).
   ========================================================================= */
window.Phase2Mock = (() => {
  const active = new URLSearchParams(location.search).get("mock") === "phase2";

  if (active) {
    const badge = document.createElement("div");
    badge.className = "mock-badge";
    badge.textContent = "Mock data on (?mock=phase2)";
    document.body.appendChild(badge);
  }

  const FOLLOW_UPS = [
    "Can you give a concrete example of that from a project you worked on?",
    "What was the hardest part of that, and how did you handle it?",
  ];

  const STAR_SAMPLES = [
    { situation: true, task: false, action: true, result: false, tip: "Add the result with a number, for example how much time or effort you saved." },
    { situation: true, task: true, action: true, result: false, tip: "Close with what changed because of your action." },
    { situation: false, task: true, action: true, result: true, tip: "Start by setting the scene in one sentence: where and when this happened." },
  ];

  // evaluation is the raw backend object. Returns a copy with the missing Phase 2 fields added.
  function enrich(evaluation, ctx) {
    const out = { ...evaluation };
    if (ctx.isFollowUp) return out;

    if (!out.follow_up && ctx.questionIndex % 2 === 0 && ctx.questionIndex < 4) {
      out.follow_up = {
        follow_up_id: "mock-f" + ctx.questionIndex,
        question: FOLLOW_UPS[(ctx.questionIndex / 2) % FOLLOW_UPS.length],
      };
    }
    if (!out.star && ctx.category !== "Technical") {
      out.star = STAR_SAMPLES[ctx.questionIndex % STAR_SAMPLES.length];
    }
    return out;
  }

  const FILLERS = ["um", "uh", "like", "you know", "basically", "actually", "sort of", "kind of"];

  // Same shape as analyzeSpeech() in API.md section 3. Measurements only, not scores.
  function analyzeSpeech({ transcript, durationSeconds }) {
    const text = String(transcript || "").toLowerCase();
    const wordCount = (text.match(/\S+/g) || []).length;
    const fillerWords = {};
    let fillerTotal = 0;
    FILLERS.forEach((f) => {
      const n = (text.match(new RegExp("\\b" + f.replace(" ", "\\s+") + "\\b", "g")) || []).length;
      if (n) { fillerWords[f] = n; fillerTotal += n; }
    });
    const measurable = durationSeconds >= 5 && wordCount >= 15;
    const minutes = durationSeconds / 60;
    return {
      wordCount,
      durationSeconds,
      wordsPerMinute: measurable ? Math.round(wordCount / minutes) : null,
      fillerWords,
      fillerTotal,
      fillerPerMinute: measurable ? Math.round((fillerTotal / minutes) * 10) / 10 : null,
      note: "Filler word matching is approximate.",
    };
  }

  return { active, enrich, analyzeSpeech };
})();
