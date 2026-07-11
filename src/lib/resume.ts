// Client wrapper around the resume-parsing Cloud Function (which calls the LLM).

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";

export interface SkillMatch {
  skill: string;
  status: "matched" | "partial" | "missing";
}

export interface ResumeAssessment {
  candidateName: string;
  fitScore: number; // 0-100
  rating: "Strong" | "Moderate" | "Weak" | string;
  summary: string; // short written review
  strengths: string[];
  gaps: string[];
  skillMatches: SkillMatch[];
  aiGeneratedLikelihood: "Low" | "Medium" | "High" | string;
  aiGeneratedConfidence: string; // short note
  aiGeneratedLines: string[]; // exact resume phrases that read as AI-generated
  extracted: {
    email?: string;
    phone?: string;
    totalExperienceYears?: number | string;
    currentTitle?: string;
    location?: string;
  };
}

export type ProviderId = "ollama" | "openai";

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderCatalogEntry {
  label: string;
  models: ModelOption[];
  defaultModel: string;
}

// Curated model list per provider (labels shown in the picker).
export const MODEL_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  ollama: {
    label: "Ollama",
    defaultModel: "gpt-oss:20b",
    models: [
      { id: "gpt-oss:20b", label: "gpt-oss 20B (fast)" },
      { id: "gpt-oss:120b", label: "gpt-oss 120B" },
      { id: "deepseek-v3.2", label: "DeepSeek V3.2" },
      { id: "qwen3-coder:480b", label: "Qwen3 Coder 480B" },
      { id: "gemma3:27b", label: "Gemma 3 27B" },
    ],
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini (fast)" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
    ],
  },
};

export interface DuplicateInfo {
  id: string;
  candidateName: string;
  matchedOn: "email" | "phone";
  email: string;
  phone: string;
  createdAt: number | null;
}

interface ParseResponse {
  ok: boolean;
  assessment?: ResumeAssessment;
  duplicate?: DuplicateInfo | null;
  error?: string;
}

export interface AssessResult {
  assessment: ResumeAssessment;
  duplicate: DuplicateInfo | null;
}

interface AvailabilityResponse {
  ok: boolean;
  providers: Record<ProviderId, boolean>;
}

/** Ask the backend which providers have an API key configured. */
export async function getLlmAvailability(): Promise<Record<ProviderId, boolean>> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, AvailabilityResponse>(
    functions,
    "llmAvailability"
  );
  const res = await callable({});
  return res.data?.providers ?? { ollama: false, openai: false };
}

/**
 * Send resume text + a job description to the chosen provider/model (via Cloud
 * Function) and get a structured fit assessment back.
 */
export async function assessResume(
  resumeText: string,
  jobDescription: string,
  provider: ProviderId,
  model: string
): Promise<AssessResult> {
  ensureConfigured();
  const callable = httpsCallable<
    { resumeText: string; jobDescription: string; provider: ProviderId; model: string },
    ParseResponse
  >(functions, "parseResume");
  const res = await callable({ resumeText, jobDescription, provider, model });
  const payload = res.data;
  if (!payload?.ok || !payload.assessment) {
    throw new Error(payload?.error || "Resume parsing failed.");
  }
  return { assessment: payload.assessment, duplicate: payload.duplicate ?? null };
}

/** Save an already-computed assessment to the reports history. Returns the id. */
export async function saveResumeReport(
  assessment: ResumeAssessment,
  provider: ProviderId,
  model: string,
  jobDescription: string
): Promise<string> {
  ensureConfigured();
  const callable = httpsCallable<
    { assessment: ResumeAssessment; provider: ProviderId; model: string; jobDescription: string },
    { ok: boolean; reportId?: string }
  >(functions, "saveResumeReport");
  const res = await callable({ assessment, provider, model, jobDescription });
  return res.data?.reportId ?? "";
}
