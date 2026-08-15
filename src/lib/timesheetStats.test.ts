import { describe, it, expect } from "vitest";
import {
  buildEffortIndex,
  effortFor,
  hoursOnJob,
  effortWithoutOutput,
  subsPerHour,
  filterByDate,
  daysBetween,
  missingDays,
} from "./timesheetStats";
import { TimesheetEntry } from "./timesheets";

const entry = (over: Partial<TimesheetEntry>): TimesheetEntry => ({
  id: "e",
  uid: "u1",
  email: "guru@cliff-services.com",
  displayName: "Guru Deepthi",
  date: "2026-08-04",
  hours: 8,
  jobs: [],
  workedOn: "",
  createdAt: null,
  updatedAt: null,
  ...over,
});

const job = (jobCode: string, hours: number) => ({ jobCode, jobTitle: "T", client: "C", hours });

describe("buildEffortIndex", () => {
  it("totals hours per person across days", () => {
    const idx = buildEffortIndex([
      entry({ date: "2026-08-04", hours: 8 }),
      entry({ date: "2026-08-05", hours: 6 }),
    ]);
    const p = effortFor(idx, "Guru Deepthi")!;
    expect(p.totalHours).toBe(14);
    expect(p.days).toBe(2);
  });

  it("sums hours per requirement across days", () => {
    const idx = buildEffortIndex([
      entry({ date: "2026-08-04", hours: 8, jobs: [job("CS-381", 5), job("CS-401", 3)] }),
      entry({ date: "2026-08-05", hours: 4, jobs: [job("CS-381", 4)] }),
    ]);
    expect(hoursOnJob(idx, "Guru Deepthi", "CS-381")).toBe(9);
    expect(hoursOnJob(idx, "Guru Deepthi", "CS-401")).toBe(3);
    expect(effortFor(idx, "Guru Deepthi")!.byJob.get("CS-381")!.days).toBe(2);
  });

  it("separates attributed hours from the day total", () => {
    // 8h logged, only 5h booked to a requirement.
    const idx = buildEffortIndex([entry({ hours: 8, jobs: [job("CS-381", 5)] })]);
    const p = effortFor(idx, "Guru Deepthi")!;
    expect(p.totalHours).toBe(8);
    expect(p.attributedHours).toBe(5);
  });

  it("matches names case- and spacing-insensitively", () => {
    const idx = buildEffortIndex([entry({ displayName: "  guru   deepthi " })]);
    expect(effortFor(idx, "Guru Deepthi")).not.toBeNull();
  });

  it("returns null for someone with no timesheet", () => {
    const idx = buildEffortIndex([entry({})]);
    expect(effortFor(idx, "Nobody At All")).toBeNull();
    expect(hoursOnJob(idx, "Nobody At All", "CS-381")).toBe(0);
  });

  it("reports whether anyone has used the requirement split at all", () => {
    expect(buildEffortIndex([entry({ hours: 8 })]).anyJobsBooked).toBe(false);
    expect(buildEffortIndex([entry({ jobs: [job("CS-1", 2)] })]).anyJobsBooked).toBe(true);
  });

  it("ignores requirement rows with no hours", () => {
    const idx = buildEffortIndex([entry({ jobs: [job("CS-381", 0)] })]);
    expect(effortFor(idx, "Guru Deepthi")!.byJob.size).toBe(0);
  });

  it("falls back to email when there is no display name", () => {
    const idx = buildEffortIndex([entry({ displayName: "", email: "x@cliff-services.com" })]);
    expect(effortFor(idx, "x@cliff-services.com")).not.toBeNull();
  });
});

describe("effortWithoutOutput", () => {
  it("lists requirements with hours but no client submissions, worst first", () => {
    const idx = buildEffortIndex([entry({ jobs: [job("CS-381", 3), job("CS-401", 9), job("CS-402", 2)] })]);
    const subs = new Map([["CS-381", 2]]); // only 381 produced anything
    const wasted = effortWithoutOutput(effortFor(idx, "Guru Deepthi"), subs);
    expect(wasted.map((j) => j.jobCode)).toEqual(["CS-401", "CS-402"]);
  });

  it("returns nothing when every requirement produced a submission", () => {
    const idx = buildEffortIndex([entry({ jobs: [job("CS-381", 3)] })]);
    expect(effortWithoutOutput(effortFor(idx, "Guru Deepthi"), new Map([["CS-381", 1]]))).toHaveLength(0);
  });
});

describe("subsPerHour", () => {
  it("computes submissions per hour", () => {
    expect(subsPerHour(3, 6)).toBe(0.5);
  });
  it("is null with no hours, rather than dividing by zero", () => {
    expect(subsPerHour(3, 0)).toBeNull();
  });
});

describe("daysBetween / missingDays", () => {
  it("lists every ISO date in range, inclusive of both ends", () => {
    expect(daysBetween("2026-08-01", "2026-08-03")).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("flags a day with no entry and no leave as missing", () => {
    // 2026-08-03/04/05 are Mon/Tue/Wed — plain weekdays, no weekend involved.
    const filled = new Set(["2026-08-03", "2026-08-05"]);
    const leave = new Set<string>();
    expect(missingDays("2026-08-03", "2026-08-05", "2026-08-05", filled, leave)).toEqual(["2026-08-04"]);
  });

  it("does not flag an approved-leave day as missing", () => {
    const filled = new Set(["2026-08-03"]);
    const leave = new Set(["2026-08-04"]);
    expect(missingDays("2026-08-03", "2026-08-05", "2026-08-05", filled, leave)).toEqual(["2026-08-05"]);
  });

  it("does not flag a future day (after `today`) as missing", () => {
    // 2026-08-01 is a Saturday, so it's excluded on its own merits too —
    // use a Monday start so this test isolates only the future-day rule.
    const filled = new Set<string>();
    const leave = new Set<string>();
    expect(missingDays("2026-08-03", "2026-08-07", "2026-08-04", filled, leave)).toEqual(["2026-08-03", "2026-08-04"]);
  });

  it("returns nothing when the range is unbounded", () => {
    expect(missingDays("", "2026-08-05", "2026-08-05", new Set(), new Set())).toEqual([]);
    expect(missingDays("2026-08-01", "", "2026-08-05", new Set(), new Set())).toEqual([]);
  });

  it("never flags a Saturday or Sunday as missing, even unfilled with no leave", () => {
    // 2026-08-01 is a Saturday, 2026-08-02 a Sunday, 2026-08-03 a Monday.
    const filled = new Set<string>();
    const leave = new Set<string>();
    expect(missingDays("2026-08-01", "2026-08-03", "2026-08-03", filled, leave)).toEqual(["2026-08-03"]);
  });
});

describe("filterByDate", () => {
  const rows = [entry({ date: "2026-07-31" }), entry({ date: "2026-08-04" }), entry({ date: "2026-08-09" })];
  it("keeps entries inside the range, inclusive", () => {
    expect(filterByDate(rows, "2026-08-01", "2026-08-04").map((e) => e.date)).toEqual(["2026-08-04"]);
  });
  it("returns everything when no range is given", () => {
    expect(filterByDate(rows, "", "")).toHaveLength(3);
  });
});
