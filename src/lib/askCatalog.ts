// The data catalog for the Ask Anything assistant.
//
// This is the ONLY thing the query-plan LLM sees about the data — table names,
// column names, and column types. No rows, no numbers. It tells the model what
// it's allowed to ask for; it never gives it anything to hallucinate an answer
// from. The actual numbers come from askEngine.ts running the plan against
// real data, entirely in code.

export type ColumnType = "string" | "number" | "date" | "enum";

export interface CatalogColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** For enum columns: the known values, so the LLM picks a real one. */
  enumValues?: string[];
  /** Sensible to sum/average in an aggregate. */
  isMetric?: boolean;
  /** Sensible to group rows by. */
  isGroupable?: boolean;
}

export interface CatalogTable {
  key: string;
  label: string;
  description: string;
  columns: CatalogColumn[];
  /** The column filtered when a date range is given. Absent = pre-aggregated table; range scopes the aggregation instead. */
  dateField: string | null;
  defaultColumns: string[];
}

export const ASK_TABLES: CatalogTable[] = [
  {
    key: "submissions",
    label: "Submissions",
    description: "One row per candidate submission event — a profile sent for a requirement, at its current status.",
    dateField: "submittedOn",
    defaultColumns: ["applicantName", "jobCode", "client", "recruiter", "status", "submittedOn"],
    columns: [
      { key: "applicantName", label: "Candidate", type: "string" },
      { key: "jobCode", label: "Req ID", type: "string", isGroupable: true },
      { key: "jobTitle", label: "Requirement", type: "string", isGroupable: true },
      { key: "client", label: "Client", type: "string", isGroupable: true },
      { key: "recruiter", label: "Recruiter", type: "string", isGroupable: true },
      { key: "status", label: "Status", type: "string", isGroupable: true },
      { key: "submittedOn", label: "Submitted on", type: "date" },
      { key: "statusChangedOn", label: "Status changed", type: "date" },
      { key: "accountManager", label: "Account manager", type: "string", isGroupable: true },
    ],
  },
  {
    key: "requirements",
    label: "Requirements",
    description: "One row per job requirement/posting from the ATS.",
    dateField: "jobCreatedOn",
    defaultColumns: ["jobCode", "jobTitle", "client", "status", "submissionsCount", "jobCreatedOn"],
    columns: [
      { key: "jobCode", label: "Req ID", type: "string" },
      { key: "jobTitle", label: "Requirement", type: "string", isGroupable: true },
      { key: "client", label: "Client", type: "string", isGroupable: true },
      { key: "status", label: "Status", type: "enum", enumValues: ["Active", "On Hold", "Hold by Client", "Closed", "Draft", "Filled"], isGroupable: true },
      { key: "jobCreatedOn", label: "Created on", type: "date" },
      { key: "submissionsCount", label: "Submissions", type: "number", isMetric: true },
      { key: "recruitmentManager", label: "Recruitment manager", type: "string", isGroupable: true },
      { key: "assignedTo", label: "Assigned to", type: "string" },
      { key: "payRate", label: "Pay rate", type: "string" },
      { key: "experience", label: "Experience", type: "string" },
      { key: "mandateSkills", label: "Mandate skills", type: "string" },
    ],
  },
  {
    key: "recruiters",
    label: "Recruiter performance",
    description:
      "One row per recruiter — their submission counts and Performance Index. A date range scopes which activity counts, not a per-row date filter.",
    dateField: null,
    defaultColumns: ["recruiter", "requirementsWorked", "profiles", "clientSubmissions", "clientRate", "index"],
    columns: [
      { key: "recruiter", label: "Recruiter", type: "string" },
      { key: "requirementsWorked", label: "Requirements worked", type: "number", isMetric: true },
      { key: "profiles", label: "Profiles submitted", type: "number", isMetric: true },
      { key: "clientSubmissions", label: "Client/vendor submissions", type: "number", isMetric: true },
      { key: "clientRatePct", label: "Client rate %", type: "number", isMetric: true },
      { key: "progressRatePct", label: "Reached interview+ %", type: "number", isMetric: true },
      { key: "index", label: "Performance index", type: "number", isMetric: true },
    ],
  },
  {
    key: "clients",
    label: "Clients",
    description:
      "One row per client/vendor — requirements they've sent us and how our submissions to them are going. A date range scopes the aggregation.",
    dateField: null,
    defaultColumns: ["client", "requirementsReceived", "requirementsActive", "submissionsSent", "responseRatePct", "verdict"],
    columns: [
      { key: "client", label: "Client", type: "string" },
      { key: "requirementsReceived", label: "Requirements received", type: "number", isMetric: true },
      { key: "requirementsActive", label: "Active requirements", type: "number", isMetric: true },
      { key: "requirementsOnHold", label: "On-hold requirements", type: "number", isMetric: true },
      { key: "submissionsSent", label: "Submissions sent", type: "number", isMetric: true },
      { key: "responseRatePct", label: "Response rate %", type: "number", isMetric: true },
      { key: "selected", label: "Selected/offers", type: "number", isMetric: true },
      {
        key: "verdict",
        label: "Verdict",
        type: "enum",
        enumValues: ["prioritize", "watch", "reconsider", "unrated"],
        isGroupable: true,
      },
    ],
  },
  {
    key: "resumes",
    label: "Resume assessments",
    description: "One row per resume fit assessment generated in Resume Parsing.",
    dateField: "createdAt",
    defaultColumns: ["candidateName", "fitScore", "rating", "aiGeneratedPercent", "currentTitle", "createdAt"],
    columns: [
      { key: "candidateName", label: "Candidate", type: "string" },
      { key: "fitScore", label: "Fit score", type: "number", isMetric: true },
      { key: "rating", label: "Rating", type: "enum", enumValues: ["Strong", "Moderate", "Weak"], isGroupable: true },
      { key: "aiGeneratedPercent", label: "AI-generated %", type: "number", isMetric: true },
      { key: "currentTitle", label: "Current title", type: "string", isGroupable: true },
      { key: "location", label: "Location", type: "string", isGroupable: true },
      { key: "experienceYears", label: "Experience (yrs)", type: "number", isMetric: true },
      { key: "githubScore", label: "GitHub portfolio score", type: "number", isMetric: true },
      { key: "linkedinVerdict", label: "LinkedIn verdict", type: "string", isGroupable: true },
      { key: "provider", label: "LLM provider", type: "string", isGroupable: true },
      { key: "createdAt", label: "Assessed on", type: "date" },
    ],
  },
  {
    key: "timesheets",
    label: "Timesheets",
    description: "One row per requirement logged on a timesheet day — hours a recruiter booked against one requirement on one date.",
    dateField: "date",
    defaultColumns: ["date", "recruiter", "jobCode", "client", "hours"],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "recruiter", label: "Recruiter", type: "string", isGroupable: true },
      { key: "jobCode", label: "Req ID", type: "string", isGroupable: true },
      { key: "jobTitle", label: "Requirement", type: "string", isGroupable: true },
      { key: "client", label: "Client", type: "string", isGroupable: true },
      { key: "hours", label: "Hours", type: "number", isMetric: true },
      { key: "notes", label: "Notes", type: "string" },
    ],
  },
];

export function tableByKey(key: string): CatalogTable | undefined {
  return ASK_TABLES.find((t) => t.key === key);
}

export function columnByKey(table: CatalogTable, key: string): CatalogColumn | undefined {
  return table.columns.find((c) => c.key === key);
}

/** Compact text form of the catalog — what actually gets sent to the LLM. */
export function catalogAsPrompt(): string {
  return ASK_TABLES.map((t) => {
    const cols = t.columns
      .map((c) => `${c.key} (${c.type}${c.enumValues ? `: ${c.enumValues.join("/")}` : ""})`)
      .join(", ");
    return `- ${t.key}: ${t.description}\n  columns: ${cols}\n  date field: ${t.dateField ?? "none (range scopes aggregation)"}`;
  }).join("\n");
}

/** A handful of curated prompts spanning every table, shown as quick-start chips. */
export const SUGGESTED_PROMPTS: string[] = [
  "Requirements received per client this month",
  "Recruiters with hours logged but no client submissions this week",
  "Clients we should reconsider working with",
  "Candidates rated Strong with a high AI-generated score",
  "Which recruiters are below index 40 this month",
  "Open requirements with zero submissions",
  "Submissions by status this week",
  "Top 10 clients by requirements received, all time",
];
