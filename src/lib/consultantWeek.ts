// Week maths for consultant timesheets.
//
// A placed consultant files one timesheet per week per assignment, Monday to
// Sunday. That is deliberately NOT the rule the recruiters' own timesheets
// follow — they fill today only, in arrears never. A consultant fills a whole
// week at the end of it, which is how every client we bill expects to receive
// hours.
//
// Everything here is pure so it can be tested; the Cloud Function validates
// again on the way in, because a browser can send anything.

import { DateTime } from "luxon";

/** Hours past which a week counts as overtime. US staffing standard. */
export const OT_THRESHOLD_HOURS = 40;

/** Most hours we will accept for a single day — a guard against a typo, not a policy. */
export const MAX_HOURS_PER_DAY = 24;

export interface WeekHours {
  /** ISO date (yyyy-MM-dd) -> hours worked. Missing or 0 means a day off. */
  [date: string]: number;
}

/** The Monday of the week containing `iso`. Weeks run Monday–Sunday. */
export function weekStartOf(iso: string): string {
  const d = DateTime.fromISO(iso);
  if (!d.isValid) return "";
  // Luxon: weekday 1 = Monday.
  return d.minus({ days: d.weekday - 1 }).toFormat("yyyy-MM-dd");
}

/** The seven ISO dates of the week beginning `weekStart`, Monday first. */
export function weekDays(weekStart: string): string[] {
  const start = DateTime.fromISO(weekStart);
  if (!start.isValid) return [];
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toFormat("yyyy-MM-dd"));
}

/** True when `weekStart` really is a Monday — the id of every week doc depends on it. */
export function isWeekStart(weekStart: string): boolean {
  const d = DateTime.fromISO(weekStart);
  return d.isValid && d.weekday === 1;
}

/** Has the week finished? A week can only be submitted once its last day has passed. */
export function weekIsComplete(weekStart: string, today: string): boolean {
  const days = weekDays(weekStart);
  return days.length === 7 && today > days[6];
}

export interface WeekTotals {
  total: number;
  regular: number;
  overtime: number;
  daysWorked: number;
}

/**
 * Total the week and split it at the overtime threshold.
 *
 * The split is on the WEEK, not the day — someone working 12 hours on Monday
 * and nothing else has worked 12 regular hours, not 8 plus 4 overtime.
 */
export function weekTotals(hours: WeekHours, weekStart: string): WeekTotals {
  let total = 0;
  let daysWorked = 0;
  for (const date of weekDays(weekStart)) {
    const h = Number(hours[date]) || 0;
    if (h > 0) {
      total += h;
      daysWorked++;
    }
  }
  total = Math.round(total * 100) / 100;
  const regular = Math.min(total, OT_THRESHOLD_HOURS);
  return {
    total,
    regular: Math.round(regular * 100) / 100,
    overtime: Math.round((total - regular) * 100) / 100,
    daysWorked,
  };
}

/** What a week is worth at a given rate, overtime paid at `otMultiplier`. */
export function weekAmount(totals: WeekTotals, rate: number, otMultiplier = 1.5): number {
  const r = Number(rate) || 0;
  const amount = totals.regular * r + totals.overtime * r * otMultiplier;
  return Math.round(amount * 100) / 100;
}

/**
 * Why a week can't be submitted, or null when it can.
 *
 * Returned as a sentence rather than a boolean so the same wording can be shown
 * in the portal and returned by the server, instead of the two drifting apart.
 */
export function weekSubmitError(hours: WeekHours, weekStart: string, today: string): string | null {
  if (!isWeekStart(weekStart)) return "A timesheet week has to start on a Monday.";
  const days = new Set(weekDays(weekStart));
  for (const [date, value] of Object.entries(hours)) {
    if (!days.has(date)) return `${date} isn't in the week beginning ${weekStart}.`;
    const h = Number(value);
    if (!Number.isFinite(h) || h < 0) return `Hours for ${date} must be a number.`;
    if (h > MAX_HOURS_PER_DAY) return `${date} has more than ${MAX_HOURS_PER_DAY} hours.`;
  }
  const totals = weekTotals(hours, weekStart);
  if (totals.total <= 0) return "Enter the hours you worked before submitting.";
  // Future days can't have been worked yet.
  for (const date of weekDays(weekStart)) {
    if (date > today && (Number(hours[date]) || 0) > 0) {
      return `${date} hasn't happened yet.`;
    }
  }
  return null;
}
