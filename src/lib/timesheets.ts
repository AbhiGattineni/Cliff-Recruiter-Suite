// Client wrappers around the Timesheets + leave-approval + role-management
// feature.
//
// Reads (rosters, timesheet lists, leave lists) go straight to Firestore —
// governed by firestore.rules — rather than through a Cloud Function. That's
// cheaper (no Cloud Run service per read endpoint) and avoids the per-project
// CPU quota that a large batch of Cloud Functions competes for on deploy.
// Writes still go through Cloud Functions, where identity-derivation and the
// approval-chain logic are easier to get right than in the rules DSL.

import { httpsCallable } from "firebase/functions";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";
import { functions, db } from "../firebase";
import { ensureConfigured } from "./errors";

export type Role = "admin" | "manager" | "employee";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: number | null;
  updatedAt: number | null;
}

function toMillis(v: unknown): number | null {
  return v instanceof Timestamp ? v.toMillis() : null;
}

function rowToProfile(id: string, x: DocumentData): UserProfile {
  return {
    uid: id,
    email: String(x.email ?? ""),
    displayName: String(x.displayName ?? ""),
    role: (x.role as Role) ?? "employee",
    createdAt: toMillis(x.createdAt),
    updatedAt: toMillis(x.updatedAt),
  };
}

export async function ensureUserProfile(): Promise<UserProfile> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; profile: UserProfile }>(
    functions,
    "ensureUserProfile"
  );
  const res = await callable({});
  return res.data.profile;
}

/** Full roster — admins use it for role management, managers for the team dashboard. */
export async function listUsers(): Promise<UserProfile[]> {
  ensureConfigured();
  const snap = await getDocs(collection(db, "userProfiles"));
  return snap.docs
    .map((d) => rowToProfile(d.id, d.data()))
    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
}

export async function setUserRole(uid: string, role: Role): Promise<UserProfile> {
  ensureConfigured();
  const callable = httpsCallable<{ uid: string; role: Role }, { ok: boolean; user: UserProfile }>(
    functions,
    "setUserRole"
  );
  const res = await callable({ uid, role });
  return res.data.user;
}

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
  /** Total for the day — the sum of `jobs` when any are booked. */
  hours: number;
  /** Per-requirement split. Empty on older entries. */
  jobs: JobHours[];
  workedOn: string;
  createdAt: number | null;
  updatedAt: number | null;
}

function rowToEntry(id: string, x: DocumentData): TimesheetEntry {
  return {
    id,
    uid: String(x.uid ?? ""),
    email: String(x.email ?? ""),
    displayName: String(x.displayName ?? ""),
    date: String(x.date ?? ""),
    hours: Number(x.hours) || 0,
    jobs: Array.isArray(x.jobs)
      ? (x.jobs as DocumentData[]).map((j) => ({
          jobCode: String(j?.jobCode ?? ""),
          jobTitle: String(j?.jobTitle ?? ""),
          client: String(j?.client ?? ""),
          hours: Number(j?.hours) || 0,
        }))
      : [],
    workedOn: String(x.workedOn ?? ""),
    createdAt: toMillis(x.createdAt),
    updatedAt: toMillis(x.updatedAt),
  };
}

export async function saveTimesheetEntry(
  date: string,
  hours: number,
  workedOn: string,
  jobs: JobHours[] = []
): Promise<TimesheetEntry> {
  ensureConfigured();
  const callable = httpsCallable<
    { date: string; hours: number; workedOn: string; jobs: JobHours[] },
    { ok: boolean; entry: TimesheetEntry }
  >(functions, "saveTimesheetEntry");
  const res = await callable({ date, hours, workedOn, jobs });
  return res.data.entry;
}

export async function listMyTimesheets(uid: string, from: string, to: string): Promise<TimesheetEntry[]> {
  ensureConfigured();
  const snap = await getDocs(query(collection(db, "timesheetEntries"), where("uid", "==", uid)));
  let entries = snap.docs.map((d) => rowToEntry(d.id, d.data()));
  if (from) entries = entries.filter((e) => e.date >= from);
  if (to) entries = entries.filter((e) => e.date <= to);
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

// Manager/admin only — enforced by firestore.rules (myRole() check), not by
// this query. Unfiltered on purpose: everyone's entries in range.
export async function listTeamTimesheets(
  from: string,
  to: string
): Promise<{ entries: TimesheetEntry[]; users: UserProfile[] }> {
  ensureConfigured();
  const constraints = [];
  if (from) constraints.push(where("date", ">=", from));
  if (to) constraints.push(where("date", "<=", to));
  const [entriesSnap, usersSnap] = await Promise.all([
    getDocs(query(collection(db, "timesheetEntries"), ...constraints)),
    getDocs(collection(db, "userProfiles")),
  ]);
  return {
    entries: entriesSnap.docs.map((d) => rowToEntry(d.id, d.data())),
    users: usersSnap.docs.map((d) => rowToProfile(d.id, d.data())),
  };
}

export type LeaveType = "half" | "full" | "multi";
export type LeaveStatus = "pending" | "approved" | "rejected";

export interface LeaveRequest {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: Role;
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

function rowToLeave(id: string, x: DocumentData): LeaveRequest {
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

export async function requestLeave(
  leaveType: LeaveType,
  startDate: string,
  endDate: string,
  reason: string
): Promise<LeaveRequest> {
  ensureConfigured();
  const callable = httpsCallable<
    { leaveType: LeaveType; startDate: string; endDate: string; reason: string },
    { ok: boolean; leave: LeaveRequest }
  >(functions, "requestLeave");
  const res = await callable({ leaveType, startDate, endDate, reason });
  return res.data.leave;
}

export async function listMyLeaves(uid: string): Promise<LeaveRequest[]> {
  ensureConfigured();
  const snap = await getDocs(query(collection(db, "leaveRequests"), where("uid", "==", uid)));
  return snap.docs
    .map((d) => rowToLeave(d.id, d.data()))
    .sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0));
}

// Admin sees every request; a manager's query is constrained to role=="employee"
// to match firestore.rules (a manager can't list manager/admin leave at all).
export async function listLeaveRequests(role: Role): Promise<LeaveRequest[]> {
  ensureConfigured();
  const base = collection(db, "leaveRequests");
  const q = role === "manager" ? query(base, where("role", "==", "employee")) : query(base);
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => rowToLeave(d.id, d.data()))
    .sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0));
}

export async function decideLeaveRequest(
  id: string,
  decision: "approved" | "rejected",
  note: string
): Promise<LeaveRequest> {
  ensureConfigured();
  const callable = httpsCallable<
    { id: string; decision: "approved" | "rejected"; note: string },
    { ok: boolean; leave: LeaveRequest }
  >(functions, "decideLeaveRequest");
  const res = await callable({ id, decision, note });
  return res.data.leave;
}
