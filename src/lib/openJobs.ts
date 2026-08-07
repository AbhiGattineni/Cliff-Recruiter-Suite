// Requirements a person can book time against.
//
// Sourced from the cached job_duration report rather than the Active Jobs one:
// only a handful of requirements are strictly "Active" (8 at the time of
// writing) while ~200 sit "On Hold", and real work happens on those too. An
// Active-only list would leave most of it unloggable.

import { fetchCeipalReport } from "./ceipal";
import { parseJobsFromApi } from "./report/parseSource";

export interface OpenJob {
  jobCode: string;
  jobTitle: string;
  client: string;
  status: string;
  /** Lower-cased haystack for the picker's search box. */
  search: string;
}

/** Statuses that still represent live work. Closed/Filled/Draft are excluded. */
const OPEN = ["active", "on hold", "hold by client"];

export function isOpenStatus(status: string): boolean {
  return OPEN.includes(String(status ?? "").trim().toLowerCase());
}

/** Open requirements, most recently created first. */
export async function listOpenJobs(): Promise<OpenJob[]> {
  const json = await fetchCeipalReport("job_duration");
  const jobs = parseJobsFromApi(json);
  return jobs
    .filter((j) => j.jobCode && isOpenStatus(j.jobStatus))
    .sort((a, b) => (b.jobCreatedOn?.toMillis() ?? 0) - (a.jobCreatedOn?.toMillis() ?? 0))
    .map((j) => ({
      jobCode: j.jobCode,
      jobTitle: j.jobTitle,
      client: j.client,
      status: j.jobStatus,
      search: `${j.jobCode} ${j.jobTitle} ${j.client}`.toLowerCase(),
    }));
}

/** Filter for the picker's search box. Empty query returns everything. */
export function filterJobs(jobs: OpenJob[], query: string): OpenJob[] {
  const q = query.trim().toLowerCase();
  if (!q) return jobs;
  const terms = q.split(/\s+/);
  return jobs.filter((j) => terms.every((t) => j.search.includes(t)));
}
