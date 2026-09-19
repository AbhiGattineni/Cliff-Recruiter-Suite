// Recruiter activity, counted for the digest.
//
// The numbers answer three questions the 10:30pm mail is meant to settle
// without anyone opening a dashboard:
//
//   1. How many requirements are open right now?
//   2. What did each recruiter submit today?
//   3. How fast did we answer a new requirement — inside 3, 6 or 9 hours of it
//      being posted?
//
// ---------------------------------------------------------------------------
// This file deliberately duplicates a little of `src/lib/report/columns.ts`,
// `dates.ts` and `submissionSla.ts`. The web app and the Cloud Functions are
// separate TypeScript packages with different module resolution, and neither
// can import across the boundary without a build change that would touch every
// import in the app. What is copied here is the *data* — the header alias lists
// and the timestamp formats — not the reporting logic, and the field set is
// narrowed to the handful this file actually reads. If Ceipal renames a column,
// both lists need the new spelling.
// ---------------------------------------------------------------------------

import { DateTime } from "luxon";

/**
 * Ceipal writes timestamps in the tenant's own wall clock, and the report
 * pipeline treats that as EST throughout (see src/lib/report/dates.ts). Parsing
 * into a FIXED offset rather than America/New_York keeps a submission's date
 * equal to the date in the string Ceipal sent — no DST shift can move one
 * across midnight into the wrong day's digest. Durations are unaffected by the
 * choice either way, since both ends sit in the same frame.
 */
const EST_ZONE = "UTC-5";

const FORMATS = [
  "M/d/yyyy, h:mm:ss a",
  "M/d/yyyy h:mm:ss a",
  "M/d/yyyy h:mm a",
  "MM/dd/yyyy hh:mm:ss a",
  "MM/dd/yyyy hh:mm a",
  "MM/dd/yyyy HH:mm:ss",
  "MM/dd/yyyy HH:mm",
  "M/d/yyyy HH:mm:ss",
  "M/d/yyyy HH:mm",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd HH:mm",
  "M-d-yyyy h:mm:ss a",
  "MM-dd-yyyy HH:mm:ss",
  "dd-MM-yyyy HH:mm:ss",
  "MMM d, yyyy h:mm a",
  "MMM d, yyyy, h:mm:ss a",
  "d MMM yyyy HH:mm",
];

export function parseTs(raw: unknown): DateTime | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "–" || s === "-" || s.toUpperCase() === "NA" || s.toUpperCase() === "N/A") {
    return null;
  }
  for (const fmt of FORMATS) {
    const dt = DateTime.fromFormat(s, fmt, { zone: EST_ZONE });
    if (dt.isValid) return dt;
  }
  const iso = DateTime.fromISO(s, { zone: EST_ZONE });
  return iso.isValid ? iso : null;
}

function normHeader(h: unknown): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SUB_ALIASES: Record<string, string[]> = {
  jobCode: ["jobcode", "code", "jobid", "requisitionid"],
  jobTitle: ["jobtitle", "title", "positionname", "position"],
  applicantName: ["applicantfullname", "applicantname", "candidatename", "candidate", "fullname", "applicant"],
  submittedBy: ["submittedby", "recruiter", "recruitername", "submittedbyrecruiter"],
  client: ["client", "clientname", "endclient"],
  submissionStatus: ["submissionstatus", "status", "currentstatus", "candidatestatus"],
  submittedOn: ["submittedon", "submitteddate", "dateofsubmission", "submissiondate"],
  jobCreatedOn: ["jobcreatedon", "jobcreated", "requirementcreated"],
};

const JOB_ALIASES: Record<string, string[]> = {
  jobCode: ["jobcode", "code", "jobid", "requisitionid", "reqid"],
  jobTitle: ["jobtitle", "title", "positionname", "position"],
  client: ["client", "clientname", "endclient"],
  jobStatus: ["jobstatus", "status"],
};

/** rawKey -> canonical field, exact match first, then a loose contains pass. */
function mapObjectKeys(keys: string[], aliases: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = () => Object.values(out);
  for (const key of keys) {
    const n = normHeader(key);
    for (const [field, als] of Object.entries(aliases)) {
      if (als.includes(n) && !taken().includes(field)) {
        out[key] = field;
        break;
      }
    }
  }
  for (const key of keys) {
    if (out[key]) continue;
    const n = normHeader(key);
    for (const [field, als] of Object.entries(aliases)) {
      if (taken().includes(field)) continue;
      if (als.some((a) => n.includes(a) || a.includes(n))) {
        out[key] = field;
        break;
      }
    }
  }
  return out;
}

function toFields(rows: Record<string, unknown>[], aliases: Record<string, string[]>): Record<string, string>[] {
  if (rows.length === 0) return [];
  // Ceipal returns a uniform shape, so the first row's keys describe them all.
  const keyMap = mapObjectKeys(Object.keys(rows[0]), aliases);
  return rows.map((raw) => {
    const o: Record<string, string> = {};
    for (const [rawKey, field] of Object.entries(keyMap)) o[field] = String(raw[rawKey] ?? "").trim();
    return o;
  });
}

/**
 * Did this profile leave the building?
 *
 * "Rejected Internally" means we stopped it ourselves, so it is not a
 * submission — the distinction the 5 September review turned on. A profile
 * rejected internally that still reached the client counts, because the
 * rejection came after it went out.
 */
function wentOut(statuses: Set<string>): boolean {
  const rejected = [...statuses].some((s) => s.includes("rejectedinternally"));
  const clientSide = [...statuses].some(
    (s) =>
      s.includes("submittedtoclient") ||
      s.includes("submittedtoendclient") ||
      s.includes("submittedtovendor") ||
      s.includes("clientsubmission") ||
      s.includes("vendorsubmission")
  );
  return !rejected || clientSide;
}

// ---- Shape -----------------------------------------------------------------

/** Cumulative: a requirement answered in 2h is inside all three windows. */
export const SPEED_WINDOWS = [3, 6, 9] as const;

export interface RecruiterRow {
  name: string;
  /** Profiles that went out, one per candidate per requirement. */
  submissions: number;
  /** Distinct requirements they put a profile on. */
  requirements: number;
  /** Of those submissions, the ones on a currently-open requirement. */
  onActive: number;
  /** Requirements where THEIR first profile landed inside each window. */
  within: [number, number, number];
  /** Requirements they touched whose posting time Ceipal didn't give us. */
  unknownPosting: number;
  /** within[9h] / requirements with a known posting time, 0-100, or null. */
  speed: number | null;
}

export interface DigestStats {
  /** Open requirements right now, from the Active Jobs report. */
  activeRequirements: number;
  /** Submissions on the digest's day. */
  submissions: number;
  /** Of those, on a requirement that is still open. */
  submissionsOnActive: number;
  /** Requirements that received their first-ever profile today. */
  requirementsAnswered: number;
  /** Of those, how many inside 3h / 6h / 9h of posting. Cumulative. */
  answeredWithin: [number, number, number];
  /** Answered today, but slower than the widest window. */
  answeredLater: number;
  /** Answered today with no posting time on the requirement, so unmeasurable. */
  answeredUnknown: number;
  /** Profiles stopped internally today — not submissions, but why a count is short. */
  rejectedInternally: number;
  recruiters: RecruiterRow[];
}

export const EMPTY_STATS: DigestStats = {
  activeRequirements: 0,
  submissions: 0,
  submissionsOnActive: 0,
  requirementsAnswered: 0,
  answeredWithin: [0, 0, 0],
  answeredLater: 0,
  answeredUnknown: 0,
  rejectedInternally: 0,
  recruiters: [],
};

// ---- Performance bands -----------------------------------------------------

export type Band = "good" | "ok" | "bad" | "none";

/**
 * Where "good" starts.
 *
 * These are a starting position, not a measured target: nobody has set a
 * service level for "answered within 9 hours" yet. They are here so the mail
 * can colour a number at all, and they are two constants precisely so they are
 * cheap to move once the team decides what good looks like.
 */
export const BAND_GOOD = 70;
export const BAND_OK = 40;

export function bandOf(pct: number | null): Band {
  if (pct == null) return "none";
  if (pct >= BAND_GOOD) return "good";
  if (pct >= BAND_OK) return "ok";
  return "bad";
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

// ---- The count itself ------------------------------------------------------

const keyOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Fold the raw Ceipal rows into the digest's numbers.
 *
 * `dayISO` is compared against the date Ceipal itself wrote, not against a
 * converted one — see the note on EST_ZONE above.
 *
 * Ceipal emits one row per status change, so a candidate appears several times
 * on a requirement. Counting rows would credit a busy requirement simply for
 * having moved through more stages, so rows are folded to one submission per
 * candidate per requirement, at their earliest SubmittedOn.
 */
export function buildStats(
  submissionRows: Record<string, unknown>[],
  activeJobRows: Record<string, unknown>[],
  dayISO: string
): DigestStats {
  const active = toFields(activeJobRows, JOB_ALIASES);
  const activeCodes = new Set(active.map((r) => keyOf(r.jobCode ?? "")).filter(Boolean));

  const events = toFields(submissionRows, SUB_ALIASES);

  interface Cand {
    recruiter: string;
    /** Null until a row carries a parseable SubmittedOn. */
    submittedOn: DateTime | null;
    statuses: Set<string>;
  }
  interface Job {
    code: string;
    postedOn: DateTime | null;
    cands: Map<string, Cand>;
  }
  const jobs = new Map<string, Job>();

  for (const e of events) {
    const code = keyOf(e.jobCode ?? "");
    if (!code) continue;
    let job = jobs.get(code);
    if (!job) {
      job = { code, postedOn: null, cands: new Map() };
      jobs.set(code, job);
    }
    if (!job.postedOn) job.postedOn = parseTs(e.jobCreatedOn);

    const cand = keyOf(e.applicantName ?? "");
    if (!cand) continue;

    let c = job.cands.get(cand);
    if (!c) {
      c = { recruiter: (e.submittedBy ?? "").trim(), submittedOn: null, statuses: new Set() };
      job.cands.set(cand, c);
    }
    // Every status this candidate reached, so the furthest one decides whether
    // they count — not whichever row happened to come last.
    c.statuses.add(normHeader(e.submissionStatus));

    const ts = parseTs(e.submittedOn);
    if (ts && (!c.submittedOn || ts < c.submittedOn)) {
      c.submittedOn = ts;
      if (!c.recruiter) c.recruiter = (e.submittedBy ?? "").trim();
    }
  }

  const stats: DigestStats = { ...EMPTY_STATS, activeRequirements: active.length, answeredWithin: [0, 0, 0] };

  interface Acc {
    name: string;
    submissions: number;
    onActive: number;
    reqs: Set<string>;
    within: [number, number, number];
    unknownPosting: number;
    measurable: Set<string>;
  }
  const byRecruiter = new Map<string, Acc>();
  const touch = (name: string): Acc | null => {
    const k = keyOf(name);
    if (!k) return null;
    let a = byRecruiter.get(k);
    if (!a) {
      a = { name: name.trim(), submissions: 0, onActive: 0, reqs: new Set(), within: [0, 0, 0], unknownPosting: 0, measurable: new Set() };
      byRecruiter.set(k, a);
    }
    return a;
  };

  for (const job of jobs.values()) {
    const onActive = activeCodes.has(job.code);

    // Today's submissions on this requirement, earliest first.
    const todays = [...job.cands.values()]
      .filter((c): c is Cand & { submittedOn: DateTime } =>
        c.submittedOn != null && c.submittedOn.toFormat("yyyy-MM-dd") === dayISO
      )
      .sort((a, b) => a.submittedOn.toMillis() - b.submittedOn.toMillis());

    const out = todays.filter((c) => wentOut(c.statuses));
    stats.rejectedInternally += todays.length - out.length;
    if (out.length === 0) continue;

    stats.submissions += out.length;
    if (onActive) stats.submissionsOnActive += out.length;

    // Was today the requirement's first answer? Only then does "how fast did we
    // respond to the posting" mean anything — a profile sent on day four is not
    // a nine-hour response, and counting it as one would flatter the number.
    const firstToday = out[0].submittedOn;
    const everEarlier = [...job.cands.values()].some(
      (c) =>
        c.submittedOn != null &&
        wentOut(c.statuses) &&
        c.submittedOn < firstToday &&
        c.submittedOn.toFormat("yyyy-MM-dd") !== dayISO
    );

    if (!everEarlier) {
      stats.requirementsAnswered += 1;
      const hours = job.postedOn ? Math.max(0, firstToday.diff(job.postedOn, "hours").hours) : null;
      if (hours == null) stats.answeredUnknown += 1;
      else {
        let landed = false;
        SPEED_WINDOWS.forEach((w, i) => {
          if (hours <= w) {
            stats.answeredWithin[i] += 1;
            landed = true;
          }
        });
        if (!landed) stats.answeredLater += 1;
      }
    }

    // Per recruiter.
    const firstByRecruiter = new Map<string, DateTime>();
    for (const c of out) {
      const a = touch(c.recruiter);
      if (!a) continue;
      a.submissions += 1;
      a.reqs.add(job.code);
      if (onActive) a.onActive += 1;
      const k = keyOf(c.recruiter);
      if (!firstByRecruiter.has(k)) firstByRecruiter.set(k, c.submittedOn);
    }

    for (const [k, first] of firstByRecruiter) {
      const a = byRecruiter.get(k);
      if (!a) continue;
      if (!job.postedOn) {
        a.unknownPosting += 1;
        continue;
      }
      a.measurable.add(job.code);
      const hours = Math.max(0, first.diff(job.postedOn, "hours").hours);
      SPEED_WINDOWS.forEach((w, i) => {
        if (hours <= w) a.within[i] += 1;
      });
    }
  }

  stats.recruiters = [...byRecruiter.values()]
    .map((a) => ({
      name: a.name,
      submissions: a.submissions,
      requirements: a.reqs.size,
      onActive: a.onActive,
      within: a.within,
      unknownPosting: a.unknownPosting,
      speed: pct(a.within[SPEED_WINDOWS.length - 1], a.measurable.size),
    }))
    .sort((x, y) => y.submissions - x.submissions || x.name.localeCompare(y.name));

  return stats;
}
