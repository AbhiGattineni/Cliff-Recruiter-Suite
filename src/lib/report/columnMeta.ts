// Human-facing metadata for the report columns: groups, plain-English
// descriptions, and role-based presets. Used by the column picker UI.
// COLUMNS (types.ts) stays the single source of truth for column ORDER.

import { COLUMNS } from "./types";

export interface ColumnGroup {
  group: string;
  blurb: string;
  columns: { name: string; desc: string }[];
}

export const COLUMN_GROUPS: ColumnGroup[] = [
  {
    group: "Job overview",
    blurb: "High-level identity of each job.",
    columns: [
      { name: "Job Code", desc: "Ceipal job / requisition code." },
      { name: "Job Title", desc: "Position title." },
      { name: "Client", desc: "End client / account." },
      { name: "Job Status", desc: "Open, closed, on-hold, etc." },
      { name: "Job Created On", desc: "When the job was posted (EST)." },
      { name: "Job Age", desc: "Time elapsed since the job was created." },
      { name: "# Submissions to Vendor/Client", desc: "Candidates forwarded to the client/vendor (distinct from # Submitted, which is submitted to the account manager)." },
    ],
  },
  {
    group: "Job detail",
    blurb: "Requirement specifics — what recruiters need to source against.",
    columns: [
      { name: "Internal Screening Required", desc: "Whether internal screening is needed." },
      { name: "Recruitment Manager", desc: "Manager who owns the requisition." },
      { name: "Pay Rate/Salary", desc: "Budgeted rate or salary." },
      { name: "Experience", desc: "Experience required for the role." },
      { name: "Mandate Skills", desc: "Mandatory / primary skills." },
      { name: "Job Description", desc: "Full job description text." },
      { name: "Comments", desc: "Challenges, rate/location concerns, role expectations." },
    ],
  },
  {
    group: "Submission counts",
    blurb: "How many candidates sit in each stage, per job.",
    columns: [
      { name: "# Submitted Profiles", desc: "Total candidates on the job." },
      { name: "# Waiting for Evaluation", desc: "Awaiting req-owner evaluation." },
      { name: "# Internal Interview", desc: "In internal interview / screening." },
      { name: "# Selected Internally", desc: "Selected internally." },
      { name: "# Rejected Internally", desc: "Rejected internally." },
      { name: "# Submitted", desc: "Submitted to the account manager (not yet forwarded to client/vendor)." },
      { name: "# Other Statuses", desc: "Any other status." },
    ],
  },
  {
    group: "Time to submit",
    blurb: "How quickly the first three candidates were submitted.",
    columns: [
      { name: "Time Taken – 1st Submission", desc: "Job creation → 1st submission." },
      { name: "Time Taken – 2nd Submission", desc: "Job creation → 2nd submission." },
      { name: "Time Taken – 3rd Submission", desc: "Job creation → 3rd submission." },
    ],
  },
  {
    group: "Candidate pipeline",
    blurb: "Per-candidate detail and stage timestamps.",
    columns: [
      { name: "Candidate", desc: "Candidate name." },
      { name: "Recruiter (Submitted By)", desc: "Recruiter who submitted the candidate." },
      { name: "Submitted On", desc: "When the candidate was submitted." },
      { name: "Waiting for Evaluation (→ Req Owner)", desc: "Timestamp entering evaluation." },
      { name: "→ time to Internal Interview", desc: "Evaluation → internal interview." },
      { name: "Internal Interview (Screening)", desc: "Internal interview timestamp." },
      { name: "→ time to Internal Decision", desc: "Interview → internal decision." },
      { name: "Selected Internally", desc: "Selected-internally timestamp." },
      { name: "Rejected Internally", desc: "Rejected-internally timestamp." },
      { name: "→ time to Submitted", desc: "Decision → submitted to client." },
      { name: "Submitted (→ Client/Vendor)", desc: "Submitted-to-client timestamp." },
      { name: "Note", desc: "Row notes (overdue, data gaps)." },
    ],
  },
];

// name -> description, for tooltips elsewhere.
export const COLUMN_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  COLUMN_GROUPS.flatMap((g) => g.columns.map((c) => [c.name, c.desc]))
);

export interface ColumnPreset {
  key: string;
  label: string;
  blurb: string;
  columns: string[];
}

export const COLUMN_PRESETS: ColumnPreset[] = [
  {
    key: "overview",
    label: "Management overview",
    blurb: "Headline numbers only — a quick read on submissions per job.",
    columns: [
      "Job Code",
      "Job Title",
      "Client",
      "Job Status",
      "Job Age",
      "# Submitted Profiles",
      "# Submitted",
      "Time Taken – 1st Submission",
    ],
  },
  {
    key: "manager",
    label: "Manager detail",
    blurb: "Full job & requirement detail with stage counts and timings.",
    columns: [
      "Job Code",
      "Job Title",
      "Client",
      "Job Status",
      "Job Created On",
      "Job Age",
      "Recruitment Manager",
      "Pay Rate/Salary",
      "Experience",
      "Mandate Skills",
      "Comments",
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
    ],
  },
  {
    key: "recruiter",
    label: "Recruiter pipeline",
    blurb: "Per-candidate view with every stage timestamp.",
    columns: [
      "Job Code",
      "Job Title",
      "Client",
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
    ],
  },
  {
    key: "all",
    label: "Everything",
    blurb: "All columns.",
    columns: [...COLUMNS],
  },
];

// Given a chosen set, return them in canonical COLUMNS order.
export function orderColumns(chosen: Iterable<string>): string[] {
  const set = new Set(chosen);
  return COLUMNS.filter((c) => set.has(c));
}
