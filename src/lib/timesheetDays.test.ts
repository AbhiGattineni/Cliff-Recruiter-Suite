import { describe, it, expect } from "vitest";
import { dayRows, dayRowsInRange, leaveDates, leaveLabel } from "./timesheetDays";
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
