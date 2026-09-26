import { describe, it, expect } from "vitest";
import {
  discoverColumns, findColumn, joinBench, statusCounts, benchStats, personKey,
  autoMap, NOT_A_PERSON, ALIASES, Row,
} from "./benchSubmissions";

describe("discoverColumns", () => {
  it("unions keys across rows, keeping first-seen order", () => {
    const rows: Row[] = [{ a: 1, b: 2 }, { b: 3, c: 4 }];
    expect(discoverColumns(rows)).toEqual(["a", "b", "c"]);
  });

  it("is empty for no rows", () => {
    expect(discoverColumns([])).toEqual([]);
  });
});

describe("findColumn", () => {
  it("matches regardless of spacing, case and punctuation", () => {
    expect(findColumn(["Email Address"], [...ALIASES.email])).toBe("Email Address");
    expect(findColumn(["EmailAddress"], [...ALIASES.email])).toBe("EmailAddress");
    expect(findColumn(["email_address"], [...ALIASES.email])).toBe("EmailAddress".replace("EmailAddress", "email_address"));
  });

  it("prefers the earlier alias when several columns match", () => {
    // "Consultant Name" outranks a bare "Name".
    expect(findColumn(["Name", "Consultant Name"], [...ALIASES.name])).toBe("Consultant Name");
  });

  it("falls back to a containing header, longest alias first", () => {
    // Neither is an exact alias; "submissionstatus" must beat "status".
    expect(findColumn(["Current Submission Status Code"], [...ALIASES.status]))
      .toBe("Current Submission Status Code");
  });

  it("returns null when nothing resembles the field", () => {
    expect(findColumn(["Widget", "Sprocket"], [...ALIASES.status])).toBeNull();
  });
});

describe("personKey", () => {
  it("prefers email and lowercases it", () => {
    expect(personKey({ Name: "A B", Email: "X@Y.COM" }, "Name", "Email")).toBe("e:x@y.com");
  });

  it("folds name case and whitespace when there is no email", () => {
    expect(personKey({ Name: "  Jane   Roe " }, "Name", null)).toBe("n:jane roe");
  });

  it("is empty when the row identifies nobody", () => {
    expect(personKey({ Name: "  " }, "Name", "Email")).toBe("");
  });
});

describe("joinBench", () => {
  const bench: Row[] = [
    { "Consultant Name": "Jane Roe", "Email Address": "jane@x.com" },
    { "Consultant Name": "John Doe", "Email Address": "john@x.com" },
    { "Consultant Name": "Idle Ivan", "Email Address": "ivan@x.com" },
  ];
  const submissions: Row[] = [
    { "Candidate Name": "Jane Roe", "Email Address": "jane@x.com", "Submission Status": "Submitted" },
    { "Candidate Name": "Jane Roe", "Email Address": "jane@x.com", "Submission Status": "Interviewing" },
    { "Candidate Name": "John Doe", "Email Address": "john@x.com", "Submission Status": "Submitted" },
  ];

  it("attaches each consultant's submissions", () => {
    const joined = joinBench(bench, submissions);
    expect(joined.map((c) => c.count)).toEqual([2, 1, 0]);
    expect(joined[0].statuses).toEqual(["Submitted", "Interviewing"]);
  });

  it("keeps bench rows with no submissions — they are the point", () => {
    const idle = joinBench(bench, submissions).find((c) => c.name === "Idle Ivan")!;
    expect(idle.count).toBe(0);
    expect(idle.statuses).toEqual([]);
  });

  it("joins on name when neither side carries an email", () => {
    const joined = joinBench(
      [{ Consultant: "Jane Roe" }],
      [{ Candidate: "  jane   roe  ", Status: "Submitted" }]
    );
    expect(joined[0].count).toBe(1);
  });

  it("survives a submissions report with no recognisable status column", () => {
    const joined = joinBench(bench, [{ "Candidate Name": "Jane Roe", Widget: "x" }]);
    expect(joined[0].count).toBe(1);
    expect(joined[0].statuses).toEqual([]);
  });

  it("matches when only one side carries an email", () => {
    // Bench has emails, submissions do not: they must still meet on the name.
    const joined = joinBench(
      [{ "Consultant Name": "Jane Roe", "Email Address": "jane@x.com" }],
      [{ "Candidate Name": "Jane Roe", "Submission Status": "Submitted" }]
    );
    expect(joined[0].count).toBe(1);
  });

  it("counts a submission once when it matches on both email and name", () => {
    const joined = joinBench(
      [{ "Consultant Name": "Jane Roe", "Email Address": "jane@x.com" }],
      [{ "Candidate Name": "Jane Roe", "Email Address": "jane@x.com", "Submission Status": "Submitted" }]
    );
    expect(joined[0].count).toBe(1);
  });

  it("returns the bench unchanged when there are no submissions at all", () => {
    const joined = joinBench(bench, []);
    expect(joined).toHaveLength(3);
    expect(joined.every((c) => c.count === 0)).toBe(true);
  });
});

describe("statusCounts", () => {
  it("tallies commonest first", () => {
    const counts = statusCounts([
      { Status: "Submitted" }, { Status: "Submitted" }, { Status: "Rejected" },
    ]);
    expect(counts).toEqual([
      { status: "Submitted", count: 2 },
      { status: "Rejected", count: 1 },
    ]);
  });

  it("groups blanks rather than dropping them", () => {
    expect(statusCounts([{ Status: "" }])).toEqual([{ status: "No status", count: 1 }]);
  });

  it("is empty when no column looks like a status", () => {
    expect(statusCounts([{ Widget: "x" }])).toEqual([]);
  });
});

describe("benchStats", () => {
  it("splits the bench into covered and idle", () => {
    const bench: Row[] = [{ Consultant: "A" }, { Consultant: "B" }];
    const subs: Row[] = [{ Candidate: "A", Status: "Submitted" }];
    const stats = benchStats(joinBench(bench, subs), subs);
    expect(stats).toMatchObject({ benchTotal: 2, submissionTotal: 1, covered: 1, idle: 1 });
    expect(stats.byStatus).toEqual([{ status: "Submitted", count: 1 }]);
  });

  it("reports an empty bench without dividing by it", () => {
    expect(benchStats([], [])).toMatchObject({ benchTotal: 0, covered: 0, idle: 0 });
  });
});

describe("findColumn exclusions", () => {
  it("does not hand the person slot to a company column", () => {
    // "VendorName" and "ContactPerson" both contain a name alias. Picking either
    // builds join keys out of vendors, which matches nobody and reads as an
    // empty bench rather than a mislabelled column.
    expect(findColumn(["VendorName", "ContactPerson"], [...ALIASES.name], NOT_A_PERSON)).toBeNull();
  });

  it("still finds the real person column beside company ones", () => {
    const cols = ["VendorName", "ContactPerson", "ApplicantName"];
    expect(findColumn(cols, [...ALIASES.name], NOT_A_PERSON)).toBe("ApplicantName");
  });
});

describe("autoMap", () => {
  it("detects each side independently", () => {
    const m = autoMap(
      [{ "Applicant Name": "A", "Email Address": "a@x.com", VendorName: "V" }],
      [{ "Candidate Name": "A", "Submission Status": "Submitted" }]
    );
    expect(m).toEqual({
      benchName: "Applicant Name",
      benchEmail: "Email Address",
      subName: "Candidate Name",
      subEmail: null,
      subStatus: "Submission Status",
    });
  });
});

describe("explicit column overrides", () => {
  const bench: Row[] = [{ Who: "Jane Roe" }];
  const submissions: Row[] = [{ Person: "Jane Roe", Outcome: "Offer", Junk: "N/A" }];

  it("joins on columns detection would never have guessed", () => {
    const map = { benchName: "Who", benchEmail: null, subName: "Person", subEmail: null, subStatus: "Outcome" };
    expect(joinBench(bench, submissions, map)[0].count).toBe(1);
  });

  it("counts statuses from the chosen column, not the detected one", () => {
    expect(statusCounts(submissions, "Outcome")).toEqual([{ status: "Offer", count: 1 }]);
    expect(statusCounts(submissions, "Junk")).toEqual([{ status: "N/A", count: 1 }]);
  });

  it("reports no statuses when the column is explicitly cleared", () => {
    expect(statusCounts(submissions, null)).toEqual([]);
  });

  it("passes the chosen status column through benchStats", () => {
    const map = { benchName: "Who", benchEmail: null, subName: "Person", subEmail: null, subStatus: "Outcome" };
    const stats = benchStats(joinBench(bench, submissions, map), submissions, "Outcome");
    expect(stats.covered).toBe(1);
    expect(stats.byStatus).toEqual([{ status: "Offer", count: 1 }]);
  });
});
