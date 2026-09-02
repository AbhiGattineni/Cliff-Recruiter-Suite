// Timesheets + leave-approval feature: user roles, daily timesheet entries,
// and leave requests. Business logic lives here; index.ts wires each piece
// into an onCall handler (auth + role checks happen there).
//
// Reads (rosters, timesheet lists, leave lists) go straight from the client
// to Firestore, governed by firestore.rules — cheaper than a Cloud Function
// per read and avoids deploying a Cloud Run service for every list endpoint.
// Only mutations stay here, where identity-derivation and the approval-chain
// logic are easier to get right (and test) than in the rules DSL.

import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * admin/manager/employee are STAFF — people who work for Cliff.
 * consultant is an OUTSIDER — someone we placed at a client, who signs in only
 * to file the hours we bill for them. They must never reach anything staff can
 * see, so every role check that means "staff" has to say so explicitly rather
 * than assuming "signed in" is enough.
 */
export type Role = "admin" | "manager" | "employee" | "consultant";

export const STAFF_ROLES: Role[] = ["admin", "manager", "employee"];

export function isStaff(role: Role): boolean {
  return role !== "consultant";
}

/** Emails at this domain are staff; anyone else signing in is an outsider. */
export const STAFF_EMAIL_DOMAIN = "cliff-services.com";

export function roleForNewAccount(email: string): Role {
  const e = email.trim().toLowerCase();
  if (e === PERMANENT_ADMIN_EMAIL) return "admin";
  // Defaulting an outside email to "employee" would drop a placed consultant
  // into the recruiters' own timesheets and the Team Dashboard completion
  // table. Anyone off the staff domain starts as a consultant instead.
  return e.endsWith("@" + STAFF_EMAIL_DOMAIN) ? "employee" : "consultant";
}

// This account is always admin, regardless of what's stored in Firestore —
// it's the seed of the whole role system, since nothing else can grant the
// very first admin.
export const PERMANENT_ADMIN_EMAIL = "abhishek.g@cliff-services.com";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: number | null;
  updatedAt: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The team's working day is US Eastern, so that is what "today" means for a
 * timesheet — not the server's UTC clock, which rolls over mid-evening Eastern
 * and would close the day while people are still working.
 *
 * "America/New_York", not the fixed "EST": Eastern is EDT (UTC-4) for about
 * eight months of the year, so a fixed -5 offset would put the midnight cutoff
 * an hour out for most of the calendar. This tracks the change automatically.
 */
export const TIMESHEET_ZONE = "America/New_York";

/** Today's date in the team's zone, as YYYY-MM-DD. */
export function todayInZone(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape stored.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMESHEET_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toMillis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | undefined;
  return t?.toMillis?.() ?? null;
}

function rowToProfile(id: string, x: Record<string, unknown>): UserProfile {
  return {
    uid: id,
    email: String(x.email ?? ""),
    displayName: String(x.displayName ?? ""),
    role: (x.role as Role) ?? "employee",
    createdAt: toMillis(x.createdAt),
    updatedAt: toMillis(x.updatedAt),
  };
}

/**
 * Get the caller's profile, creating one (default role "employee") on first
 * login. The permanent admin's email is re-asserted as "admin" every time,
 * even if it was somehow changed directly in Firestore.
 */
export async function getOrCreateProfile(uid: string, email: string, displayName: string): Promise<UserProfile> {
  const db = getFirestore();
  const ref = db.collection("userProfiles").doc(uid);
  const snap = await ref.get();
  const isPermanentAdmin = email.trim().toLowerCase() === PERMANENT_ADMIN_EMAIL;

  if (!snap.exists) {
    const role: Role = roleForNewAccount(email);
    await ref.set({
      email,
      displayName,
      role,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const created = await ref.get();
    return rowToProfile(uid, created.data()!);
  }

  const data = snap.data()!;
  const patch: Record<string, unknown> = {};
  if (email && data.email !== email) patch.email = email;
  if (displayName && data.displayName !== displayName) patch.displayName = displayName;
  if (isPermanentAdmin && data.role !== "admin") patch.role = "admin";
  if (Object.keys(patch).length) {
    patch.updatedAt = FieldValue.serverTimestamp();
    await ref.set(patch, { merge: true });
    const updated = await ref.get();
    return rowToProfile(uid, updated.data()!);
  }
  return rowToProfile(uid, data);
}

export async function getProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getFirestore().collection("userProfiles").doc(uid).get();
  return snap.exists ? rowToProfile(uid, snap.data()!) : null;
}

export async function setRole(targetUid: string, role: Role): Promise<UserProfile> {
  const db = getFirestore();
  const ref = db.collection("userProfiles").doc(targetUid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("User not found.");
  const data = snap.data()!;
  if (String(data.email ?? "").trim().toLowerCase() === PERMANENT_ADMIN_EMAIL && role !== "admin") {
    throw new Error(`${PERMANENT_ADMIN_EMAIL} must stay an admin.`);
  }
  await ref.set({ role, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return rowToProfile(targetUid, { ...data, role });
}

// ---- Daily timesheet entries -----------------------------------------------

/** Hours booked against one requirement on a given day. */
export interface JobHours {
  jobCode: string;
  jobTitle: string;
  client: string;
  hours: number;
}

export interface TimesheetEntry {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  date: string; // YYYY-MM-DD
  /** Total for the day. Derived from `jobs` when any are booked. */
  hours: number;
  /** Per-requirement split. Empty on older entries and on non-requirement days. */
  jobs: JobHours[];
  /** Free-text note. Was the only record of what was worked on before `jobs`. */
  workedOn: string;
  /** Set when a manager/admin filled this day for the person, rather than the person themselves. */
  filledByUid: string | null;
  filledByName: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

function rowToEntry(id: string, x: Record<string, unknown>): TimesheetEntry {
  return {
    id,
    uid: String(x.uid ?? ""),
    email: String(x.email ?? ""),
    displayName: String(x.displayName ?? ""),
    date: String(x.date ?? ""),
    hours: Number(x.hours) || 0,
    jobs: Array.isArray(x.jobs)
      ? (x.jobs as Record<string, unknown>[]).map((j) => ({
          jobCode: String(j?.jobCode ?? ""),
          jobTitle: String(j?.jobTitle ?? ""),
          client: String(j?.client ?? ""),
          hours: Number(j?.hours) || 0,
        }))
      : [],
    workedOn: String(x.workedOn ?? ""),
    filledByUid: x.filledByUid ? String(x.filledByUid) : null,
    filledByName: x.filledByName ? String(x.filledByName) : null,
    createdAt: toMillis(x.createdAt),
    updatedAt: toMillis(x.updatedAt),
  };
}

const MAX_JOBS_PER_DAY = 20;

/** Validate and normalise the per-requirement split. */
function cleanJobs(raw: unknown): JobHours[] {
  if (!Array.isArray(raw)) return [];
  const out: JobHours[] = [];
  for (const item of raw.slice(0, MAX_JOBS_PER_DAY)) {
    const o = (item ?? {}) as Record<string, unknown>;
    const jobCode = String(o.jobCode ?? "").trim().slice(0, 60);
    if (!jobCode) continue;
    const h = Number(o.hours);
    if (!(Number.isFinite(h) && h > 0 && h <= 24)) {
      throw new Error(`Hours for ${jobCode} must be between 0 and 24.`);
    }
    // One row per requirement — merge a repeated code rather than storing it twice.
    const existing = out.find((x) => x.jobCode === jobCode);
    if (existing) {
      existing.hours += h;
      continue;
    }
    out.push({
      jobCode,
      jobTitle: String(o.jobTitle ?? "").trim().slice(0, 200),
      client: String(o.client ?? "").trim().slice(0, 120),
      hours: h,
    });
  }
  return out;
}

export async function saveEntry(
  profile: UserProfile,
  date: string,
  hours: number,
  workedOn: string,
  jobsRaw?: unknown
): Promise<TimesheetEntry> {
  if (!DATE_RE.test(date)) throw new Error("date must be in YYYY-MM-DD format.");
  // You may only fill TODAY. Backdating and future-dating are both refused,
  // and this single rule is also what closes editing: today's entry can still
  // be corrected (the write below upserts), but once the day is over the date
  // no longer matches and nothing can change it. A missed day is a manager's
  // job from then on — see saveEntryOnBehalf.
  const today = todayInZone();
  if (date !== today) {
    throw new Error(
      date > today
        ? "You can't fill a timesheet for a future date."
        : `You can only fill today's timesheet (${today}). Ask a manager to fill ${date} for you.`
    );
  }
  const jobs = cleanJobs(jobsRaw);
  // At least one requirement is mandatory — a timesheet with no requirement
  // attached to the hours isn't useful for judging where the time went.
  if (jobs.length === 0) {
    throw new Error("Select at least one requirement worked on.");
  }
  // The split IS the day's total, so the two can never disagree.
  const total = jobs.reduce((sum, j) => sum + j.hours, 0);
  if (!(Number.isFinite(total) && total > 0 && total <= 24)) {
    throw new Error("Total hours for a day must be more than 0 and at most 24.");
  }
  hours = Math.round(total * 100) / 100;
  return writeEntry(profile, date, hours, workedOn, jobs, null);
}

/**
 * A manager or admin filling a day the person themselves can no longer reach.
 *
 * Missing days only: if an entry already exists it is left alone, so nobody
 * can quietly rewrite what a recruiter actually logged. The hours belong to
 * the recruiter — `uid` and `displayName` are theirs, and every total that
 * counts them is unchanged — but the entry carries who really typed it.
 */
export async function saveEntryOnBehalf(
  actor: UserProfile,
  targetUid: string,
  date: string,
  workedOn: string,
  jobsRaw?: unknown
): Promise<TimesheetEntry> {
  if (actor.role !== "admin" && actor.role !== "manager") {
    throw new Error("Only a manager or admin can fill someone else's timesheet.");
  }
  if (!DATE_RE.test(date)) throw new Error("date must be in YYYY-MM-DD format.");
  if (date > todayInZone()) throw new Error("You can't fill a timesheet for a future date.");

  const db = getFirestore();
  const targetSnap = await db.collection("userProfiles").doc(String(targetUid)).get();
  if (!targetSnap.exists) throw new Error("That person doesn't have a profile yet.");
  const t = targetSnap.data()!;
  const target: UserProfile = {
    uid: String(targetUid),
    email: String(t.email ?? ""),
    displayName: String(t.displayName ?? ""),
    role: (t.role as Role) ?? "employee",
    createdAt: null,
    updatedAt: null,
  };

  const existing = await db.collection("timesheetEntries").doc(`${targetUid}_${date}`).get();
  if (existing.exists) {
    throw new Error(`${target.displayName || target.email} already filled ${date}. Existing entries can't be changed.`);
  }

  const jobs = cleanJobs(jobsRaw);
  if (jobs.length === 0) throw new Error("Select at least one requirement worked on.");
  const total = jobs.reduce((sum, j) => sum + j.hours, 0);
  if (!(Number.isFinite(total) && total > 0 && total <= 24)) {
    throw new Error("Total hours for a day must be more than 0 and at most 24.");
  }
  return writeEntry(target, date, Math.round(total * 100) / 100, workedOn, jobs, actor);
}

/** The one place a timesheet entry is written, whoever is doing the typing. */
async function writeEntry(
  owner: UserProfile,
  date: string,
  hours: number,
  workedOn: string,
  jobs: JobHours[],
  filledBy: UserProfile | null
): Promise<TimesheetEntry> {
  const db = getFirestore();
  const id = `${owner.uid}_${date}`;
  const ref = db.collection("timesheetEntries").doc(id);
  const existing = await ref.get();
  await ref.set(
    {
      uid: owner.uid,
      email: owner.email,
      displayName: owner.displayName,
      date,
      hours,
      jobs,
      workedOn: workedOn.slice(0, 500),
      // Who actually typed it, when that isn't the person it belongs to.
      filledByUid: filledBy ? filledBy.uid : null,
      filledByName: filledBy ? filledBy.displayName || filledBy.email : null,
      createdAt: existing.exists ? existing.data()!.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const saved = await ref.get();
  return rowToEntry(id, saved.data()!);
}

// ---- Leave requests ---------------------------------------------------------

export type LeaveType = "half" | "full" | "multi";
export type LeaveStatus = "pending" | "approved" | "rejected";

export interface LeaveRequest {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: Role; // requester's role at the time of the request — decides the approval chain
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  requestedAt: number | null;
  decidedByUid: string | null;
  decidedByName: string | null;
  decidedByEmail: string | null;
  decidedAt: number | null;
  decisionNote: string;
}

function rowToLeave(id: string, x: Record<string, unknown>): LeaveRequest {
  return {
    id,
    uid: String(x.uid ?? ""),
    email: String(x.email ?? ""),
    displayName: String(x.displayName ?? ""),
    role: (x.role as Role) ?? "employee",
    leaveType: (x.leaveType as LeaveType) ?? "full",
    startDate: String(x.startDate ?? ""),
    endDate: String(x.endDate ?? ""),
    reason: String(x.reason ?? ""),
    status: (x.status as LeaveStatus) ?? "pending",
    requestedAt: toMillis(x.requestedAt),
    decidedByUid: (x.decidedByUid as string) ?? null,
    decidedByName: (x.decidedByName as string) ?? null,
    decidedByEmail: (x.decidedByEmail as string) ?? null,
    decidedAt: toMillis(x.decidedAt),
    decisionNote: String(x.decisionNote ?? ""),
  };
}

export async function createLeaveRequest(
  profile: UserProfile,
  leaveType: LeaveType,
  startDate: string,
  endDate: string,
  reason: string
): Promise<LeaveRequest> {
  if (leaveType !== "half" && leaveType !== "full" && leaveType !== "multi") {
    throw new Error("leaveType must be 'half', 'full', or 'multi'.");
  }
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }
  if (endDate < startDate) throw new Error("End date must be on or after the start date.");
  if (leaveType !== "multi" && startDate !== endDate) {
    throw new Error("Half-day and one-day leave use the same start and end date.");
  }
  const doc = {
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName,
    role: profile.role,
    leaveType,
    startDate,
    endDate,
    reason: reason.slice(0, 500),
    status: "pending" as LeaveStatus,
    requestedAt: FieldValue.serverTimestamp(),
    decidedByUid: null,
    decidedByName: null,
    decidedByEmail: null,
    decidedAt: null,
    decisionNote: "",
  };
  const ref = await getFirestore().collection("leaveRequests").add(doc);
  const saved = await ref.get();
  return rowToLeave(ref.id, saved.data()!);
}

/** Employee leave → manager or admin decides. Manager (or admin) leave → admin only. */
function canDecide(deciderRole: Role, requesterRole: Role): boolean {
  if (deciderRole === "admin") return true;
  if (deciderRole === "manager") return requesterRole === "employee";
  return false;
}

export async function decideLeave(
  decider: UserProfile,
  id: string,
  decision: "approved" | "rejected",
  note: string
): Promise<LeaveRequest> {
  const db = getFirestore();
  const ref = db.collection("leaveRequests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Leave request not found.");
  const data = snap.data()!;
  const requesterRole = (data.role as Role) ?? "employee";
  if (!canDecide(decider.role, requesterRole)) {
    throw new Error(
      requesterRole === "employee"
        ? "Only a manager or admin can decide this request."
        : "Only an admin can decide a manager's leave request."
    );
  }
  if (data.status !== "pending") throw new Error("This request has already been decided.");
  const patch = {
    status: decision,
    decidedByUid: decider.uid,
    decidedByName: decider.displayName,
    decidedByEmail: decider.email,
    decidedAt: FieldValue.serverTimestamp(),
    decisionNote: note.slice(0, 500),
  };
  await ref.set(patch, { merge: true });
  const updated = await ref.get();
  return rowToLeave(id, updated.data()!);
}
