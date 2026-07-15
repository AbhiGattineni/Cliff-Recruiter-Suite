// Dashboard stats + report-run logging.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { currentActor, Actor } from "./auth";

export interface DashboardStats {
  resumesGenerated: number;
  reportsGenerated: number;
  distinctCandidates: number;
  strongFit: number;
  moderateFit: number;
  weakFit: number;
  aiHigh: number;
  avgFitScore: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; stats: DashboardStats }>(
    functions,
    "dashboardStats"
  );
  const res = await callable({});
  return res.data.stats;
}

export async function logReportRun(source: string, rowCount: number, jobCount: number): Promise<void> {
  try {
    ensureConfigured();
    const callable = httpsCallable<
      { source: string; rowCount: number; jobCount: number; by: Actor },
      unknown
    >(functions, "logReportRun");
    await callable({ source, rowCount, jobCount, by: currentActor() });
  } catch {
    /* best-effort — never block the UI on logging */
  }
}
