import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  sanitizePlan,
  runPlan,
  submissionsToRows,
  requirementsToRows,
  timesheetsToRows,
  recruitersToRows,
  clientsToRows,
  AskPlan,
} from "./askEngine";
import { SubmissionEvent, JobRecord } from "./report/types";
import { TimesheetEntry } from "./timesheets";

const ev = (over: Partial<SubmissionEvent>): SubmissionEvent => ({
  jobCode: "J1",
  jobTitle: "Dev",
  applicantName: "Cand",
  submittedBy: "Rec",
  client: "Acme",
  submissionStatus: "Submitted To Client",
  statusChangedOn: DateTime.fromISO("2026-08-04"),
  submittedOn: DateTime.fromISO("2026-08-01"),
  accountManager: "AM",
  jobCreatedOn: DateTime.fromISO("2026-07-01"),
  ...over,
});

const job = (over: Partial<JobRecord>): JobRecord => ({
  jobCode: "J1", jobTitle: "T", client: "Acme", jobStatus: "Active", jobCreatedOn: DateTime.fromISO("2026-07-01"),
  numOfSubmissions: 0, internalScreeningRequired: "", recruitmentManager: "", payRate: "", jobModifiedOn: null,
  jobDescription: "", experience: "", mandateSkills: "", comments: "", assignedTo: "",
  ...over,
});

const emptyPlan = (table: string): AskPlan => ({
  table, title: "T", filters: [], dateFrom: null, dateTo: null, groupBy: null,
  metric: { field: null, agg: "count" }, columns: [], sort: null, limit: 500, chart: "none",
});

describe("sanitizePlan", () => {
  it("falls back to a known table when the LLM names one that doesn't exist", () => {
    const p = sanitizePlan({ table: "not_a_real_table" });
    expect(p.table).toBe("submissions");
  });

  it("drops filters on fields that aren't in the table's catalog", () => {
    const p = sanitizePlan({ table: "submissions", filters: [{ field: "madeUpField", op: "eq", value: "x" }] });
    expect(p.filters).toHaveLength(0);
  });

  it("keeps a valid filter", () => {
    const p = sanitizePlan({ table: "submissions", filters: [{ field: "client", op: "eq", value: "IBM" }] });
    expect(p.filters).toEqual([{ field: "client", op: "eq", value: "IBM" }]);
  });

  it("rejects a groupBy field that doesn't exist on the table", () => {
    const p = sanitizePlan({ table: "submissions", groupBy: "nonsense" });
    expect(p.groupBy).toBeNull();
  });

  it("falls back to the table's default columns when none are given", () => {
    const p = sanitizePlan({ table: "requirements", columns: [] });
    expect(p.columns.length).toBeGreaterThan(0);
    expect(p.columns).toContain("jobCode");
  });

  it("rejects a malformed date instead of trusting it", () => {
    const p = sanitizePlan({ table: "submissions", dateFrom: "not-a-date", dateTo: "2026-08-04" });
    expect(p.dateFrom).toBeNull();
    expect(p.dateTo).toBe("2026-08-04");
  });

  it("caps a runaway limit", () => {
    const p = sanitizePlan({ table: "submissions", limit: 999999 });
    expect(p.limit).toBeLessThanOrEqual(2000);
  });
});

describe("submissionsToRows + runPlan filtering", () => {
  // Distinct applicantName per event — submissionsToRows folds a candidate's
  // status-change history to one row per (job, candidate), so these need to
  // read as three different candidates to stay three different submissions.
  const rows = submissionsToRows([
    ev({ applicantName: "A1", client: "IBM", submissionStatus: "Submitted To Client", submittedOn: DateTime.fromISO("2026-08-01") }),
    ev({ applicantName: "A2", client: "IBM", submissionStatus: "Rejected", submittedOn: DateTime.fromISO("2026-08-02") }),
    ev({ applicantName: "A3", client: "Apple", submissionStatus: "Submitted To Client", submittedOn: DateTime.fromISO("2026-07-01") }),
  ]);

  it("filters by an eq clause", () => {
    const plan = sanitizePlan({ ...emptyPlan("submissions"), filters: [{ field: "client", op: "eq", value: "IBM" }] });
    const res = runPlan(rows, plan);
    expect(res.totalRows).toBe(2);
  });

  it("filters by a date range on the table's date field", () => {
    const plan = sanitizePlan({ ...emptyPlan("submissions"), dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    const res = runPlan(rows, plan);
    expect(res.totalRows).toBe(2);
  });

  it("groups and counts", () => {
    const plan = sanitizePlan({ ...emptyPlan("submissions"), groupBy: "client" });
    const res = runPlan(rows, plan);
    expect(res.grouped).toBe(true);
    expect(res.rows).toEqual(
      expect.arrayContaining([{ label: "IBM", value: 2 }, { label: "Apple", value: 1 }])
    );
  });

  it("is case-insensitive on eq and contains", () => {
    const plan = sanitizePlan({ ...emptyPlan("submissions"), filters: [{ field: "client", op: "eq", value: "ibm" }] });
    expect(runPlan(rows, plan).totalRows).toBe(2);
  });

  it("folds a candidate's status-change history on one job into a single row at their current status", () => {
    const folded = submissionsToRows([
      ev({ submissionStatus: "Waiting for Evaluation", submittedOn: DateTime.fromISO("2026-08-06"), statusChangedOn: DateTime.fromISO("2026-08-06") }),
      ev({ submissionStatus: "Submitted To Client", submittedOn: DateTime.fromISO("2026-08-06"), statusChangedOn: DateTime.fromISO("2026-08-07") }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].status).toBe("Submitted To Client");
    expect(folded[0].submittedOn).toBe("2026-08-06");
  });

  it("keeps a candidate's events on two different jobs as two separate rows", () => {
    const folded = submissionsToRows([ev({ jobCode: "J1" }), ev({ jobCode: "J2" })]);
    expect(folded).toHaveLength(2);
  });
});

describe("runPlan grouped metric aggregation", () => {
  it("sums a numeric field per group instead of counting", () => {
    const rows = timesheetsToRows([
      entry("Guru", [{ jobCode: "J1", jobTitle: "T", client: "C", hours: 3 }]),
      entry("Guru", [{ jobCode: "J1", jobTitle: "T", client: "C", hours: 2 }]),
      entry("Juhi", [{ jobCode: "J2", jobTitle: "T2", client: "C2", hours: 5 }]),
    ]);
    const plan = sanitizePlan({
      ...emptyPlan("timesheets"),
      groupBy: "recruiter",
      metric: { field: "hours", agg: "sum" },
    });
    const res = runPlan(rows, plan);
    expect(res.rows).toEqual(expect.arrayContaining([{ label: "Guru", value: 5 }, { label: "Juhi", value: 5 }]));
  });

  it("caps chart slices and buckets the remainder as Other", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ev({ applicantName: `Cand${i}`, client: `Client${i}`, submittedOn: DateTime.fromISO("2026-08-01") })
    );
    const rows = submissionsToRows(many);
    const plan = sanitizePlan({ ...emptyPlan("submissions"), groupBy: "client", chart: "pie" });
    const res = runPlan(rows, plan);
    expect(res.chartData!.length).toBe(8);
    expect(res.chartData!.some((d) => d.label === "Other")).toBe(true);
  });
});

function entry(name: string, jobs: TimesheetEntry["jobs"]): TimesheetEntry {
  return {
    id: "e", uid: "u", email: `${name}@x.com`, displayName: name, date: "2026-08-04",
    hours: jobs.reduce((s, j) => s + j.hours, 0), jobs, workedOn: "", createdAt: null, updatedAt: null,
  };
}

describe("requirementsToRows", () => {
  it("flattens a job record to a catalog row", () => {
    const rows = requirementsToRows([job({ jobCode: "CS-1", client: "IBM", jobStatus: "On Hold" })]);
    expect(rows[0]).toMatchObject({ jobCode: "CS-1", client: "IBM", status: "On Hold" });
  });
});

describe("recruitersToRows / clientsToRows", () => {
  it("produces one row per recruiter with the same index the performance page would show", () => {
    const rows = recruitersToRows(
      [ev({ submittedBy: "Guru", submissionStatus: "Submitted To Client" })],
      [job({})],
      null,
      null
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recruiter).toBe("Guru");
    expect(typeof rows[0].index).toBe("number");
  });

  it("joins requirements-received with submission response stats by client", () => {
    const rows = clientsToRows(
      [ev({ client: "IBM", submissionStatus: "Submitted To Client" })],
      [job({ client: "IBM" }), job({ client: "IBM", jobCode: "J2" })],
      null,
      null
    );
    const ibm = rows.find((r) => r.client === "IBM")!;
    expect(ibm.requirementsReceived).toBe(2);
    expect(ibm.submissionsSent).toBe(1);
  });

  it("includes a client with requirements but zero submissions", () => {
    const rows = clientsToRows([], [job({ client: "Ghost Co" })], null, null);
    const g = rows.find((r) => r.client === "Ghost Co")!;
    expect(g.requirementsReceived).toBe(1);
    expect(g.submissionsSent).toBe(0);
  });
});

describe("runPlan non-grouped table", () => {
  it("sorts rows by the requested field and direction", () => {
    const rows = submissionsToRows([
      ev({ applicantName: "Zed" }),
      ev({ applicantName: "Amy" }),
    ]);
    const plan = sanitizePlan({ ...emptyPlan("submissions"), sort: { field: "applicantName", dir: "asc" } });
    const res = runPlan(rows, plan);
    expect(res.rows.map((r) => r.applicantName)).toEqual(["Amy", "Zed"]);
  });

  it("respects the row limit while reporting the true total", () => {
    const rows = submissionsToRows(Array.from({ length: 5 }, (_, i) => ev({ applicantName: `Cand${i}` })));
    const plan = sanitizePlan({ ...emptyPlan("submissions"), limit: 2 });
    const res = runPlan(rows, plan);
    expect(res.rows).toHaveLength(2);
    expect(res.totalRows).toBe(5);
  });
});
