/* =========================================================================
   PREPLINE — HISTORY DASHBOARD (Phase 3)
   -------------------------------------------------------------------------
   Two jobs:
     1. Save a finished session (scores and counts only) when an interview report
        or an aptitude result is shown.        POST /api/history/save
     2. Show the History page: past sessions, an overall-score line chart and the
        weak areas.                            GET /api/history?user_id=...
        "Delete my history" removes everything. DELETE /api/history?user_id=...

   There is no login. The browser creates a random UUID and keeps it in
   localStorage as prepline_user_id, so history belongs to this browser only.

   Privacy: answers, transcripts, video and resume text are never sent here.
   See API.md section 4.

   Needs from app.js: showView(), CONFIG.API_BASE_URL.
   Backend: Ankita's backend/history.py. Until it is merged, open the page with
   ?mock=phase3 to use phase3-mock.js. Without the backend, saving fails quietly
   and the History page shows a message with a Retry button.

   All text is inserted with textContent, never innerHTML.
   ========================================================================= */
window.HistoryUI = (() => {
  "use strict";

  const USER_KEY = "prepline_user_id";
  const DEFAULT_STATUS = "AI Mock Interview Coach";
  const SECTION_LABELS = {
    relevance: "Relevance",
    technical_accuracy: "Technical accuracy",
    clarity: "Clarity",
    communication: "Communication",
    quant: "Quant (aptitude)",
    logical: "Logical (aptitude)",
    verbal: "Verbal (aptitude)",
  };
  const WEAK_AREA_COUNT = 3;

  const $ = (id) => document.getElementById(id);
  const useMock = () => !!(window.Phase3Mock && Phase3Mock.active);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ============================ USER ID ============================ */
  let memoryId = null; // used only when localStorage is blocked

  function newId() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function getUserId() {
    try {
      let id = localStorage.getItem(USER_KEY);
      if (!id) {
        id = newId();
        localStorage.setItem(USER_KEY, id);
      }
      return id;
    } catch (e) {
      if (!memoryId) memoryId = newId();
      return memoryId;
    }
  }

  /* ============================ API LAYER ============================
     Shapes are the ones in API.md section 4.
     ================================================================= */
  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error("Could not reach the backend. Is the FastAPI server running?");
    }
    if (!res.ok) {
      if (res.status === 404) throw new Error("History isn't available on the server yet.");
      const data = await res.json().catch(() => ({}));
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : `Request failed (${res.status}).`);
    }
    return res.json();
  }

  const apiHistorySave = (entry) => (useMock() ? Phase3Mock.history.save(entry) : request("POST", "/api/history/save", entry));
  const apiHistoryDelete = (userId) => (useMock() ? Phase3Mock.history.remove(userId) : request("DELETE", `/api/history?user_id=${encodeURIComponent(userId)}`));
  async function apiHistoryList(userId) {
    const data = useMock() ? await Phase3Mock.history.list(userId) : await request("GET", `/api/history?user_id=${encodeURIComponent(userId)}`);
    return Array.isArray(data.sessions) ? data.sessions : [];
  }

  /* ============================ SAVING ============================ */
  const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

  // Fire and forget. A failed save must never get in the way of the report or the result.
  function saveQuietly(entry) {
    apiHistorySave(entry).catch((err) => console.warn("History was not saved:", err.message));
  }

  // Called from finishSession() in app.js once the report is on screen.
  function recordInterview({ candidate, evaluations, readiness, attention, attentionOff }) {
    if (!evaluations || !evaluations.length) return;
    const valid = evaluations.filter((e) => e.overall > 0);
    const avg = (key) => (valid.length ? clampScore(valid.reduce((a, e) => a + (e[key] || 0), 0) / valid.length) : 0);

    const entry = {
      user_id: getUserId(),
      kind: "interview",
      created_at: new Date().toISOString(),
      role: candidate.role,
      mode: candidate.mode,
      company_style: candidate.companyStyle,
      overall_score: clampScore(readiness),
      sections: {
        relevance: avg("relevance"),
        technical_accuracy: avg("technical_accuracy"),
        clarity: avg("clarity"),
        communication: avg("communication"),
      },
    };

    if (!attentionOff && attention && attention.measured) {
      entry.attention = {
        lookingAwayCount: (attention.measured.lookingAway || {}).count || 0,
        faceNotVisibleCount: (attention.measured.faceNotVisible || {}).count || 0,
      };
    }

    const speech = window.InterviewOptions ? InterviewOptions.summarizeSpeech(evaluations) : null;
    if (speech) {
      entry.speech = { fillerTotal: speech.fillerTotal };
      if (speech.avgWpm !== null) entry.speech.avgWpm = speech.avgWpm;
    }
    saveQuietly(entry);
  }

  // Called from aptitude.js after the result is shown.
  // usingMockQuestions is true while the aptitude round still runs on its own mock questions.
  // Those results are not real, so they are only kept in the mock history (?mock=phase3).
  function recordAptitude(result, usingMockQuestions) {
    if (!result) return;
    if (usingMockQuestions && !useMock()) return;
    const sections = {};
    Object.entries(result.by_section || {}).forEach(([key, v]) => {
      sections[key] = v.total ? clampScore((v.correct / v.total) * 100) : 0;
    });
    saveQuietly({
      user_id: getUserId(),
      kind: "aptitude",
      created_at: new Date().toISOString(),
      overall_score: clampScore(result.percent),
      sections,
    });
  }

  /* ============================ HISTORY PAGE ============================ */
  let sessions = [];
  let busy = false;

  function setPanel(name, message) {
    ["Loading", "Error", "Empty", "Content"].forEach((n) => { $("history" + n).hidden = n !== name; });
    if (name === "Error") $("historyErrorText").textContent = message || "Something went wrong.";
    $("historyDeleteBtn").disabled = name === "Loading";
  }

  async function load() {
    setPanel("Loading");
    try {
      sessions = await apiHistoryList(getUserId());
      if (!sessions.length) { setPanel("Empty"); return; }
      renderChart(sessions);
      renderWeakAreas(sessions);
      renderList(sessions);
      setPanel("Content");
    } catch (err) {
      setPanel("Error", err.message);
    }
  }

  async function open() {
    $("topStatus").textContent = "History";
    showView("view-history");
    window.scrollTo(0, 0);
    await load();
  }

  function goHome() {
    $("topStatus").textContent = DEFAULT_STATUS;
    showView("view-landing");
  }

  async function deleteAll() {
    if (busy) return;
    const ok = confirm("Delete all your saved history? This cannot be undone.");
    if (!ok) return;
    busy = true;
    $("historyDeleteBtn").disabled = true;
    try {
      await apiHistoryDelete(getUserId());
      await load();
    } catch (err) {
      alert(err.message || "Could not delete your history.");
      $("historyDeleteBtn").disabled = false;
    } finally {
      busy = false;
    }
  }

  /* ---------- formatting ---------- */
  function fmtDate(iso, withTime) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    const opts = withTime
      ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" };
    return d.toLocaleString(undefined, opts);
  }
  const kindLabel = (k) => (k === "aptitude" ? "Aptitude" : "Interview");
  const chipClass = (score) => (score >= 70 ? "good" : score >= 45 ? "mid" : "bad");
  function sectionLabel(key) {
    if (SECTION_LABELS[key]) return SECTION_LABELS[key];
    const s = String(key).replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------- list ---------- */
  function renderList(items) {
    const body = $("historyRows");
    body.textContent = "";
    items.forEach((s) => {
      const tr = document.createElement("tr");
      tr.append(
        el("td", "", fmtDate(s.created_at, true)),
        el("td", "", kindLabel(s.kind)),
        el("td", "", s.role || "—"),
      );
      const score = el("td", "history-score");
      score.appendChild(el("span", "score-chip " + chipClass(s.overall_score), String(s.overall_score)));
      tr.appendChild(score);
      body.appendChild(tr);
    });
  }

  /* ---------- weak areas: sections with the lowest average ---------- */
  function renderWeakAreas(items) {
    const totals = {};
    items.forEach((s) => {
      Object.entries(s.sections || {}).forEach(([key, v]) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        totals[key] = totals[key] || { sum: 0, count: 0 };
        totals[key].sum += n;
        totals[key].count += 1;
      });
    });
    const rows = Object.entries(totals)
      .map(([key, t]) => ({ key, avg: Math.round(t.sum / t.count), count: t.count }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, WEAK_AREA_COUNT);

    const box = $("historyWeak");
    box.textContent = "";
    $("historyWeakBlock").hidden = rows.length === 0;
    rows.forEach((r) => {
      const row = el("div", "metric");
      const top = el("div", "metric-top");
      top.append(
        el("span", "name", sectionLabel(r.key)),
        el("span", "val", `${r.avg}/100 · ${r.count} session${r.count === 1 ? "" : "s"}`),
      );
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = r.avg + "%";
      fill.style.background = scoreColorVar(r.avg);
      track.appendChild(fill);
      row.append(top, track);
      box.appendChild(row);
    });
  }

  /* ---------- line chart (inline SVG, no library) ---------- */
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderChart(items) {
    const data = items.slice().reverse(); // the API sends newest first; the chart reads oldest to newest
    const W = 640, H = 260, L = 38, R = 16, T = 14, B = 36;
    const iw = W - L - R, ih = H - T - B;
    const x = (i) => (data.length === 1 ? L + iw / 2 : L + (iw * i) / (data.length - 1));
    const y = (v) => T + ih * (1 - Math.max(0, Math.min(100, v)) / 100);

    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "history-svg" });
    const last = data[data.length - 1];
    chart.setAttribute("aria-label", `Overall score for your last ${data.length} session${data.length === 1 ? "" : "s"}. The most recent score is ${last.overall_score} out of 100.`);

    [0, 25, 50, 75, 100].forEach((v) => {
      chart.appendChild(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "hc-grid" }));
      chart.appendChild(svg("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "hc-tick" }, String(v)));
    });

    if (data.length > 1) {
      chart.appendChild(svg("polyline", { points: data.map((s, i) => `${x(i)},${y(s.overall_score)}`).join(" "), class: "hc-line" }));
    }

    data.forEach((s, i) => {
      const cx = x(i), cy = y(s.overall_score);
      const label = `${fmtDate(s.created_at)} · ${kindLabel(s.kind)} · ${s.overall_score}/100`;
      const mark = s.kind === "aptitude"
        ? svg("rect", { x: cx - 5, y: cy - 5, width: 10, height: 10, class: "hc-dot hc-square" })
        : svg("circle", { cx, cy, r: 5.5, class: "hc-dot hc-circle" });
      mark.appendChild(svg("title", {}, label));
      chart.appendChild(mark);
    });

    chart.appendChild(svg("text", { x: L, y: H - 10, "text-anchor": "start", class: "hc-tick" }, fmtDate(data[0].created_at)));
    if (data.length > 1) {
      chart.appendChild(svg("text", { x: W - R, y: H - 10, "text-anchor": "end", class: "hc-tick" }, fmtDate(last.created_at)));
    }

    const box = $("historyChart");
    box.textContent = "";
    box.appendChild(chart);
    $("historyChartNote").textContent = data.length === 1
      ? "Complete another session to see how your score changes over time."
      : "";
  }

  /* ============================ WIRING ============================ */
  $("openHistoryBtn").addEventListener("click", open);
  $("historyBackBtn").addEventListener("click", goHome);
  $("historyDeleteBtn").addEventListener("click", deleteAll);
  $("historyRetryBtn").addEventListener("click", load);

  return { getUserId, recordInterview, recordAptitude, open };
})();
