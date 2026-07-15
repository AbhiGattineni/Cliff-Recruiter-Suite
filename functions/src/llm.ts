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
  "extracted": { "email": string, "phone": string, "totalExperienceYears": number, "currentTitle": string, "location": string }
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
