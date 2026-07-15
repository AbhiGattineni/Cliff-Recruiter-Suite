// Client wrappers for the internally-selected candidate pool + JD role matching.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";

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

export async function getCandidatePool(): Promise<PoolCandidate[]> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; candidates: PoolCandidate[] }>(
    functions,
    "candidatePool",
    { timeout: 300_000 }
  );
  const res = await callable({});
  return res.data?.candidates ?? [];
}

/** LLM semantic match: returns the pool role titles relevant to the JD. */
export async function matchCandidatesToJd(jobDescription: string, roles: string[]): Promise<string[]> {
  ensureConfigured();
  const callable = httpsCallable<{ jobDescription: string; roles: string[] }, { ok: boolean; relevant?: string[]; error?: string }>(
    functions,
    "matchCandidatesToJd",
    { timeout: 120_000 }
  );
  const res = await callable({ jobDescription, roles });
  if (!res.data?.ok) throw new Error(res.data?.error || "Matching failed.");
  return res.data?.relevant ?? [];
}

/** Free keyword fallback (no LLM): a role is relevant if it shares a word with the JD. */
export function keywordMatchRoles(jobDescription: string, roles: string[]): string[] {
  const jdWords = new Set((jobDescription.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || []));
  return roles.filter((role) => {
    const rw = role.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || [];
    return rw.some((w) => jdWords.has(w));
  });
}
