// One row per day, whether the day was worked or taken as leave.
//
// A timesheet list that only holds entries shows an absence as a gap, and a
// gap reads the same whether the person was on approved leave or simply never
// filled it in. The leave was already recorded — it just lived in a separate
// table further down the page, so checking "did they actually owe me that day"
// meant scrolling between two lists and matching dates by eye.
//
// So the two are merged here, once, and both the Team Dashboard and a person's
// own history render the result. Only APPROVED leave becomes a row: until it
// is approved nothing has been granted, and the day stays missing — the same
// rule missingDays() already applies.

import { TimesheetEntry, LeaveRequest, LeaveType } from "./timesheets";
import { daysBetween } from "./timesheetStats";

export interface DayRow {
  date: string;
  /** The filed timesheet for the day, when there is one. */
  entry: TimesheetEntry | null;
  /** Approved leave covering the day, when there is any. */
  leaveType: LeaveType | null;
  leaveReason: string;
  /** Hours filed. Zero on a day that was only leave. */
  hours: number;
}

/** How a leave day is labelled in the list. */
export function leaveLabel(type: LeaveType): string {
  if (type === "half") return "Half day leave";
  if (type === "multi") return "Leave";
  return "Full day leave";
}

/**
 * The dates one approved leave covers.
 *
 * A "multi" request spans start..end; the others are a single day, and are
 * read that way even if an endDate was stored, so a malformed multi-day half
 * day cannot silently blank out a week.
 */
export function leaveDates(leave: LeaveRequest): string[] {
  if (leave.leaveType === "multi") return daysBetween(leave.startDate, leave.endDate || leave.startDate);
  return leave.startDate ? [leave.startDate] : [];
}

/**
 * Every day with something to show, newest first: a timesheet, approved leave,
 * or both.
 *
 * Both is not two rows. A half day is exactly the case where someone takes
 * half the day off and logs the rest, and splitting that across two lines asks
 * the reader to add it back up. One row carries the hours and the leave
 * together.
 */
export function dayRows(entries: TimesheetEntry[], leaves: LeaveRequest[]): DayRow[] {
  const byDate = new Map<string, DayRow>();

  for (const e of entries) {
    if (!e.date) continue;
    byDate.set(e.date, { date: e.date, entry: e, leaveType: null, leaveReason: "", hours: e.hours });
  }

  for (const l of leaves) {
    if (l.status !== "approved") continue;
    for (const d of leaveDates(l)) {
      const row = byDate.get(d);
      if (row) {
        // A day already carrying hours keeps them and gains the leave marker.
        row.leaveType = l.leaveType;
        row.leaveReason = l.reason;
      } else {
        byDate.set(d, { date: d, entry: null, leaveType: l.leaveType, leaveReason: l.reason, hours: 0 });
      }
    }
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** The same, narrowed to a date range (inclusive). Blank bounds are open. */
export function dayRowsInRange(
  entries: TimesheetEntry[],
  leaves: LeaveRequest[],
  from: string,
  to: string
): DayRow[] {
  return dayRows(entries, leaves).filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}
