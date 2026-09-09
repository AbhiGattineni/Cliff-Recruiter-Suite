import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  buildRequirementSla,
  slaTotals,
  bucketMatrix,
  groupBy,
  byRecruiter,
  ownersIn,
  worstFirst,
  bucketOf,
  SLA_TARGET_SUBMISSIONS,
} from "./submissionSla";
import { SubmissionEvent } from "./report/types";

const CREATED = DateTime.fromISO("2026-08-03T09:00:00");

/** One status-change event. `h` is hours after the requirement was created. */
const ev = (over: Partial<SubmissionEvent> & { h?: number }): SubmissionEvent => {
  const { h, ...rest } = over;
  return {
    jobCode: "CS-1",
    jobTitle: "Java Developer",
    applicantName: "Candidate A",
    submittedBy: "Guru Deepthi",
    client: "Gstate",
    submissionStatus: "Submitted",
    statusChangedOn: h != null ? CREATED.plus({ hours: h }) : null,
    submittedOn: h != null ? CREATED.plus({ hours: h }) : null,
    accountManager: "Pavan",
    jobCreatedOn: CREATED,
    ...rest,
  } as SubmissionEvent;
};

describe("buildRequirementSla", () => {
  it("measures each submission from when the requirement was created", () => {
    const [r] = buildRequirementSla([
      ev({ applicantName: "A", h: 3 }),
      ev({ applicantName: "B", h: 30 }),
    ]);
    expect(r.hoursToNth).toEqual([3, 30]);
    expect(r.inWindow).toBe(1); // only the 3h one is inside 24h
    expect(r.met).toBe(false);
  });

  it("counts a candidate once, however many times their status changed", () => {
    // Same candidate, three events; the earliest submission is the submission.
    const [r] = buildRequirementSla([
      ev({ applicantName: "A", h: 20 }),
      ev({ applicantName: "A", h: 5 }),
      ev({ applicantName: "A", h: 40 }),
    ]);
    expect(r.submissions).toHaveLength(1);
    expect(r.hoursToNth[0]).toBe(5);
  });

  it("treats a requirement as met only when the full target lands in the window", () => {
    const [r] = buildRequirementSla([
      ev({ applicantName: "A", h: 1 }),
      ev({ applicantName: "B", h: 2 }),
    ]);
    expect(r.met).toBe(true);
    expect(r.inWindow).toBe(SLA_TARGET_SUBMISSIONS);
  });

  it("does not let a flood of profiles on one requirement count more than the target", () => {
    const [r] = buildRequirementSla(
      ["A", "B", "C", "D", "E"].map((n, i) => ev({ applicantName: n, h: i + 1 }))
    );
    expect(r.submissions).toHaveLength(5);
    expect(r.inWindow).toBe(2); // capped — the point of measuring per requirement
  });

  it("handles a requirement with no creation date rather than inventing one", () => {
    const [r] = buildRequirementSla([ev({ applicantName: "A", h: 3, jobCreatedOn: null })]);
    expect(r.hoursToNth).toEqual([null, null]);
    expect(r.inWindow).toBe(0);
    expect(r.ageDays).toBeNull();
  });

  it("keeps a requirement that never got a submission", () => {
    const [r] = buildRequirementSla([ev({ applicantName: "", submittedOn: null, h: undefined })]);
    expect(r.submissions).toHaveLength(0);
    expect(r.met).toBe(false);
  });

  it("fills missing client and owner from a later event", () => {
    const [r] = buildRequirementSla([
      ev({ applicantName: "A", h: 1, client: "", accountManager: "" }),
      ev({ applicantName: "B", h: 2, client: "Gstate", accountManager: "Pavan" }),
    ]);
    expect(r.client).toBe("Gstate");
    expect(r.owner).toBe("Pavan");
  });

  it("reports requirement age in days", () => {
    const [r] = buildRequirementSla([ev({ applicantName: "A", h: 1 })], {
      now: CREATED.plus({ days: 9, hours: 5 }),
    });
    expect(r.ageDays).toBe(9);
  });
});

describe("slaTotals", () => {
  const rows = buildRequirementSla([
    // CS-1: both inside 24h — met.
    ev({ jobCode: "CS-1", applicantName: "A", h: 1 }),
    ev({ jobCode: "CS-1", applicantName: "B", h: 4 }),
    // CS-2: one inside, one late.
    ev({ jobCode: "CS-2", applicantName: "C", h: 2 }),
    ev({ jobCode: "CS-2", applicantName: "D", h: 60 }),
    // CS-3: nothing at all.
    ev({ jobCode: "CS-3", applicantName: "", submittedOn: null, h: undefined }),
  ]);

  it("scores against two submissions per requirement", () => {
    const t = slaTotals(rows);
    expect(t.requirements).toBe(3);
    expect(t.expected).toBe(6);
    expect(t.achieved).toBe(3); // 2 + 1 + 0
    expect(t.attainment).toBe(50);
  });

  it("separates requirements that got nothing from those that got too little", () => {
    const t = slaTotals(rows);
    expect(t.met).toBe(1);
    expect(t.untouched).toBe(1);
    expect(t.under).toBe(0); // CS-2 got 2 submissions, just one of them late
  });

  it("reports total submissions alongside, so attainment is not read alone", () => {
    expect(slaTotals(rows).totalSubmissions).toBe(4);
  });

  it("does not divide by zero on an empty set", () => {
    expect(slaTotals([])).toMatchObject({ attainment: 0, expected: 0 });
  });
});

describe("bucketOf / bucketMatrix", () => {
  it("puts each elapsed time in the ladder used in the review", () => {
    expect(bucketOf(0)).toBe("lt4");
    expect(bucketOf(3.9)).toBe("lt4");
    expect(bucketOf(4)).toBe("h4to8");
    expect(bucketOf(23.5)).toBe("h16to24");
    expect(bucketOf(24)).toBe("h24to48");
    expect(bucketOf(100)).toBe("gt48");
    expect(bucketOf(null)).toBeNull();
  });

  it("counts first and second submissions separately", () => {
    const rows = buildRequirementSla([
      ev({ jobCode: "CS-1", applicantName: "A", h: 1 }),
      ev({ jobCode: "CS-1", applicantName: "B", h: 30 }),
      ev({ jobCode: "CS-2", applicantName: "C", h: 2 }),
    ]);
    const [first, second] = bucketMatrix(rows);
    expect(first.lt4).toBe(2);
    expect(second.h24to48).toBe(1);
    expect(second.lt4).toBe(0);
  });
});

describe("groupBy", () => {
  const rows = buildRequirementSla([
    ev({ jobCode: "CS-1", accountManager: "Pavan", applicantName: "A", h: 1 }),
    ev({ jobCode: "CS-1", accountManager: "Pavan", applicantName: "B", h: 2 }),
    ev({ jobCode: "CS-2", accountManager: "Vipul", applicantName: "C", h: 90 }),
  ]);

  it("splits by owner and scores each side on its own requirements", () => {
    const g = groupBy(rows, (r) => r.owner);
    expect(g.map((x) => x.name)).toEqual(["Vipul", "Pavan"]); // worst first
    expect(g.find((x) => x.name === "Pavan")!.totals.attainment).toBe(100);
    expect(g.find((x) => x.name === "Vipul")!.totals.attainment).toBe(0);
  });

  it("names requirements with no account manager rather than dropping them", () => {
    const g = groupBy(buildRequirementSla([ev({ accountManager: "", applicantName: "A", h: 1 })]), (r) => r.owner);
    expect(g[0].name).toBe("(unassigned)");
  });
});

describe("byRecruiter", () => {
  const rows = buildRequirementSla([
    ev({ jobCode: "CS-1", submittedBy: "Guru Deepthi", applicantName: "A", h: 1 }),
    ev({ jobCode: "CS-1", submittedBy: "saurabh", applicantName: "B", h: 40 }),
    ev({ jobCode: "CS-2", submittedBy: "Guru Deepthi", applicantName: "C", h: 5 }),
  ]);

  it("credits each recruiter for their own submissions", () => {
    const r = byRecruiter(rows);
    const guru = r.find((x) => x.name === "Guru Deepthi")!;
    expect(guru.submissions).toBe(2);
    expect(guru.inWindow).toBe(2);
    expect(guru.rate).toBe(100);
    expect(guru.requirements).toBe(2);
  });

  it("counts a late submission against the recruiter who made it", () => {
    expect(byRecruiter(rows).find((x) => x.name === "saurabh")!.rate).toBe(0);
  });

  it("judges only the submissions that could have earned anything", () => {
    // A third profile is neither credited nor held against anyone.
    const many = buildRequirementSla([
      ev({ jobCode: "CS-9", submittedBy: "Juhi Sinha", applicantName: "A", h: 1 }),
      ev({ jobCode: "CS-9", submittedBy: "Juhi Sinha", applicantName: "B", h: 2 }),
      ev({ jobCode: "CS-9", submittedBy: "Juhi Sinha", applicantName: "C", h: 200 }),
    ]);
    expect(byRecruiter(many)[0].submissions).toBe(2);
    expect(byRecruiter(many)[0].rate).toBe(100);
  });
});

describe("ownersIn / worstFirst", () => {
  it("lists the account managers present, for the filter", () => {
    const rows = buildRequirementSla([
      ev({ jobCode: "CS-1", accountManager: "Vipul", applicantName: "A", h: 1 }),
      ev({ jobCode: "CS-2", accountManager: "Pavan", applicantName: "B", h: 1 }),
    ]);
    expect(ownersIn(rows)).toEqual(["Pavan", "Vipul"]);
  });

  it("puts requirements with nothing sent at the top of the chase list", () => {
    const rows = buildRequirementSla([
      ev({ jobCode: "CS-1", applicantName: "A", h: 1 }),
      ev({ jobCode: "CS-2", applicantName: "", submittedOn: null, h: undefined }),
    ]);
    expect(worstFirst(rows)[0].jobCode).toBe("CS-2");
  });
});
