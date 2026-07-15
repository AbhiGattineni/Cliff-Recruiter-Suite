// Canonical record shapes and the exact output column list for the report.

import { DateTime } from "luxon";
import { CanonicalStatus } from "./columns";

export interface JobRecord {
  jobCode: string;
  jobTitle: string;
  client: string;
  jobStatus: string;
  jobCreatedOn: DateTime | null;
  numOfSubmissions: number | null; // ATS "#Of Submissions"
  internalScreeningRequired: string;
  recruitmentManager: string;
  payRate: string;
  jobModifiedOn: DateTime | null;
  jobDescription: string;
  experience: string;
  mandateSkills: string;
  comments: string;
  assignedTo: string; // recruiter(s) assigned to the requirement
}

// One raw submission-activity event (a single status change for a candidate).
export interface SubmissionEvent {
  jobCode: string;
  jobTitle: string;
  applicantName: string;
  submittedBy: string;
  client: string;
  submissionStatus: string;
  statusChangedOn: DateTime | null;
  submittedOn: DateTime | null;
  accountManager: string;
  jobCreatedOn: DateTime | null; // job's created date (Ceipal submissions report carries this)
}

// A candidate on a job = all their events folded together.
export interface CandidateAgg {
  jobCode: string;
  applicantName: string;
  submittedBy: string;
  accountManager: string;
  client: string;
  submittedOn: DateTime | null;
  // Latest timestamp seen for each mapped status.
  statusTs: Partial<Record<CanonicalStatus, DateTime | null>>;
  currentBucket: CanonicalStatus; // status with the latest Status Changed On
  hasClientVendor: boolean; // ever reached any client/vendor-side status
}

// The exact, ordered output columns (headers in row 1).
export const COLUMNS: string[] = [
  "Job Code",
  "Job Title",
  "Client",
  "Job Status",
  "Job Created On",
  "Job Age",
  "# Submissions to Vendor/Client",
  "# Submitted Profiles",
  "# Waiting for Evaluation",
  "# Internal Interview",
  "# Selected Internally",
  "# Rejected Internally",
  "# Submitted",
  "# Other Statuses",
  "Time Taken – 1st Submission",
  "Time Taken – 2nd Submission",
  "Time Taken – 3rd Submission",
  "Internal Screening Required",
  "Recruitment Manager",
  "Pay Rate/Salary",
  "Experience",
  "Mandate Skills",
  "Job Description",
  "Comments",
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
  "Note",
];

export interface ReportRow {
  cells: Record<string, string>; // keyed by COLUMNS entries
  na: boolean; // generic NA row -> peach shading
  red: boolean; // 0-submission overdue -> red shading
  internalOnly: boolean; // has submissions but none sent to client/vendor -> amber
}

export interface ReportResult {
  rows: ReportRow[];
  generatedAt: DateTime | null; // "now" (latest timestamp across both files)
  jobCount: number;
  candidateCount: number;
  redCount: number;
  internalOnlyCount: number; // jobs with submissions but none sent to client/vendor
  warnings: string[];
}
