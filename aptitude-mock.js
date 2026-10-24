/* =========================================================================
   APTITUDE MOCK — TEMPORARY
   -------------------------------------------------------------------------
   Stands in for Ankita's backend/aptitude.py until it is connected.
   It follows API.md section 2 exactly:
     AptitudeMock.start({ sections, count, difficulty })
       -> { round_id, duration_seconds, questions: [{ id, section, question, options }] }
     AptitudeMock.submit({ round_id, answers, time_taken_seconds })
       -> { total, correct, wrong, skipped, percent, by_section, review }

   TO REMOVE THE MOCK LATER:
     1. Set USE_MOCK = false at the top of aptitude.js
     2. Delete this file
     3. Delete the <script src="aptitude-mock.js"> line in index.html
   Nothing else depends on this file.

   Notes on behaviour:
   - Quant questions are generated, so there are always enough of them.
     Logical and Verbal have 8 hand-written questions each. Like the real
     server, the mock returns as many questions as it has when `count` is larger.
   - `difficulty` is accepted but ignored by the mock.
   - Answer keys live in localStorage so a page refresh in the middle of a
     test can still be submitted. The real server keeps them server-side and
     never sends them with the questions.
   ========================================================================= */
window.AptitudeMock = (() => {
  const KEYS_STORAGE = "prepline_mock_aptitude_keys";
  const LATENCY_MS = 450;

  /* ---------- small helpers ---------- */
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[rnd(0, arr.length - 1)];
  function shuffle(arr) {
    const x = arr.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = rnd(0, i);
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inr = (n) => "₹" + n.toLocaleString("en-IN");

  // Builds four distinct numeric options around `ans`, in random order.
  function numericOptions(ans, fmt, step) {
    const set = new Set([ans]);
    for (const d of shuffle([1, 2, 3, 4, 5, -1, -2, -3, -4])) {
      if (set.size >= 4) break;
      const v = ans + d * step;
      if (v > 0) set.add(v);
    }
    let k = 6;
    while (set.size < 4) set.add(ans + k++ * step);
    const values = shuffle([...set]);
    return { options: values.map(fmt), correct_index: values.indexOf(ans) };
  }

  /* ---------- Quant: generated ---------- */
  const QUANT_GENERATORS = [
    function percentOf() {
      const p = pick([10, 15, 20, 25, 30, 40, 60, 75]);
      const n = rnd(5, 30) * 20;
      const ans = (n * p) / 100;
      return {
        question: `What is ${p}% of ${n}?`,
        explanation: `${p}% of ${n} = ${p}/100 × ${n} = ${ans}.`,
        ...numericOptions(ans, String, Math.max(2, Math.round(ans / 10))),
      };
    },
    function averageSpeed() {
      const speed = pick([40, 45, 50, 55, 60, 65, 70, 75, 80, 90]);
      const t = rnd(2, 6);
      const d = speed * t;
      return {
        question: `A train covers ${d} km in ${t} hours at a steady speed. What is its speed in km/h?`,
        explanation: `Speed = distance ÷ time = ${d} ÷ ${t} = ${speed} km/h.`,
        ...numericOptions(speed, (v) => `${v} km/h`, 5),
      };
    },
    function simpleInterest() {
      const P = 1000 * rnd(2, 15);
      const R = pick([5, 6, 8, 10, 12]);
      const T = rnd(2, 5);
      const si = (P * R * T) / 100;
      return {
        question: `What is the simple interest on ${inr(P)} at ${R}% per annum for ${T} years?`,
        explanation: `SI = P × R × T ÷ 100 = ${P} × ${R} × ${T} ÷ 100 = ${inr(si)}.`,
        ...numericOptions(si, inr, Math.max(10, Math.round(si / 100) * 10)),
      };
    },
    function ratioSplit() {
      const [a, b] = pick([[2, 3], [3, 5], [4, 7], [2, 5], [3, 4], [5, 7]]);
      const m = rnd(3, 12);
      const sum = (a + b) * m;
      const ans = b * m;
      return {
        question: `Two numbers are in the ratio ${a}:${b} and their sum is ${sum}. What is the larger number?`,
        explanation: `Total parts = ${a} + ${b} = ${a + b}, so one part = ${sum} ÷ ${a + b} = ${m}. Larger number = ${b} × ${m} = ${ans}.`,
        ...numericOptions(ans, String, m),
      };
    },
  ];

  /* ---------- Logical + Verbal: hand-written ---------- */
  const LOGICAL = [
    { question: "What comes next in the series: 2, 6, 12, 20, 30, ?", options: ["40", "42", "44", "46"], correct_index: 1,
      explanation: "The terms are n × (n + 1): 1×2, 2×3, 3×4, 4×5, 5×6. The next term is 6 × 7 = 42." },
    { question: "All roses are flowers. Some flowers fade quickly. Which statement must be true?",
      options: ["Some flowers are roses", "All flowers are roses", "No rose fades quickly", "Some roses fade quickly"], correct_index: 0,
      explanation: "Every rose is a flower, so at least some flowers are roses. The other statements are not guaranteed by the information given." },
    { question: "If CAT is coded as 24 (using A=1, B=2 … Z=26 and adding the letter values), what is the code for DOG?",
      options: ["24", "26", "28", "30"], correct_index: 1,
      explanation: "CAT = 3 + 1 + 20 = 24. DOG = 4 + 15 + 7 = 26." },
    { question: "Pointing to a man, Riya says, “He is the son of my mother’s only brother.” How is the man related to Riya?",
      options: ["Brother", "Uncle", "Cousin", "Nephew"], correct_index: 2,
      explanation: "Her mother’s only brother is her maternal uncle. His son is Riya’s cousin." },
    { question: "Aman walks 5 km north, turns right and walks 3 km, then turns right again and walks 5 km. How far is he from his starting point?",
      options: ["3 km", "5 km", "8 km", "13 km"], correct_index: 0,
      explanation: "North 5 km, east 3 km, then south 5 km. The north and south legs cancel, leaving him 3 km east of the start." },
    { question: "Find the odd one out: 2, 3, 5, 9, 11, 13",
      options: ["2", "5", "9", "13"], correct_index: 2,
      explanation: "All the numbers are prime except 9, which is divisible by 3." },
    { question: "What comes next in the letter series: A, C, F, J, O, ?",
      options: ["T", "U", "V", "W"], correct_index: 1,
      explanation: "The gaps between letters are +2, +3, +4, +5, so the next gap is +6. O is the 15th letter; 15 + 6 = 21, which is U." },
    { question: "What is the angle between the hour hand and the minute hand of a clock at 3:00?",
      options: ["60°", "75°", "90°", "120°"], correct_index: 2,
      explanation: "At 3:00 the minute hand points at 12 and the hour hand at 3. Each hour mark is 30°, so 3 × 30° = 90°." },
  ];

  const VERBAL = [
    { question: "Choose the word closest in meaning to “Candid”.", options: ["Secretive", "Frank", "Rude", "Shy"], correct_index: 1,
      explanation: "“Candid” means open and honest, which is closest to “frank”." },
    { question: "Choose the word opposite in meaning to “Scarce”.", options: ["Rare", "Limited", "Abundant", "Meagre"], correct_index: 2,
      explanation: "“Scarce” means in short supply. “Abundant” means plentiful, which is its opposite." },
    { question: "Fill in the blank: Neither the manager nor the engineers ___ present in the meeting yesterday.",
      options: ["was", "were", "is", "been"], correct_index: 1,
      explanation: "With “neither … nor”, the verb agrees with the subject closest to it. “Engineers” is plural, and the sentence is in the past, so “were”." },
    { question: "Which of these is spelled correctly?", options: ["Occurence", "Occurrence", "Ocurrence", "Occurance"], correct_index: 1,
      explanation: "The correct spelling is “occurrence”, with a double c and a double r." },
    { question: "What does the idiom “to burn the midnight oil” mean?",
      options: ["To waste resources", "To work late into the night", "To start a fire", "To wake up early"], correct_index: 1,
      explanation: "The idiom refers to working or studying late at night." },
    { question: "Choose one word for: a person who knows many languages.", options: ["Polyglot", "Pedant", "Orator", "Philanthropist"], correct_index: 0,
      explanation: "A polyglot is someone who speaks or understands several languages." },
    { question: "Fill in the blank: She is very good ___ mathematics.", options: ["in", "at", "on", "with"], correct_index: 1,
      explanation: "The correct collocation is “good at” a subject or skill." },
    { question: "Choose the word closest in meaning to “Ephemeral”.", options: ["Eternal", "Short-lived", "Ancient", "Fragile"], correct_index: 1,
      explanation: "“Ephemeral” describes something that lasts for a very short time." },
  ];

  /* ---------- answer-key storage (stands in for the server) ---------- */
  function readKeys() {
    try { return JSON.parse(localStorage.getItem(KEYS_STORAGE)) || {}; } catch (e) { return {}; }
  }
  function writeKeys(all) {
    const ids = Object.keys(all);
    while (ids.length > 5) delete all[ids.shift()]; // keep the last few rounds only
    try { localStorage.setItem(KEYS_STORAGE, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- public API ---------- */
  async function start({ sections, count }) {
    await wait(LATENCY_MS);
    const wanted = (sections || []).filter((s) => ["quant", "logical", "verbal"].includes(s));
    if (!wanted.length) throw new Error("Choose at least one section.");
    const total = Math.max(1, Number(count) || 10);

    const pools = {
      quant: Array.from({ length: total }, () => pick(QUANT_GENERATORS)()),
      logical: shuffle(LOGICAL),
      verbal: shuffle(VERBAL),
    };

    // Share the questions across sections round-robin, until `count` or the pools run out.
    const taken = Object.fromEntries(wanted.map((s) => [s, 0]));
    let picked = 0;
    while (picked < total) {
      let progressed = false;
      for (const s of wanted) {
        if (picked >= total) break;
        if (taken[s] < pools[s].length) { taken[s]++; picked++; progressed = true; }
      }
      if (!progressed) break;
    }

    const roundId = "mock" + Math.random().toString(36).slice(2, 8);
    const questions = [];
    const keys = {};
    let n = 101;
    for (const s of wanted) {
      for (const q of pools[s].slice(0, taken[s])) {
        const id = "q" + n++;
        questions.push({ id, section: s, question: q.question, options: q.options });
        keys[id] = { section: s, question: q.question, options: q.options, correct_index: q.correct_index, explanation: q.explanation };
      }
    }

    const all = readKeys();
    all[roundId] = { order: questions.map((q) => q.id), keys };
    writeKeys(all);

    return { round_id: roundId, duration_seconds: questions.length * 60, questions };
  }

  async function submit({ round_id, answers }) {
    await wait(LATENCY_MS);
    const round = readKeys()[round_id];
    if (!round) throw new Error("Test not found. It may have expired — please start a new one.");

    const picked = new Map((answers || []).map((a) => [a.id, a.selected_index]));
    const bySection = {};
    let correct = 0, wrong = 0, skipped = 0;
    const review = round.order.map((id) => {
      const k = round.keys[id];
      const sel = picked.has(id) && picked.get(id) !== undefined ? picked.get(id) : null;
      const isCorrect = sel !== null && sel === k.correct_index;
      bySection[k.section] = bySection[k.section] || { correct: 0, total: 0 };
      bySection[k.section].total++;
      if (sel === null) skipped++;
      else if (isCorrect) { correct++; bySection[k.section].correct++; }
      else wrong++;
      return { id, question: k.question, options: k.options, selected_index: sel, correct_index: k.correct_index, explanation: k.explanation, is_correct: isCorrect };
    });

    const total = round.order.length;
    return {
      total, correct, wrong, skipped,
      percent: total ? Math.round((correct / total) * 1000) / 10 : 0,
      by_section: bySection,
      review,
    };
  }

  return { start, submit };
})();
