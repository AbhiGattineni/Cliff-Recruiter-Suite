// Client wrappers for the GitHub portfolio Cloud Functions.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { ProviderId, TokenUsage } from "./resume";

export interface GithubProfile {
  login: string;
  url: string;
  avatarUrl: string;
  name: string;
  bio: string;
  location: string;
  company: string;
  blog: string;
  publicRepos: number;
  followers: number;
  createdAt: string;
}

export interface PortfolioRepo {
  name: string;
  url: string;
  language: string;
  stars: number;
  lastPushed: string;
  whyRelevant: string;
}

export interface SkillEvidence {
  skill: string;
  status: "evidenced" | "partial" | "missing" | string;
  note: string;
}

export interface PortfolioAssessment {
  portfolioScore: number; // 0-100
  rating: "Strong" | "Moderate" | "Weak" | string;
  summary: string;
  activityLevel: string;
  relevantRepos: PortfolioRepo[];
  skillEvidence: SkillEvidence[];
  redFlags: string[];
}

export interface PortfolioResult {
  profile: GithubProfile;
  portfolio: PortfolioAssessment;
  usage: TokenUsage | null;
}

/** Search GitHub for likely profiles for a candidate (recruiter confirms the match). */
export async function searchGithubUsers(name: string, email: string): Promise<GithubProfile[]> {
  ensureConfigured();
  const callable = httpsCallable<{ name: string; email: string }, { ok: boolean; matches?: GithubProfile[]; error?: string }>(
    functions,
    "githubSearch"
  );
  const res = await callable({ name, email });
  if (!res.data?.ok) throw new Error(res.data?.error || "GitHub search failed.");
  return res.data.matches ?? [];
}

/** Fetch a GitHub profile's portfolio and assess it against the job description. */
export async function assessGithubPortfolio(
  github: string,
  jobDescription: string,
  provider: ProviderId,
  model: string
): Promise<PortfolioResult> {
  ensureConfigured();
  const callable = httpsCallable<
    { github: string; jobDescription: string; provider: ProviderId; model: string },
    { ok: boolean; profile?: GithubProfile; portfolio?: PortfolioAssessment; usage?: TokenUsage; error?: string }
  >(functions, "githubPortfolio", { timeout: 300_000 });
  const res = await callable({ github, jobDescription, provider, model });
  if (!res.data?.ok || !res.data.portfolio || !res.data.profile) {
    throw new Error(res.data?.error || "Portfolio assessment failed.");
  }
  return { profile: res.data.profile, portfolio: res.data.portfolio, usage: res.data.usage ?? null };
}

export interface ResumeReportPatch {
  githubUrl?: string;
  linkedinUrl?: string;
  portfolio?: PortfolioAssessment;
  githubProfile?: GithubProfile;
  linkedinCheck?: unknown;
  missingLinks?: { github: boolean; linkedin: boolean } | null;
}

/** Patch profile links / portfolio onto an already-saved resume report. */
export async function updateResumeReport(id: string, patch: ResumeReportPatch): Promise<void> {
  ensureConfigured();
  const callable = httpsCallable<{ id: string } & ResumeReportPatch, { ok: boolean }>(functions, "updateResumeReport");
  await callable({ id, ...patch });
}
