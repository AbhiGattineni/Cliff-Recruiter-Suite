import { describe, it, expect } from "vitest";
import { dayRows, dayRowsInRange, leaveDates, leaveLabel, trackedThrough } from "./timesheetDays";
import { missingDays } from "./timesheetStats";
import { TimesheetEntry, LeaveRequest } from "./timesheets";

const entry = (date: string, hours: number): TimesheetEntry => ({
  id: `u1_${date}`,
  uid: "u1",
  email: "a@cliff-services.com",
  displayName: "A",
  date,
  hours,
  jobs: [{ jobCode: "CS-1", jobTitle: "Dev", client: "X", hours }],
  bench: [],
  workedOn: "",
  filledByUid: null,
  filledByName: null,
  createdAt: null,
  updatedAt: null,
});

const leave = (over: Partial<LeaveRequest>): LeaveRequest => ({
  id: "l1",
  uid: "u1",
  email: "a@cliff-services.com",
  displayName: "A",
  role: "employee",
  leaveType: "full",
  startDate: "2026-10-02",
  endDate: "2026-10-02",
  reason: "",
  status: "approved",
  requestedAt: null,
  decidedByUid: null,
  decidedByName: null,
  decidedByEmail: null,
  decidedAt: null,
  decisionNote: "",
  ...over,
});

describe("leaveDates", () => {
  it("spans the range for a multi-day request", () => {
    expect(leaveDates(leave({ leaveType: "multi", startDate: "2026-10-01", endDate: "2026-10-03" })))
      .toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("is one day for a full or half day, whatever endDate says", () => {
    // A single-day type with a stray endDate must not blank out a week.
    expect(leaveDates(leave({ leaveType: "full", startDate: "2026-10-01", endDate: "2026-10-09" })))
      .toEqual(["2026-10-01"]);
    expect(leaveDates(leave({ leaveType: "half", startDate: "2026-10-01", endDate: "" })))
      .toEqual(["2026-10-01"]);
  });
});

describe("dayRows", () => {
  it("puts approved leave in the list as its own day", () => {
    const rows = dayRows([entry("2026-10-01", 9)], [leave({ startDate: "2026-10-02", endDate: "2026-10-02" })]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-01"]);
    expect(rows[0].entry).toBeNull();
    expect(rows[0].leaveType).toBe("full");
    expect(rows[0].hours).toBe(0);
  });

  it("ignores leave that isn't approved — the day stays missing until it is", () => {
    const rows = dayRows([], [leave({ status: "pending" }), leave({ id: "l2", status: "rejected" })]);
    expect(rows).toEqual([]);
  });

  it("merges a half day onto the hours logged the same date, as one row", () => {
    const rows = dayRows(
      [entry("2026-10-02", 4)],
      [leave({ leaveType: "half", startDate: "2026-10-02", endDate: "2026-10-02", reason: "appointment" })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hours).toBe(4);
    expect(rows[0].entry).not.toBeNull();
    expect(rows[0].leaveType).toBe("half");
    expect(rows[0].leaveReason).toBe("appointment");
  });

  it("covers every day of a multi-day request", () => {
    const rows = dayRows([], [leave({ leaveType: "multi", startDate: "2026-10-05", endDate: "2026-10-07" })]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-07", "2026-10-06", "2026-10-05"]);
  });

  it("sorts newest first", () => {
    const rows = dayRows([entry("2026-09-28", 8), entry("2026-10-03", 8)], []);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-03", "2026-09-28"]);
  });
});

describe("dayRowsInRange", () => {
  it("keeps both ends and drops what falls outside", () => {
    const rows = dayRowsInRange(
      [entry("2026-09-30", 8), entry("2026-10-01", 8), entry("2026-10-05", 8)],
      [leave({ startDate: "2026-10-02", endDate: "2026-10-02" })],
      "2026-10-01",
      "2026-10-02"
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-01"]);
  });
});

describe("leaveLabel", () => {
  it("names each kind the way the row reads", () => {
    expect(leaveLabel("half")).toBe("Half day leave");
    expect(leaveLabel("full")).toBe("Full day leave");
    expect(leaveLabel("multi")).toBe("Leave");
  });
});

describe("trackedThrough", () => {
  const TODAY = "2026-10-02";
  // 2026-09-18 12:00 UTC is still the 18th in US Eastern.
  const SEP_18 = Date.UTC(2026, 8, 18, 12, 0, 0);

  it("tracks an active person right up to today", () => {
    expect(trackedThrough({ active: true, deactivatedAt: null }, TODAY)).toBe(TODAY);
  });

  it("stops at the day someone was deactivated", () => {
    // Someone who left in September must not accumulate October as missing.
    expect(trackedThrough({ active: false, deactivatedAt: SEP_18 }, TODAY)).toBe("2026-09-18");
  });

  it("reads the deactivation day in the team's zone, not UTC", () => {
    // 2026-09-19 01:00 UTC is still the 18th in US Eastern, and the timesheet
    // day is the team's day.
    expect(trackedThrough({ active: false, deactivatedAt: Date.UTC(2026, 8, 19, 1, 0, 0) }, TODAY))
      .toBe("2026-09-18");
  });

  it("never runs past today for someone deactivated today", () => {
    expect(trackedThrough({ active: false, deactivatedAt: Date.UTC(2030, 0, 1, 12) }, TODAY)).toBe(TODAY);
  });

  it("chases nobody when the account is inactive with no date to go on", () => {
    expect(trackedThrough({ active: false, deactivatedAt: null }, TODAY)).toBe("");
  });
});

describe("a deactivated person's history", () => {
  // The bug this pins: filtering them out of the dashboard took their whole
  // September off the page, when deactivating was only meant to stop the chase.
  const SEP_18 = Date.UTC(2026, 8, 18, 12, 0, 0);
  const left = { active: false, deactivatedAt: SEP_18 };

  it("keeps every day they filed while they were here", () => {
    const rows = dayRowsInRange(
      [entry("2026-09-15", 9), entry("2026-09-17", 9)],
      [leave({ startDate: "2026-09-16", endDate: "2026-09-16" })],
      "2026-09-01",
      "2026-10-02"
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-09-17", "2026-09-16", "2026-09-15"]);
  });

  it("owes nothing for the days after they left", () => {
    const through = trackedThrough(left, "2026-10-02");
    // Every working day from the 21st on is past `through`, so none is missing.
    expect(missingDays("2026-09-21", "2026-10-02", through, new Set(), new Set(), new Set())).toEqual([]);
  });

  it("still shows the days they missed while they were here", () => {
    const through = trackedThrough(left, "2026-10-02");
    // Tue 15 Sep and Wed 16 Sep, with the 17th filled.
    expect(missingDays("2026-09-15", "2026-10-02", through, new Set(["2026-09-17"]), new Set(), new Set()))
      .toEqual(["2026-09-15", "2026-09-16", "2026-09-18"]);
  });
});
