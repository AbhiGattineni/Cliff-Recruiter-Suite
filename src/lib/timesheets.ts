// Client wrappers around the Timesheets + leave-approval + role-management
// Cloud Functions.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
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

export async function ensureUserProfile(): Promise<UserProfile> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; profile: UserProfile }>(
    functions,
    "ensureUserProfile"
  );
  const res = await callable({});
  return res.data.profile;
}

export async function listUsers(): Promise<UserProfile[]> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; users: UserProfile[] }>(
    functions,
    "listUsers"
  );
  const res = await callable({});
  return res.data.users ?? [];
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

export interface TimesheetEntry {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  date: string; // YYYY-MM-DD
  hours: number;
  workedOn: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export async function saveTimesheetEntry(date: string, hours: number, workedOn: string): Promise<TimesheetEntry> {
  ensureConfigured();
  const callable = httpsCallable<
    { date: string; hours: number; workedOn: string },
    { ok: boolean; entry: TimesheetEntry }
  >(functions, "saveTimesheetEntry");
  const res = await callable({ date, hours, workedOn });
  return res.data.entry;
}

export async function listMyTimesheets(from: string, to: string): Promise<TimesheetEntry[]> {
  ensureConfigured();
  const callable = httpsCallable<{ from: string; to: string }, { ok: boolean; entries: TimesheetEntry[] }>(
    functions,
    "listMyTimesheets"
  );
  const res = await callable({ from, to });
  return res.data.entries ?? [];
}

export async function listTeamTimesheets(
  from: string,
  to: string
): Promise<{ entries: TimesheetEntry[]; users: UserProfile[] }> {
  ensureConfigured();
  const callable = httpsCallable<
    { from: string; to: string },
    { ok: boolean; entries: TimesheetEntry[]; users: UserProfile[] }
  >(functions, "listTeamTimesheets");
  const res = await callable({ from, to });
  return { entries: res.data.entries ?? [], users: res.data.users ?? [] };
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

export async function listMyLeaves(): Promise<LeaveRequest[]> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; leaves: LeaveRequest[] }>(
    functions,
    "listMyLeaves"
  );
  const res = await callable({});
  return res.data.leaves ?? [];
}

export async function listLeaveRequests(): Promise<LeaveRequest[]> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; leaves: LeaveRequest[] }>(
    functions,
    "listLeaveRequests"
  );
  const res = await callable({});
  return res.data.leaves ?? [];
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
