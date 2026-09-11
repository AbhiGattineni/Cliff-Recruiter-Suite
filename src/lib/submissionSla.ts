// "Two profiles per requirement, inside 24 hours" — counted.
//
// This is the number the 5 September review spent an hour and a half deriving
// by hand: client by client, reading counts off the screen, tallying how many
// first and second submissions landed inside a day, and dividing. It came out
// at 62.5% for one owner's requirements and 54.2% for the other's. The counting
// was the expensive part, and it was also the unreliable part — the tally was
// lost and restarted several times.
//
// Definitions, fixed here so every screen means the same thing by them:
//
//   - The clock starts when the REQUIREMENT was created, not when a recruiter
//     picked it up. That is what the business is buying: time from a client
//     asking to us answering.
//   - It is a plain 24-hour wall clock. Business hours were considered and
//     deliberately not used for now — a requirement arriving at 3pm is not
//     given until 3pm the next working day.
//   - A requirement's score is capped at the target. Sending eight profiles to
//     one requirement does not make up for sending none to another; that is the
//     whole point of measuring per requirement rather than in total.
//   - Only the FIRST `target` submissions count towards attainment. A ninth
//     profile arriving inside the window is not a save.
//   - A profile REJECTED INTERNALLY is not a submission. It never left the
//     building, so counting it would credit the team for work the client never
//     saw — and that is exactly the distinction the review turned on: "if I
//     reject, then why do we waste the time on submitting on Ceipal… so
//     submission is not considered". They are counted separately instead, so
//     the reason a requirement is short stays visible.

import { DateTime } from "luxon";
import { SubmissionEvent } from "./report/types";
import { normalizeStatus } from "./report/columns";

export const SLA_TARGET_SUBMISSIONS = 2;
export const SLA_WINDOW_HOURS = 24;

/** The ladder used in the review, kept verbatim so the numbers are comparable. */
export const SLA_BUCKETS = [
  { key: "lt4", label: "< 4h", upTo: 4 },
  { key: "h4to8", label: "4–8h", upTo: 8 },
  { key: "h8to16", label: "8–16h", upTo: 16 },
  { key: "h16to24", label: "16–24h", upTo: 24 },
  { key: "h24to48", label: "24–48h", upTo: 48 },
  { key: "gt48", label: "48h+", upTo: Infinity },
] as const;

export type BucketKey = (typeof SLA_BUCKETS)[number]["key"];

export function bucketOf(hours: number | null): BucketKey | null {
  if (hours == null || !isFinite(hours) || hours < 0) return null;
  return (SLA_BUCKETS.find((b) => hours < b.upTo) ?? SLA_BUCKETS[SLA_BUCKETS.length - 1]).key;
}

export interface SlaSubmission {
  candidate: string;
  recruiter: string;
  submittedOn: DateTime;
  /** Hours from requirement creation. Null when the requirement has no creation date. */
  hours: number | null;
}

/**
 * Did this profile actually go out?
 *
 * `normalizeStatus` reserves REJECTED for "Rejected Internally" specifically —
 * a client-side rejection lands in OTHER — so this is exactly the profiles we
 * stopped ourselves. One that was rejected internally but reached the
 * client/vendor anyway still counts; the rejection came after it went out.
 */
function wentOut(statuses: Set<string>): boolean {
  return !statuses.has("REJECTED") || statuses.has("CLIENT_VENDOR");
}

export interface RequirementSla {
  jobCode: string;
  jobTitle: string;
  client: string;
  owner: string; // account manager, straight from Ceipal
  jobCreatedOn: DateTime | null;
  /** Unique candidates on this requirement, earliest submission first. */
  submissions: SlaSubmission[];
  /** Hours to the 1st, 2nd … up to `target` submissions. Null where none happened. */
  hoursToNth: (number | null)[];
  /** How many of the first `target` submissions landed inside the window. Capped at target. */
  inWindow: number;
  /** Requirement age in days, for the coverage board. */
  ageDays: number | null;
  met: boolean;
  /** Profiles stopped internally — not submissions, but the reason a count is short. */
  rejectedInternally: number;
}

const norm = (s: string) => String(s ?? "").trim();
const keyOf = (s: string) => norm(s).toLowerCase().replace(/\s+/g, " ");

export interface SlaOptions {
  target?: number;
  windowHours?: number;
  /** "now", for requirement age. Injected so tests aren't clock-dependent. */
  now?: DateTime;
}

/**
 * Fold raw events into one row per requirement.
 *
 * Ceipal sends one event per status change, so a candidate appears several
 * times; the earliest SubmittedOn for a candidate is their submission, and
 * counting rows instead would inflate a busy requirement simply for having
 * moved through more stages.
 */
export function buildRequirementSla(
  events: SubmissionEvent[],
  opts: SlaOptions = {}
): RequirementSla[] {
  const target = opts.target ?? SLA_TARGET_SUBMISSIONS;
  const windowHours = opts.windowHours ?? SLA_WINDOW_HOURS;
  const now = opts.now ?? DateTime.local();

  interface Acc {
    jobCode: string;
    jobTitle: string;
    client: string;
    owner: string;
    jobCreatedOn: DateTime | null;
    byCandidate: Map<string, SlaSubmission>;
    statusesByCandidate: Map<string, Set<string>>;
  }
  const jobs = new Map<string, Acc>();

  for (const ev of events) {
    const code = norm(ev.jobCode);
    if (!code) continue;
    let job = jobs.get(code);
    if (!job) {
      job = {
        jobCode: code,
        jobTitle: norm(ev.jobTitle),
        client: norm(ev.client),
        owner: norm(ev.accountManager),
        jobCreatedOn: ev.jobCreatedOn ?? null,
        byCandidate: new Map(),
        statusesByCandidate: new Map(),
      };
      jobs.set(code, job);
    }
    // Fill in anything the first event happened to be missing.
    if (!job.jobTitle) job.jobTitle = norm(ev.jobTitle);
    if (!job.client) job.client = norm(ev.client);
    if (!job.owner) job.owner = norm(ev.accountManager);
    if (!job.jobCreatedOn) job.jobCreatedOn = ev.jobCreatedOn ?? null;

    const cand = keyOf(ev.applicantName);
    if (!cand) continue;
    // Every status this candidate has been through, so the furthest one they
    // reached decides whether they count — not whichever event came last.
    let seen = job.statusesByCandidate.get(cand);
    if (!seen) {
      seen = new Set();
      job.statusesByCandidate.set(cand, seen);
    }
    seen.add(normalizeStatus(ev.submissionStatus));

    if (!ev.submittedOn) continue;
    const existing = job.byCandidate.get(cand);
    if (!existing || ev.submittedOn < existing.submittedOn) {
      job.byCandidate.set(cand, {
        candidate: norm(ev.applicantName),
        recruiter: norm(ev.submittedBy),
        submittedOn: ev.submittedOn,
        hours: null, // filled below, once the job's created date is settled
      });
    }
  }

  return [...jobs.values()].map((job) => {
    const counted = [...job.byCandidate.entries()].filter(([cand]) =>
      wentOut(job.statusesByCandidate.get(cand) ?? new Set())
    );
    const rejectedInternally = job.byCandidate.size - counted.length;

    const submissions = counted
      .map(([, sub]) => sub)
      .sort((a, b) => a.submittedOn.toMillis() - b.submittedOn.toMillis())
      .map((s) => ({
        ...s,
        hours: job.jobCreatedOn
          ? Math.max(0, s.submittedOn.diff(job.jobCreatedOn, "hours").hours)
          : null,
      }));

    const hoursToNth = Array.from({ length: target }, (_, i) => submissions[i]?.hours ?? null);
    const inWindow = hoursToNth.filter((h) => h != null && h <= windowHours).length;

    return {
      jobCode: job.jobCode,
      jobTitle: job.jobTitle,
      client: job.client,
      owner: job.owner,
      jobCreatedOn: job.jobCreatedOn,
      submissions,
      hoursToNth,
      inWindow,
      ageDays: job.jobCreatedOn ? Math.floor(now.diff(job.jobCreatedOn, "days").days) : null,
      met: inWindow >= target,
      rejectedInternally,
    };
  });
}

export interface SlaTotals {
  requirements: number;
  /** requirements × target — what 100% would be. */
  expected: number;
  /** Submissions that landed inside the window, capped per requirement. */
  achieved: number;
  /** achieved / expected, 0–100. */
  attainment: number;
  /** Requirements that hit the full target inside the window. */
  met: number;
  /** Requirements with no submission at all. */
  untouched: number;
  /** Requirements with some submissions but fewer than the target, ever. */
  under: number;
  /** Every submission, in or out of window. Context for the attainment figure. */
  totalSubmissions: number;
  /** Profiles stopped internally, which are not submissions and never were. */
  rejectedInternally: number;
}

export function slaTotals(rows: RequirementSla[], target = SLA_TARGET_SUBMISSIONS): SlaTotals {
  const expected = rows.length * target;
  const achieved = rows.reduce((n, r) => n + r.inWindow, 0);
  return {
    requirements: rows.length,
    expected,
    achieved,
    attainment: expected > 0 ? Math.round((achieved / expected) * 100) : 0,
    met: rows.filter((r) => r.met).length,
    untouched: rows.filter((r) => r.submissions.length === 0).length,
    under: rows.filter((r) => r.submissions.length > 0 && r.submissions.length < target).length,
    totalSubmissions: rows.reduce((n, r) => n + r.submissions.length, 0),
    rejectedInternally: rows.reduce((n, r) => n + r.rejectedInternally, 0),
  };
}

/**
 * The bucket histogram, per submission position — the table read aloud client by
 * client in the review ("less than four hours is 20, 4 to 8 is 9 …").
 */
export function bucketMatrix(
  rows: RequirementSla[],
  target = SLA_TARGET_SUBMISSIONS
): Record<BucketKey, number>[] {
  return Array.from({ length: target }, (_, i) => {
    const counts = Object.fromEntries(SLA_BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;
    for (const r of rows) {
      const b = bucketOf(r.hoursToNth[i]);
      if (b) counts[b] += 1;
    }
    return counts;
  });
}

/** Group requirements by a field, each group carrying its own totals. */
export function groupBy(
  rows: RequirementSla[],
  pick: (r: RequirementSla) => string,
  target = SLA_TARGET_SUBMISSIONS
): { name: string; rows: RequirementSla[]; totals: SlaTotals }[] {
  const map = new Map<string, RequirementSla[]>();
  for (const r of rows) {
    const name = pick(r) || "(unassigned)";
    const list = map.get(name);
    if (list) list.push(r);
    else map.set(name, [r]);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, rows: list, totals: slaTotals(list, target) }))
    .sort((a, b) => a.totals.attainment - b.totals.attainment || b.totals.requirements - a.totals.requirements);
}

/**
 * Per recruiter, from the submissions themselves rather than the requirement.
 *
 * A requirement has one owner but many recruiters, so this cannot come from
 * grouping requirements — it has to be counted a submission at a time.
 */
export interface RecruiterSla {
  name: string;
  submissions: number;
  inWindow: number;
  /** Submissions inside the window as a share of that recruiter's own submissions. */
  rate: number;
  requirements: number;
}

export function byRecruiter(
  rows: RequirementSla[],
  target = SLA_TARGET_SUBMISSIONS,
  windowHours = SLA_WINDOW_HOURS
): RecruiterSla[] {
  const map = new Map<string, { name: string; submissions: number; inWindow: number; reqs: Set<string> }>();
  for (const r of rows) {
    // Only the first `target` submissions can earn anything, so only those are
    // judged — a recruiter is not marked down for a third profile nobody asked
    // for, and not credited for one either.
    r.submissions.slice(0, target).forEach((s) => {
      const k = keyOf(s.recruiter);
      if (!k) return;
      let e = map.get(k);
      if (!e) {
        e = { name: s.recruiter, submissions: 0, inWindow: 0, reqs: new Set() };
        map.set(k, e);
      }
      e.submissions += 1;
      e.reqs.add(r.jobCode);
      if (s.hours != null && s.hours <= windowHours) e.inWindow += 1;
    });
  }
  return [...map.values()]
    .map((e) => ({
      name: e.name,
      submissions: e.submissions,
      inWindow: e.inWindow,
      rate: e.submissions > 0 ? Math.round((e.inWindow / e.submissions) * 100) : 0,
      requirements: e.reqs.size,
    }))
    .sort((a, b) => b.inWindow - a.inWindow || a.name.localeCompare(b.name));
}

/** Every distinct account manager present, for the owner filter. */
export function ownersIn(rows: RequirementSla[]): string[] {
  return [...new Set(rows.map((r) => r.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Requirements worth chasing first: nothing sent, then least sent, then oldest. */
export function worstFirst(rows: RequirementSla[]): RequirementSla[] {
  return rows.slice().sort(
    (a, b) =>
      a.submissions.length - b.submissions.length ||
      b.inWindow - a.inWindow ||
      (b.ageDays ?? 0) - (a.ageDays ?? 0)
  );
}
