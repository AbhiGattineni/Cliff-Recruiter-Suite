// Bench submissions a bench sales recruiter can book time against.
//
// The Ceipal bench submissions report has no ID column — it is a custom report
// whose shape is set in Ceipal's UI — so a submission has to be identified by
// what it says: who was submitted, to whom, for what, and when. That composite
// is the key, and it is derived rather than stored so the same row keys the
// same way on every pull.
//
// The date is normalised to an ISO day first. Ceipal returns "09/21/2026
// 17:37:28" today and could return ISO tomorrow if someone edits the report;
// keying on the raw string would orphan every past entry the day that happens.

import { getBenchSubmissions, autoMap, cell, rowDay, ColumnMap, Row } from "./benchSubmissions";

export interface BenchOption {
  subKey: string;
  consultant: string;
  vendor: string;
  jobTitle: string;
  status: string;
  /** ISO day, or "" when the report carried no readable date. */
  submittedOn: string;
  /** Lower-cased haystack for the picker's search box. */
  search: string;
}

/** The ISO day a submission row falls on, or "" when it has none. */
export function isoDay(value: unknown): string {
  const ms = rowDay(value);
  return ms === null ? "" : new Date(ms).toISOString().slice(0, 10);
}

/**
 * The identity of one submission row.
 *
 * Lower-cased and whitespace-collapsed so trivial formatting differences
 * between pulls don't produce a second key for the same submission.
 */
export function benchSubmissionKey(parts: {
  consultant: string;
  vendor: string;
  jobTitle: string;
  submittedOn: string;
}): string {
  const norm = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return [parts.consultant, parts.vendor, parts.jobTitle, parts.submittedOn].map(norm).join("|");
}

/** Turn report rows into pickable options, using the detected column mapping. */
export function toBenchOptions(submissions: Row[], map: ColumnMap, vendorCol: string | null): BenchOption[] {
  const out: BenchOption[] = [];
  const seen = new Set<string>();
  for (const r of submissions) {
    const consultant = [cell(r, map.subName), cell(r, map.subLast)].filter(Boolean).join(" ").trim();
    const vendor = cell(r, vendorCol);
    const jobTitle = cell(r, map.subTitle);
    const submittedOn = map.subDate ? isoDay(r[map.subDate]) : "";
    const subKey = benchSubmissionKey({ consultant, vendor, jobTitle, submittedOn });
    // A row that identifies nothing can't be booked against — "||||" would
    // collect every blank row under one key.
    if (!consultant && !vendor && !jobTitle) continue;
    if (seen.has(subKey)) continue;
    seen.add(subKey);
    out.push({
      subKey,
      consultant,
      vendor,
      jobTitle,
      status: cell(r, map.subStatus),
      submittedOn,
      search: `${consultant} ${vendor} ${jobTitle} ${submittedOn}`.toLowerCase(),
    });
  }
  // Most recent first — today's work is almost always on a recent submission.
  return out.sort((a, b) => b.submittedOn.localeCompare(a.submittedOn) || a.consultant.localeCompare(b.consultant));
}

/** Filter for the picker's search box. An empty query returns everything. */
export function filterBenchOptions(options: BenchOption[], query: string): BenchOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const terms = q.split(/\s+/);
  return options.filter((o) => terms.every((t) => o.search.includes(t)));
}

/** Every bench submission currently in the report, ready for the picker. */
export async function listBenchOptions(): Promise<BenchOption[]> {
  const data = await getBenchSubmissions(false);
  const map = autoMap(data.bench, data.submissions);
  return toBenchOptions(data.submissions, map, map.subVendor);
}
