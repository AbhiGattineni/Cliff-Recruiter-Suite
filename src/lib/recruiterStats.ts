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
  submittedOn: DateTime | null; // time of submission
  jobCreatedOn: DateTime | null; // time of job posting
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

// Target client/vendor submissions per assigned requirement.
export const TARGET_PER_ASSIGNED = 2;

// Weights for the composite Performance Index (sum = 1). The dominant metric is
// hitting the target of TARGET_PER_ASSIGNED client/vendor submissions per assigned
// requirement.
export const INDEX_WEIGHTS = {
  clientPerAssigned: 0.45, // client/vendor submissions vs target (2 per assigned requirement)
  clientRate: 0.2, // profiles reaching a client/vendor submission
  progressRate: 0.15, // profiles reaching internal interview or beyond
  volume: 0.12, // profiles submitted, normalised to the busiest recruiter
  coverage: 0.08, // distinct requirements worked, normalised to the widest
} as const;

// Internal funnel stage — for ORDERING and COLOUR only, never shown as a label.
type Funnel = "client" | "selected" | "interview" | "waiting" | "submitted" | "rejected" | "unknown";

const FUNNEL_RANK: Record<Funnel, number> = {
  client: 0,
  selected: 1,
  interview: 2,
  waiting: 3,
  submitted: 4,
  rejected: 5,
  unknown: 6,
};

const FUNNEL_COLOR: Record<Funnel, string> = {
  client: "#1e7e34",
  selected: "#12b886",
  interview: "#e0a800",
  waiting: "#4c8bf5",
  submitted: "#8aa4c8",
  rejected: "#c92a2a",
  unknown: "", // filled from PALETTE
};

// Distinct colours for statuses that don't match a known funnel stage.
const PALETTE = ["#7048e8", "#e8590c", "#0ca678", "#f06595", "#495057", "#a61e4d", "#1098ad", "#d9480f"];

/** Map a raw status to an internal funnel stage (scoring/ordering only). */
export function funnelOf(raw: string): Funnel {
  const n = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return "unknown";
  if (
    n.includes("clientsubmission") ||
    n.includes("vendorsubmission") ||
    n.includes("submittedtoclient") ||
    n.includes("submittedtovendor") ||
    n.includes("submittedtoendclient") ||
    n.includes("submittedtoenduser") ||
    n.includes("clientsubmitted") ||
    n.includes("vendorsubmitted")
  ) {
    return "client";
  }
  if (n.includes("rejectedinternally") || n.includes("internalreject") || n === "rejected") return "rejected";
  if (n.includes("selectedinternally") || n.includes("internalselect") || n === "selected") return "selected";
  if (n.includes("internalinterview") || n.includes("internalscreening")) return "interview";
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

// Merged display label for the client-funnel statuses (client & vendor submissions
// are treated as the same status per the user's rule). All other statuses keep
// their own verbatim name.
const CLIENT_LABEL = "Client / Vendor Submission";

/** Identity (de-dupe key + display label + funnel) for a raw status. */
function statusIdentity(raw: string): { key: string; label: string; funnel: Funnel } {
  const funnel = funnelOf(raw);
  if (funnel === "client") return { key: "__client__", label: CLIENT_LABEL, funnel };
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
  assignedCount: number; // distinct requirements assigned to this recruiter
  clientTarget: number; // target client/vendor submissions (2 × target base)
  index: number; // 0–100 composite Performance Index
  indexParts: {
    clientPerAssigned: number;
    clientRate: number;
    progressRate: number;
    volume: number;
    coverage: number;
  };
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
  jobCreatedOn: DateTime | null;
}

/** Fold raw events into one record per candidate (latest status by timestamp wins). */
function foldCandidates(subs: SubmissionEvent[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const ev of subs) {
    const applicant = (ev.applicantName || "").toLowerCase().trim() || "(unknown)";
    const jobCode = ev.jobCode || "(unknown)";
    const key = `${jobCode}||${applicant}`;
    const ts = ev.statusChangedOn?.toMillis() ?? ev.submittedOn?.toMillis() ?? 0;
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
        jobCreatedOn: ev.jobCreatedOn ?? null,
      });
    } else {
      if (!cur.recruiter && ev.submittedBy) cur.recruiter = ev.submittedBy;
      if (!cur.jobTitle && ev.jobTitle) cur.jobTitle = ev.jobTitle;
      if (!cur.consultant && ev.applicantName) cur.consultant = ev.applicantName;
      if (!cur.client && ev.client) cur.client = ev.client;
      if (!cur.submittedOn && ev.submittedOn) cur.submittedOn = ev.submittedOn;
      if (!cur.jobCreatedOn && ev.jobCreatedOn) cur.jobCreatedOn = ev.jobCreatedOn;
      if (ts >= cur.ts) {
        cur.ts = ts;
        cur.status = ev.submissionStatus || "";
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

/** Aggregate raw submission events into per-recruiter performance, ranked by index. */
export function computeRecruiterStats(subs: SubmissionEvent[], jobs: JobRecord[] = []): RecruiterStatsResult {
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
    let clientCount = 0;
    let progressCount = 0;
    for (const [key, n] of p.counts) {
      const f = funnelByKey.get(key)!;
      if (f === "client") clientCount += n;
      if (f === "client" || f === "selected" || f === "interview") progressCount += n;
      counts[labelByKey.get(key) ?? key] = n;
    }
    const profiles = p.profiles || 1;
    const rows = p.rows
      .slice()
      .sort((a, b) => (b.submittedOn?.toMillis() ?? 0) - (a.submittedOn?.toMillis() ?? 0));
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
      clientCount,
      clientRate: clientCount / profiles,
      progressRate: progressCount / profiles,
      assignedCount,
      rows,
      jobGroups,
      noSubCount,
    };
  });

  const maxProfiles = Math.max(1, ...prelim.map((x) => x.profiles));
  const maxReqs = Math.max(1, ...prelim.map((x) => x.requirements));
  const W = INDEX_WEIGHTS;

  const stats: RecruiterStat[] = prelim.map((x) => {
    const volume = x.profiles / maxProfiles;
    const coverage = x.requirements / maxReqs;
    // Target = 2 client/vendor submissions per assigned requirement. When there's
    // no Assigned-To data, fall back to the requirements the recruiter worked.
    const targetBase = x.assignedCount > 0 ? x.assignedCount : x.requirements;
    const clientTarget = TARGET_PER_ASSIGNED * targetBase;
    const clientPerAssigned = clientTarget > 0 ? Math.min(1, x.clientCount / clientTarget) : 0;
    const indexParts = {
      clientPerAssigned,
      clientRate: x.clientRate,
      progressRate: x.progressRate,
      volume,
      coverage,
    };
    const index = Math.round(
      100 *
        (W.clientPerAssigned * clientPerAssigned +
          W.clientRate * x.clientRate +
          W.progressRate * x.progressRate +
          W.volume * volume +
          W.coverage * coverage)
    );
    return { ...x, clientTarget, index, indexParts };
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

/** A plain-English summary of a recruiter's current pipeline, using real status names. */
export function statusSentence(s: RecruiterStat, statuses: StatusMeta[]): string {
  const parts = statuses
    .filter((st) => (s.counts[st.label] ?? 0) > 0)
    .map((st) => `${s.counts[st.label]} in ${st.label}`);
  if (parts.length === 0) return `${s.name} has no submissions.`;
  return `${s.name} submitted ${s.profiles} profile${s.profiles === 1 ? "" : "s"} — ${parts.join(", ")}.`;
}
