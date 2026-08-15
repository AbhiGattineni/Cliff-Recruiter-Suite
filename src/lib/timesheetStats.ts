// Fold timesheet entries into the shapes Recruiter Performance needs:
// hours per person, and hours per person per requirement.
//
// Timesheets are keyed by Firebase user (uid/displayName/email) while Ceipal
// submissions are keyed by recruiter name, so the two are joined on a
// normalised name. Anyone whose app display name differs from their Ceipal
// name simply shows no hours rather than being attributed to the wrong person.

import { DateTime } from "luxon";
import { TimesheetEntry } from "./timesheets";

export const nameKey = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Every ISO date from `from` to `to`, inclusive. Shared so "missing days" means the same thing everywhere it's shown. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (d.isValid && end.isValid && d <= end) {
    out.push(d.toFormat("yyyy-MM-dd"));
    d = d.plus({ days: 1 });
  }
  return out;
}

/**
 * Days in [from, to] (up to `today`) with no timesheet entry and no approved
 * leave — the one definition of "unfilled" used both in the Team Dashboard
 * and a recruiter's own card, so the two places agree.
 *
 * Weekends are never "missing" — nobody's expected to log hours on a
 * Saturday or Sunday, so an empty one isn't flagged red.
 */
export function missingDays(
  from: string,
  to: string,
  today: string,
  filledDates: Set<string>,
  approvedLeaveDates: Set<string>
): string[] {
  if (!from || !to) return [];
  return daysBetween(from, to).filter((d) => {
    if (d > today || filledDates.has(d) || approvedLeaveDates.has(d)) return false;
    const weekday = DateTime.fromISO(d).weekday; // Luxon: 1=Monday ... 6=Saturday, 7=Sunday
    return weekday !== 6 && weekday !== 7;
  });
}

export interface JobEffort {
  jobCode: string;
  jobTitle: string;
  client: string;
  hours: number;
  days: number; // how many separate days were booked to it
}

export interface PersonEffort {
  name: string;
  totalHours: number; // every hour logged in range, including unattributed
  attributedHours: number; // hours booked to a requirement
  days: number; // days with any entry
  byJob: Map<string, JobEffort>;
}

export interface EffortIndex {
  byPerson: Map<string, PersonEffort>; // keyed by nameKey
  totalHours: number;
  anyJobsBooked: boolean; // false when nobody has used the requirement split yet
}

/** Entries whose date falls inside [from, to] (ISO yyyy-mm-dd, inclusive). */
export function filterByDate(entries: TimesheetEntry[], from: string, to: string): TimesheetEntry[] {
  if (!from && !to) return entries;
  return entries.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
}

export function buildEffortIndex(entries: TimesheetEntry[]): EffortIndex {
  const byPerson = new Map<string, PersonEffort>();
  let totalHours = 0;
  let anyJobsBooked = false;

  for (const e of entries) {
    const name = (e.displayName || e.email || "").trim();
    const key = nameKey(name);
    if (!key) continue;

    let p = byPerson.get(key);
    if (!p) {
      p = { name, totalHours: 0, attributedHours: 0, days: 0, byJob: new Map() };
      byPerson.set(key, p);
    }
    p.totalHours += Number(e.hours) || 0;
    p.days += 1;
    totalHours += Number(e.hours) || 0;

    for (const j of e.jobs ?? []) {
      const code = String(j.jobCode ?? "").trim();
      const hours = Number(j.hours) || 0;
      if (!code || hours <= 0) continue;
      anyJobsBooked = true;
      p.attributedHours += hours;
      const cur = p.byJob.get(code);
      if (cur) {
        cur.hours += hours;
        cur.days += 1;
        if (!cur.jobTitle && j.jobTitle) cur.jobTitle = j.jobTitle;
        if (!cur.client && j.client) cur.client = j.client;
      } else {
        p.byJob.set(code, {
          jobCode: code,
          jobTitle: j.jobTitle ?? "",
          client: j.client ?? "",
          hours,
          days: 1,
        });
      }
    }
  }

  return { byPerson, totalHours, anyJobsBooked };
}

export function effortFor(index: EffortIndex, recruiterName: string): PersonEffort | null {
  return index.byPerson.get(nameKey(recruiterName)) ?? null;
}

/** Hours booked by one person against one requirement. */
export function hoursOnJob(index: EffortIndex, recruiterName: string, jobCode: string): number {
  const p = effortFor(index, recruiterName);
  if (!p || !jobCode) return 0;
  return p.byJob.get(jobCode)?.hours ?? 0;
}

/**
 * Requirements a person logged time against but made no client/vendor
 * submission on — effort that produced no output. `clientSubsByJob` maps job
 * code to the number of client submissions in the same period.
 */
export function effortWithoutOutput(
  effort: PersonEffort | null,
  clientSubsByJob: Map<string, number>
): JobEffort[] {
  if (!effort) return [];
  return [...effort.byJob.values()]
    .filter((j) => (clientSubsByJob.get(j.jobCode) ?? 0) === 0)
    .sort((a, b) => b.hours - a.hours);
}

/** Client/vendor submissions per hour. Null when no hours are logged. */
export function subsPerHour(clientSubs: number, hours: number): number | null {
  if (!(hours > 0)) return null;
  return Math.round((clientSubs / hours) * 100) / 100;
}
