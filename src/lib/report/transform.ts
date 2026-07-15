// The report transform: canonical records -> one flat row per candidate
// submission, with job-level fields repeated across a job's rows.
// Implements the full spec (status pivot, inter-status durations, stage counts,
// time-taken, job age, NA rows, sort, and the red overdue rule).

import { DateTime } from "luxon";
import { JobRecord, SubmissionEvent, CandidateAgg, ReportRow, ReportResult } from "./types";
import { CanonicalStatus, normalizeStatus, isClientVendorStatus } from "./columns";
import { fmtTs, fmtDuration, maxDt, minDt, DASH } from "./dates";
import { collectTimestamps } from "./parseSource";

const NA = "NA";

// ---- candidate aggregation -------------------------------------------------

function firstNonEmpty(cur: string, next: string): string {
  return cur && cur.trim() ? cur : next || "";
}

function groupCandidates(subs: SubmissionEvent[]): Map<string, CandidateAgg[]> {
  // jobCode -> (applicantKey -> aggregate)
  const byJob = new Map<string, Map<string, CandidateAgg & { _bestTs: DateTime | null }>>();

  for (const ev of subs) {
    const jobCode = ev.jobCode || "(unknown)";
    const applicant = ev.applicantName || "(unknown)";
    const key = applicant.toLowerCase().trim();

    if (!byJob.has(jobCode)) byJob.set(jobCode, new Map());
    const jobMap = byJob.get(jobCode)!;

    let agg = jobMap.get(key);
    if (!agg) {
      agg = {
        jobCode,
        applicantName: applicant,
        submittedBy: "",
        accountManager: "",
        client: "",
        submittedOn: null,
        statusTs: {},
        currentBucket: "OTHER",
        hasClientVendor: false,
        _bestTs: null,
      };
      jobMap.set(key, agg);
    }

    agg.submittedBy = firstNonEmpty(agg.submittedBy, ev.submittedBy);
    agg.accountManager = firstNonEmpty(agg.accountManager, ev.accountManager);
    agg.client = firstNonEmpty(agg.client, ev.client);
    agg.submittedOn = minDt([agg.submittedOn, ev.submittedOn]);
    if (isClientVendorStatus(ev.submissionStatus)) agg.hasClientVendor = true;

    const bucket = normalizeStatus(ev.submissionStatus);

    // Record the latest timestamp for a mapped status.
    if (bucket !== "OTHER" && ev.statusChangedOn) {
      const prev = agg.statusTs[bucket] ?? null;
      agg.statusTs[bucket] = maxDt([prev, ev.statusChangedOn]);
    }

    // Track the candidate's current (latest) status for stage counts.
    if (ev.statusChangedOn) {
      if (!agg._bestTs || ev.statusChangedOn.toMillis() >= agg._bestTs.toMillis()) {
        agg._bestTs = ev.statusChangedOn;
        agg.currentBucket = bucket;
      }
    } else if (!agg._bestTs) {
      // No timestamp anywhere yet — fall back to the most recent event seen.
      agg.currentBucket = bucket;
    }
  }

  const out = new Map<string, CandidateAgg[]>();
  for (const [jobCode, jobMap] of byJob) {
    out.set(jobCode, Array.from(jobMap.values()).map(({ _bestTs, ...rest }) => rest));
  }
  return out;
}

// ---- red overdue rule ------------------------------------------------------

function isOverdue(jobCreatedOn: DateTime | null, now: DateTime | null): boolean {
  if (!jobCreatedOn || !now) return false;
  const twoPM = jobCreatedOn.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const sixPM = jobCreatedOn.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const deadline = jobCreatedOn.toMillis() <= twoPM.toMillis() ? sixPM : sixPM.plus({ days: 1 });
  return now.toMillis() >= deadline.toMillis();
}

// ---- numeric job-code sort -------------------------------------------------

function jobNum(code: string): number {
  const digits = String(code).replace(/\D/g, "");
  if (!digits) return Number.NEGATIVE_INFINITY;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function normTitle(t: string): string {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---- main ------------------------------------------------------------------

export function buildReport(jobs: JobRecord[], subs: SubmissionEvent[]): ReportResult {
  const warnings: string[] = [];
  const now = maxDt(collectTimestamps(jobs, subs));
  if (!now) warnings.push("No timestamps found in the sources — Job Age and overdue checks are unavailable.");

  const jobsMap = new Map<string, JobRecord>();
  for (const j of jobs) if (!jobsMap.has(j.jobCode)) jobsMap.set(j.jobCode, j);

  // The Ceipal submissions report carries JobCreatedOn per row; use it as the
  // job-created date when there's no separate job-postings record (the
  // job-duration report has no Job Code to join on).
  const subJobCreated = new Map<string, DateTime>();
  for (const s of subs) {
    if (s.jobCode && s.jobCreatedOn && !subJobCreated.has(s.jobCode)) {
      subJobCreated.set(s.jobCode, s.jobCreatedOn);
    }
  }

  const candByJob = groupCandidates(subs);

  // Job records that carry a code (e.g. an uploaded postings export) vs. records
  // matched by title only (the Ceipal job-duration report has no Job Code).
  const jobsByTitle = new Map<string, JobRecord>();
  for (const j of jobs) {
    const t = normTitle(j.jobTitle);
    if (t && !jobsByTitle.has(t)) jobsByTitle.set(t, j);
  }
  const titleByCode = new Map<string, string>();
  for (const s of subs) {
    if (s.jobCode && s.jobTitle && !titleByCode.has(s.jobCode)) titleByCode.set(s.jobCode, s.jobTitle);
  }

  // Union of job codes from postings + submissions.
  const allCodes = new Set<string>([...jobsMap.keys(), ...candByJob.keys()]);
  const sortedCodes = Array.from(allCodes).sort((a, b) => jobNum(b) - jobNum(a) || b.localeCompare(a));

  const rows: ReportRow[] = [];
  let candidateCount = 0;
  let redCount = 0;
  let internalOnlyCount = 0;

  for (const code of sortedCodes) {
    const job = jobsMap.get(code);
    const cands = (candByJob.get(code) ?? []).slice();
    const M = cands.length;
    // Enrich from the job-duration report, matched by job title.
    const submissionTitle = titleByCode.get(code) || subs.find((s) => s.jobCode === code)?.jobTitle || "";
    const jobDur = job ? undefined : jobsByTitle.get(normTitle(submissionTitle));
    const effJob = job ?? jobDur;
    const jobCreatedOn = job?.jobCreatedOn ?? subJobCreated.get(code) ?? jobDur?.jobCreatedOn ?? null;
    const jobAge = fmtDuration(jobCreatedOn, now);

    // Job-level fields shared by every row of this job. Fields only present in a
    // full postings record (status/pay rate/screening) stay NA for title-only jobs.
    const jobBase: Record<string, string> = {
      "Job Code": code,
      "Job Title": effJob?.jobTitle || submissionTitle || "",
      Client: job?.client || cands[0]?.client || "",
      "Job Status": job ? job.jobStatus || "" : NA,
      "Job Created On": fmtTs(jobCreatedOn),
      "Job Age": jobAge,
      "Internal Screening Required": job ? job.internalScreeningRequired : NA,
      "Recruitment Manager": effJob?.recruitmentManager || NA,
      "Pay Rate/Salary": job ? job.payRate : NA,
      Experience: effJob?.experience || NA,
      "Mandate Skills": effJob?.mandateSkills || NA,
      "Job Description": effJob?.jobDescription || NA,
      Comments: effJob?.comments || NA,
    };

    if (M === 0) {
      // --- NA row cases ---
      const postingsCount = job?.numOfSubmissions ?? 0;
      const cells: Record<string, string> = { ...jobBase };
      // candidate detail = NA
      for (const c of [
        "Candidate",
        "Recruiter (Submitted By)",
        "Submitted On",
        "Waiting for Evaluation (→ Req Owner)",
        "→ time to Internal Interview",
        "Internal Interview (Screening)",
        "→ time to Internal Decision",
        "Selected Internally",
        "Rejected Internally",
        "→ time to Submitted",
        "Submitted (→ Client/Vendor)",
      ]) {
        cells[c] = NA;
      }
      cells["Time Taken – 1st Submission"] = DASH;
      cells["Time Taken – 2nd Submission"] = DASH;
      cells["Time Taken – 3rd Submission"] = DASH;

      let red = false;
      if (postingsCount > 0) {
        // Submissions exist per ATS but candidate details are absent.
        cells["# Submitted Profiles"] = String(postingsCount);
        setStageCounts(cells, null); // NA
          cells["Note"] = `${postingsCount} profiles submitted – candidate details not in provided files`;
      } else {
        // True zero-submission job.
        cells["# Submitted Profiles"] = "0";
        setStageCounts(cells, { WAITING: 0, INTERNAL_INTERVIEW: 0, SELECTED: 0, REJECTED: 0, SUBMITTED: 0, CLIENT_VENDOR: 0, OTHER: 0 });
        red = isOverdue(jobCreatedOn, now);
        cells["Note"] = red
          ? "No submissions — Overdue (no submission by office deadline)"
          : "No submissions";
      }
      if (red) redCount++;
      rows.push({ cells, na: true, red, internalOnly: false });
      continue;
    }

    // --- Job with candidates ---
    // "Internal only" = has submissions but not a single profile ever reached the
    // client/vendor side (still entirely in our field).
    const internalOnly = !cands.some((c) => c.hasClientVendor);
    if (internalOnly) internalOnlyCount++;
    const counts = countBuckets(cands);
    // Order candidates by Submitted On, earliest first (nulls last).
    const ordered = cands.slice().sort((a, b) => {
      const av = a.submittedOn?.toMillis() ?? Number.POSITIVE_INFINITY;
      const bv = b.submittedOn?.toMillis() ?? Number.POSITIVE_INFINITY;
      return av - bv;
    });

    const timeTaken = [0, 1, 2].map((i) =>
      ordered[i] ? fmtDuration(jobCreatedOn, ordered[i].submittedOn) : DASH
    );

    const postings = job?.numOfSubmissions ?? null;
    const extraNote =
      postings != null && postings > M ? `ATS shows ${postings} submissions; ${M} in provided export` : "";
    if (extraNote) warnings.push(`Job Code ${code}: ${extraNote}.`);

    ordered.forEach((cand, idx) => {
      candidateCount++;
      const cells: Record<string, string> = { ...jobBase };
      cells["# Submitted Profiles"] = String(M);
      setStageCounts(cells, counts);
      cells["Time Taken – 1st Submission"] = timeTaken[0];
      cells["Time Taken – 2nd Submission"] = timeTaken[1];
      cells["Time Taken – 3rd Submission"] = timeTaken[2];

      const ts = cand.statusTs;
      const waiting = ts.WAITING ?? null;
      const interview = ts.INTERNAL_INTERVIEW ?? null;
      const selected = ts.SELECTED ?? null;
      const rejected = ts.REJECTED ?? null;
      // The "Submitted (→ Client/Vendor)" stage is the client/vendor submission,
      // not the bare "submitted to account manager".
      const clientVendor = ts.CLIENT_VENDOR ?? null;

      const decisionTs = maxDt([selected, rejected]); // whichever exists (later if both)
      const decisionAnchor = interview ?? waiting; // fall back to waiting if no interview
      const submittedAnchor = selected ?? rejected ?? interview ?? waiting;

      cells["Candidate"] = cand.applicantName;
      cells["Recruiter (Submitted By)"] = cand.submittedBy || "";
      cells["Submitted On"] = fmtTs(cand.submittedOn);
      cells["Waiting for Evaluation (→ Req Owner)"] = fmtTs(waiting);
      cells["→ time to Internal Interview"] = fmtDuration(waiting, interview);
      cells["Internal Interview (Screening)"] = fmtTs(interview);
      cells["→ time to Internal Decision"] = decisionTs ? fmtDuration(decisionAnchor, decisionTs) : DASH;
      cells["Selected Internally"] = fmtTs(selected);
      cells["Rejected Internally"] = fmtTs(rejected);
      cells["→ time to Submitted"] = clientVendor ? fmtDuration(submittedAnchor, clientVendor) : DASH;
      cells["Submitted (→ Client/Vendor)"] = fmtTs(clientVendor);
      cells["Note"] = idx === 0 ? extraNote : "";

      rows.push({ cells, na: false, red: false, internalOnly });
    });
  }

  return {
    rows,
    generatedAt: now,
    jobCount: sortedCodes.length,
    candidateCount,
    redCount,
    internalOnlyCount,
    warnings,
  };
}

function countBuckets(cands: CandidateAgg[]): Record<CanonicalStatus, number> {
  const counts: Record<CanonicalStatus, number> = {
    WAITING: 0,
    INTERNAL_INTERVIEW: 0,
    SELECTED: 0,
    REJECTED: 0,
    SUBMITTED: 0,
    CLIENT_VENDOR: 0,
    OTHER: 0,
  };
  for (const c of cands) counts[c.currentBucket]++;
  return counts;
}

function setStageCounts(
  cells: Record<string, string>,
  counts: Record<CanonicalStatus, number> | null
) {
  cells["# Waiting for Evaluation"] = counts ? String(counts.WAITING) : NA;
  cells["# Internal Interview"] = counts ? String(counts.INTERNAL_INTERVIEW) : NA;
  cells["# Selected Internally"] = counts ? String(counts.SELECTED) : NA;
  cells["# Rejected Internally"] = counts ? String(counts.REJECTED) : NA;
  cells["# Submitted"] = counts ? String(counts.SUBMITTED) : NA;
  cells["# Submissions to Vendor/Client"] = counts ? String(counts.CLIENT_VENDOR) : NA;
  cells["# Other Statuses"] = counts ? String(counts.OTHER) : NA;
}
