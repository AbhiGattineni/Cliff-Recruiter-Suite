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
  shortDays,
  dayBreakdown,
  summariseDays,
  EXPECTED_DAILY_HOURS,
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
  filledByUid: null,
  filledByName: null,
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

describe("shortDays", () => {
  // Aug 3-7 2026 is Mon-Fri; Aug 8-9 is the weekend.
  const noLeave = new Set<string>();

  it("flags a working day logged under a full day, with the hours it got", () => {
    const hours = new Map([["2026-08-03", 4], ["2026-08-04", EXPECTED_DAILY_HOURS]]);
    expect(shortDays("2026-08-03", "2026-08-04", "2026-08-04", hours, noLeave)).toEqual([
      { date: "2026-08-03", hours: 4 },
    ]);
  });

  it("says nothing about a day with no entry at all — that is missingDays' job", () => {
    const hours = new Map([["2026-08-03", 4]]);
    const short = shortDays("2026-08-03", "2026-08-05", "2026-08-05", hours, noLeave);
    expect(short.map((d) => d.date)).toEqual(["2026-08-03"]);
  });

  it("ignores weekends, approved leave, and anything after today", () => {
    const hours = new Map([
      ["2026-08-08", 2], // Saturday
      ["2026-08-06", 3], // approved leave
      ["2026-08-07", 1], // in the future relative to `today`
      ["2026-08-05", 5], // the only real shortfall
    ]);
    const leave = new Set(["2026-08-06"]);
    const short = shortDays("2026-08-03", "2026-08-09", "2026-08-05", hours, leave);
    expect(short.map((d) => d.date)).toEqual(["2026-08-05"]);
  });

  it("does not flag a full or over-full day", () => {
    const hours = new Map([["2026-08-03", EXPECTED_DAILY_HOURS], ["2026-08-04", EXPECTED_DAILY_HOURS + 2]]);
    expect(shortDays("2026-08-03", "2026-08-04", "2026-08-04", hours, noLeave)).toEqual([]);
  });
});

// 2026-08-03 is a Monday, so 08-08 and 08-09 are the weekend.
describe("dayBreakdown / summariseDays", () => {
  const hours = new Map([
    ["2026-08-03", EXPECTED_DAILY_HOURS], // full
    ["2026-08-04", 4], // short
    ["2026-08-07", 11], // over a full day still reads as filled
    ["2026-08-08", 3], // Saturday — logged, but never expected
  ]);
  const leave = new Set(["2026-08-06"]);
  const days = dayBreakdown("2026-08-03", "2026-08-10", "2026-08-09", hours, leave);

  it("labels every day in the range, gaps included", () => {
    expect(days.map((d) => [d.date, d.status])).toEqual([
      ["2026-08-03", "filled"],
      ["2026-08-04", "short"],
      ["2026-08-05", "missing"],
      ["2026-08-06", "leave"],
      ["2026-08-07", "filled"],
      ["2026-08-08", "weekend"],
      ["2026-08-09", "weekend"],
      ["2026-08-10", "future"],
    ]);
  });

  it("carries the hours logged, whatever the status", () => {
    expect(days.find((d) => d.date === "2026-08-08")?.hours).toBe(3);
    expect(days.find((d) => d.date === "2026-08-05")?.hours).toBe(0);
  });

  it("agrees with missingDays and shortDays", () => {
    const from = "2026-08-03";
    const to = "2026-08-10";
    const today = "2026-08-09";
    expect(days.filter((d) => d.status === "missing").map((d) => d.date)).toEqual(
      missingDays(from, to, today, new Set(hours.keys()), leave)
    );
    expect(days.filter((d) => d.status === "short").map((d) => d.date)).toEqual(
      shortDays(from, to, today, hours, leave).map((d) => d.date)
    );
  });

  it("counts only the days something was expected on", () => {
    const t = summariseDays(days);
    expect(t).toMatchObject({ expectedDays: 4, filled: 2, short: 1, missing: 1, leave: 1 });
    // Every hour logged counts toward the total, weekend included.
    expect(t.hours).toBe(EXPECTED_DAILY_HOURS + 4 + 11 + 3);
    // Short by 5h, missing a whole 9h day; the 11h day owes nothing.
    expect(t.shortfallHours).toBe(EXPECTED_DAILY_HOURS - 4 + EXPECTED_DAILY_HOURS);
    expect(t.completion).toBe(75);
  });

  it("reports a clean sheet when nothing was expected", () => {
    const weekend = dayBreakdown("2026-08-08", "2026-08-09", "2026-08-09", new Map(), new Set());
    expect(summariseDays(weekend)).toMatchObject({ expectedDays: 0, completion: 100, shortfallHours: 0 });
  });
});
