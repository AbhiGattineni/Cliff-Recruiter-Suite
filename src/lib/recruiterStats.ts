// Recruiter performance aggregation.
//
// Each profile (a candidate on a job) has ONE current/final status — the status
// of its latest event by "Status Changed On". We count, per recruiter, how many
// of their profiles sit in each status.
//
// Statuses are taken VERBATIM from Ceipal — each distinct status keeps its own
// name (no catch-all "Other" bucket). An internal funnel classification is used
// only to colour/order the statuses and to score the Performance Index.

import { DateTime } from "luxon";
import { SubmissionEvent, JobRecord } from "./report/types";
import { fmtDuration } from "./report/dates";

// One underlying profile (a consultant submitted to a requirement) for the detail view.
export interface ProfileRow {
  jobCode: string; // requirement id
  jobTitle: string; // requirement
  consultant: string; // candidate name
  status: string; // current status (display label)
  client: string;
  submittedOn: DateTime | null; // when the profile was first uploaded/submitted
  lastActivity: DateTime | null; // when the current status was set — drives period attribution
  jobCreatedOn: DateTime | null; // time of job posting
}

/**
 * The date a submission event should be attributed to.
 *
 * This is the status-change date, NOT the upload date. A candidate uploaded on
 * 31 Jul and submitted to the client on 4 Aug did the client-submission work in
 * August, and must count there. Using the upload date credited it to July and
 * hid it from any August range entirely. Falls back to the upload date only
 * when Ceipal gives us no status-change timestamp.
 */
export function eventDate(ev: SubmissionEvent): DateTime | null {
  return ev.statusChangedOn ?? ev.submittedOn ?? null;
}

/**
 * Keep events whose activity happened inside [from, to] (inclusive).
 *
 * Filtering happens on individual events, before they're folded into one row
 * per candidate, so a candidate uploaded in July and client-submitted in August
 * correctly appears in BOTH periods — as "Submitted" in July and as
 * "Client / Vendor Submission" in August.
 */
export function filterByActivity(
  subs: SubmissionEvent[],
  from: DateTime | null,
  to: DateTime | null
): SubmissionEvent[] {
  if (!from && !to) return subs;
  return subs.filter((ev) => {
    const d = eventDate(ev);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// One requirement in a recruiter's detail view, with its submissions (may be empty
// when the recruiter is assigned the requirement but has made no submissions).
export interface JobGroup {
  jobCode: string;
  jobTitle: string;
  client: string;
  jobCreatedOn: DateTime | null; // time of job posting
  submissions: ProfileRow[];
  firstSubmission: DateTime | null; // earliest submission time
  timeToFirst: string; // job posting → first submission ("Xd Yh Zm" / "–")
  assignedOnly: boolean; // true = assigned but no submissions
}

export interface StatusMeta {
  key: string; // normalised de-dupe key
  label: string; // display name (as Ceipal provides it)
  color: string;
}

// Target profiles sent out per assigned requirement.
export const TARGET_PER_ASSIGNED = 2;

/** The five scoring tiers of the pipeline, best first. Keys match Funnel stages. */
export type PipelineStage =
  | "offerAccepted"
  | "clientSelected"
  | "clientInterview"
  | "clientSubmitted"
  | "vendorSubmitted";

export const PIPELINE_STAGES: PipelineStage[] = [
  "offerAccepted",
  "clientSelected",
  "clientInterview",
  "clientSubmitted",
  "vendorSubmitted",
];

// The Performance Index, out of 100.
//
// A submission is only the first step, so the score is mostly PIPELINE: each
// profile earns points for how far it actually got, in the business's own order
// of preference — offer accepted, then selected in the client round, then
// interviewing with the client, then through the vendor to the client, then out
// to the vendor. On top of that sits the older question of whether the recruiter
// covered the requirements they were given at all.
//
// Every tier is capped, which is what makes the ordering hold rather than just
// being implied by a weight: no amount of submissions can add up to an offer.
// A hundred profiles sitting at the vendor are worth 6 points; one accepted
// offer is worth 55.
export const STAGE_POINTS: Record<PipelineStage, { first: number; each: number; cap: number }> = {
  // An accepted offer is the job. The first one is worth more than every
  // submission-tier cap combined; further ones keep adding.
  offerAccepted: { first: 55, each: 20, cap: 100 },
  clientSelected: { first: 12, each: 12, cap: 24 },
  clientInterview: { first: 6, each: 6, cap: 14 },
  clientSubmitted: { first: 3, each: 3, cap: 12 },
  vendorSubmitted: { first: 1, each: 1, cap: 6 },
};

/** Points available for covering assigned requirements at TARGET_PER_ASSIGNED profiles each. */
export const REQUIREMENT_TARGET_POINTS = 20;

/**
 * The most a recruiter can score without a single accepted offer: every
 * pipeline tier capped out, plus full requirement coverage. Stated here because
 * it is the number that decides how much an offer is really worth — an offer
 * (55) beats any pile of submissions, but a genuinely full pipeline of
 * near-wins can still out-score one.
 */
export const MAX_WITHOUT_OFFER =
  STAGE_POINTS.clientSelected.cap +
  STAGE_POINTS.clientInterview.cap +
  STAGE_POINTS.clientSubmitted.cap +
  STAGE_POINTS.vendorSubmitted.cap +
  REQUIREMENT_TARGET_POINTS;

/** Points a tier earns for `n` profiles sitting at it. */
export function stagePoints(stage: PipelineStage, n: number): number {
  if (n <= 0) return 0;
  const { first, each, cap } = STAGE_POINTS[stage];
  return Math.min(cap, first + (n - 1) * each);
}

// Internal funnel stage. Used for ORDERING and COLOUR, and — since the index
// became pipeline-weighted — for scoring too. The ladder is the one the
// business cares about, best outcome first:
//
//   1. offerAccepted    selected in the client round AND took the offer
//   2. clientSelected   selected in the client round (offer out, not yet taken)
//   3. clientInterview  interviewing with the client/vendor right now
//   4. clientSubmitted  selected by the vendor and sent on to the client
//   5. vendorSubmitted  sent to the vendor
//
// Client and vendor submissions used to be merged into one status, because a
// submission was a submission. That no longer holds: reaching the client is a
// step past reaching the vendor, and the index has to be able to tell them
// apart, so they are separate stages (and separate labels) again.
type Funnel =
  | "offerAccepted"
  | "clientSelected"
  | "clientInterview"
  | "clientSubmitted"
  | "vendorSubmitted"
  | "selected"
  | "interview"
  | "waiting"
  | "submitted"
  | "rejected"
  | "unknown";

const FUNNEL_RANK: Record<Funnel, number> = {
  offerAccepted: 0,
  clientSelected: 1,
  clientInterview: 2,
  clientSubmitted: 3,
  vendorSubmitted: 4,
  selected: 5,
  interview: 6,
  waiting: 7,
  submitted: 8,
  rejected: 9,
  unknown: 10,
};

const FUNNEL_COLOR: Record<Funnel, string> = {
  offerAccepted: "#07521f",
  clientSelected: "#0b6e2e",
  clientInterview: "#1e7e34",
  clientSubmitted: "#12b886",
  vendorSubmitted: "#5cc9a7",
  selected: "#8bc34a",
  interview: "#e0a800",
  waiting: "#4c8bf5",
  submitted: "#8aa4c8",
  rejected: "#c92a2a",
  unknown: "", // filled from PALETTE
};

/** Stages that mean the profile was actually sent out — to the vendor or beyond. */
function reachedClient(f: Funnel): boolean {
  return (
    f === "vendorSubmitted" ||
    f === "clientSubmitted" ||
    f === "clientInterview" ||
    f === "clientSelected" ||
    f === "offerAccepted"
  );
}

// Distinct colours for statuses that don't match a known funnel stage.
const PALETTE = ["#7048e8", "#e8590c", "#0ca678", "#f06595", "#495057", "#a61e4d", "#1098ad", "#d9480f"];

/** Map a raw status to an internal funnel stage (scoring/ordering only). */
export function funnelOf(raw: string): Funnel {
  const n = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return "unknown";

  // Negative outcomes first, so "rejected by vendor" isn't read as client progress.
  if (n.includes("reject") || n.includes("disqualif")) return "rejected";

  const internal = n.includes("internal");
  const clientSide =
    n.includes("client") || n.includes("vendor") || n.includes("enduser") || n.includes("external");

  // 1. The offer was taken. Only an explicit acceptance or a start counts —
  //    "Offer Released" means an offer went out, which the candidate can still
  //    decline, so it scores as a client-round selection rather than a win.
  if (
    n.includes("offeraccept") ||
    n.includes("acceptedoffer") ||
    n.includes("placed") ||
    n.includes("placement") ||
    n.includes("joined") ||
    n.includes("joining") ||
    n.includes("onboard") ||
    n.includes("confirmation") ||
    n.includes("confirmed")
  ) {
    return "offerAccepted";
  }

  // 2. Picked in the client round — an offer is out, or the client/vendor said
  //    yes, but nobody has signed anything yet.
  if (
    n.includes("offer") || // offer released / extended / in progress
    n.includes("selectedbyclient") ||
    n.includes("clientselected") ||
    n.includes("selectedbyenduser") ||
    (n.includes("select") && clientSide && !internal && !n.includes("selectedbyvendor"))
  ) {
    return "clientSelected";
  }

  // 3. Interviewing with the client/vendor right now.
  if (!internal && clientSide && n.includes("interview")) return "clientInterview";

  // 4. Through the vendor and on to the client.
  if (
    n.includes("selectedbyvendor") ||
    n.includes("clientsubmission") ||
    n.includes("submittedtoclient") ||
    n.includes("submittedtoendclient") ||
    n.includes("submittedtoenduser") ||
    n.includes("clientsubmitted")
  ) {
    return "clientSubmitted";
  }

  // 5. Sent to the vendor — the first step out of the door.
  if (
    n.includes("vendorsubmission") ||
    n.includes("submittedtovendor") ||
    n.includes("vendorsubmitted")
  ) {
    return "vendorSubmitted";
  }
  if (n.includes("selectedinternally") || n.includes("internalselect") || n === "selected") return "selected";
  if (n.includes("internalinterview") || n.includes("internalscreening") || n.includes("interview")) {
    return "interview";
  }
  if (n.includes("waitingforevaluation") || n === "waiting") return "waiting";
  if (
    n === "submitted" ||
    n.includes("submittedtoaccountmanager") ||
    n.includes("submittedtoam") ||
    n.includes("submittedinternally") ||
    n.includes("internalsubmission") ||
    n.includes("submittedtorequirementowner")
  ) {
    return "submitted";
  }
  return "unknown";
}

const normKey = (raw: string) => raw.toLowerCase().replace(/\s+/g, " ").trim();
const cleanLabel = (raw: string) => raw.replace(/\s+/g, " ").trim();

/**
 * Identity (de-dupe key + display label + funnel) for a raw status.
 *
 * Client and vendor submissions used to be merged under one
 * "Client / Vendor Submission" label. They are no longer the same thing to the
 * index — reaching the client scores above reaching the vendor — so showing
 * them as one status would hide the difference the score is now built on. Every
 * status keeps its own verbatim Ceipal name.
 */
function statusIdentity(raw: string): { key: string; label: string; funnel: Funnel } {
  const funnel = funnelOf(raw);
  const trimmed = (raw ?? "").trim();
  return {
    key: normKey(trimmed) || "(no status)",
    label: trimmed ? cleanLabel(trimmed) : "No status",
    funnel,
  };
}

export interface RecruiterStat {
  name: string;
  requirements: number; // distinct job codes worked
  profiles: number; // candidate submissions
  counts: Record<string, number>; // keyed by status LABEL (dynamic)
  clientCount: number; // profiles at a client/vendor submission
  clientRate: number; // clientCount / profiles
  progressRate: number; // reached interview or beyond / profiles
  assignedCount: number; // distinct requirements assigned to this recruiter (all time)
  targetBasis: "assigned" | "worked"; // what clientTarget was computed from
  targetBaseCount: number; // the requirement count behind clientTarget
  clientTarget: number; // target client/vendor submissions (2 × target base)
  index: number; // 0–100 composite Performance Index
  /** How many profiles sit at each scoring tier of the pipeline. */
  stageCounts: Record<PipelineStage, number>;
  /** Points earned per tier, plus the requirement-coverage points. Sums to `index`. */
  indexParts: Record<PipelineStage | "requirementTarget", number>;
  rows: ProfileRow[]; // the underlying profiles, newest submission first
  jobGroups: JobGroup[]; // profiles grouped by requirement (+ assigned-no-submission)
  noSubCount: number; // assigned requirements with no submissions
}

export interface RecruiterStatsResult {
  stats: RecruiterStat[];
  statuses: StatusMeta[]; // global ordered union of statuses (with colours)
}

interface Candidate {
  recruiter: string;
  jobCode: string;
  jobTitle: string;
  consultant: string;
  client: string;
  status: string; // raw status of the latest event
  ts: number;
  submittedOn: DateTime | null;
  lastActivity: DateTime | null; // status-change time of the latest event
  jobCreatedOn: DateTime | null;
}

/** Fold raw events into one record per candidate (latest status by timestamp wins). */
function foldCandidates(subs: SubmissionEvent[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const ev of subs) {
    const applicant = (ev.applicantName || "").toLowerCase().trim() || "(unknown)";
    const jobCode = ev.jobCode || "(unknown)";
    const key = `${jobCode}||${applicant}`;
    const ts = eventDate(ev)?.toMillis() ?? 0;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        recruiter: ev.submittedBy || "",
        jobCode,
        jobTitle: ev.jobTitle || "",
        consultant: ev.applicantName || "",
        client: ev.client || "",
        status: ev.submissionStatus || "",
        ts,
        submittedOn: ev.submittedOn ?? null,
        lastActivity: eventDate(ev),
        jobCreatedOn: ev.jobCreatedOn ?? null,
      });
    } else {
      if (!cur.recruiter && ev.submittedBy) cur.recruiter = ev.submittedBy;
      if (!cur.jobTitle && ev.jobTitle) cur.jobTitle = ev.jobTitle;
      if (!cur.consultant && ev.applicantName) cur.consultant = ev.applicantName;
      if (!cur.client && ev.client) cur.client = ev.client;
      if (!cur.submittedOn && ev.submittedOn) cur.submittedOn = ev.submittedOn;
      if (!cur.jobCreatedOn && ev.jobCreatedOn) cur.jobCreatedOn = ev.jobCreatedOn;
      // Keep the earliest upload date, but the LATEST status wins.
      const so = ev.submittedOn;
      if (so && (!cur.submittedOn || so < cur.submittedOn)) cur.submittedOn = so;
      if (ts >= cur.ts) {
        cur.ts = ts;
        cur.status = ev.submissionStatus || "";
        cur.lastActivity = eventDate(ev);
      }
    }
  }
  return Array.from(map.values());
}

const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Requirements the recruiter has submitted to, plus assigned ones with no submissions. */
function buildJobGroups(rows: ProfileRow[], assigned: JobRecord[]): JobGroup[] {
  const m = new Map<string, JobGroup>();
  for (const r of rows) {
    const key = r.jobCode || r.jobTitle || "(unknown)";
    let g = m.get(key);
    if (!g) {
      g = {
        jobCode: r.jobCode,
        jobTitle: r.jobTitle,
        client: r.client,
        jobCreatedOn: r.jobCreatedOn,
        submissions: [],
        firstSubmission: null,
        timeToFirst: "",
        assignedOnly: false,
      };
      m.set(key, g);
    }
    g.submissions.push(r);
    if (!g.jobTitle && r.jobTitle) g.jobTitle = r.jobTitle;
    if (!g.client && r.client) g.client = r.client;
    if (!g.jobCreatedOn && r.jobCreatedOn) g.jobCreatedOn = r.jobCreatedOn;
  }
  for (const g of m.values()) {
    let first: DateTime | null = null;
    for (const r of g.submissions) {
      if (r.submittedOn && (!first || r.submittedOn < first)) first = r.submittedOn;
    }
    g.firstSubmission = first;
    g.timeToFirst = fmtDuration(g.jobCreatedOn, first);
  }
  // Assigned requirements with no submission in this view.
  for (const j of assigned) {
    const key = j.jobCode || j.jobTitle || "(unknown)";
    if (m.has(key)) continue;
    m.set(key, {
      jobCode: j.jobCode,
      jobTitle: j.jobTitle,
      client: j.client,
      jobCreatedOn: j.jobCreatedOn,
      submissions: [],
      firstSubmission: null,
      timeToFirst: "",
      assignedOnly: true,
    });
  }
  return Array.from(m.values()).sort((a, b) => {
    if (a.assignedOnly !== b.assignedOnly) return a.assignedOnly ? 1 : -1;
    return (
      b.submissions.length - a.submissions.length ||
      (b.firstSubmission?.toMillis() ?? 0) - (a.firstSubmission?.toMillis() ?? 0)
    );
  });
}

export interface JobSubmission {
  consultant: string;
  recruiter: string;
  status: string; // merged display label (current status)
  submittedOn: DateTime | null;
}

/** Group the already-loaded submissions by Job Code (one row per candidate, latest status). */
export function submissionsByJob(subs: SubmissionEvent[]): Map<string, JobSubmission[]> {
  const cands = foldCandidates(subs);
  const m = new Map<string, JobSubmission[]>();
  for (const c of cands) {
    const code = c.jobCode && c.jobCode !== "(unknown)" && c.jobCode.toUpperCase() !== "NA" ? c.jobCode : "";
    if (!code) continue;
    const { label } = statusIdentity(c.status || "");
    if (!m.has(code)) m.set(code, []);
    m.get(code)!.push({ consultant: c.consultant, recruiter: c.recruiter, status: label, submittedOn: c.submittedOn });
  }
  for (const arr of m.values()) arr.sort((a, b) => (b.submittedOn?.toMillis() ?? 0) - (a.submittedOn?.toMillis() ?? 0));
  return m;
}

export interface StatsOptions {
  /**
   * True when a date range is active. The "2 client submissions per assigned
   * requirement" target is a lifetime expectation — measuring one day's output
   * against every requirement a recruiter has ever been assigned makes the
   * metric meaningless (1 submission against a target of 116), so within a
   * window we score against the requirements actually worked in it.
   */
  periodScoped?: boolean;
}

/** Aggregate raw submission events into per-recruiter performance, ranked by index. */
export function computeRecruiterStats(
  subs: SubmissionEvent[],
  jobs: JobRecord[] = [],
  opts: StatsOptions = {}
): RecruiterStatsResult {
  const cands = foldCandidates(subs);

  // Requirements assigned to each recruiter (by the job-posting "Assigned To" column).
  const assignedByName = new Map<string, JobRecord[]>();
  for (const j of jobs) {
    const assigned = j.assignedTo || "";
    if (!assigned) continue;
    for (const nm of assigned.split(/[,;/]/)) {
      const k = nameKey(nm);
      if (!k) continue;
      if (!assignedByName.has(k)) assignedByName.set(k, []);
      assignedByName.get(k)!.push(j);
    }
  }

  // Global status registry (keeps each real status name; merges only exact/whitespace/case variants).
  const registry = new Map<string, { label: string; funnel: Funnel; total: number }>();
  const per = new Map<
    string,
    { profiles: number; jobs: Set<string>; counts: Map<string, number>; rows: ProfileRow[] }
  >();

  for (const c of cands) {
    const name = (c.recruiter || "").trim();
    if (!name || name.toUpperCase() === "NA") continue;

    const { key, label, funnel } = statusIdentity(c.status || "");

    let reg = registry.get(key);
    if (!reg) {
      reg = { label, funnel, total: 0 };
      registry.set(key, reg);
    }
    reg.total++;

    let p = per.get(name);
    if (!p) {
      p = { profiles: 0, jobs: new Set(), counts: new Map(), rows: [] };
      per.set(name, p);
    }
    p.profiles++;
    const code = c.jobCode && c.jobCode !== "(unknown)" && c.jobCode.toUpperCase() !== "NA" ? c.jobCode : "";
    if (code) p.jobs.add(code);
    p.counts.set(key, (p.counts.get(key) || 0) + 1);
    p.rows.push({
      jobCode: code,
      jobTitle: c.jobTitle,
      consultant: c.consultant,
      status: label,
      client: c.client,
      submittedOn: c.submittedOn,
      lastActivity: c.lastActivity,
      jobCreatedOn: c.jobCreatedOn,
    });
  }

  // Order statuses (funnel rank, then busiest, then alpha) and assign colours.
  const ordered = Array.from(registry.entries()).sort(
    (a, b) => FUNNEL_RANK[a[1].funnel] - FUNNEL_RANK[b[1].funnel] || b[1].total - a[1].total || a[1].label.localeCompare(b[1].label)
  );
  let paletteIdx = 0;
  const statuses: StatusMeta[] = ordered.map(([key, reg]) => ({
    key,
    label: reg.label,
    color: FUNNEL_COLOR[reg.funnel] || PALETTE[paletteIdx++ % PALETTE.length],
  }));
  const labelByKey = new Map(statuses.map((s) => [s.key, s.label]));
  const funnelByKey = new Map(Array.from(registry.entries()).map(([k, r]) => [k, r.funnel]));

  const prelim = Array.from(per.entries()).map(([name, p]) => {
    const counts: Record<string, number> = {};
    const stageCounts: Record<PipelineStage, number> = {
      offerAccepted: 0,
      clientSelected: 0,
      clientInterview: 0,
      clientSubmitted: 0,
      vendorSubmitted: 0,
    };
    let clientCount = 0;
    let progressCount = 0;
    for (const [key, n] of p.counts) {
      const f = funnelByKey.get(key)!;
      if (f in stageCounts) stageCounts[f as PipelineStage] += n;
      if (reachedClient(f)) clientCount += n;
      if (reachedClient(f) || f === "selected" || f === "interview") progressCount += n;
      counts[labelByKey.get(key) ?? key] = n;
    }
    const profiles = p.profiles || 1;
    // Most recently active first — the useful ordering when reviewing a period.
    const rows = p.rows
      .slice()
      .sort((a, b) => (b.lastActivity?.toMillis() ?? 0) - (a.lastActivity?.toMillis() ?? 0));
    const assignedList = assignedByName.get(nameKey(name)) ?? [];
    const assignedCount = new Set(
      assignedList.map((j) => (j.jobCode || j.jobTitle || "").trim()).filter(Boolean)
    ).size;
    const jobGroups = buildJobGroups(rows, assignedList);
    const noSubCount = jobGroups.filter((g) => g.assignedOnly).length;
    return {
      name,
      requirements: p.jobs.size,
      profiles: p.profiles,
      counts,
      stageCounts,
      clientCount,
      clientRate: clientCount / profiles,
      progressRate: progressCount / profiles,
      assignedCount,
      rows,
      jobGroups,
      noSubCount,
    };
  });

  const stats: RecruiterStat[] = prelim.map((x) => {
    // Coverage: 2 profiles sent out per requirement. Within a date range that
    // base is the requirements actually worked in the window; across all time
    // it's the recruiter's assigned requirements (falling back to worked when
    // there's no Assigned-To data).
    const useWorked = opts.periodScoped || x.assignedCount === 0;
    const targetBasis: "assigned" | "worked" = useWorked ? "worked" : "assigned";
    const targetBase = useWorked ? x.requirements : x.assignedCount;
    const clientTarget = TARGET_PER_ASSIGNED * targetBase;
    const coverage = clientTarget > 0 ? Math.min(1, x.clientCount / clientTarget) : 0;

    // Each profile scores once, at the furthest stage it reached — a candidate
    // who accepted an offer is not also counted as a submission.
    const indexParts = {
      offerAccepted: stagePoints("offerAccepted", x.stageCounts.offerAccepted),
      clientSelected: stagePoints("clientSelected", x.stageCounts.clientSelected),
      clientInterview: stagePoints("clientInterview", x.stageCounts.clientInterview),
      clientSubmitted: stagePoints("clientSubmitted", x.stageCounts.clientSubmitted),
      vendorSubmitted: stagePoints("vendorSubmitted", x.stageCounts.vendorSubmitted),
      requirementTarget: REQUIREMENT_TARGET_POINTS * coverage,
    };
    const total = Object.values(indexParts).reduce((s, v) => s + v, 0);
    const index = Math.min(100, Math.round(total));
    return { ...x, targetBasis, targetBaseCount: targetBase, clientTarget, index, indexParts };
  });

  stats.sort((a, b) => b.index - a.index || b.profiles - a.profiles);
  return { stats, statuses };
}

export type SortKey = "index" | "profiles" | "requirements" | "clientRate" | "progressRate";

export function sortStats(stats: RecruiterStat[], key: SortKey): RecruiterStat[] {
  const val = (s: RecruiterStat) =>
    key === "index" ? s.index
    : key === "profiles" ? s.profiles
    : key === "requirements" ? s.requirements
    : key === "clientRate" ? s.clientRate
    : s.progressRate;
  return [...stats].sort((a, b) => val(b) - val(a) || b.index - a.index);
}

/**
 * Screening outcome for a submission status (rule: Selected-or-later = passed,
 * any Rejected = failed, otherwise pending). Works on the merged display labels.
 */
export function screeningOf(raw: string): "passed" | "failed" | "pending" {
  const n = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return "pending";
  if (n.includes("reject")) return "failed";
  if (n.includes("select") || n.includes("interview") || n.includes("submission")) return "passed";
  return "pending";
}

/** A plain-English summary of a recruiter's current pipeline, using real status names. */
export function statusSentence(s: RecruiterStat, statuses: StatusMeta[]): string {
  const parts = statuses
    .filter((st) => (s.counts[st.label] ?? 0) > 0)
    .map((st) => `${s.counts[st.label]} in ${st.label}`);
  if (parts.length === 0) return `${s.name} has no submissions.`;
  return `${s.name} submitted ${s.profiles} profile${s.profiles === 1 ? "" : "s"} — ${parts.join(", ")}.`;
}
