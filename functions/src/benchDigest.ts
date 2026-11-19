// The digest's "🪑 Bench sales" section.
//
// One line per consultant on the bench, with how many submissions were made for
// them that day. Anyone with none is shown in red with a 0.
//
// The data is the same two Ceipal reports the Bench Submissions page reads — the
// bench list (CEIPAL_BENCH_LIST_URL) and the bench submissions
// (CEIPAL_BENCH_SUBMISSIONS_URL) — joined the same way that page joins them: on
// email, else on the full name. Columns are found the way that page finds them: by matching headers against alias lists, because the report
// is configured in Ceipal and its column names aren't fixed. The lists below are
// copied from src/lib/benchSubmissions.ts — the app and the functions can't
// import each other — so if one changes, change both.

import { DateTime } from "luxon";
import { fetchReport } from "./ceipal.js";
import { readCache, writeCache } from "./ceipalCache.js";
import { parseTs } from "./recruiterStats.js";

export type Row = Record<string, unknown>;

// ---- Columns (mirrors src/lib/benchSubmissions.ts) ---------------------------

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES = {
  email: ["emailaddress", "emailid", "email"],
  name: ["consultantname", "candidatename", "applicantfullname", "applicantname", "employeename",
         "resourcename", "fullname", "consultant", "candidate", "applicant", "name"],
  status: ["submissionstatus", "currentstatus", "profilestatus", "benchstatus", "candidatestatus", "status"],
  recruiter: ["submittedby", "marketingrecruiter", "recruitername", "marketer", "recruiter", "assignedto"],
  vendor: ["vendorname", "vendor", "endclient", "clientname", "client"],
  title: ["jobtitle", "positionname", "requirement", "position", "title"],
  date: ["submittedon", "submissiondate", "submitteddate", "appliedon", "createdon", "date"],
  first: ["firstname", "givenname", "fname"],
  last: ["lastname", "surname", "familyname", "lname"],
};
const NOT_A_PERSON = ["vendor", "client", "company", "partner", "contactperson", "submittedby"];
const NOT_A_DATE = ["candidate", "name"];

function discoverColumns(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function findColumn(columns: string[], aliases: string[], exclude: string[] = []): string | null {
  const byNorm = new Map<string, string>();
  for (const c of columns) {
    const n = normHeader(c);
    if (!byNorm.has(n)) byNorm.set(n, c);
  }
  for (const a of aliases) {
    const hit = byNorm.get(a);
    if (hit) return hit;
  }
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

const cell = (r: Row, col: string | null): string => (col ? String(r[col] ?? "").replace(/\s+/g, " ").trim() : "");
const blank = (s: string) => !s || s === "-" || s === "–" || /^n\/?a$/i.test(s);

interface BenchColumns {
  email: string | null;
  recruiter: string | null;
  date: string | null;
  name: string | null;
  last: string | null;
  vendor: string | null;
  title: string | null;
  status: string | null;
}

function mapColumns(rows: Row[]): BenchColumns {
  const cols = discoverColumns(rows.slice(0, 200));
  const first = findColumn(cols, ALIASES.first);
  const last = findColumn(cols, ALIASES.last);
  return {
    email: findColumn(cols, ALIASES.email),
    recruiter: findColumn(cols, ALIASES.recruiter),
    date: findColumn(cols, ALIASES.date, NOT_A_DATE),
    name: first && last ? first : findColumn(cols, ALIASES.name, NOT_A_PERSON),
    last: first && last ? last : null,
    vendor: findColumn(cols, ALIASES.vendor),
    title: findColumn(cols, ALIASES.title),
    status: findColumn(cols, ALIASES.status),
  };
}

/** The calendar day a cell names, as yyyy-MM-dd, or "" when it has none. Date-only cells count too. */
function dayOf(v: unknown): string {
  const ts = parseTs(v);
  if (ts) return ts.toFormat("yyyy-MM-dd");
  const s = String(v ?? "").trim();
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (us) return DateTime.fromObject({ year: +us[3], month: +us[1], day: +us[2] }).toFormat("yyyy-MM-dd");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return DateTime.fromObject({ year: +iso[1], month: +iso[2], day: +iso[3] }).toFormat("yyyy-MM-dd");
  return "";
}

// ---- People -------------------------------------------------------------------

const tokens = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

/** Same person? Equal names, or every word of the shorter (2+ words) name is in the longer one. */
export function samePerson(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && short.every((t) => long.includes(t));
}

// ---- Loading --------------------------------------------------------------------

type BenchReport = "bench_list" | "bench_submissions";
const ENV: Record<BenchReport, string> = {
  bench_list: "CEIPAL_BENCH_LIST_URL",
  bench_submissions: "CEIPAL_BENCH_SUBMISSIONS_URL",
};
const LABEL: Record<BenchReport, string> = { bench_list: "bench list", bench_submissions: "bench submissions" };

export interface ReportLoad {
  rows: Row[];
  fetchedAt: number;
  /** Set when Ceipal couldn't be read and a saved copy (or nothing) was used. */
  problem?: string;
}

/**
 * One report, read live from Ceipal every time — both bench reports are small,
 * and reading the saved copy is what let a wrong or stale copy through before.
 * The saved copy is only the fallback when Ceipal doesn't answer. Never throws.
 */
async function loadReport(report: BenchReport, password: string): Promise<ReportLoad> {
  const label = LABEL[report];
  const configured = !!password && !password.startsWith("PLACEHOLDER") && !!process.env[ENV[report]];
  let why = `the ${label} report isn't configured (${ENV[report]})`;
  if (configured) {
    try {
      const data = (await fetchReport(report, password, 0)) as { result?: unknown[]; total_available?: number };
      const rows = (Array.isArray(data.result) ? data.result : []) as Row[];
      try {
        await writeCache(report, rows, Number(data.total_available) || rows.length);
      } catch {
        /* the digest doesn't need the copy saved */
      }
      return { rows, fetchedAt: Date.now() };
    } catch (e) {
      why = `Ceipal didn't answer for the ${label}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  try {
    const cached = await readCache(report);
    if (cached && cached.rows.length > 0) {
      return { rows: cached.rows as Row[], fetchedAt: cached.fetchedAt, problem: `${why} — the last saved copy was used.` };
    }
  } catch {
    /* nothing saved either */
  }
  return { rows: [], fetchedAt: 0, problem: `${why}.` };
}

export interface BenchLoad {
  bench: Row[];
  submissions: Row[];
  problems: string[];
  /** The two Ceipal links came back the wrong way round and were swapped. */
  swapped: boolean;
}

/** Does this report look like submissions (who submitted, when, what status)? */
function looksLikeSubmissions(rows: Row[]): boolean {
  return discoverColumns(rows.slice(0, 50)).some((c) =>
    /submittedby|submittedon|submissiondate|submitteddate|submissionstatus|dateofsubmission/.test(normHeader(c))
  );
}

/**
 * Both bench reports, in parallel. Never throws.
 *
 * If the two come back the wrong way round — the "bench list" holding
 * submissions and the "bench submissions" holding the roster, which is what
 * happens when the two Ceipal links are swapped — they're swapped back, going
 * by which one has submission columns.
 */
export async function loadBench(password: string): Promise<BenchLoad> {
  const [b, s] = await Promise.all([loadReport("bench_list", password), loadReport("bench_submissions", password)]);
  const problems = [b.problem, s.problem].filter(Boolean) as string[];
  if (b.rows.length && s.rows.length && looksLikeSubmissions(b.rows) && !looksLikeSubmissions(s.rows)) {
    return { bench: s.rows, submissions: b.rows, problems, swapped: true };
  }
  return { bench: b.rows, submissions: s.rows, problems, swapped: false };
}

// ---- Counting ---------------------------------------------------------------------

export interface BenchLine {
  time: string;
  consultant: string;
  title: string;
  vendor: string;
  status: string;
  recruiter: string;
}

export interface BenchPerson {
  name: string;
  /** Submissions made for them on the day. */
  count: number;
  lines: BenchLine[];
}

export interface BenchDay {
  /** Everyone on the bench list, busiest first; count 0 = nothing submitted for them today. */
  people: BenchPerson[];
  total: number;
  /** Today's submissions for someone who isn't on the bench list. */
  notOnBench: BenchLine[];
  /** Submissions per recruiter today, busiest first. */
  byRecruiter: [string, number][];
  /** Why the numbers might be off — a missing column, for instance. */
  warnings: string[];
}

const fullName = (r: Row, c: BenchColumns) =>
  [cell(r, c.name), cell(r, c.last)].filter((x) => !blank(x)).join(" ");

/** Identifiers a row offers: its email and its full name, lower-cased. */
function keysOf(r: Row, c: BenchColumns): string[] {
  const keys: string[] = [];
  const e = cell(r, c.email).toLowerCase();
  if (e.includes("@")) keys.push(`e:${e}`);
  const n = fullName(r, c).toLowerCase();
  if (n) keys.push(`n:${n}`);
  return keys;
}

/**
 * Every consultant on the bench list with the number of submissions made for
 * them on `dayISO` — including those with none, which is the point.
 */
export function benchDay(bench: Row[], submissions: Row[], dayISO: string): BenchDay {
  const bc = mapColumns(bench);
  const sc = mapColumns(submissions);
  const warnings: string[] = [];
  if (bench.length && !bc.name) warnings.push("The bench list has no name column, so consultants can't be named.");
  if (submissions.length && !sc.date) warnings.push("The bench submissions report has no date column, so today's submissions can't be picked out. Add \"Submitted On\" to the report in Ceipal.");
  if (!bench.length) warnings.push("The bench list came back empty.");

  const people: (BenchPerson & { keys: string[] })[] = [];
  for (const r of bench) {
    const name = fullName(r, bc);
    const keys = keysOf(r, bc);
    if (!name && !keys.length) continue;
    // The same consultant listed twice on the bench is counted once.
    if (keys.some((k) => people.some((p) => p.keys.includes(k)))) continue;
    people.push({ name: name || cell(r, bc.email) || "(unnamed)", count: 0, lines: [], keys });
  }

  const notOnBench: BenchLine[] = [];
  const recruiters = new Map<string, number>();
  let total = 0;
  for (const r of submissions) {
    if (!sc.date || dayOf(r[sc.date]) !== dayISO) continue;
    total++;
    const ts = parseTs(r[sc.date]);
    const recruiter = blank(cell(r, sc.recruiter)) ? "" : cell(r, sc.recruiter);
    const line: BenchLine = {
      time: ts && (ts.hour || ts.minute) ? ts.toFormat("h:mm a") : "",
      consultant: fullName(r, sc) || "(no name)",
      title: blank(cell(r, sc.title)) ? "" : cell(r, sc.title),
      vendor: blank(cell(r, sc.vendor)) ? "" : cell(r, sc.vendor),
      status: blank(cell(r, sc.status)) ? "" : cell(r, sc.status),
      recruiter,
    };
    if (recruiter) recruiters.set(recruiter, (recruiters.get(recruiter) ?? 0) + 1);
    const keys = keysOf(r, sc);
    const hit =
      people.find((p) => keys.some((k) => p.keys.includes(k))) ??
      people.find((p) => samePerson(p.name, line.consultant));
    if (hit) {
      hit.count++;
      hit.lines.push(line);
    } else {
      notOnBench.push(line);
    }
  }

  const out = people
    .map(({ name, count, lines }) => ({ name, count, lines }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const byRecruiter = [...recruiters.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { people: out, total, notOnBench, byRecruiter, warnings };
}