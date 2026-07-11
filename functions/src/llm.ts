// LLM-backed resume assessment — Ollama (OpenAI-compatible Chat Completions API).
//
// Works with Ollama Cloud (https://ollama.com/v1, Bearer API key) and with a
// local/self-hosted Ollama (http://localhost:11434/v1, no key needed).
// Configure via env: LLM_BASE_URL, LLM_MODEL, and the LLM_API_KEY secret.

export interface SkillMatch {
  skill: string;
  status: "matched" | "partial" | "missing";
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
  aiGeneratedConfidence: string;
  aiGeneratedLines: string[]; // exact resume phrases that read as AI-generated
  extracted: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are a recruitment screening assistant for a staffing firm.
Given a candidate resume and a job description, assess the fit.
Return ONLY a single JSON object (no prose, no markdown fences, no comments) with exactly these keys:
{
  "candidateName": string,
  "fitScore": number (0-100),
  "rating": "Strong" | "Moderate" | "Weak",
  "summary": string (2-4 sentences, plain professional English),
  "strengths": string[] (3-6 short points),
  "gaps": string[] (2-5 short points),
  "skillMatches": [{ "skill": string, "status": "matched" | "partial" | "missing" }],
  "aiGeneratedLikelihood": "Low" | "Medium" | "High",
  "aiGeneratedConfidence": string (one short sentence explaining the AI-likelihood signal),
  "aiGeneratedLines": string[] (up to 5 exact phrases or sentences copied VERBATIM from the resume that read as AI-generated - generic, templated, or buzzword-heavy filler. Empty array if none stand out),
  "extracted": { "email": string, "phone": string, "totalExperienceYears": number, "currentTitle": string, "location": string }
}
The AI-generated likelihood is a probabilistic judgement of how machine-written the resume text reads; it is not proof.
For aiGeneratedLines, copy the phrases exactly as they appear in the resume so they can be located; do not paraphrase.
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

  // Light normalisation so the UI never crashes on a missing field.
  const assessment: ResumeAssessment = {
    candidateName: parsed.candidateName ?? "",
    fitScore: Number(parsed.fitScore ?? 0),
    rating: parsed.rating ?? "Moderate",
    summary: parsed.summary ?? "",
    strengths: parsed.strengths ?? [],
    gaps: parsed.gaps ?? [],
    skillMatches: parsed.skillMatches ?? [],
    aiGeneratedLikelihood: parsed.aiGeneratedLikelihood ?? "Medium",
    aiGeneratedConfidence: parsed.aiGeneratedConfidence ?? "",
    aiGeneratedLines: Array.isArray(parsed.aiGeneratedLines) ? parsed.aiGeneratedLines : [],
    extracted: parsed.extracted ?? {},
  };
  return { assessment, usage };
}
