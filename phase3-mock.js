/* =========================================================================
   PHASE 3 MOCK — TEMPORARY
   -------------------------------------------------------------------------
   Stands in for Ankita's backend/history.py and backend/resume.py until they
   are merged. It is OFF by default. Turn it on by opening the page with
   ?mock=phase3 on the end of the address, for example:
       http://127.0.0.1:5500/index.html?mock=phase3
   A small "Mock data on" badge is shown while it is active.

   It follows API.md sections 4 and 5:
     history.save(entry)     POST   /api/history/save        -> { ok, id }
     history.list(userId)    GET    /api/history?user_id=    -> { sessions: [...] } newest first, max 50
     history.remove(userId)  DELETE /api/history?user_id=    -> { ok }
     resume.parse(file)      POST   /api/resume/parse        -> { text, char_count, truncated }

   What it does:
     - History is kept in this browser's localStorage and seeded once with a few
       sample sessions, so the chart and the weak areas can be seen straight away.
     - The resume mock cannot read a PDF. It returns a clearly marked sample text,
       so never use it to judge the questions. It only shows the "Resume added" flow.

   TO REMOVE THE MOCK LATER:
     1. Delete this file
     2. Delete the <script src="phase3-mock.js"> line in index.html
   history.js and resume-upload.js check that it exists before using it.
   ========================================================================= */
window.Phase3Mock = (() => {
  const active = new URLSearchParams(location.search).get("mock") === "phase3";
  const STORE_KEY = "prepline_mock_history";
  const SEEDED_KEY = "prepline_mock_history_seeded";
  const LATENCY_MS = 350;

  if (active) {
    const badge = document.createElement("div");
    badge.className = "mock-badge";
    badge.textContent = "Mock data on (?mock=phase3)";
    document.body.appendChild(badge);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function read() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
  }
  function write(rows) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)); } catch (e) { /* storage unavailable */ }
  }

  function daysAgo(n) {
    return new Date(Date.now() - n * 86400000).toISOString();
  }

  function seedOnce() {
    let seeded = false;
    try { seeded = localStorage.getItem(SEEDED_KEY) === "1"; } catch (e) { seeded = true; }
    if (seeded || read().length) return;
    const sample = [
      { kind: "interview", created_at: daysAgo(21), role: "Software Engineer", mode: "friendly", company_style: "general", overall_score: 48,
        sections: { relevance: 55, technical_accuracy: 45, clarity: 50, communication: 42 } },
      { kind: "aptitude", created_at: daysAgo(17), overall_score: 55, sections: { quant: 40, logical: 60, verbal: 70 } },
      { kind: "interview", created_at: daysAgo(12), role: "Software Engineer", mode: "strict", company_style: "product", overall_score: 58,
        sections: { relevance: 66, technical_accuracy: 52, clarity: 60, communication: 54 } },
      { kind: "aptitude", created_at: daysAgo(8), overall_score: 65, sections: { quant: 55, logical: 65, verbal: 75 } },
      { kind: "interview", created_at: daysAgo(4), role: "Data Analyst", mode: "friendly", company_style: "service", overall_score: 66,
        sections: { relevance: 72, technical_accuracy: 60, clarity: 68, communication: 64 } },
      { kind: "interview", created_at: daysAgo(1), role: "Software Engineer", mode: "stress", company_style: "product", overall_score: 71,
        sections: { relevance: 78, technical_accuracy: 64, clarity: 72, communication: 70 } },
    ];
    write(sample.map((s, i) => ({ id: i + 1, user_id: "mock", ...s })));
    try { localStorage.setItem(SEEDED_KEY, "1"); } catch (e) { /* ignore */ }
  }

  const history = {
    async save(entry) {
      await wait(LATENCY_MS);
      seedOnce();
      const rows = read();
      const id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
      rows.push({ id, ...entry });
      write(rows);
      return { ok: true, id };
    },
    async list() {
      await wait(LATENCY_MS);
      seedOnce();
      const rows = read().slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
      return { sessions: rows };
    },
    async remove() {
      await wait(LATENCY_MS);
      write([]);
      try { localStorage.setItem(SEEDED_KEY, "1"); } catch (e) { /* ignore */ }
      return { ok: true };
    },
  };

  const resume = {
    async parse(file) {
      await wait(700);
      const text = "[MOCK RESUME TEXT — this is sample text, not the contents of " + file.name + "] "
        + "Final-year student with projects in web development and data analysis. Skills: JavaScript, Python, SQL.";
      return { text, char_count: text.length, truncated: false };
    },
  };

  return { active, history, resume };
})();
