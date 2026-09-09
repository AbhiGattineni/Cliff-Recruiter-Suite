// Company holidays — days nobody is expected to file a timesheet for.
//
// One list for the whole company, and deliberately not modelled as leave: a
// holiday costs nobody an allowance, and calling it "approved leave" would tell
// people something untrue about their own balance.
//
// Writes go straight to Firestore rather than through a callable. The rules
// already know who is staff and who is a manager, which is the entire check
// this needs, and every 2nd-gen function is another Cloud Run service against a
// CPU quota this project has hit more than once. A collection that only
// managers can write is not worth one.
//
// The document ID is the date. That is the natural key — a day is or is not a
// holiday — so the same date cannot be added twice, and looking one up needs no
// query at all.

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { ensureConfigured, AppError } from "./errors";
import { daysBetween } from "./timesheetStats";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Holiday {
  date: string; // ISO yyyy-MM-dd, and the document ID
  name: string;
  addedByUid: string | null;
  addedByName: string;
  createdAt: number | null;
}

const rowToHoliday = (id: string, x: Record<string, unknown>): Holiday => ({
  date: String(x.date ?? id),
  name: String(x.name ?? ""),
  addedByUid: (x.addedByUid as string) ?? null,
  addedByName: String(x.addedByName ?? ""),
  createdAt: (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
});

/** Every holiday on record, soonest first. Readable by all staff — recruiters need it too. */
export async function listHolidays(): Promise<Holiday[]> {
  ensureConfigured();
  const snap = await getDocs(collection(db, "holidays"));
  return snap.docs
    .map((d) => rowToHoliday(d.id, d.data()))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Add one or more holidays. A range writes one document per day, so a
 * multi-day shutdown is still just a set of dates to everything downstream.
 *
 * Weekends inside a range are skipped — marking a Saturday as a holiday says
 * nothing, since nobody was expected to work it.
 */
export async function addHolidays(from: string, to: string, name: string): Promise<string[]> {
  ensureConfigured();
  const label = name.trim();
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new AppError("Pick a valid date.");
  if (to < from) throw new AppError("The end date is before the start date.");
  if (!label) throw new AppError("Give the holiday a name.");

  const user = auth.currentUser;
  const dates = daysBetween(from, to).filter((d) => {
    const wd = new Date(`${d}T00:00:00`).getDay();
    return wd !== 0 && wd !== 6;
  });
  if (dates.length === 0) throw new AppError("That range is all weekend — nothing to mark.");

  await Promise.all(
    dates.map((date) =>
      setDoc(doc(db, "holidays", date), {
        date,
        name: label,
        addedByUid: user?.uid ?? null,
        addedByName: user?.displayName || user?.email || "",
        createdAt: serverTimestamp(),
      })
    )
  );
  return dates;
}

export async function removeHoliday(date: string): Promise<void> {
  ensureConfigured();
  await deleteDoc(doc(db, "holidays", date));
}

/** Just the dates, for the timesheet rules that ask "is anything owed on this day". */
export const holidayDateSet = (rows: Holiday[]): Set<string> => new Set(rows.map((h) => h.date));
