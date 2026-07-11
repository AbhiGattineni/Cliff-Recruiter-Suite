// Client wrapper for the recruiterActivity callable — pulls job-board, pipeline
// and mail-merge counts per recruiter for a date range (nothing is stored).

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";

export interface ActivityCounts {
  pipelineUpdates: number;
  bulkEmails: number;
  diceCredits: number;
  monsterCredits: number;
  advSearchInternalDb: number; // not date-filtered (report has no date column)
}

export interface RecruiterActivity {
  from: string | null;
  to: string | null;
  byRecruiter: Record<string, ActivityCounts>;
  fetchedAt: number;
}

/** Same normalisation the function uses to key recruiters. */
export const activityNameKey = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export async function getRecruiterActivity(from: string, to: string): Promise<RecruiterActivity> {
  ensureConfigured();
  const callable = httpsCallable<{ from: string; to: string }, { ok: boolean } & RecruiterActivity>(
    functions,
    "recruiterActivity",
    // Pulls large reports live (mail merge ~19k rows) — allow plenty of time.
    { timeout: 540_000 }
  );
  const res = await callable({ from, to });
  const d = res.data;
  return {
    from: d?.from ?? null,
    to: d?.to ?? null,
    byRecruiter: d?.byRecruiter ?? {},
    fetchedAt: d?.fetchedAt ?? 0,
  };
}
