// Bench roster + the submissions made for it.
//
// Neither report's columns are known ahead of time: these are Ceipal custom
// reports whose shape is set in Ceipal's UI, not here, and a handler that
// guesses at field names is exactly what leaves a table full of dashes. So the
// columns are discovered from the rows that actually arrive, and the few fields
// that carry meaning -- who the consultant is, what the status is -- are found
// by matching headers against the same tolerant alias lists the Excel pipeline
// already uses.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { normHeader } from "./report/columns";

export type Row = Record<string, unknown>;

export interface BenchData {
  bench: Row[];
  submissions: Row[];
  fetchedAt: number;
  stale: boolean;
  problem: string;
}

export async function getBenchSubmissions(refresh = false): Promise<BenchData> {
  ensureConfigured();
  const callable = httpsCallable<
    { action: string; refresh: boolean },
    { ok: boolean; bench?: Row[]; submissions?: Row[]; fetchedAt?: number; stale?: boolean; problem?: string }
  >(functions, "ceipalData", { timeout: 300_000 });
  const res = await callable({ action: "benchSubmissions", refresh });
  return {
    bench: res.data?.bench ?? [],
    submissions: res.data?.submissions ?? [],
    fetchedAt: res.data?.fetchedAt ?? 0,
    stale: res.data?.stale === true,
    problem: res.data?.problem ?? "",
  };
}

/**
 * Every column present across the rows, in the order Ceipal first mentions
 * them. Rows are not guaranteed to share a key set, so this is a union rather
 * than the keys of row 0.
 */
export function discoverColumns(rows: Row[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** The first column whose normalised header matches an alias, in alias order. */
export function findColumn(columns: string[], aliases: string[], exclude: string[] = []): string | null {
  const byNorm = new Map<string, string>();
  for (const c of columns) {
    const n = normHeader(c);
    if (!byNorm.has(n)) byNorm.set(n, c);
  }
  for (const a of aliases) {
    const hit = byNorm.get(a);
    if (hit) return hit;
  }
  // Nothing exact — accept a header that merely contains an alias, longest
  // alias first so "submissionstatus" wins over "status".
  //
  // `exclude` keeps the short aliases honest. "name" appears in VendorName and
  // ContactPerson as readily as in ApplicantName, and a person slot filled by a
  // vendor column produces join keys that match nothing, which looks like an
  // empty result rather than a mislabelled column.
  for (const a of [...aliases].sort((x, y) => y.length - x.length)) {
    for (const c of columns) {
      const n = normHeader(c);
      if (!n.includes(a)) continue;
      if (exclude.some((bad) => n.includes(bad))) continue;
      return c;
    }
  }
  return null;
}

/** Headers that name a company or a third party, never the person submitted. */
export const NOT_A_PERSON = ["vendor", "client", "company", "partner", "contactperson", "submittedby"];

export const ALIASES = {
  name: ["consultantname", "candidatename", "applicantfullname", "applicantname", "employeename",
         "resourcename", "fullname", "consultant", "candidate", "applicant", "name"],
  email: ["emailaddress", "emailid", "email"],
  status: ["submissionstatus", "currentstatus", "profilestatus", "benchstatus", "candidatestatus", "status"],
  recruiter: ["submittedby", "marketingrecruiter", "recruitername", "marketer", "recruiter", "assignedto"],
  client: ["endclient", "clientname", "client", "vendor"],
  title: ["jobtitle", "positionname", "requirement", "position", "title"],
  date: ["submittedon", "submissiondate", "submitteddate", "appliedon", "createdon", "date"],
  first: ["firstname", "givenname", "fname"],
  last: ["lastname", "surname", "familyname", "lname"],
} as const;

/** Trimmed string cell. */
export const cell = (r: Row, col: string | null): string =>
  col ? String(r[col] ?? "").trim() : "";

/**
 * Every identifier a row offers, strongest first: the email, then the folded
 * name.
 *
 * Both are kept rather than just the best one because the two reports are
 * configured separately in Ceipal and need not carry the same columns. A bench
 * roster with emails and a submissions report without would key on different
 * things and match nobody, which looks exactly like an empty bench.
 */
export function personKeys(
  r: Row,
  nameCol: string | null,
  emailCol: string | null,
  lastCol: string | null = null
): string[] {
  const keys: string[] = [];
  const email = cell(r, emailCol).toLowerCase();
  if (email) keys.push(`e:${email}`);
  const name = fullName(r, nameCol, lastCol);
  if (name) keys.push(`n:${name.toLowerCase()}`);
  return keys;
}

/**
 * The person's name, joined from a surname column when the report splits it.
 *
 * The bench roster carries FirstName and LastName while the submissions report
 * carries one ApplicantName, so one side reads "Anil" and the other "Anil
 * Challa" unless the halves are put back together.
 */
export function fullName(r: Row, nameCol: string | null, lastCol: string | null = null): string {
  return [cell(r, nameCol), cell(r, lastCol)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** The strongest identifier a row offers, or "" when it identifies nobody. */
export function personKey(r: Row, nameCol: string | null, emailCol: string | null): string {
  return personKeys(r, nameCol, emailCol)[0] ?? "";
}

/**
 * The columns naming a person: a single full-name column, or a first/last pair.
 *
 * The pair is looked for first. A report with FirstName and LastName has no
 * column matching a full-name alias, so the containing-header fallback settles
 * on FirstName -- and keying the bench on "anil" while the submissions key on
 * "anil challa" matches nobody at all.
 */
export function findNameColumns(columns: string[]): { name: string | null; last: string | null } {
  const first = findColumn(columns, [...ALIASES.first]);
  const last = findColumn(columns, [...ALIASES.last]);
  if (first && last) return { name: first, last };
  return { name: findColumn(columns, [...ALIASES.name], NOT_A_PERSON), last: null };
}

export interface BenchConsultant {
  row: Row;
  key: string;
  name: string;
  /** Submissions found for this consultant. */
  submissions: Row[];
  count: number;
  /** Distinct statuses across those submissions. */
  statuses: string[];
}

/**
 * Attach each bench consultant's submissions to them.
 *
 * Bench rows that match nobody still come back, with a count of zero — those
 * are the point of the page, not a gap in it.
 */
/**
 * Which column carries which meaning. Detected by default, overridable by hand.
 *
 * Detection is a guess about a report this code has never seen, and a wrong
 * guess is quiet: the join silently matches nobody, or a status tile counts a
 * column that happens to read "N/A". So the guess is shown in the UI and can be
 * corrected there, and the correction is what everything downstream uses.
 */
export interface ColumnMap {
  benchName: string | null;
  /** Surname column, when the report splits the name across two. */
  benchLast: string | null;
  benchEmail: string | null;
  subName: string | null;
  subLast: string | null;
  subEmail: string | null;
  subStatus: string | null;
}

export function autoMap(bench: Row[], submissions: Row[]): ColumnMap {
  const b = discoverColumns(bench);
  const s = discoverColumns(submissions);
  const bn = findNameColumns(b);
  const sn = findNameColumns(s);
  return {
    benchName: bn.name,
    benchLast: bn.last,
    benchEmail: findColumn(b, [...ALIASES.email]),
    subName: sn.name,
    subLast: sn.last,
    subEmail: findColumn(s, [...ALIASES.email]),
    subStatus: findColumn(s, [...ALIASES.status]),
  };
}

export function joinBench(bench: Row[], submissions: Row[], map?: ColumnMap): BenchConsultant[] {
  const m = map ?? autoMap(bench, submissions);
  const bName = m.benchName;
  const bEmail = m.benchEmail;
  const sName = m.subName;
  const sEmail = m.subEmail;
  const sStatus = m.subStatus;

  // Index every submission under each identifier it offers, so a bench row can
  // match on whichever identifier the two reports happen to share.
  const byKey = new Map<string, number[]>();
  submissions.forEach((s, i) => {
    for (const k of personKeys(s, sName, sEmail, m.subLast)) {
      const list = byKey.get(k);
      if (list) list.push(i);
      else byKey.set(k, [i]);
    }
  });

  return bench.map((row) => {
    const keys = personKeys(row, bName, bEmail, m.benchLast);
    // A submission indexed under both an email and a name must still be counted
    // once, so collect indices before resolving them to rows.
    const hits = new Set<number>();
    for (const k of keys) for (const i of byKey.get(k) ?? []) hits.add(i);
    const subs = [...hits].sort((a, b) => a - b).map((i) => submissions[i]);

    const statuses: string[] = [];
    for (const s of subs) {
      const v = cell(s, sStatus);
      if (v && !statuses.includes(v)) statuses.push(v);
    }
    return { row, key: keys[0] ?? "", name: fullName(row, bName, m.benchLast), submissions: subs, count: subs.length, statuses };
  });
}

export interface StatusCount {
  status: string;
  count: number;
}

/** Submissions per status, commonest first. Blank statuses group as "No status". */
export function statusCounts(submissions: Row[], column?: string | null): StatusCount[] {
  const statusCol =
    column !== undefined ? column : findColumn(discoverColumns(submissions), [...ALIASES.status]);
  if (!statusCol) return [];
  const tally = new Map<string, number>();
  for (const s of submissions) {
    const v = cell(s, statusCol) || "No status";
    tally.set(v, (tally.get(v) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

export interface BenchStats {
  benchTotal: number;
  submissionTotal: number;
  /** Bench consultants with at least one submission. */
  covered: number;
  /** Bench consultants with none — who needs work today. */
  idle: number;
  byStatus: StatusCount[];
}

export function benchStats(joined: BenchConsultant[], submissions: Row[], statusCol?: string | null): BenchStats {
  const covered = joined.filter((c) => c.count > 0).length;
  return {
    benchTotal: joined.length,
    submissionTotal: submissions.length,
    covered,
    idle: joined.length - covered,
    byStatus: statusCounts(submissions, statusCol),
  };
}
