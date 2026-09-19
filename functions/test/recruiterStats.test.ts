import { describe, it, expect } from "vitest";
import { buildStats, bandOf, pct, BAND_GOOD, BAND_OK } from "../src/recruiterStats";

const DAY = "2026-09-18";

// Ceipal's own spellings, so the alias mapping is exercised rather than bypassed.
const sub = (o: {
  job: string;
  cand: string;
  by: string;
  status?: string;
  submitted?: string;
  posted?: string;
}) => ({
  JobCode: o.job,
  "Applicant Full Name": o.cand,
  "Submitted By": o.by,
  "Submission Status": o.status ?? "Submitted to Client",
  "Submitted On": o.submitted ?? `${"09/18/2026"} 10:00:00`,
  "Job Created On": o.posted ?? "09/18/2026 09:00:00",
});

const job = (code: string) => ({ JobCode: code, JobTitle: "Dev", Client: "Acme", JobStatus: "Active" });

describe("buildStats", () => {
  it("counts active requirements from the active-jobs report", () => {
    const s = buildStats([], [job("J1"), job("J2"), job("J3")], DAY);
    expect(s.activeRequirements).toBe(3);
  });

  it("folds a candidate's many status rows into one submission", () => {
    const rows = [
      sub({ job: "J1", cand: "Ann Lee", by: "Ravi", status: "Waiting for Evaluation", submitted: "09/18/2026 10:00:00" }),
      sub({ job: "J1", cand: "Ann Lee", by: "Ravi", status: "Internal Interview", submitted: "09/18/2026 10:00:00" }),
      sub({ job: "J1", cand: "Ann Lee", by: "Ravi", status: "Submitted to Client", submitted: "09/18/2026 10:00:00" }),
    ];
    const s = buildStats(rows, [job("J1")], DAY);
    expect(s.submissions).toBe(1);
    expect(s.recruiters).toHaveLength(1);
    expect(s.recruiters[0]).toMatchObject({ name: "Ravi", submissions: 1, requirements: 1, onActive: 1 });
  });

  it("does not count a profile stopped internally", () => {
    const rows = [
      sub({ job: "J1", cand: "Ann Lee", by: "Ravi", status: "Rejected Internally" }),
      sub({ job: "J1", cand: "Bob Ray", by: "Ravi", status: "Submitted to Client" }),
    ];
    const s = buildStats(rows, [job("J1")], DAY);
    expect(s.submissions).toBe(1);
    expect(s.rejectedInternally).toBe(1);
  });

  it("counts one rejected internally that still reached the client", () => {
    const rows = [
      sub({ job: "J1", cand: "Ann Lee", by: "Ravi", status: "Rejected Internally" }),
      sub({ job: "J1", cand: "Ann Lee", by: "Ravi", status: "Submitted to Vendor" }),
    ];
    const s = buildStats(rows, [job("J1")], DAY);
    expect(s.submissions).toBe(1);
    expect(s.rejectedInternally).toBe(0);
  });

  it("separates submissions on open requirements from the rest", () => {
    const rows = [
      sub({ job: "OPEN", cand: "Ann Lee", by: "Ravi" }),
      sub({ job: "CLOSED", cand: "Bob Ray", by: "Ravi" }),
    ];
    const s = buildStats(rows, [job("OPEN")], DAY);
    expect(s.submissions).toBe(2);
    expect(s.submissionsOnActive).toBe(1);
    expect(s.recruiters[0].onActive).toBe(1);
  });

  it("buckets a requirement's first answer cumulatively across 3/6/9h", () => {
    const rows = [
      // posted 09:00, answered 11:00 => 2h, inside all three
      sub({ job: "FAST", cand: "A A", by: "Ravi", posted: "09/18/2026 09:00:00", submitted: "09/18/2026 11:00:00" }),
      // posted 09:00, answered 14:00 => 5h, inside 6 and 9 only
      sub({ job: "MID", cand: "B B", by: "Ravi", posted: "09/18/2026 09:00:00", submitted: "09/18/2026 14:00:00" }),
      // posted 09:00, answered 17:00 => 8h, inside 9 only
      sub({ job: "SLOW", cand: "C C", by: "Ravi", posted: "09/18/2026 09:00:00", submitted: "09/18/2026 17:00:00" }),
      // posted 09:00, answered 23:00 => 14h, outside all
      sub({ job: "LATE", cand: "D D", by: "Ravi", posted: "09/18/2026 09:00:00", submitted: "09/18/2026 23:00:00" }),
    ];
    const s = buildStats(rows, [], DAY);
    expect(s.requirementsAnswered).toBe(4);
    expect(s.answeredWithin).toEqual([1, 2, 3]);
    expect(s.answeredLater).toBe(1);
  });

  // A profile sent on day four is not a nine-hour response to the posting.
  it("does not treat a follow-up profile as the requirement's first answer", () => {
    const rows = [
      sub({ job: "J1", cand: "Old One", by: "Ravi", posted: "09/15/2026 09:00:00", submitted: "09/15/2026 10:00:00" }),
      sub({ job: "J1", cand: "New One", by: "Ravi", posted: "09/15/2026 09:00:00", submitted: "09/18/2026 10:00:00" }),
    ];
    const s = buildStats(rows, [], DAY);
    expect(s.submissions).toBe(1); // today's only
    expect(s.requirementsAnswered).toBe(0);
    expect(s.answeredWithin).toEqual([0, 0, 0]);
  });

  it("reports a requirement with no posting time as unmeasurable, not as fast", () => {
    const rows = [sub({ job: "J1", cand: "A A", by: "Ravi", posted: "" })];
    const s = buildStats(rows, [], DAY);
    expect(s.requirementsAnswered).toBe(1);
    expect(s.answeredUnknown).toBe(1);
    expect(s.answeredWithin).toEqual([0, 0, 0]);
    expect(s.recruiters[0].speed).toBeNull();
    expect(s.recruiters[0].unknownPosting).toBe(1);
  });

  it("ignores submissions from other days", () => {
    const rows = [
      sub({ job: "J1", cand: "A A", by: "Ravi", submitted: "09/17/2026 10:00:00" }),
      sub({ job: "J2", cand: "B B", by: "Ravi", submitted: "09/19/2026 10:00:00" }),
    ];
    expect(buildStats(rows, [], DAY).submissions).toBe(0);
  });

  it("ranks recruiters by submissions", () => {
    const rows = [
      sub({ job: "J1", cand: "A A", by: "Ravi" }),
      sub({ job: "J2", cand: "B B", by: "Ravi" }),
      sub({ job: "J3", cand: "C C", by: "Meena" }),
    ];
    const s = buildStats(rows, [], DAY);
    expect(s.recruiters.map((r) => r.name)).toEqual(["Ravi", "Meena"]);
    expect(s.recruiters[0].submissions).toBe(2);
  });

  it("treats the same recruiter spelled with odd spacing as one person", () => {
    const rows = [
      sub({ job: "J1", cand: "A A", by: "Ravi Kumar" }),
      sub({ job: "J2", cand: "B B", by: "ravi  kumar" }),
    ];
    const s = buildStats(rows, [], DAY);
    expect(s.recruiters).toHaveLength(1);
    expect(s.recruiters[0].submissions).toBe(2);
  });

  it("survives empty input", () => {
    const s = buildStats([], [], DAY);
    expect(s.submissions).toBe(0);
    expect(s.recruiters).toEqual([]);
  });
});

describe("bands", () => {
  it("splits at the two thresholds", () => {
    expect(bandOf(BAND_GOOD)).toBe("good");
    expect(bandOf(BAND_GOOD - 1)).toBe("ok");
    expect(bandOf(BAND_OK)).toBe("ok");
    expect(bandOf(BAND_OK - 1)).toBe("bad");
    expect(bandOf(null)).toBe("none");
  });

  it("returns null rather than 0% when there is nothing to measure", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
  });
});
