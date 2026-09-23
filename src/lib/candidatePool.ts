// Client wrappers for the internally-selected candidate pool + JD role matching.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { callAi } from "./ai";

export interface PoolCandidate {
  name: string;
  email: string;
  mobile: string;
  location: string;
  status: string;
  latestRole: string;
  latestClient: string;
  latestSubmittedOn: string;
  latestRecruiter: string;
  roles: string[]; // distinct roles this candidate was submitted to
  count: number; // number of submissions
}

export interface Pool {
  candidates: PoolCandidate[];
  /** When the underlying Ceipal rows were pulled (epoch ms, 0 if unknown). */
  fetchedAt: number;
  /** True when Ceipal could not be reached and this is the last good pull. */
  stale: boolean;
  /** Ceipal's own message when the live pull failed. Empty when it succeeded. */
  problem: string;
}

export async function getCandidatePool(refresh = false): Promise<Pool> {
  ensureConfigured();
  const callable = httpsCallable<
    { action: string; refresh: boolean },
    { ok: boolean; candidates: PoolCandidate[]; fetchedAt?: number; stale?: boolean; problem?: string }
  >(functions, "ceipalData", { timeout: 300_000 });
  const res = await callable({ action: "candidatePool", refresh });
  return {
    candidates: res.data?.candidates ?? [],
    fetchedAt: res.data?.fetchedAt ?? 0,
    stale: res.data?.stale === true,
    problem: res.data?.problem ?? "",
  };
}

/** LLM semantic match: returns the pool role titles relevant to the JD. */
export async function matchCandidatesToJd(jobDescription: string, roles: string[]): Promise<string[]> {
  ensureConfigured();
  const data = await callAi<
    { jobDescription: string; roles: string[] },
    { ok: boolean; relevant?: string[]; error?: string }
  >("matchCandidatesToJd", { jobDescription, roles }, { timeout: 120_000 });
  if (!data?.ok) throw new Error(data?.error || "Matching failed.");
  return data?.relevant ?? [];
}

/** Free keyword fallback (no LLM): a role is relevant if it shares a word with the JD. */
export function keywordMatchRoles(jobDescription: string, roles: string[]): string[] {
  const jdWords = new Set((jobDescription.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || []));
  return roles.filter((role) => {
    const rw = role.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || [];
    return rw.some((w) => jdWords.has(w));
  });
}
