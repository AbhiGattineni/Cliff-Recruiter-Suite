// Client / Vendor scorecard aggregation.
//
// Management view: for each client/vendor we submit to, how many profiles we sent
// and how far they moved — so we can decide who to prioritise and who is sitting
// silently on our submissions.
//
// The timeline starts at SUBMISSION TO CLIENT/VENDOR: a profile only enters this
// view once it has reached the client/vendor side (isClientVendorStatus). Profiles
// still internal never count here. Each profile is counted once, by its latest
// status.

import { DateTime } from "luxon";
import { SubmissionEvent } from "./report/types";
import { isClientVendorStatus, normHeader } from "./report/columns";

// Ordered client-side stages (the funnel a profile moves through on the client side).
export type ClientStage = "submitted" | "interview" | "selected" | "rejected" | "hold";

export const STAGE_META: { key: ClientStage; label: string; color: string }[] = [
  { key: "submitted", label: "Submitted (awaiting response)", color: "#8aa4c8" },
  { key: "interview", label: "Interview (L1/L2/client round)", color: "#e0a800" },
  { key: "selected", label: "Selected / Offer", color: "#12b886" },
  { key: "hold", label: "On hold", color: "#7048e8" },
  { key: "rejected", label: "Rejected", color: "#c92a2a" },
];

export const STAGE_COLOR: Record<ClientStage, string> = STAGE_META.reduce(
  (m, s) => ((m[s.key] = s.color), m),
  {} as Record<ClientStage, string>
);

// A submitted-stage profile older than this (no response yet) is "stale".
export const STALE_DAYS = 14;

export type Verdict = "prioritize" | "watch" | "reconsider";
export type Trend = "up" | "down" | "flat" | "na";

/** Map a client-side status to its funnel stage. Non-client statuses fall to "submitted". */
export function clientStage(raw: string): ClientStage {
  const n = normHeader(raw);
  if (n.includes("selectedby") || n.includes("bgv")) return "selected";
  if (n.includes("rejected") || n.includes("disqualified")) return "rejected";
  if (n.includes("hold")) return "hold";
  if (n.includes("interview")) return "interview";
  return "submitted";
}

export interface ClientSubmission {
  consultant: string;
  recruiter: string;
  jobCode: string;
  jobTitle: string;
  status: string; // verbatim current status
  stage: ClientStage;
  submittedOn: DateTime | null;
  lastActivity: DateTime | null; // latest status-changed time
  daysWaiting: number | null; // days since it went to client with no further movement
  timeToResponseDays: number | null; // submission -> first movement (only if it moved)
}

export interface ClientScore {
  client: string;
  total: number; // profiles submitted to client/vendor
  submitted: number; // still awaiting a response
  interview: number;
  selected: number;
  rejected: number;
  hold: number;
  moved: number; // interview + selected + rejected + hold (any feedback)
  responseRate: number; // moved / total
  selectionRate: number; // selected / total
  interviewReached: number; // interview + selected (got to interview or beyond)
  interviewRate: number; // interviewReached / total
  interviewToSelection: number | null; // selected / interviewReached
  subsPerSelection: number | null; // total / selected (effort per win)
  avgTimeToResponseDays: number | null; // avg over profiles that moved
  staleCount: number; // awaiting-response profiles older than STALE_DAYS
  lastActivity: DateTime | null;
  avgWaitDays: number | null; // avg age of the awaiting-response profiles
  maxWaitDays: number | null; // oldest awaiting-response profile
  trend: Trend; // recent vs prior response-rate direction
  recentRate: number | null;
  priorRate: number | null;
  verdict: Verdict;
  subs: ClientSubmission[];
}

interface Folded {
  recruiter: string;
  jobCode: string;
  jobTitle: string;
  consultant: string;
  client: string;
  status: string; // latest status
  ts: number; // latest status-changed time (ms)
  submittedOn: DateTime | null;
  lastActivity: DateTime | null;
  firstMovedAt: DateTime | null; // earliest client-side movement (past "submitted")
  everClient: boolean;
}

/** Fold raw events into one record per candidate (latest status by timestamp wins). */
function foldByCandidate(subs: SubmissionEvent[]): Folded[] {
  const map = new Map<string, Folded>();
  for (const ev of subs) {
    const applicant = (ev.applicantName || "").toLowerCase().trim() || "(unknown)";
    const jobCode = ev.jobCode || "(unknown)";
    const key = `${jobCode}||${applicant}`;
    const changed = ev.statusChangedOn ?? ev.submittedOn ?? null;
    const ts = changed?.toMillis() ?? 0;
    const clientHere = isClientVendorStatus(ev.submissionStatus);
    const movedHere = clientHere && clientStage(ev.submissionStatus) !== "submitted";
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
        lastActivity: changed,
        firstMovedAt: movedHere ? changed : null,
        everClient: clientHere,
      });
    } else {
      if (!cur.recruiter && ev.submittedBy) cur.recruiter = ev.submittedBy;
      if (!cur.jobTitle && ev.jobTitle) cur.jobTitle = ev.jobTitle;
      if (!cur.consultant && ev.applicantName) cur.consultant = ev.applicantName;
      if (!cur.client && ev.client) cur.client = ev.client;
      if (!cur.submittedOn && ev.submittedOn) cur.submittedOn = ev.submittedOn;
      if (clientHere) cur.everClient = true;
      if (movedHere && changed && (!cur.firstMovedAt || changed < cur.firstMovedAt)) cur.firstMovedAt = changed;
      if (ts >= cur.ts) {
        cur.ts = ts;
        cur.status = ev.submissionStatus || "";
        cur.lastActivity = changed;
      }
    }
  }
  return Array.from(map.values());
}

const clientKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const roundDays = (a: DateTime, b: DateTime) => Math.max(0, Math.round(a.diff(b, "days").days));

/** Recent-vs-prior response-rate trend for a client's submissions (cohorts by submit date). */
function trendOf(subs: ClientSubmission[], now: DateTime): { trend: Trend; recentRate: number | null; priorRate: number | null } {
  const recent: ClientSubmission[] = [];
  const prior: ClientSubmission[] = [];
  for (const s of subs) {
    if (!s.submittedOn) continue;
    const age = now.diff(s.submittedOn, "days").days;
    if (age <= 45) recent.push(s);
    else if (age <= 90) prior.push(s);
  }
  const rate = (arr: ClientSubmission[]) => (arr.length ? arr.filter((x) => x.stage !== "submitted").length / arr.length : null);
  const recentRate = rate(recent);
  const priorRate = rate(prior);
  if (recent.length < 2 || prior.length < 2 || recentRate == null || priorRate == null) {
    return { trend: "na", recentRate, priorRate };
  }
  const diff = recentRate - priorRate;
  return { trend: diff > 0.1 ? "up" : diff < -0.1 ? "down" : "flat", recentRate, priorRate };
}

/** Build one scorecard per client/vendor from raw submission events. */
export function computeClientScores(subs: SubmissionEvent[], now: DateTime = DateTime.now()): ClientScore[] {
  const cands = foldByCandidate(subs).filter((c) => c.everClient);

  const groups = new Map<string, { client: string; subs: ClientSubmission[] }>();
  for (const c of cands) {
    const clientName = (c.client || "").trim() || "(Unspecified client)";
    const key = clientKey(clientName);
    const stage = clientStage(c.status);
    const daysWaiting = stage === "submitted" ? roundDays(now, c.lastActivity ?? c.submittedOn ?? now) : null;
    const timeToResponseDays =
      stage !== "submitted" && c.firstMovedAt && c.submittedOn ? roundDays(c.firstMovedAt, c.submittedOn) : null;
    const row: ClientSubmission = {
      consultant: c.consultant,
      recruiter: c.recruiter,
      jobCode: c.jobCode && c.jobCode !== "(unknown)" ? c.jobCode : "",
      jobTitle: c.jobTitle,
      status: c.status,
      stage,
      submittedOn: c.submittedOn,
      lastActivity: c.lastActivity,
      daysWaiting,
      timeToResponseDays,
    };
    let g = groups.get(key);
    if (!g) {
      g = { client: clientName, subs: [] };
      groups.set(key, g);
    }
    g.subs.push(row);
  }

  const scores: ClientScore[] = [];
  for (const g of groups.values()) {
    const counts: Record<ClientStage, number> = { submitted: 0, interview: 0, selected: 0, rejected: 0, hold: 0 };
    let lastActivity: DateTime | null = null;
    const waits: number[] = [];
    const responseTimes: number[] = [];
    let staleCount = 0;
    for (const s of g.subs) {
      counts[s.stage]++;
      if (s.lastActivity && (!lastActivity || s.lastActivity > lastActivity)) lastActivity = s.lastActivity;
      if (s.stage === "submitted" && s.daysWaiting != null) {
        waits.push(s.daysWaiting);
        if (s.daysWaiting > STALE_DAYS) staleCount++;
      }
      if (s.timeToResponseDays != null) responseTimes.push(s.timeToResponseDays);
    }
    const total = g.subs.length;
    const moved = counts.interview + counts.selected + counts.rejected + counts.hold;
    const interviewReached = counts.interview + counts.selected;
    const responseRate = total ? moved / total : 0;
    const { trend, recentRate, priorRate } = trendOf(g.subs, now);
    // Verdict (per the agreed rule): red only when NOTHING has ever moved.
    const verdict: Verdict =
      moved === 0 ? "reconsider" : counts.selected > 0 || responseRate >= 0.5 ? "prioritize" : "watch";
    g.subs.sort((a, b) => (b.submittedOn?.toMillis() ?? 0) - (a.submittedOn?.toMillis() ?? 0));
    scores.push({
      client: g.client,
      total,
      submitted: counts.submitted,
      interview: counts.interview,
      selected: counts.selected,
      rejected: counts.rejected,
      hold: counts.hold,
      moved,
      responseRate,
      selectionRate: total ? counts.selected / total : 0,
      interviewReached,
      interviewRate: total ? interviewReached / total : 0,
      interviewToSelection: interviewReached ? counts.selected / interviewReached : null,
      subsPerSelection: counts.selected ? total / counts.selected : null,
      avgTimeToResponseDays: responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
      staleCount,
      lastActivity,
      avgWaitDays: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      maxWaitDays: waits.length ? Math.max(...waits) : null,
      trend,
      recentRate,
      priorRate,
      verdict,
      subs: g.subs,
    });
  }

  // Default order: most submissions first (biggest relationships on top).
  scores.sort((a, b) => b.total - a.total || b.moved - a.moved);
  return scores;
}

export interface PortfolioStats {
  clients: number;
  totalSubs: number;
  responded: number; // profiles that got any feedback
  interviewed: number; // reached interview or beyond
  selected: number;
  respondedRate: number;
  interviewedRate: number;
  selectedRate: number;
  interviewToSelection: number | null;
  avgTimeToResponseDays: number | null;
  staleTotal: number;
  verdicts: Record<Verdict, number>;
}

/** Roll the per-client scores up into a portfolio-level funnel + headline numbers. */
export function portfolioStats(scores: ClientScore[]): PortfolioStats {
  let totalSubs = 0, responded = 0, interviewed = 0, selected = 0, staleTotal = 0;
  const verdicts: Record<Verdict, number> = { prioritize: 0, watch: 0, reconsider: 0 };
  const responseTimes: number[] = [];
  for (const s of scores) {
    totalSubs += s.total;
    responded += s.moved;
    interviewed += s.interviewReached;
    selected += s.selected;
    staleTotal += s.staleCount;
    verdicts[s.verdict]++;
    for (const sub of s.subs) if (sub.timeToResponseDays != null) responseTimes.push(sub.timeToResponseDays);
  }
  return {
    clients: scores.length,
    totalSubs,
    responded,
    interviewed,
    selected,
    respondedRate: totalSubs ? responded / totalSubs : 0,
    interviewedRate: totalSubs ? interviewed / totalSubs : 0,
    selectedRate: totalSubs ? selected / totalSubs : 0,
    interviewToSelection: interviewed ? selected / interviewed : null,
    avgTimeToResponseDays: responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
    staleTotal,
    verdicts,
  };
}

export type ClientSortKey = "total" | "responseRate" | "selected" | "waiting" | "reconsider" | "stale" | "response_time";

const VERDICT_SEVERITY: Record<Verdict, number> = { reconsider: 0, watch: 1, prioritize: 2 };

export function sortClientScores(scores: ClientScore[], key: ClientSortKey): ClientScore[] {
  const arr = [...scores];
  switch (key) {
    case "responseRate":
      return arr.sort((a, b) => b.responseRate - a.responseRate || b.total - a.total);
    case "selected":
      return arr.sort((a, b) => b.selected - a.selected || b.responseRate - a.responseRate);
    case "waiting":
      return arr.sort((a, b) => (b.maxWaitDays ?? -1) - (a.maxWaitDays ?? -1) || b.submitted - a.submitted);
    case "stale":
      return arr.sort((a, b) => b.staleCount - a.staleCount || (b.maxWaitDays ?? -1) - (a.maxWaitDays ?? -1));
    case "response_time":
      // Fastest responders first; clients with no response go last.
      return arr.sort((a, b) => (a.avgTimeToResponseDays ?? Infinity) - (b.avgTimeToResponseDays ?? Infinity));
    case "reconsider":
      return arr.sort((a, b) => VERDICT_SEVERITY[a.verdict] - VERDICT_SEVERITY[b.verdict] || b.total - a.total);
    default:
      return arr.sort((a, b) => b.total - a.total || b.moved - a.moved);
  }
}
