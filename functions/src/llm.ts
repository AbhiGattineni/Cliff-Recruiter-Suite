// LLM-backed resume assessment — Ollama (OpenAI-compatible Chat Completions API).
//
// Works with Ollama Cloud (https://ollama.com/v1, Bearer API key) and with a
// local/self-hosted Ollama (http://localhost:11434/v1, no key needed).
// Configure via env: LLM_BASE_URL, LLM_MODEL, and the LLM_API_KEY secret.

export interface SkillMatch {
  skill: string;
  status: "matched" | "partial" | "missing";
}

export interface AiFlaggedLine {
  text: string; // verbatim resume line/sentence
  score: number; // 0-100 AI-generation likelihood for that line
}

export interface ResumeAssessment {
  candidateName: string;
  fitScore: number;
  rating: string;
  summary: string;
  strengths: string[];
  gaps: string[];
  skillMatches: SkillMatch[];
  aiGeneratedLikelihood: string;
  aiGeneratedPercent: number; // 0-100 overall share of AI-generated content
  aiGeneratedConfidence: string;
  aiGeneratedLines: AiFlaggedLine[]; // every line that reads AI-generated, scored
  extracted: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are a recruitment screening assistant for a staffing firm.
Given a candidate resume and a job description, (1) assess the fit and (2) detect AI/LLM-generated writing in the resume.

AI-DETECTION METHOD — do this rigorously, line by line:
- Split the resume's experience/summary/project sections into individual bullet points and sentences.
- Score EACH bullet/sentence 0-100 for how likely the WRITING was produced/rewritten by an AI/LLM (ChatGPT-style).
- Strong signals of AI generation (raise the score): uniformly polished, smooth, "professionally rewritten" prose; parallel/templated bullet structure; heavy buzzwords ("spearheaded", "leveraged", "orchestrated", "streamlined", "cross-functional", "synergy", "robust", "scalable", "comprehensive", "hands-on", "solid command of", "comfortable building", "drove", "utilized"); every bullet/sentence following the same rhythm (verb + task + outcome); even sentence length and cadence; long flowing sentences that read like an LLM expanded a short bullet; marketing-brochure tone.
- CRITICAL: Most AI-written resumes are AI *rewrites* of a real person's resume — they KEEP genuine specifics (tool names, product names, schedules, codes, exact numbers) while polishing the wording. Therefore specific or technical detail does NOT indicate human authorship. Do NOT lower the score just because the resume names real tools, projects, schedules, or exact numbers. Judge the WRITING STYLE, not the factual specificity.
- Genuine human signals (only these lower the score, and they are about STYLE, not facts): messy or uneven phrasing, abrupt fragments, inconsistent formatting, first-person voice, typos or grammatical slips, terse note-like bullets.
- Be thorough and lean towards flagging when the prose is uniformly polished and templated, EVEN IF it is full of specific technical detail. If the whole summary/experience reads professionally rewritten, flag ALL of its bullets/sentences and set the percentage high (80-100).

Return ONLY a single JSON object (no prose, no markdown fences, no comments) with exactly these keys:
{
  "candidateName": string,
  "fitScore": number (0-100),
  "rating": "Strong" | "Moderate" | "Weak",
  "summary": string (2-4 sentences, plain professional English),
  "strengths": string[] (3-6 short points),
  "gaps": string[] (2-5 short points),
  "skillMatches": [{ "skill": string, "status": "matched" | "partial" | "missing" }],
  "aiGeneratedPercent": number (0-100 = the share of the resume's bullets/sentences that read AI-generated),
  "aiGeneratedLikelihood": "Low" | "Medium" | "High" ("Low" if aiGeneratedPercent < 30, "Medium" if 30-65, "High" if > 65),
  "aiGeneratedConfidence": string (one short sentence naming the main signals you used),
  "aiGeneratedLines": [{ "text": string, "score": number }] (EVERY bullet or sentence that reads AI-generated with score >= 40, copied VERBATIM from the resume; do NOT cap the count — list all of them; empty array only if nothing reads AI-generated),
  "extracted": { "email": string, "phone": string, "totalExperienceYears": number, "currentTitle": string, "location": string, "githubUrl": string (the candidate's GitHub profile URL if the resume contains one — copy it verbatim, else ""), "linkedinUrl": string (the candidate's LinkedIn profile URL if present — copy it verbatim, else "") }
}
For aiGeneratedLines, copy each phrase exactly as it appears in the resume so it can be located; do not paraphrase or shorten.
The AI signal is a probabilistic judgement, not proof.
Base skillMatches on the must-have and preferred skills in the job description.
Output the JSON object and nothing else.`;

export interface LlmConfig {
  baseUrl: string; // e.g. https://ollama.com/v1  or  https://api.openai.com/v1
  apiKey: string;
  model: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number; // estimated USD (0 when the model has no known price)
  priced: boolean; // false = no price for this model, cost is not meaningful
}

// Approximate USD per 1M tokens (input / output). Extend as models are added.
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "o4-mini": { in: 1.1, out: 4.4 },
};

function priceFor(model: string): { in: number; out: number } | null {
  const key = model.toLowerCase().trim();
  return PRICES[key] ?? null;
}

function computeUsage(model: string, prompt: number, completion: number): TokenUsage {
  const total = prompt + completion || prompt + completion;
  const p = priceFor(model);
  const cost = p ? (prompt / 1e6) * p.in + (completion / 1e6) * p.out : 0;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total, cost, priced: !!p };
}

/** Pull the first balanced JSON object out of the model's reply. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("The model did not return JSON.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Given a job description and a list of past role titles, return the titles that
 * are a relevant match (same or adjacent/transferable role) — used to filter the
 * internally-selected candidate pool by a pasted JD.
 */
export async function matchRolesToJd(
  jobDescription: string,
  roles: string[],
  config: LlmConfig
): Promise<{ relevant: string[]; usage: TokenUsage }> {
  const { apiKey, model } = config;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey && !apiKey.startsWith("PLACEHOLDER")) headers["authorization"] = `Bearer ${apiKey}`;

  const sys = `You match a job description to a pool of past role titles.
Given the JOB DESCRIPTION and a numbered LIST of role titles, return ONLY the titles that are a RELEVANT match for the job description's role — the same role or an adjacent / transferable role in the same skill area (e.g. "Backend Developer" matches "Java Developer"; "Data Engineer" matches "ETL Developer"). Exclude clearly unrelated roles.
Return ONLY a JSON object: {"relevant": string[]} where each string is copied VERBATIM from the provided list. If none match, return {"relevant": []}. Output the JSON and nothing else.`;
  const user = `JOB DESCRIPTION:\n${jobDescription}\n\nROLE TITLES:\n${roles.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.1,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM match failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const text = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
  const usage = computeUsage(model, Number(promptTokens) || 0, Number(completionTokens) || 0);
  if (data.usage?.total_tokens) usage.totalTokens = Number(data.usage.total_tokens);

  let relevant: string[] = [];
  try {
    const parsed = extractJson(text) as { relevant?: unknown };
    if (Array.isArray(parsed.relevant)) relevant = parsed.relevant.map((x) => String(x)).filter((x) => x.trim());
  } catch {
    relevant = [];
  }
  // Keep only titles that were actually offered (case-insensitive).
  const offered = new Set(roles.map((r) => r.toLowerCase().trim()));
  relevant = relevant.filter((r) => offered.has(r.toLowerCase().trim()));
  return { relevant, usage };
}

export async function assessResume(
  resumeText: string,
  jobDescription: string,
  config: LlmConfig
): Promise<{ assessment: ResumeAssessment; usage: TokenUsage }> {
  const { apiKey, model } = config;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Ollama Cloud uses a Bearer key; a local Ollama needs none.
  if (apiKey && !apiKey.startsWith("PLACEHOLDER")) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `JOB DESCRIPTION:\n${jobDescription}\n\n---\n\nRESUME:\n${resumeText}` },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${t.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    prompt_eval_count?: number; // native Ollama
    eval_count?: number; // native Ollama
  };
  // OpenAI-compatible shape: choices[0].message.content. (Native Ollama: message.content.)
  const text = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
  if (!text) throw new Error("The model returned an empty response.");

  const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
  const usage = computeUsage(model, Number(promptTokens) || 0, Number(completionTokens) || 0);
  if (data.usage?.total_tokens) usage.totalTokens = Number(data.usage.total_tokens);

  const parsed = extractJson(text) as ResumeAssessment;

  // Normalise the AI-detection output (accept scored objects or plain strings).
  const rawLines = (Array.isArray(parsed.aiGeneratedLines) ? parsed.aiGeneratedLines : []) as unknown[];
  const aiLines: AiFlaggedLine[] = rawLines
    .map((l): AiFlaggedLine => {
      if (typeof l === "string") return { text: l, score: 70 };
      const o = (l ?? {}) as { text?: unknown; score?: unknown };
      const t = typeof o.text === "string" ? o.text : String(o.text ?? "");
      return { text: t, score: Math.max(0, Math.min(100, Math.round(Number(o.score) || 0))) };
    })
    .filter((l) => l.text.trim().length > 0)
    .slice(0, 80);

  let percent = Number(parsed.aiGeneratedPercent);
  if (!Number.isFinite(percent)) {
    percent = aiLines.length ? Math.round(aiLines.reduce((s, l) => s + l.score, 0) / aiLines.length) : 0;
  }
  percent = Math.max(0, Math.min(100, Math.round(percent)));
  const band = percent > 65 ? "High" : percent >= 30 ? "Medium" : "Low";

  // Light normalisation so the UI never crashes on a missing field.
  const assessment: ResumeAssessment = {
    candidateName: parsed.candidateName ?? "",
    fitScore: Number(parsed.fitScore ?? 0),
    rating: parsed.rating ?? "Moderate",
    summary: parsed.summary ?? "",
    strengths: parsed.strengths ?? [],
    gaps: parsed.gaps ?? [],
    skillMatches: parsed.skillMatches ?? [],
    aiGeneratedLikelihood: band,
    aiGeneratedPercent: percent,
    aiGeneratedConfidence: parsed.aiGeneratedConfidence ?? "",
    aiGeneratedLines: aiLines,
    extracted: parsed.extracted ?? {},
  };
  return { assessment, usage };
}

// ---- GitHub portfolio vs JD -------------------------------------------------

export interface PortfolioRepoAssessment {
  name: string;
  url: string;
  language: string;
  stars: number;
  lastPushed: string;
  whyRelevant: string;
}

export interface SkillEvidence {
  skill: string;
  status: "evidenced" | "partial" | "missing";
  note: string;
}

export interface PortfolioAssessment {
  portfolioScore: number; // 0-100
  rating: string; // Strong | Moderate | Weak
  summary: string;
  activityLevel: string; // Active | Moderate | Dormant
  relevantRepos: PortfolioRepoAssessment[];
  skillEvidence: SkillEvidence[];
  redFlags: string[];
}

const PORTFOLIO_PROMPT = `You are a technical recruiter's assistant. Given a JOB DESCRIPTION and a summary of a candidate's GITHUB PORTFOLIO (profile, repositories, languages, README excerpts), assess how well the PUBLIC portfolio evidences the skills the job needs.
Judge ONLY from the portfolio data provided — do not invent repositories or skills. Mostly-forked repos and tutorial/course clones are weak evidence. A sparse or empty portfolio is not disqualifying — say so neutrally.
Return ONLY a single JSON object (no prose, no markdown fences) with exactly these keys:
{
  "portfolioScore": number (0-100 — how strongly the public portfolio evidences the JD's required skills),
  "rating": "Strong" | "Moderate" | "Weak",
  "summary": string (2-4 plain-English sentences for a recruiter),
  "activityLevel": "Active" | "Moderate" | "Dormant" (from the recency of pushes),
  "relevantRepos": [{ "name": string, "url": string, "language": string, "stars": number, "lastPushed": string, "whyRelevant": string (one sentence tying the repo to the JD) }] (only repos genuinely relevant to the JD, most relevant first, max 8; [] if none),
  "skillEvidence": [{ "skill": string, "status": "evidenced" | "partial" | "missing", "note": string (short — where the evidence is, or "no public evidence") }] (for the JD's key skills),
  "redFlags": string[] (0-4 short points, e.g. "all repos are forks", "no activity since 2022"; [] if none)
}
Output the JSON object and nothing else.`;

export async function assessPortfolio(
  portfolioSummary: string,
  jobDescription: string,
  config: LlmConfig
): Promise<{ portfolio: PortfolioAssessment; usage: TokenUsage }> {
  const { apiKey, model } = config;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey && !apiKey.startsWith("PLACEHOLDER")) headers["authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: PORTFOLIO_PROMPT },
        { role: "user", content: `JOB DESCRIPTION:\n${jobDescription}\n\n---\n\nGITHUB PORTFOLIO:\n${portfolioSummary}` },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM portfolio request failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const text = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
  if (!text) throw new Error("The model returned an empty response.");
  const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
  const usage = computeUsage(model, Number(promptTokens) || 0, Number(completionTokens) || 0);
  if (data.usage?.total_tokens) usage.totalTokens = Number(data.usage.total_tokens);

  const parsed = extractJson(text) as Partial<PortfolioAssessment>;
  const str = (v: unknown) => String(v ?? "");
  const repos: PortfolioRepoAssessment[] = (Array.isArray(parsed.relevantRepos) ? (parsed.relevantRepos as unknown[]) : [])
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name),
        url: str(o.url),
        language: str(o.language),
        stars: Number(o.stars) || 0,
        lastPushed: str(o.lastPushed),
        whyRelevant: str(o.whyRelevant),
      };
    })
    .filter((r) => r.name)
    .slice(0, 8);
  const evidence: SkillEvidence[] = (Array.isArray(parsed.skillEvidence) ? (parsed.skillEvidence as unknown[]) : [])
    .map((e): SkillEvidence => {
      const o = (e ?? {}) as Record<string, unknown>;
      const status: SkillEvidence["status"] =
        o.status === "evidenced" || o.status === "partial" || o.status === "missing" ? o.status : "missing";
      return { skill: str(o.skill), status, note: str(o.note) };
    })
    .filter((e) => e.skill)
    .slice(0, 20);

  const portfolio: PortfolioAssessment = {
    portfolioScore: Math.max(0, Math.min(100, Math.round(Number(parsed.portfolioScore) || 0))),
    rating: parsed.rating === "Strong" || parsed.rating === "Weak" ? parsed.rating : "Moderate",
    summary: str(parsed.summary),
    activityLevel: str(parsed.activityLevel) || "Moderate",
    relevantRepos: repos,
    skillEvidence: evidence,
    redFlags: (Array.isArray(parsed.redFlags) ? parsed.redFlags : []).map(str).filter(Boolean).slice(0, 4),
  };
  return { portfolio, usage };
}

// ---- Ask Anything: NL -> query plan, and grounded narrative -----------------
//
// Two-stage design, on purpose: the LLM NEVER sees a data row and never states
// a number. planAskQuery only chooses WHAT to look at (a JSON plan over a
// catalog of table/column names); the actual numbers are computed in
// src/lib/askEngine.ts, in plain code, from data already loaded in the app.
// narrateAskResult is handed only the already-computed aggregate — a handful
// of numbers, not raw data — and asked to phrase (not invent) a sentence.
//
// Keep this catalog text in sync with src/lib/askCatalog.ts — it's duplicated
// rather than imported because functions/ is a separate TS project.
const ASK_CATALOG_PROMPT = [
  "- submissions: one row per candidate submission event (a profile sent for a requirement, at its current status).",
  "  columns: applicantName (string, the CANDIDATE who was submitted -- not a staff member), jobCode (string), jobTitle (string), client (string), recruiter (string, the STAFF MEMBER who made the submission), status (string), submittedOn (date), statusChangedOn (date), accountManager (string)",
  "  date field: submittedOn",
  "- requirements: one row per job requirement/posting.",
  "  columns: jobCode (string), jobTitle (string), client (string), status (enum: Active/On Hold/Hold by Client/Closed/Draft/Filled), jobCreatedOn (date), submissionsCount (number), recruitmentManager (string), assignedTo (string), payRate (string), experience (string), mandateSkills (string)",
  "  date field: jobCreatedOn",
  "- recruiters: one row per recruiter -- submission counts and Performance Index. A date range scopes which activity counts (not a per-row filter).",
  "  columns: recruiter (string), requirementsWorked (number), profiles (number), clientSubmissions (number), clientRatePct (number), progressRatePct (number), index (number)",
  "  date field: none (range scopes aggregation)",
  "- clients: one row per client/vendor -- requirements received and how our submissions to them are going. A date range scopes the aggregation.",
  "  columns: client (string), requirementsReceived (number), requirementsActive (number), requirementsOnHold (number), submissionsSent (number), responseRatePct (number), selected (number), verdict (enum: prioritize/watch/reconsider/unrated)",
  "  date field: none (range scopes aggregation)",
  "- resumes: one row per resume fit assessment.",
  "  columns: candidateName (string), fitScore (number), rating (enum: Strong/Moderate/Weak), aiGeneratedPercent (number), currentTitle (string), location (string), experienceYears (number), githubScore (number), linkedinVerdict (string), provider (string), createdAt (date)",
  "  date field: createdAt",
  "- timesheets: one row per requirement logged on a timesheet day.",
  "  columns: date (date), recruiter (string), jobCode (string), jobTitle (string), client (string), hours (number), notes (string)",
  "  date field: date",
].join("\n");

const ASK_PLAN_SYS = [
  "You turn a plain-English question about recruiting data into a JSON query plan.",
  "You do NOT answer the question and you never invent a number -- you only say what to look at.",
  "A separate deterministic engine runs your plan against the real data.",
  "",
  "Available tables and columns (use ONLY these field names, never invent one):",
  ASK_CATALOG_PROMPT,
  "",
  "Return ONLY a JSON object with this exact shape:",
  "{",
  '  "table": one of "submissions" | "requirements" | "recruiters" | "clients" | "resumes" | "timesheets",',
  '  "title": a short human title for this view (max 10 words),',
  '  "filters": [{ "field": string, "op": "eq"|"contains"|"in"|"gte"|"lte"|"before"|"after"|"between", "value": string | number | string[] }],',
  '  "dateFrom": "YYYY-MM-DD" or null,',
  '  "dateTo": "YYYY-MM-DD" or null,',
  '  "groupBy": a column name to group by, or null for a plain row list,',
  '  "metric": { "field": a numeric column name or null, "agg": "count"|"sum"|"avg" },',
  '  "columns": string[] of columns to show in the table (only used when groupBy is null),',
  '  "sort": { "field": string, "dir": "asc"|"desc" } or null,',
  '  "chart": "pie" | "bar" | "none" -- pick "none" when there is no groupBy or a chart would not help,',
  '  "limit": a row cap, default 500',
  "}",
  'Interpret relative dates ("this month", "last week", "this year") against the date this request was made.',
  "Pick the table whose description best matches the question. If the question asks for something no table",
  "supports, pick the closest table anyway and leave out filters/groupBy that do not apply -- never refuse.",
  "",
  "A person's name in the question is almost always a RECRUITER (a staff member), not a candidate --",
  'phrasings like "submissions by <name>", "how many submissions did <name> do/make", "<name>\'s submissions",',
  '"<name>\'s index/performance" all filter on the `recruiter` field. Only use `applicantName` /',
  '`candidateName` when the question is explicitly about a candidate or applicant profile (e.g. "candidate',
  'John Doe", "the profile for <name>", "resume assessment for <name>"). When unsure, prefer `recruiter`.',
  "",
  'Prefer op "contains" over "eq" for any filter on a name (recruiter, applicantName, candidateName, client) --',
  "names in the data may include middle initials, suffixes or different spacing than the question uses, and",
  '"contains" still matches. Only use "eq" when the question supplies a value you are confident is the exact,',
  "complete stored value (e.g. a status or an enum from the catalog above).",
  "Output the JSON object and nothing else.",
].join("\n");

/** NL question -> structured query plan. The plan is untrusted output -- the caller (askEngine.sanitizePlan) validates every field before running it. */
export async function planAskQuery(
  question: string,
  priorPlan: unknown,
  today: string,
  config: LlmConfig
): Promise<{ plan: unknown; usage: TokenUsage }> {
  const { apiKey, model } = config;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey && !apiKey.startsWith("PLACEHOLDER")) headers["authorization"] = `Bearer ${apiKey}`;

  const userParts = [`Today's date: ${today}`];
  if (priorPlan) {
    userParts.push(`Previous query plan (this question may be a follow-up refining it):\n${JSON.stringify(priorPlan)}`);
  }
  userParts.push(`Question: ${question}`);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.1,
      messages: [
        { role: "system", content: ASK_PLAN_SYS },
        { role: "user", content: userParts.join("\n\n") },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM query-plan request failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const text = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
  if (!text) throw new Error("The model returned an empty response.");
  const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
  const usage = computeUsage(model, Number(promptTokens) || 0, Number(completionTokens) || 0);
  if (data.usage?.total_tokens) usage.totalTokens = Number(data.usage.total_tokens);

  const plan = extractJson(text);
  return { plan, usage };
}

const LANG_NAME: Record<string, string> = { en: "English", te: "Telugu", hi: "Hindi" };

/**
 * Phrase a short summary of an ALREADY-COMPUTED aggregate. The model receives
 * only these numbers -- never raw rows -- so it can rephrase them but cannot
 * introduce a figure that is not already here.
 */
export async function narrateAskResult(
  facts: Record<string, unknown>,
  lang: string,
  config: LlmConfig
): Promise<{ text: string; usage: TokenUsage }> {
  const { apiKey, model } = config;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey && !apiKey.startsWith("PLACEHOLDER")) headers["authorization"] = `Bearer ${apiKey}`;

  const langName = LANG_NAME[lang] ?? "English";
  const sys = [
    "You write a 1-3 sentence plain-language summary of an already-computed data result for a recruiting-agency manager.",
    "You are given ONLY the computed numbers below -- you have no access to raw data and must not state, estimate,",
    "or imply any number that is not explicitly present in the JSON. Do not invent causes or recommendations beyond",
    `what the numbers directly show. Write in ${langName}.`,
    'Return ONLY a JSON object: {"text": string}. Output the JSON and nothing else.',
  ].join(" ");
  const user = `Computed result:\n${JSON.stringify(facts)}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM narrative request failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const raw = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
  if (!raw) throw new Error("The model returned an empty response.");
  const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
  const usage = computeUsage(model, Number(promptTokens) || 0, Number(completionTokens) || 0);
  if (data.usage?.total_tokens) usage.totalTokens = Number(data.usage.total_tokens);

  let text = "";
  try {
    const parsed = extractJson(raw) as { text?: unknown };
    text = typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    text = raw.trim(); // some models ignore the JSON instruction for short text -- fall back to the raw reply
  }
  return { text: text.slice(0, 800), usage };
}
