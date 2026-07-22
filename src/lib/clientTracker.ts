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

export type Verdict = "prioritize" | "watch" | "reconsider";

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
  lastActivity: DateTime | null;
  avgWaitDays: number | null; // avg age of the awaiting-response profiles
  maxWaitDays: number | null; // oldest awaiting-response profile
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
        everClient: clientHere,
      });
    } else {
      if (!cur.recruiter && ev.submittedBy) cur.recruiter = ev.submittedBy;
      if (!cur.jobTitle && ev.jobTitle) cur.jobTitle = ev.jobTitle;
      if (!cur.consultant && ev.applicantName) cur.consultant = ev.applicantName;
      if (!cur.client && ev.client) cur.client = ev.client;
      if (!cur.submittedOn && ev.submittedOn) cur.submittedOn = ev.submittedOn;
      if (clientHere) cur.everClient = true;
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

/** Build one scorecard per client/vendor from raw submission events. */
export function computeClientScores(subs: SubmissionEvent[], now: DateTime = DateTime.now()): ClientScore[] {
  const cands = foldByCandidate(subs).filter((c) => c.everClient);

  const groups = new Map<string, { client: string; subs: ClientSubmission[] }>();
  for (const c of cands) {
    const clientName = (c.client || "").trim() || "(Unspecified client)";
    const key = clientKey(clientName);
    const stage = clientStage(c.status);
    const daysWaiting =
      stage === "submitted"
        ? Math.max(0, Math.round(now.diff(c.lastActivity ?? c.submittedOn ?? now, "days").days))
        : null;
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
    for (const s of g.subs) {
      counts[s.stage]++;
      if (s.lastActivity && (!lastActivity || s.lastActivity > lastActivity)) lastActivity = s.lastActivity;
      if (s.stage === "submitted" && s.daysWaiting != null) waits.push(s.daysWaiting);
    }
    const total = g.subs.length;
    const moved = counts.interview + counts.selected + counts.rejected + counts.hold;
    const responseRate = total ? moved / total : 0;
    const selectionRate = total ? counts.selected / total : 0;
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
      selectionRate,
      lastActivity,
      avgWaitDays: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      maxWaitDays: waits.length ? Math.max(...waits) : null,
      verdict,
      subs: g.subs,
    });
  }

  // Default order: most submissions first (biggest relationships on top).
  scores.sort((a, b) => b.total - a.total || b.moved - a.moved);
  return scores;
}

export type ClientSortKey = "total" | "responseRate" | "selected" | "waiting" | "reconsider";

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
    case "reconsider":
      return arr.sort(
        (a, b) => VERDICT_SEVERITY[a.verdict] - VERDICT_SEVERITY[b.verdict] || b.total - a.total
      );
    default:
      return arr.sort((a, b) => b.total - a.total || b.moved - a.moved);
  }
}
