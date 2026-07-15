// Client wrapper for the activeJobs callable — the Ceipal "Active Jobs - All"
// report (a live snapshot of currently-open jobs).

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";

export interface ActiveJob {
  jobCode: string;
  jobTitle: string;
  client: string;
  location: string;
  status: string;
  positions: number;
  submissions: number;
  clientSub: number;
  interviews: number;
  placements: number;
  recruitmentManager: string;
  payRate: string;
  remote: string;
  jobCreated: string;
}

export async function getActiveJobs(): Promise<ActiveJob[]> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; jobs: ActiveJob[] }>(
    functions,
    "activeJobs",
    { timeout: 120_000 }
  );
  const res = await callable({});
  return res.data?.jobs ?? [];
}
