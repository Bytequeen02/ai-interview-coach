/* =========================================================================
   PREPLINE — APTITUDE ROUND UI (Phase 1)
   -------------------------------------------------------------------------
   Flow: landing -> aptitude setup -> timed test -> result + review.
   This file never touches CameraManager, getUserMedia or the microphone, so
   the aptitude round does not ask for camera or mic permission.

   Needs from app.js (loaded before this file): showView(), scoreColorVar()
   and CONFIG.API_BASE_URL. All text is inserted with textContent, never innerHTML.

   Backend: set USE_MOCK = false once POST /api/aptitude/start and
   /api/aptitude/submit are live. The mocks live in aptitude-mock.js only.
   ========================================================================= */
(() => {
  "use strict";

  /* ============================ CONFIG ============================ */
  const USE_MOCK = true;
  const STORAGE_KEY = "prepline_aptitude_active"; // in-progress test, so a refresh does not lose it
  const DEFAULT_STATUS = "AI Mock Interview Coach";
  const SECTION_LABELS = { quant: "Quant", logical: "Logical", verbal: "Verbal" };
  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  const RING_CIRCUMFERENCE = 364; // same ring geometry as the interview report

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ============================ API LAYER ============================
     Shapes are exactly the ones in API.md section 2.
     ================================================================= */
  async function postJson(path, body) {
    let res;
    try {
      res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error("Could not reach the backend. Is the FastAPI server running on " + CONFIG.API_BASE_URL + "?");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `Request failed (${res.status}).`);
    }
    return res.json();
  }

  // req: { sections, count, difficulty } -> { round_id, duration_seconds, questions }
  function apiAptitudeStart(payload) {
    return USE_MOCK ? AptitudeMock.start(payload) : postJson("/api/aptitude/start", payload);
  }

  // req: { round_id, answers: [{ id, selected_index|null }], time_taken_seconds }
  //  -> { total, correct, wrong, skipped, percent, by_section, review }
  function apiAptitudeSubmit(payload) {
    return USE_MOCK ? AptitudeMock.submit(payload) : postJson("/api/aptitude/submit", payload);
  }

  /* ============================ STATE ============================ */
  const setup = { count: 20, difficulty: "mixed" };

  // round: { roundId, durationSeconds, questions, answers:{id:index}, marked:{id:true},
  //          current, startedAt, endsAt }   (endsAt is an absolute timestamp, so the
  //          timer is correct after a refresh or if the tab is in the background)
  let round = null;
  let timerHandle = null;
  let lastShownSeconds = -1;
  let submitting = false;
  let lastResult = null;
  let reviewFilter = "all";

  function saveRound() {
    if (!round) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(round)); } catch (e) { /* storage unavailable */ }
  }
  function clearSavedRound() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }
  function loadSavedRound() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const r = JSON.parse(raw);
      const valid = r && r.roundId && Array.isArray(r.questions) && r.questions.length
        && Number.isFinite(r.endsAt) && Number.isFinite(r.startedAt);
      if (!valid) return null;
      r.answers = r.answers || {};
      r.marked = r.marked || {};
      r.current = Math.min(Math.max(0, r.current | 0), r.questions.length - 1);
      return r;
    } catch (e) {
      return null;
    }
  }

  const isTestActive = () => !!round;

  function announce(message) {
    $("aptLive").textContent = "";
    setTimeout(() => { $("aptLive").textContent = message; }, 50);
  }

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  /* ============================ NAVIGATION ============================ */
  function enterAptitude() {
    $("topStatus").textContent = "Aptitude round";
    showView("view-apt-setup");
  }
  function goHome() {
    $("topStatus").textContent = DEFAULT_STATUS;
    showView("view-landing");
  }

  $("startAptitudeBtn").addEventListener("click", enterAptitude);
  $("aptBackToLanding").addEventListener("click", goHome);
  $("aptAnotherBtn").addEventListener("click", enterAptitude);
  $("aptHomeBtn").addEventListener("click", goHome);

  /* ============================ SETUP SCREEN ============================ */
  function wirePills(groupId, onPick) {
    const pills = Array.from($(groupId).querySelectorAll(".pill"));
    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => {
          const on = p === pill;
          p.classList.toggle("active", on);
          p.setAttribute("aria-pressed", String(on));
        });
        onPick(pill.dataset.value);
      });
    });
  }
  wirePills("aptGrpCount", (v) => { setup.count = Number(v); });
  wirePills("aptGrpDifficulty", (v) => { setup.difficulty = v; });

  function selectedSections() {
    return Array.from(document.querySelectorAll("#aptSections input:checked")).map((i) => i.value);
  }
  function refreshSetupState() {
    const none = selectedSections().length === 0;
    $("aptStartBtn").disabled = none;
    $("aptSectionsHint").textContent = none ? "Choose at least one section to continue." : "";
  }
  document.querySelectorAll("#aptSections input").forEach((i) => i.addEventListener("change", () => {
    $("aptSetupError").textContent = "";
    refreshSetupState();
  }));
  refreshSetupState();

  async function startRound() {
    const sections = selectedSections();
    if (!sections.length) return;
    const btn = $("aptStartBtn");
    btn.disabled = true;
    btn.textContent = "Preparing your test…";
    $("aptSetupError").textContent = "";
    try {
      const data = await apiAptitudeStart({ sections, count: setup.count, difficulty: setup.difficulty });
      const questions = (Array.isArray(data.questions) ? data.questions : [])
        .filter((q) => q && q.id != null && Array.isArray(q.options) && q.options.length >= 2);
      if (!questions.length) {
        throw new Error("No questions are available for this selection. Try other sections or a different difficulty.");
      }
      // The duration comes from the API. The fallback only protects the UI from a malformed response.
      const duration = Number(data.duration_seconds) > 0 ? Number(data.duration_seconds) : questions.length * 60;
      const now = Date.now();
      round = {
        roundId: data.round_id,
        durationSeconds: duration,
        questions,
        answers: {},
        marked: {},
        current: 0,
        startedAt: now,
        endsAt: now + duration * 1000,
      };
      saveRound();
      beginTest();
    } catch (err) {
      $("aptSetupError").textContent = err.message || "Could not start the test. Please try again.";
    } finally {
      btn.textContent = "Start test";
      refreshSetupState();
    }
  }
  $("aptStartBtn").addEventListener("click", startRound);

  /* ============================ TEST SCREEN ============================ */
  function beginTest() {
    submitting = false;
    $("topStatus").textContent = "Aptitude round";
    showView("view-apt-test");
    closePalette();
    renderQuestion();
    startTimer();
    window.scrollTo(0, 0);
  }

  function currentQuestion() { return round.questions[round.current]; }
  function answeredCount() { return Object.keys(round.answers).length; }
  function markedCount() { return Object.keys(round.marked).length; }

  function renderQuestion() {
    const q = currentQuestion();
    const total = round.questions.length;
    $("aptProgressText").textContent = `Question ${round.current + 1} of ${total}`;
    $("aptSectionTag").textContent = SECTION_LABELS[q.section] || q.section || "General";
    $("aptQText").textContent = q.question;

    const box = $("aptOptions");
    box.textContent = "";
    const selected = round.answers[q.id];
    q.options.forEach((text, i) => {
      const label = el("label", "apt-option");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "aptOption";
      input.value = String(i);
      input.checked = selected === i;
      input.addEventListener("change", () => selectOption(i));
      label.append(input, el("span", "apt-letter", LETTERS[i] || String(i + 1)), el("span", "apt-opt-text", text));
      box.appendChild(label);
    });

    $("aptPrevBtn").disabled = round.current === 0;
    $("aptNextBtn").disabled = round.current === total - 1;
    $("aptClearBtn").disabled = selected === undefined;
    const isMarked = !!round.marked[q.id];
    const markBtn = $("aptMarkBtn");
    markBtn.setAttribute("aria-pressed", String(isMarked));
    markBtn.classList.toggle("is-on", isMarked);
    markBtn.textContent = isMarked ? "Marked for review" : "Mark for review";

    renderPalette();
  }

  function renderPalette() {
    const grid = $("aptPaletteGrid");
    grid.textContent = "";
    round.questions.forEach((q, i) => {
      const answered = q.id in round.answers;
      const marked = !!round.marked[q.id];
      const btn = el("button", "apt-qbtn", String(i + 1));
      btn.type = "button";
      btn.classList.toggle("is-answered", answered);
      btn.classList.toggle("is-marked", marked);
      if (i === round.current) {
        btn.classList.add("is-current");
        btn.setAttribute("aria-current", "true");
      }
      btn.setAttribute("aria-label", `Question ${i + 1}, ${answered ? "answered" : "not answered"}${marked ? ", marked for review" : ""}`);
      btn.addEventListener("click", () => { goTo(i); closePalette(); window.scrollTo(0, 0); });
      grid.appendChild(btn);
    });
    const n = answeredCount();
    const total = round.questions.length;
    $("aptAnsweredText").textContent = `${n} of ${total} answered`;
    $("aptPaletteToggle").textContent = `Question palette (${n} of ${total} answered)`;
  }

  function selectOption(index) {
    round.answers[currentQuestion().id] = index;
    saveRound();
    $("aptClearBtn").disabled = false;
    renderPalette();
  }
  function clearAnswer() {
    delete round.answers[currentQuestion().id];
    saveRound();
    renderQuestion();
  }
  function toggleMark() {
    const id = currentQuestion().id;
    if (round.marked[id]) delete round.marked[id];
    else round.marked[id] = true;
    saveRound();
    renderQuestion();
  }
  function goTo(index) {
    round.current = Math.min(Math.max(0, index), round.questions.length - 1);
    saveRound();
    renderQuestion();
  }

  $("aptPrevBtn").addEventListener("click", () => goTo(round.current - 1));
  $("aptNextBtn").addEventListener("click", () => goTo(round.current + 1));
  $("aptClearBtn").addEventListener("click", clearAnswer);
  $("aptMarkBtn").addEventListener("click", toggleMark);
  $("aptSubmitBtn").addEventListener("click", confirmSubmit);

  /* ---------- palette toggle (small screens) ---------- */
  function closePalette() {
    $("aptPalette").classList.remove("open");
    $("aptPaletteToggle").setAttribute("aria-expanded", "false");
  }
  $("aptPaletteToggle").addEventListener("click", () => {
    const open = $("aptPalette").classList.toggle("open");
    $("aptPaletteToggle").setAttribute("aria-expanded", String(open));
  });

  /* ============================ TIMER ============================ */
  function remainingSeconds() {
    return Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000));
  }
  function startTimer() {
    stopTimer();
    lastShownSeconds = -1;
    tick();
    timerHandle = setInterval(tick, 250);
  }
  function stopTimer() {
    clearInterval(timerHandle);
    timerHandle = null;
  }
  function tick() {
    if (!round) { stopTimer(); return; }
    const left = remainingSeconds();
    if (left !== lastShownSeconds) {
      lastShownSeconds = left;
      const timer = $("aptTimer");
      timer.textContent = fmtClock(left);
      timer.classList.toggle("is-low", left <= 60);
      if (left === 300) announce("5 minutes remaining.");
      if (left === 60) announce("1 minute remaining.");
    }
    if (left <= 0) {
      stopTimer();
      submitRound(true);
    }
  }

  /* ============================ MODAL ============================ */
  let modalReturnFocus = null;
  let modalEscape = null;

  function openModal({ title, text, rows, actions, spinner, onEscape }) {
    const modal = $("aptModal");
    if (modal.hidden) modalReturnFocus = document.activeElement;
    $("aptModalTitle").textContent = title;
    $("aptModalText").textContent = text || "";
    $("aptModalSpinner").hidden = !spinner;

    const list = $("aptModalRows");
    list.textContent = "";
    (rows || []).forEach(([label, value]) => {
      const row = el("div");
      row.append(el("span", "", label), el("b", "", value));
      list.appendChild(row);
    });
    list.hidden = !(rows && rows.length);

    const bar = $("aptModalActions");
    bar.textContent = "";
    (actions || []).forEach((a) => {
      const btn = el("button", "btn " + (a.kind === "primary" ? "btn-primary" : "btn-ghost"), a.label);
      btn.type = "button";
      btn.addEventListener("click", a.onClick);
      bar.appendChild(btn);
    });

    modalEscape = onEscape || null;
    modal.hidden = false;
    const first = bar.querySelector("button");
    (first || $("aptModalCard")).focus();
  }

  function closeModal() {
    $("aptModal").hidden = true;
    modalEscape = null;
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  document.addEventListener("keydown", (e) => {
    if ($("aptModal").hidden) return;
    if (e.key === "Escape" && modalEscape) { e.preventDefault(); modalEscape(); return; }
    if (e.key === "Tab") {
      const focusable = Array.from($("aptModalCard").querySelectorAll("button:not([disabled])"));
      if (!focusable.length) { e.preventDefault(); $("aptModalCard").focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ============================ SUBMIT ============================ */
  function confirmSubmit() {
    if (!round || submitting) return;
    const total = round.questions.length;
    const answered = answeredCount();
    const unanswered = total - answered;
    openModal({
      title: "Submit your test?",
      text: unanswered > 0
        ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. After you submit, your answers can't be changed.`
        : "After you submit, your answers can't be changed.",
      rows: [
        ["Answered", `${answered} of ${total}`],
        ["Not answered", String(unanswered)],
        ["Marked for review", String(markedCount())],
      ],
      actions: [
        { label: "Keep working", kind: "ghost", onClick: closeModal },
        { label: "Submit test", kind: "primary", onClick: () => submitRound(false) },
      ],
      onEscape: closeModal,
    });
  }

  async function submitRound(auto) {
    if (!round || submitting) return;
    submitting = true;
    stopTimer();
    openModal(auto
      ? { title: "Time is up", text: "Submitting your answers now. Please keep this page open.", spinner: true }
      : { title: "Submitting your answers…", text: "Please keep this page open.", spinner: true });

    const questions = round.questions;
    const elapsed = Math.round((Date.now() - round.startedAt) / 1000);
    const timeTaken = auto ? round.durationSeconds : Math.min(round.durationSeconds, Math.max(0, elapsed));
    const payload = {
      round_id: round.roundId,
      answers: questions.map((q) => ({ id: q.id, selected_index: q.id in round.answers ? round.answers[q.id] : null })),
      time_taken_seconds: timeTaken,
    };

    try {
      const result = await apiAptitudeSubmit(payload);
      const sectionOf = Object.fromEntries(questions.map((q) => [q.id, q.section]));
      clearSavedRound();
      round = null;
      submitting = false;
      closeModal();
      renderResult(result, timeTaken, sectionOf);
      showView("view-apt-result");
      window.scrollTo(0, 0);
    } catch (err) {
      submitting = false;
      const timeLeft = remainingSeconds() > 0;
      const actions = [{ label: "Try again", kind: "primary", onClick: () => { closeModal(); submitRound(auto); } }];
      if (timeLeft) {
        actions.push({ label: "Back to test", kind: "ghost", onClick: () => { closeModal(); startTimer(); } });
      }
      openModal({
        title: "Couldn't submit your answers",
        text: `${err.message || "Something went wrong."} Your answers are still saved on this page.`,
        actions,
      });
    }
  }

  /* ============================ LEAVING THE PAGE ============================ */
  window.addEventListener("beforeunload", (e) => {
    if (!isTestActive()) return;
    e.preventDefault();
    e.returnValue = ""; // browsers show their own wording
  });

  // Clicking the brand logo during a test asks first. The capture phase lets this run before app.js's handler.
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#brandHome")) return;
    if (isTestActive()) {
      e.stopImmediatePropagation();
      e.preventDefault();
      openModal({
        title: "Leave this test?",
        text: "Your answers have not been submitted. If you leave now, this attempt is discarded.",
        actions: [
          { label: "Stay on test", kind: "ghost", onClick: closeModal },
          {
            label: "Leave test", kind: "primary", onClick: () => {
              stopTimer();
              clearSavedRound();
              round = null;
              submitting = false;
              closeModal();
              goHome();
            },
          },
        ],
        onEscape: closeModal,
      });
      return;
    }
    $("topStatus").textContent = DEFAULT_STATUS; // app.js handles the actual view change
  }, true);

  /* ============================ RESULT SCREEN ============================ */
  function pctText(p) {
    const n = Number(p) || 0;
    return (Number.isInteger(n) ? String(n) : n.toFixed(1)) + "%";
  }

  function renderResult(res, timeTaken, sectionOf) {
    const percent = Number(res.percent) || 0;
    $("aptPercentNum").textContent = pctText(percent);
    $("aptScoreLine").textContent = `${res.correct} of ${res.total} correct`;
    $("aptScoreNote").textContent = res.skipped
      ? `${res.skipped} question${res.skipped === 1 ? " was" : "s were"} left unanswered.`
      : "You answered every question.";

    const ring = $("aptRingProgress");
    ring.style.transition = "none";
    ring.setAttribute("stroke-dashoffset", RING_CIRCUMFERENCE);
    ring.style.stroke = scoreColorVar(percent);
    setTimeout(() => {
      ring.style.transition = "stroke-dashoffset 0.8s ease";
      ring.setAttribute("stroke-dashoffset", RING_CIRCUMFERENCE - (Math.min(100, percent) / 100) * RING_CIRCUMFERENCE);
    }, 50);

    $("aptStatCorrect").textContent = res.correct;
    $("aptStatWrong").textContent = res.wrong;
    $("aptStatSkipped").textContent = res.skipped;
    $("aptStatTime").textContent = fmtClock(timeTaken);

    // Section-wise score bars
    const secBox = $("aptSectionBars");
    secBox.textContent = "";
    const entries = Object.entries(res.by_section || {});
    $("aptSectionBlock").hidden = entries.length === 0;
    entries.forEach(([key, v]) => {
      const pct = v.total ? Math.round((v.correct / v.total) * 100) : 0;
      const row = el("div", "metric");
      const top = el("div", "metric-top");
      top.append(el("span", "name", SECTION_LABELS[key] || key), el("span", "val", `${v.correct} / ${v.total} (${pct}%)`));
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = pct + "%";
      fill.style.background = scoreColorVar(pct);
      track.appendChild(fill);
      row.append(top, track);
      secBox.appendChild(row);
    });

    lastResult = { res, sectionOf };
    reviewFilter = "all";
    renderReview();
  }

  function reviewStatus(item) {
    if (item.selected_index === null || item.selected_index === undefined) return "skipped";
    return item.is_correct ? "correct" : "wrong";
  }

  function renderReview() {
    const { res, sectionOf } = lastResult;
    const items = res.review || [];
    const counts = { all: items.length, wrong: 0, skipped: 0 };
    items.forEach((it) => { const s = reviewStatus(it); if (s === "wrong") counts.wrong++; if (s === "skipped") counts.skipped++; });

    // Filter pills
    const filters = $("aptReviewFilters");
    filters.textContent = "";
    [["all", "All"], ["wrong", "Incorrect"], ["skipped", "Skipped"]].forEach(([key, label]) => {
      const pill = el("button", "pill apt-pill" + (reviewFilter === key ? " active" : ""), `${label} (${counts[key]})`);
      pill.type = "button";
      pill.setAttribute("aria-pressed", String(reviewFilter === key));
      pill.addEventListener("click", () => { reviewFilter = key; renderReview(); });
      filters.appendChild(pill);
    });

    const list = $("aptReviewList");
    list.textContent = "";
    const shown = items
      .map((it, i) => ({ it, number: i + 1 }))
      .filter(({ it }) => reviewFilter === "all" || reviewStatus(it) === reviewFilter);

    if (!shown.length) {
      list.appendChild(el("p", "apt-empty", reviewFilter === "wrong" ? "No incorrect answers." : "No skipped questions."));
      return;
    }

    shown.forEach(({ it, number }) => {
      const status = reviewStatus(it);
      const card = el("article", "apt-review-item is-" + status);

      const head = el("div", "apt-review-head");
      const tag = [`Question ${number}`, SECTION_LABELS[sectionOf[it.id]]].filter(Boolean).join(" · ");
      const chipClass = status === "correct" ? "good" : status === "wrong" ? "bad" : "mid";
      const chipText = status === "correct" ? "Correct" : status === "wrong" ? "Incorrect" : "Skipped";
      head.append(el("span", "apt-review-tag", tag), el("span", "score-chip " + chipClass, chipText));
      card.appendChild(head);

      card.appendChild(el("p", "apt-review-q", it.question));

      const opts = el("div", "apt-review-opts");
      it.options.forEach((text, i) => {
        const isCorrect = i === it.correct_index;
        const isYours = i === it.selected_index;
        const row = el("div", "apt-ropt" + (isCorrect ? " is-correct" : "") + (isYours && !isCorrect ? " is-wrong" : ""));
        row.append(el("span", "apt-letter", LETTERS[i] || String(i + 1)), el("span", "apt-opt-text", text));
        const labels = [];
        if (isYours) labels.push("Your answer");
        if (isCorrect) labels.push("Correct answer");
        if (labels.length) row.appendChild(el("span", "apt-ropt-tag", labels.join(" · ")));
        opts.appendChild(row);
      });
      card.appendChild(opts);

      if (status === "skipped") card.appendChild(el("p", "apt-skipped-note", "You didn't answer this question."));
      if (it.explanation) {
        const ex = el("div", "apt-explain");
        ex.append(el("div", "apt-explain-label", "Explanation"), el("p", "", it.explanation));
        card.appendChild(ex);
      }
      list.appendChild(card);
    });
  }

  /* ============================ RESTORE AFTER REFRESH ============================ */
  const saved = loadSavedRound();
  if (saved) {
    round = saved;
    beginTest();
    announce("Your test was restored. The timer kept running while the page was closed.");
  }
})();
