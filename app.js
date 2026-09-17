/* =========================================================================
   PREPLINE — AI MOCK INTERVIEW COACH — FRONTEND (Vamshika's part)
   -------------------------------------------------------------------------
   This file is a self-contained, working MVP with a MOCK evaluation layer
   standing in for Kashish's FastAPI + LLM backend.

   INTEGRATION NOTE FOR KASHISH:
   Every backend call goes through the three functions in the "API LAYER"
   section below (apiGenerateQuestions, apiEvaluateAnswer, apiFinalizeReport).
   Each one currently calls a mock*() function. To go live, replace the body
   of each api* function with a real fetch() to your FastAPI endpoint and
   keep the same return shape documented above each function — nothing else
   in this file needs to change.
   ========================================================================= */

const CONFIG = {
  API_BASE_URL: "http://127.0.0.1:8000", // FastAPI backend (Kashish's part)
};

/* ============================ API LAYER ================================
   INTEGRATION NOTE: the real backend is SESSION-BASED and gives out ONE
   question at a time (it only generates question N+1 after question N has
   been answered). That's different from the original mock, which returned
   all N questions upfront. To keep the rest of this file (loadQuestion,
   renderFeedback, renderReport, etc.) working unchanged, we:
     - store the session_id on `state` once the interview starts
     - keep `state.questions` as an array that GROWS one item at a time
       (see the "nextQuestion" click handler further down, which now
       awaits a real fetch before showing the next question)
     - use `state.totalQuestions` (not state.questions.length) for the
       "Question X of N" progress display, since the array won't be full
       length until the interview is complete
   ========================================================================= */

// Backend only accepts Fresher / Junior / Mid / Senior. Map the UI's
// pill labels (which show friendlier "years of experience" text) to that.
function mapExperienceLevel(uiValue) {
  const map = {
    "Fresher": "Fresher",
    "0-2 yrs": "Junior",
    "2-5 yrs": "Mid",
    "5+ yrs": "Senior",
  };
  return map[uiValue] || "Fresher";
}

// Expected return: [{ id, text, category, idealAnswer }]
// (Only returns the FIRST question — see integration note above. Later
// questions are fetched lazily by the "nextQuestion" click handler.)
async function apiGenerateQuestions({ role, experience, type, count }) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}/api/interview/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_name: state.candidate.name,
        target_role: role,
        experience_level: mapExperienceLevel(experience),
        interview_type: type,
        num_questions: count,
      }),
    });
  } catch (err) {
    throw new Error("Could not reach the backend. Is the FastAPI server running on " + CONFIG.API_BASE_URL + "?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? JSON.stringify(body.detail) : "Failed to start interview.");
  }
  const data = await res.json();
  state.sessionId = data.session_id;
  state.totalQuestions = data.total_questions;
  return [{
    id: data.first_question.question_id,
    text: data.first_question.question,
    category: data.first_question.category,
    // Backend doesn't hand out a pre-written "model answer" before the
    // question is answered (unlike the old mock's curated bank) — a real
    // improved_answer only exists once the AI evaluates the candidate's
    // actual answer. submitCurrentAnswer() below fills this in after that.
    idealAnswer: "",
  }];
}

// Expected return:
// { relevance, technical_accuracy, clarity, communication, overall, feedback, improved_answer }
// All scores are 0-100 integers (backend returns 0-10 floats — converted here).
async function apiEvaluateAnswer({ question, answer }) {
  const q = state.questions[state.currentIndex];
  const safeAnswer = (answer || "").trim().length ? answer : "(No answer was provided for this question.)";

  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}/api/interview/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.sessionId,
        question_id: q.id,
        question: question,
        answer: safeAnswer,
      }),
    });
  } catch (err) {
    throw new Error("Could not reach the backend. Is the FastAPI server running on " + CONFIG.API_BASE_URL + "?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? JSON.stringify(body.detail) : "Failed to evaluate answer.");
  }
  const data = await res.json();
  const e = data.evaluation;
  return {
    relevance: Math.round(e.relevance * 10),
    technical_accuracy: Math.round(e.technical_accuracy * 10),
    clarity: Math.round(e.clarity * 10),
    communication: Math.round(e.communication * 10),
    overall: Math.round(e.overall_score * 10),
    feedback: e.feedback,
    improved_answer: e.improved_answer,
  };
}

// Expected return: { readiness: 0-100, summary: string }
async function apiFinalizeReport(payload) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}/api/interview/${state.sessionId}/report`);
  } catch (err) {
    throw new Error("Could not reach the backend. Is the FastAPI server running on " + CONFIG.API_BASE_URL + "?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? JSON.stringify(body.detail) : "Failed to generate report.");
  }
  const data = await res.json();
  return {
    readiness: Math.round(data.overall_score * 10),
    summary: data.interview_summary,
  };
}

/* ============================ MOCK ENGINE =============================== */
/* Deterministic-ish scoring so the demo feels believable rather than random. */

const QUESTION_BANK = {
  // Default / general Software Engineer technical set — used when role doesn't match a specific bank below
  Technical: [
    { text: "Walk me through how you'd design a system that needs to handle a sudden spike in traffic.",
      ideal: "I'd start by identifying the bottleneck — usually the app server or database. I'd add a load balancer to spread traffic across multiple app server instances, introduce caching (like Redis) for frequently read data, and consider a CDN for static assets. For the database, I'd look at read replicas or sharding if writes are the issue, and add rate limiting or a queue to smooth out sudden bursts instead of letting them hit the backend directly." },
    { text: "Explain the difference between a process and a thread, and when you'd choose one over the other.",
      ideal: "A process is an independent program with its own memory space, while a thread is a lighter unit of execution within a process that shares memory with other threads in the same process. I'd choose multiple processes when I need strong isolation (so one crash doesn't take down everything) and threads when tasks need to share data quickly and the overhead of separate memory spaces isn't worth it." },
    { text: "How would you debug a function that's producing the wrong output only for some inputs?",
      ideal: "I'd first look for a pattern in the failing inputs — edge cases like empty values, zero, negatives, or unusual data types. Then I'd trace the function step by step with print statements or a debugger to see where actual values diverge from expected ones, paying close attention to boundary conditions and any shared state. Once I find the cause, I'd write a test for that specific case before fixing it." },
    { text: "Describe a time you had to optimize slow code. What did you look at first?",
      ideal: "I'd first profile the code to find the actual bottleneck rather than guessing — often it's a loop doing repeated work, an unindexed database query, or unnecessary re-computation. Once I know where the time is going, I'd fix that specific hotspot (like adding a cache, an index, or a better algorithm) and re-measure to confirm the improvement before optimizing anything else." },
    { text: "What's the difference between SQL and NoSQL databases, and how would you decide between them?",
      ideal: "SQL databases are relational, enforce a fixed schema, and are strong for structured data with complex relationships and transactions. NoSQL databases are more flexible with schema, often scale horizontally more easily, and suit unstructured or rapidly changing data. I'd pick SQL when data integrity and relationships matter most, and NoSQL when I need flexible schemas or massive horizontal scale." },
    { text: "How would you design a rate limiter for an API?",
      ideal: "I'd use a token bucket or sliding window algorithm, tracking request counts per user or API key in a fast store like Redis. Each request checks and decrements available tokens; if none are left, the request is rejected with a 429 status. I'd also expose rate-limit headers so clients know their remaining quota and when it resets." },
    { text: "Explain how you'd approach testing a feature before shipping it.",
      ideal: "I'd start with unit tests for the core logic, covering normal cases, edge cases, and failure cases. Then I'd add integration tests to check the feature works with the rest of the system, and manually test the main user flows. Before shipping, I'd also consider rolling it out gradually (feature flag or canary release) so issues are caught with limited impact." },
    { text: "What happens when you type a URL into a browser and hit enter?",
      ideal: "The browser parses the URL, then does a DNS lookup to get the server's IP address. It opens a TCP connection (with a TLS handshake for HTTPS), sends an HTTP request, and the server processes it and sends back a response. The browser then parses the HTML and CSS to build the DOM and CSSOM, renders the page, and runs any JavaScript, after which the page becomes interactive." },
  ],

  // Role-specific technical banks — matched by keyword against the role the candidate typed in.
  TechnicalByRole: {
    "data analyst": [
      { text: "How would you find and handle missing or duplicate data in a dataset?",
        ideal: "I'd first profile the data to see how much is missing and whether it's random or patterned. Depending on the case, I'd either drop rows/columns with too much missing data, impute values (mean, median, or a model-based estimate), or flag it explicitly. For duplicates, I'd define what makes a row unique and drop exact or near-duplicates after confirming they aren't legitimate repeats." },
      { text: "Write or explain a SQL query to find the second highest salary in an employee table.",
        ideal: "One common way: use a subquery with MAX() that excludes the overall maximum — e.g. SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees). Alternatively, DENSE_RANK() with a window function ordered by salary descending, then filtering for rank = 2, handles ties more predictably." },
      { text: "How would you explain a complex data finding to a non-technical stakeholder?",
        ideal: "I'd lead with the business implication, not the method — what changed, why it matters, and what action it suggests — using a simple chart or one number as the anchor. I'd avoid jargon like p-values or model names unless asked, and be ready to go one level deeper only if they want it." },
      { text: "What's the difference between INNER JOIN, LEFT JOIN, and OUTER JOIN?",
        ideal: "INNER JOIN returns only rows that match in both tables. LEFT JOIN returns all rows from the left table plus matching rows from the right (nulls where there's no match). FULL OUTER JOIN returns all rows from both tables, matching where possible and filling nulls elsewhere." },
      { text: "How would you detect if a metric's sudden change is a real trend or just noise?",
        ideal: "I'd check the historical variance of that metric to see if the change falls outside normal fluctuation, look for seasonality or one-off events (holidays, outages) that could explain it, and if possible run a statistical significance test. I'd also segment the data to see if the change is broad-based or driven by one small group." },
      { text: "Walk me through how you'd approach a dashboard that stakeholders say is 'too slow'.",
        ideal: "I'd first check if the slowness is in the query, the data volume, or the rendering — often it's an unoptimized query or pulling more data than the visual needs. I'd add indexes, pre-aggregate data where possible, and consider caching or scheduled refreshes instead of live queries for heavy dashboards." },
      { text: "What's the difference between correlation and causation, and why does it matter in your analysis?",
        ideal: "Correlation means two variables move together; causation means one actually causes the other. Treating correlation as causation can lead to wrong business decisions — like assuming a marketing channel drove sales when a third factor caused both. I'd look for controlled comparisons or experiments before claiming causation." },
      { text: "How do you decide which chart type to use for a given dataset?",
        ideal: "It depends on what I'm showing: trends over time use line charts, comparisons across categories use bar charts, part-to-whole uses pie or stacked bars (sparingly), and relationships between two variables use scatter plots. I pick the type that makes the specific comparison the audience needs to make as easy as possible." },
    ],
    "frontend": [
      { text: "What's the difference between the DOM and the Virtual DOM, and why does it matter?",
        ideal: "The DOM is the browser's actual tree representation of the page, and updating it directly is relatively expensive. The Virtual DOM is a lightweight in-memory copy that frameworks like React use to calculate the minimal set of changes needed, then apply only those changes to the real DOM — making updates faster and more predictable." },
      { text: "How would you optimize a web page that's loading slowly?",
        ideal: "I'd check what's blocking render — large unoptimized images, render-blocking JS/CSS, or too many network requests. Fixes include lazy-loading images, code-splitting JavaScript, minifying and compressing assets, using a CDN, and deferring non-critical scripts so the page becomes interactive faster." },
      { text: "Explain the CSS box model.",
        ideal: "Every element is a box made of content, padding, border, and margin, from inside out. Content is the actual text/image, padding is space inside the border, border wraps the padding, and margin is space outside the border separating it from other elements. box-sizing: border-box changes whether padding/border are included in the declared width." },
      { text: "What's the difference between == and === in JavaScript?",
        ideal: "== compares values after converting them to the same type (type coercion), while === compares both value and type without conversion. For example, '5' == 5 is true, but '5' === 5 is false. Using === is generally safer since it avoids unexpected coercion bugs." },
      { text: "How do you make a website responsive across different screen sizes?",
        ideal: "I'd use a fluid layout with relative units (%, rem, vw) instead of fixed pixels, CSS Grid or Flexbox for adaptable layouts, and media queries to adjust styles at specific breakpoints. I'd also test on real device sizes and ensure touch targets and font sizes stay usable on mobile." },
      { text: "What are React hooks, and why were they introduced?",
        ideal: "Hooks like useState and useEffect let function components manage state and side effects without needing class components. They were introduced to make it easier to reuse stateful logic between components and to avoid the complexity of 'this' binding and lifecycle methods in classes." },
      { text: "How would you handle a form with several interdependent fields (e.g. state and city dropdowns)?",
        ideal: "I'd keep the form state centralized (in one object or a form library like Formik/React Hook Form), and derive dependent fields from it — e.g. re-fetching or filtering city options whenever the state field changes, resetting the city value if the state changes to avoid mismatched selections." },
      { text: "What's the difference between client-side rendering and server-side rendering?",
        ideal: "In client-side rendering, the browser downloads a mostly-empty HTML page and JavaScript builds the content in the browser. In server-side rendering, the server sends fully-built HTML for the initial load, which is usually faster to first paint and better for SEO, though it can shift more load to the server." },
    ],
    "product": [
      { text: "How would you prioritize a backlog with limited engineering resources?",
        ideal: "I'd score items on impact versus effort — using something like RICE or a simple 2x2 matrix — factoring in business goals, user pain, and dependencies. I'd also loop in engineering early to catch effort estimates that look off, and keep prioritization visible so stakeholders understand why something is or isn't in the current sprint." },
      { text: "Walk me through how you'd define success metrics for a new feature.",
        ideal: "I'd start from the problem the feature solves and pick 1-2 primary metrics directly tied to that outcome (like activation rate or task completion), plus a guardrail metric to catch unintended harm (like churn or load time). I'd set a baseline and target before launch so success can be judged objectively afterward." },
      { text: "How would you handle a disagreement between engineering and design on a feature's scope?",
        ideal: "I'd get both sides to explain the trade-off in terms of user impact and cost, look for a smaller version that satisfies the core user need within the engineering constraint, and make the final call transparently, explaining the reasoning to both teams rather than just picking a side." },
      { text: "How would you decide whether to build a feature or not, given ambiguous user feedback?",
        ideal: "I'd look for supporting signals beyond the feedback itself — usage data, support tickets, or a quick survey — to see how widespread and severe the need is. If it's still unclear, I'd consider a lightweight test (a prototype or a smaller version) before committing significant engineering time." },
      { text: "Tell me about a time you had to say no to a stakeholder's feature request.",
        ideal: "I'd explain the specific trade-off — what it would cost in time or focus versus higher-priority work — using data or user impact to back up the decision, and offer an alternative (a smaller version, or revisiting it next cycle) rather than a flat no." },
      { text: "How do you gather and incorporate user feedback into the product roadmap?",
        ideal: "I'd combine qualitative sources (user interviews, support tickets, sales feedback) with quantitative data (usage analytics, funnel drop-offs) to spot recurring themes, then map validated pain points against business priorities before adding them to the roadmap — rather than reacting to the loudest single request." },
      { text: "How would you approach launching a feature in a way that lets you measure its impact?",
        ideal: "I'd define the success metric upfront, use a phased or A/B rollout where possible so I have a comparison group, and make sure tracking/analytics are in place before launch, not after — so I can attribute any change in metrics to the feature with confidence." },
      { text: "What's your framework for deciding between multiple competing product ideas?",
        ideal: "I'd evaluate each idea against a consistent set of criteria — user impact, strategic fit, effort, and risk — using a simple scoring model, and validate the top contenders with lightweight research or a prototype before fully committing engineering resources." },
    ],
  },

  HR: [
    { text: "Tell me about yourself.",
      ideal: "I'd give a brief, structured summary: current role or field of study, one or two relevant achievements or skills, and why I'm interested in this particular role — kept to about 60-90 seconds, ending with a natural bridge into why I'm a good fit." },
    { text: "Why do you want to work here?",
      ideal: "I'd connect something specific about the company (its product, mission, or recent work) to my own skills and interests, showing I've actually researched them rather than giving a generic answer, and explain what I hope to contribute and learn." },
    { text: "Describe a conflict you had with a teammate and how you resolved it.",
      ideal: "I'd describe a specific, real situation using the STAR method — the disagreement (Situation/Task), what I did to address it directly and respectfully (Action), and the outcome (Result), emphasizing communication and compromise rather than who was 'right'." },
    { text: "Tell me about a time you failed. What did you learn?",
      ideal: "I'd pick a genuine failure, briefly explain what went wrong and my role in it without over-explaining or blaming others, then focus most of the answer on what I learned and how I've applied that lesson since." },
    { text: "Where do you see yourself in five years?",
      ideal: "I'd describe realistic growth — deepening expertise in my field, taking on more responsibility or leadership — while tying it back to how this role helps me get there, showing ambition without sounding like I'll leave immediately." },
    { text: "How do you handle tight deadlines and pressure?",
      ideal: "I'd explain a concrete strategy — prioritizing tasks, breaking work into smaller pieces, communicating early if something's at risk — and back it up with a brief real example where this approach helped me deliver under pressure." },
    { text: "Tell me about a time you had to convince someone to see things your way.",
      ideal: "I'd describe the situation, how I understood the other person's perspective first, the specific reasoning or evidence I used to make my case, and the outcome — showing persuasion through listening and logic rather than just insisting." },
    { text: "What's a weakness you're actively working on?",
      ideal: "I'd name a real, specific weakness (not a disguised strength), then describe the concrete steps I'm taking to improve it, showing self-awareness and genuine progress rather than a rehearsed non-answer." },
  ],
  // Generic fallback templates — used for any role that doesn't match a curated bank above.
  // {role} gets replaced with whatever the candidate typed, so questions still feel role-specific.
  GenericByRole: [
    { text: "What are the most important skills for a {role}, and which one would you say is your strongest?",
      ideal: "I'd name 2-3 skills that are genuinely core to the {role} role (not generic ones like 'hard work'), briefly explain why each matters day-to-day, and then pick my strongest one and back it up with a specific example of using it." },
    { text: "Walk me through a recent project or task you handled as a {role}. What was your approach?",
      ideal: "I'd use the STAR structure: briefly set up the Situation and Task, explain the specific steps I took (Action), and end with the measurable or observable Result — keeping the focus on my own contribution and decision-making, not just what the team did." },
    { text: "What tools, software, or methods do you rely on most in {role} work?",
      ideal: "I'd name the 2-3 tools or methods most central to doing this job well, briefly explain what each is used for, and mention one example of how using them well made a real difference in a task or project." },
    { text: "Describe a challenging problem you faced while working as a {role} and how you resolved it.",
      ideal: "I'd describe a real, specific problem, what made it hard (limited time, unclear requirements, conflicting priorities, etc.), the concrete steps I took to solve it, and what the outcome was — plus what I'd do differently if faced with it again." },
    { text: "How do you prioritize your tasks in a typical week as a {role}?",
      ideal: "I'd explain a concrete method — like sorting tasks by urgency and impact, blocking time for deep work, or checking in with stakeholders on shifting priorities — and give a brief real example of a week where this approach helped me stay on track." },
    { text: "What does success look like in a {role} role, and how would you measure it?",
      ideal: "I'd name 1-2 concrete outcomes or metrics that reflect real impact in this role (not vague ones like 'doing a good job'), and explain briefly why those particular measures matter to the team or business." },
    { text: "Tell me about a time you had to learn a new skill quickly to complete a task as a {role}.",
      ideal: "I'd describe the specific skill gap, how I closed it quickly (documentation, asking a colleague, a short course, trial and error), and how I applied it to actually finish the task — showing initiative and comfort with being outside my existing knowledge." },
    { text: "How do you stay updated with new trends, tools, or best practices relevant to a {role}?",
      ideal: "I'd name specific, real habits — following particular publications, communities, courses, or people in the field — rather than a vague 'I read articles', and mention one recent thing I learned this way and how I applied it." },
  ],
};

function pickTechnicalPool(role) {
  const r = (role || "").toLowerCase();
  if (/data\s*(analyst|scientist|science)/.test(r) || r.includes("analytics")) return QUESTION_BANK.TechnicalByRole["data analyst"];
  if (/front[\s-]?end|react|ui developer/.test(r)) return QUESTION_BANK.TechnicalByRole["frontend"];
  if (/product manager|\bpm\b/.test(r)) return QUESTION_BANK.TechnicalByRole["product"];
  if (!r.trim()) return QUESTION_BANK.Technical; // no role typed: use general SE set
  // Any other typed role: use generic templates with the role name filled in, so it always feels relevant
  return QUESTION_BANK.GenericByRole.map(q => ({
    text: q.text.replace(/\{role\}/g, role.trim()),
    ideal: q.ideal.replace(/\{role\}/g, role.trim()),
  }));
}

function mockGenerateQuestions({ role, type, count }) {
  const technicalPool = pickTechnicalPool(role);
  let pool = [];
  if (type === "Technical") pool = technicalPool.map(q => ({ ...q, category: "Technical" }));
  else if (type === "HR") pool = QUESTION_BANK.HR.map(q => ({ ...q, category: "HR" }));
  else pool = [
    ...technicalPool.map(q => ({ ...q, category: "Technical" })),
    ...QUESTION_BANK.HR.map(q => ({ ...q, category: "HR" })),
  ];

  // shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const chosen = pool.slice(0, count);
  return chosen.map((q, i) => ({
    id: i + 1,
    text: q.text,
    category: q.category,
    idealAnswer: q.ideal,
  }));
}

const FILLER_WORDS = ["um", "uh", "like", "basically", "actually", "you know", "sort of", "kind of"];

function mockEvaluateAnswer({ question, answer }) {
  const trimmed = (answer || "").trim();
  const words = trimmed.length ? trimmed.split(/\s+/) : [];
  const wordCount = words.length;
  const lowerAns = trimmed.toLowerCase();

  // Relevance: keyword overlap between question and answer
  const qWords = question.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 4);
  const overlap = qWords.filter(w => lowerAns.includes(w)).length;
  let relevance = Math.min(100, 40 + overlap * 12 + Math.min(wordCount, 60));
  if (wordCount === 0) relevance = 0;

  // Filler word penalty feeds into communication + clarity
  const fillerHits = FILLER_WORDS.reduce((acc, w) => acc + (lowerAns.split(w).length - 1), 0);
  const fillerPenalty = Math.min(35, fillerHits * 8);

  // Structure/length signal
  const lengthScore = wordCount === 0 ? 0 : Math.max(20, Math.min(95, 30 + wordCount * 1.6));

  let clarity = Math.max(10, Math.round(lengthScore - fillerPenalty * 0.6));
  let communication = Math.max(10, Math.round(70 - fillerPenalty + (wordCount > 15 ? 15 : 0)));
  let technical_accuracy = Math.max(10, Math.round((relevance * 0.6) + (wordCount > 20 ? 20 : wordCount)));

  relevance = Math.min(100, Math.max(0, Math.round(relevance)));
  clarity = Math.min(100, clarity);
  communication = Math.min(100, communication);
  technical_accuracy = Math.min(100, technical_accuracy);

  const overall = wordCount === 0 ? 0 : Math.round((relevance + clarity + communication + technical_accuracy) / 4);

  let feedback;
  let improved_answer;
  if (wordCount === 0) {
    feedback = "No answer was recorded for this question. An empty response scores zero across the board — even a short, direct attempt would score higher than silence.";
    improved_answer = "Try structuring a response with the STAR method: briefly set the Situation, your Task, the Action you took, and the Result — even two or three sentences per part is enough.";
  } else {
    const parts = [];
    if (relevance < 60) parts.push("your answer drifts from what the question actually asked — anchor your first sentence directly to the key term in the question");
    else parts.push("you stayed on topic and addressed the core of the question");
    if (fillerHits > 2) parts.push(`filler words like "${FILLER_WORDS.find(w => lowerAns.includes(w)) || "um"}" show up often enough to soften your delivery — pausing silently reads as more confident`);
    if (wordCount < 25) parts.push("the answer is quite short for this kind of question — adding one concrete example would make it far more convincing");
    else if (wordCount > 120) parts.push("the answer runs long — tightening it to the most important 2-3 points would land better");
    feedback = "In this answer, " + parts.join("; ") + ".";

    improved_answer = "A tighter version would open with a one-line direct answer, follow with a specific example or number to back it up, and close with the outcome or what you'd do differently — keeping the whole thing to about 3-4 sentences.";
  }

  return {
    relevance,
    technical_accuracy,
    clarity,
    communication,
    overall,
    feedback,
    improved_answer,
  };
}

function mockFinalizeReport({ evaluations }) {
  const valid = evaluations.filter(e => e.overall > 0);
  const avg = (key) => valid.length ? Math.round(valid.reduce((a, e) => a + e[key], 0) / valid.length) : 0;
  const readiness = valid.length ? Math.round((avg("relevance") + avg("technical_accuracy") + avg("clarity") + avg("communication")) / 4) : 0;

  let summary;
  if (readiness >= 80) summary = "Strong session overall — your answers were relevant and well-structured. Focus on trimming filler words to sound even more polished.";
  else if (readiness >= 60) summary = "Solid foundation. A few answers need more specific examples and tighter structure to feel fully interview-ready.";
  else if (readiness >= 35) summary = "You're getting the shape of it, but several answers need more direct, on-topic responses. Practice answering the exact question asked before adding context.";
  else summary = "This session shows a lot of room to grow — start by answering every question fully, even briefly, before working on polish.";

  return { readiness, summary };
}

/* ============================ APP STATE ================================= */

const state = {
  candidate: { name: "", role: "", experience: "Fresher", type: "Mixed", count: 5 },
  sessionId: null,       // set by apiGenerateQuestions() once the backend session starts
  totalQuestions: 0,     // set by apiGenerateQuestions() — use this instead of questions.length
                         // for progress display, since `questions` fills in one at a time
  questions: [],
  currentIndex: 0,
  evaluations: [], // { question, category, ...scores }
  timerHandle: null,
  timerSeconds: 0,
};

/* ============================ VIEW ROUTING =============================== */

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

/* ============================ LANDING -> SETUP =========================== */

document.getElementById("startBtn").addEventListener("click", () => showView("view-setup"));
document.getElementById("brandHome").addEventListener("click", () => showView("view-landing"));
document.getElementById("backToLanding").addEventListener("click", () => showView("view-landing"));

function wirePillGroup(groupId, stateKey) {
  const group = document.getElementById(groupId);
  const pills = group.querySelectorAll(".pill");
  pills.forEach(p => {
    p.addEventListener("click", () => {
      pills.forEach(x => x.classList.remove("active"));
      p.classList.add("active");
      state.candidate[stateKey] = p.dataset.value;
    });
  });
  // default select first
  pills[0].classList.add("active");
  state.candidate[stateKey] = pills[0].dataset.value;
}
wirePillGroup("grpExperience", "experience");
wirePillGroup("grpType", "type");

document.getElementById("countMinus").addEventListener("click", () => {
  state.candidate.count = Math.max(3, state.candidate.count - 1);
  document.getElementById("countVal").textContent = state.candidate.count;
});
document.getElementById("countPlus").addEventListener("click", () => {
  state.candidate.count = Math.min(10, state.candidate.count + 1);
  document.getElementById("countVal").textContent = state.candidate.count;
});

/* ============================ SETUP -> INTERVIEW ========================= */

document.getElementById("beginInterview").addEventListener("click", async () => {
  state.candidate.name = document.getElementById("inpName").value.trim() || "Candidate";
  state.candidate.role = document.getElementById("inpRole").value.trim() || "your target role";

  const btn = document.getElementById("beginInterview");
  btn.disabled = true;
  btn.textContent = "Preparing questions…";

  try {
    state.questions = await apiGenerateQuestions({
      role: state.candidate.role,
      experience: state.candidate.experience,
      type: state.candidate.type,
      count: state.candidate.count,
    });
    state.currentIndex = 0;
    state.evaluations = [];
    document.getElementById("topStatus").textContent = state.candidate.role;
    loadQuestion();
    showView("view-interview");
  } catch (err) {
    alert(err.message || "Something went wrong starting the interview.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Begin interview";
  }
});

/* ============================ INTERVIEW SCREEN ============================ */

function loadQuestion() {
  const q = state.questions[state.currentIndex];
  document.getElementById("qCount").textContent = `Question ${state.currentIndex + 1} of ${state.totalQuestions}`;
  document.getElementById("qCategory").textContent = q.category;
  document.getElementById("qText").textContent = q.text;
  document.getElementById("answerBox").value = "";
  document.getElementById("wordCount").textContent = "0 words";
  const pct = (state.currentIndex / state.totalQuestions) * 100;
  document.getElementById("progressFill").style.width = pct + "%";
  startTimer();
}

document.getElementById("answerBox").addEventListener("input", (e) => {
  const words = e.target.value.trim().length ? e.target.value.trim().split(/\s+/).length : 0;
  document.getElementById("wordCount").textContent = `${words} word${words === 1 ? "" : "s"}`;
});

function startTimer() {
  clearInterval(state.timerHandle);
  state.timerSeconds = 0;
  updateTimerDisplay();
  state.timerHandle = setInterval(() => {
    state.timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}
function stopTimer() { clearInterval(state.timerHandle); }
function updateTimerDisplay() {
  const m = String(Math.floor(state.timerSeconds / 60)).padStart(2, "0");
  const s = String(state.timerSeconds % 60).padStart(2, "0");
  document.getElementById("qTimer").textContent = `${m}:${s}`;
}

document.getElementById("skipBtn").addEventListener("click", () => submitCurrentAnswer(""));
document.getElementById("submitAnswer").addEventListener("click", () => {
  submitCurrentAnswer(document.getElementById("answerBox").value);
});

async function submitCurrentAnswer(answerText) {
  stopTimer();
  showView("view-loading");

  const q = state.questions[state.currentIndex];
  const loadingLines = [
    "Checking relevance and topic coverage",
    "Scanning for filler words and structure",
    "Scoring clarity and communication",
  ];
  document.getElementById("loadingSub").textContent = loadingLines[Math.floor(Math.random() * loadingLines.length)];

  try {
    const evaluation = await apiEvaluateAnswer({
      question: q.text,
      answer: answerText,
      role: state.candidate.role,
      category: q.category,
    });

    // small artificial delay so the loading state feels real, not instant
    await new Promise(r => setTimeout(r, 550));

    state.evaluations.push({ question: q.text, category: q.category, answer: answerText, idealAnswer: evaluation.improved_answer, ...evaluation });
    renderFeedback(evaluation);
    showView("view-feedback");
  } catch (err) {
    alert(err.message || "Something went wrong evaluating your answer.");
    showView("view-interview");
  }
}

/* ============================ FEEDBACK SCREEN ============================ */

function scoreColorVar(score) {
  if (score >= 70) return "var(--good)";
  if (score >= 45) return "var(--mid)";
  return "var(--bad)";
}

function renderFeedback(evalData) {
  document.getElementById("fbQCount").textContent = `Question ${state.currentIndex + 1} of ${state.totalQuestions} — feedback`;
  document.getElementById("fbOverall").textContent = evalData.overall;
  document.getElementById("fbOverall").style.color = scoreColorVar(evalData.overall);
  document.getElementById("fbFeedback").textContent = evalData.feedback;
  document.getElementById("fbImproved").textContent = evalData.improved_answer;

  const metrics = [
    ["Relevance", evalData.relevance],
    ["Technical accuracy", evalData.technical_accuracy],
    ["Clarity", evalData.clarity],
    ["Communication", evalData.communication],
  ];
  const container = document.getElementById("fbMetrics");
  container.innerHTML = metrics.map(([name, val]) => `
    <div class="metric">
      <div class="metric-top"><span class="name">${name}</span><span class="val">${val}/100</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${val}%; background:${scoreColorVar(val)}"></div></div>
    </div>
  `).join("");
}

document.getElementById("nextQuestion").addEventListener("click", async () => {
  state.currentIndex++;
  if (state.currentIndex < state.totalQuestions) {
    showView("view-loading");
    document.getElementById("loadingSub").textContent = "Preparing your next question";
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/interview/${state.sessionId}/next-question`);
      if (!res.ok) throw new Error("Failed to fetch the next question.");
      const data = await res.json();
      state.questions.push({
        id: data.question.question_id,
        text: data.question.question,
        category: data.question.category,
        idealAnswer: "",
      });
      loadQuestion();
      showView("view-interview");
    } catch (err) {
      alert(err.message || "Something went wrong fetching the next question.");
      showView("view-interview"); // fall back to the last visible screen rather than a dead loading state
    }
  } else {
    await finishSession();
  }
});

/* ============================ REPORT SCREEN =============================== */

async function finishSession() {
  showView("view-loading");
  document.getElementById("loadingSub").textContent = "Putting together your final report";

  try {
    const { readiness, summary } = await apiFinalizeReport({
      candidate: state.candidate,
      evaluations: state.evaluations,
    });
    await new Promise(r => setTimeout(r, 500));

    renderReport(readiness, summary);
    showView("view-report");
  } catch (err) {
    alert(err.message || "Something went wrong generating the final report.");
    showView("view-feedback");
  }
}

function renderReport(readiness, summary) {
  document.getElementById("reportName").textContent = `${state.candidate.name}'s interview report`;
  document.getElementById("readinessNum").textContent = readiness;
  document.getElementById("readinessBlurb").textContent = summary;

  let headline = "Needs more practice";
  if (readiness >= 80) headline = "Interview ready";
  else if (readiness >= 60) headline = "Almost there";
  else if (readiness >= 35) headline = "Building the basics";
  document.getElementById("readinessHeadline").textContent = headline;

  const circumference = 364;
  const offset = circumference - (readiness / 100) * circumference;
  const ring = document.getElementById("ringProgress");
  ring.style.stroke = scoreColorVar(readiness);
  setTimeout(() => { ring.style.transition = "stroke-dashoffset 0.8s ease"; ring.setAttribute("stroke-dashoffset", offset); }, 50);

  const avg = (key) => {
    const valid = state.evaluations.filter(e => e.overall > 0);
    if (!valid.length) return 0;
    return Math.round(valid.reduce((a, e) => a + e[key], 0) / valid.length);
  };
  const metrics = [
    ["Relevance", avg("relevance")],
    ["Technical accuracy", avg("technical_accuracy")],
    ["Clarity", avg("clarity")],
    ["Communication", avg("communication")],
  ];
  document.getElementById("reportMetrics").innerHTML = metrics.map(([name, val]) => `
    <div class="metric">
      <div class="metric-top"><span class="name">${name}</span><span class="val">${val}/100</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${val}%; background:${scoreColorVar(val)}"></div></div>
    </div>
  `).join("");

  const WEAK_THRESHOLD = 60;
  document.getElementById("qBreakdownList").innerHTML = state.evaluations.map((e, i) => `
    <div class="qitem">
      <div class="qrow">
        <div>
          <div class="qtext">${i + 1}. ${escapeHtml(e.question)}</div>
          <div class="qtag">${e.category}</div>
        </div>
        <div class="score-chip ${e.overall >= 70 ? "good" : e.overall >= 45 ? "mid" : "bad"}">${e.overall}</div>
      </div>
      ${e.overall < WEAK_THRESHOLD && e.idealAnswer ? `
        <div class="correct-answer">
          <div class="ca-label">Correct / model answer</div>
          <p>${escapeHtml(e.idealAnswer)}</p>
        </div>
      ` : ""}
    </div>
  `).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("restartBtn").addEventListener("click", () => {
  state.questions = [];
  state.currentIndex = 0;
  state.evaluations = [];
  state.sessionId = null;
  state.totalQuestions = 0;
  document.getElementById("inpName").value = "";
  document.getElementById("inpRole").value = "";
  document.getElementById("topStatus").textContent = "AI Mock Interview Coach";
  showView("view-landing");
});
