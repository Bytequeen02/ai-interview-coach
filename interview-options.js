/* =========================================================================
   PREPLINE — SMART INTERVIEW OPTIONS (Phase 2 helpers)
   -------------------------------------------------------------------------
   Used by app.js for three things the backend may or may not send yet:
     1. follow-up question   evaluation.follow_up
     2. STAR checklist       evaluation.star
     3. speech information   words per minute + filler words (information only)

   Everything here is optional. If the backend sends nothing, nothing extra is
   shown and the interview works exactly as before.

   The exact follow_up / star fields are still to be confirmed by Kashish, so
   the normalise functions accept both shapes seen so far:
     follow_up: { follow_up_id, question }   (API.md)   or   { id, text }
     star:      { situation, task, action, result, tip }  with true/false values,
                or each value as { ok, tip }, or a separate star.tips object.
   When the final shape is agreed, only normalizeFollowUp / normalizeStar change.

   All text is inserted with textContent, never innerHTML.
   ========================================================================= */
window.InterviewOptions = (() => {
  const $ = (id) => document.getElementById(id);
  const STAR_KEYS = [
    ["situation", "Situation"],
    ["task", "Task"],
    ["action", "Action"],
    ["result", "Result"],
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ============================ NORMALISE ============================ */

  // -> { id, text } or null
  function normalizeFollowUp(raw) {
    if (!raw || typeof raw !== "object") return null;
    const text = String(raw.question ?? raw.text ?? "").trim();
    if (!text) return null;
    return { id: raw.follow_up_id ?? raw.id ?? null, text };
  }

  // -> { items: [{ key, label, ok, tip }], tip } or null
  function normalizeStar(raw) {
    if (!raw || typeof raw !== "object") return null;
    let known = 0;
    const items = STAR_KEYS.map(([key, label]) => {
      const v = raw[key];
      let ok = null;
      let tip = "";
      if (typeof v === "boolean") {
        ok = v;
      } else if (v && typeof v === "object") {
        if (typeof v.ok === "boolean") ok = v.ok;
        else if (typeof v.present === "boolean") ok = v.present;
        if (typeof v.tip === "string") tip = v.tip;
      }
      if (!tip && raw.tips && typeof raw.tips[key] === "string") tip = raw.tips[key];
      if (ok !== null) known++;
      return { key, label, ok, tip: tip.trim() };
    });
    if (!known) return null;
    return { items, tip: typeof raw.tip === "string" ? raw.tip.trim() : "" };
  }

  /* ============================ STAR CHECKLIST ============================ */

  function renderStar(star) {
    const panel = $("fbStar");
    if (!star) { panel.hidden = true; return; }
    const list = $("fbStarList");
    list.textContent = "";
    star.items.filter((i) => i.ok !== null).forEach((i) => {
      const li = el("li", "star-item " + (i.ok ? "is-yes" : "is-no"));
      const mark = el("span", "star-mark", i.ok ? "✓" : "✗");
      mark.setAttribute("aria-hidden", "true");
      const body = el("div", "star-body");
      const head = el("div", "star-head");
      head.append(el("span", "star-label", i.label), el("span", "sr-only", i.ok ? "included" : "missing"));
      body.appendChild(head);
      if (i.tip) body.appendChild(el("div", "star-tip", i.tip));
      li.append(mark, body);
      list.appendChild(li);
    });
    const tip = $("fbStarTip");
    tip.textContent = star.tip;
    tip.hidden = !star.tip;
    panel.hidden = false;
  }

  /* ============================ SPEECH INFORMATION ============================ */

  // Uses Ankita's module when it exists (speech-analysis/speechAnalyzer.js, see API.md section 3).
  // Until it is merged, the import fails quietly and nothing is shown (or the mock is used with ?mock=phase2).
  async function getSpeechMetrics(transcript, durationSeconds, usedVoice) {
    const text = (transcript || "").trim();
    if (!text) return null;
    // Typed answers have no speaking time, so pace is not measured for them.
    const args = { transcript: text, durationSeconds: usedVoice ? durationSeconds : 0 };
    try {
      const mod = await import("./speech-analysis/speechAnalyzer.js");
      if (typeof mod.analyzeSpeech === "function") return mod.analyzeSpeech(args);
    } catch (err) {
      /* module not available yet */
    }
    if (window.Phase2Mock && Phase2Mock.active) return Phase2Mock.analyzeSpeech(args);
    return null;
  }

  function fillerCount(m) {
    if (Number.isFinite(m.fillerTotal)) return m.fillerTotal;
    return Object.values(m.fillerWords || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  }

  function renderSpeech(metrics, usedVoice) {
    const panel = $("fbSpeech");
    if (!metrics) { panel.hidden = true; return; }
    const grid = $("fbSpeechGrid");
    grid.textContent = "";
    const add = (label, value) => {
      const row = el("div");
      row.append(el("dt", "", label), el("dd", "", value));
      grid.appendChild(row);
    };

    add("Words", String(metrics.wordCount ?? 0));
    add("Words per minute", Number.isFinite(metrics.wordsPerMinute)
      ? String(metrics.wordsPerMinute)
      : usedVoice ? "Not enough speech to measure" : "Not measured for typed answers");

    const total = fillerCount(metrics);
    const list = Object.entries(metrics.fillerWords || {})
      .filter(([, n]) => Number(n) > 0)
      .map(([word, n]) => `${word} ×${n}`)
      .join(", ");
    add("Filler words", total > 0 ? `${total}${list ? " — " + list : ""}` : "None found");

    $("fbSpeechNote").textContent = metrics.note || "";
    panel.hidden = false;
  }

  /* ============================ REPORT SUMMARY ============================ */

  // -> { avgWpm|null, fillerTotal, answers } or null
  function summarizeSpeech(evaluations) {
    const withSpeech = (evaluations || []).filter((e) => e.speech);
    if (!withSpeech.length) return null;
    const wpms = withSpeech.map((e) => e.speech.wordsPerMinute).filter(Number.isFinite);
    return {
      avgWpm: wpms.length ? Math.round(wpms.reduce((a, n) => a + n, 0) / wpms.length) : null,
      fillerTotal: withSpeech.reduce((a, e) => a + fillerCount(e.speech), 0),
      answers: withSpeech.length,
    };
  }

  function renderReportSpeech(summary) {
    const panel = $("reportSpeech");
    if (!summary) { panel.hidden = true; return; }
    const grid = $("reportSpeechGrid");
    grid.textContent = "";
    const add = (label, value) => {
      const row = el("div");
      row.append(el("dt", "", label), el("dd", "", value));
      grid.appendChild(row);
    };
    add("Average words per minute", summary.avgWpm !== null ? String(summary.avgWpm) : "Not measured");
    add("Filler words in total", String(summary.fillerTotal));
    add("Answers included", String(summary.answers));
    panel.hidden = false;
  }

  return { normalizeFollowUp, normalizeStar, renderStar, getSpeechMetrics, renderSpeech, summarizeSpeech, renderReportSpeech };
})();
