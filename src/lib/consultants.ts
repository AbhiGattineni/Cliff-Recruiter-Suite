// Client side of consultant billing.
//
// Reads go straight to Firestore under the rules in firestore.rules — a
// consultant sees only their own assignment and weeks, staff see everything,
// and nobody but staff can read assignmentRates. Writes go through the single
// `consultantOps` callable, so status can only move along the submit/approve
// path rather than being set directly.

import { httpsCallable } from "firebase/functions";
import { collection, getDocs, query, where, type DocumentData } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, functions, db } from "../firebase";
import { ensureConfigured, friendlyError } from "./errors";
import { UserProfile } from "./timesheets";

export interface Assignment {
  id: string;
  consultantUid: string;
  consultantName: string;
  consultantEmail: string;
  client: string;
  endClient: string;
  jobTitle: string;
  startDate: string;
  endDate: string | null;
  poNumber: string;
  status: "active" | "ended";
  createdAt: number | null;
  updatedAt: number | null;
}

/** Money. Staff-only — the rules deny this collection to consultants outright. */
export interface AssignmentRates {
  assignmentId: string;
  billRate: number;
  payRate: number;
  otMultiplier: number;
  currency: string;
}

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export interface ConsultantTimesheet {
  id: string;
  assignmentId: string;
  consultantUid: string;
  consultantName: string;
  client: string;
  weekStart: string;
  hours: Record<string, number>;
  total: number;
  regular: number;
  overtime: number;
  status: TimesheetStatus;
  note: string;
  submittedAt: number | null;
  decidedByUid: string | null;
  decidedByName: string | null;
  decidedAt: number | null;
  decisionNote: string;
}

const toMillis = (v: unknown): number | null =>
  (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;

function call<T>(data: Record<string, unknown>): Promise<T> {
  ensureConfigured();
  const fn = httpsCallable<Record<string, unknown>, T>(functions, "consultantOps");
  return fn(data).then((r) => r.data);
}

// ---- Invites ---------------------------------------------------------------

/**
 * Create a consultant's account, then have Firebase email them a link to set
 * their own password.
 *
 * We never generate or transmit a password. The reset email is Firebase's, so
 * there is no SMTP of ours in the path and nothing to leak.
 */
export interface Invite {
  user: UserProfile;
  /** Firebase's set-password link, to pass on by hand. */
  resetLink: string;
  /** Why the email didn't go out, or null if it did. The account exists either way. */
  emailError: string | null;
}

export async function inviteConsultant(email: string, displayName: string): Promise<Invite> {
  const res = await call<{ ok: boolean; user: UserProfile; resetLink: string }>({
    action: "invite",
    email,
    displayName,
  });
  // The account is made whether or not the mail goes out, so a failure here is
  // not an invite failure and must not be reported as one — it used to throw,
  // which left the consultant created, the modal showing an error, and nobody
  // any the wiser about which of the two had actually happened. The returned
  // link is the way through regardless.
  let emailError: string | null = null;
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    emailError = friendlyError(e);
  }
  return { ...res, emailError };
}

/** A fresh set-password link for someone whose invite never arrived. */
export async function resendInvite(email: string): Promise<{ resetLink: string; emailError: string | null }> {
  const res = await call<{ ok: boolean; resetLink: string }>({ action: "resetLink", email });
  let emailError: string | null = null;
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    emailError = friendlyError(e);
  }
  return { resetLink: res.resetLink, emailError };
}

// ---- Assignments -----------------------------------------------------------

export async function saveAssignment(input: {
  id?: string;
  consultantUid: string;
  client: string;
  endClient?: string;
  jobTitle: string;
  startDate: string;
  endDate?: string;
  poNumber?: string;
  status?: "active" | "ended";
  billRate: number;
  payRate: number;
  otMultiplier?: number;
  currency?: string;
}): Promise<Assignment> {
  const res = await call<{ ok: boolean; assignment: Assignment }>({
    action: "saveAssignment",
    ...input,
  });
  return res.assignment;
}

function rowToAssignment(id: string, x: DocumentData): Assignment {
  return {
    id,
    consultantUid: String(x.consultantUid ?? ""),
    consultantName: String(x.consultantName ?? ""),
    consultantEmail: String(x.consultantEmail ?? ""),
    client: String(x.client ?? ""),
    endClient: String(x.endClient ?? ""),
    jobTitle: String(x.jobTitle ?? ""),
    startDate: String(x.startDate ?? ""),
    endDate: x.endDate ? String(x.endDate) : null,
    poNumber: String(x.poNumber ?? ""),
    status: x.status === "ended" ? "ended" : "active",
    createdAt: toMillis(x.createdAt),
    updatedAt: toMillis(x.updatedAt),
  };
}

/** Every assignment (staff), or just your own (consultant) — the rules decide which. */
export async function listAssignments(consultantUid?: string): Promise<Assignment[]> {
  ensureConfigured();
  const base = collection(db, "assignments");
  const snap = await getDocs(consultantUid ? query(base, where("consultantUid", "==", consultantUid)) : query(base));
  return snap.docs
    .map((d) => rowToAssignment(d.id, d.data()))
    .sort((a, b) => a.consultantName.localeCompare(b.consultantName) || a.client.localeCompare(b.client));
}

/** Rates for every assignment, keyed by assignment id. Staff only. */
export async function listAssignmentRates(): Promise<Map<string, AssignmentRates>> {
  ensureConfigured();
  const snap = await getDocs(collection(db, "assignmentRates"));
  const m = new Map<string, AssignmentRates>();
  for (const d of snap.docs) {
    const x = d.data();
    m.set(d.id, {
      assignmentId: d.id,
      billRate: Number(x.billRate) || 0,
      payRate: Number(x.payRate) || 0,
      otMultiplier: Number(x.otMultiplier) || 1.5,
      currency: String(x.currency ?? "USD"),
    });
  }
  return m;
}

// ---- Timesheets ------------------------------------------------------------

function rowToTimesheet(id: string, x: DocumentData): ConsultantTimesheet {
  return {
    id,
    assignmentId: String(x.assignmentId ?? ""),
    consultantUid: String(x.consultantUid ?? ""),
    consultantName: String(x.consultantName ?? ""),
    client: String(x.client ?? ""),
    weekStart: String(x.weekStart ?? ""),
    hours: (x.hours ?? {}) as Record<string, number>,
    total: Number(x.total) || 0,
    regular: Number(x.regular) || 0,
    overtime: Number(x.overtime) || 0,
    status: (x.status as TimesheetStatus) ?? "draft",
    note: String(x.note ?? ""),
    submittedAt: toMillis(x.submittedAt),
    decidedByUid: x.decidedByUid ? String(x.decidedByUid) : null,
    decidedByName: x.decidedByName ? String(x.decidedByName) : null,
    decidedAt: toMillis(x.decidedAt),
    decisionNote: String(x.decisionNote ?? ""),
  };
}

export async function listConsultantTimesheets(consultantUid?: string): Promise<ConsultantTimesheet[]> {
  ensureConfigured();
  const base = collection(db, "consultantTimesheets");
  const snap = await getDocs(
    consultantUid ? query(base, where("consultantUid", "==", consultantUid)) : query(base)
  );
  return snap.docs
    .map((d) => rowToTimesheet(d.id, d.data()))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.consultantName.localeCompare(b.consultantName));
}

export async function submitTimesheet(
  assignmentId: string,
  weekStart: string,
  hours: Record<string, number>,
  note: string
): Promise<ConsultantTimesheet> {
  const res = await call<{ ok: boolean; timesheet: ConsultantTimesheet }>({
    action: "submitTimesheet",
    assignmentId,
    weekStart,
    hours,
    note,
  });
  return res.timesheet;
}

export async function decideTimesheet(
  id: string,
  decision: "approved" | "rejected",
  decisionNote: string
): Promise<ConsultantTimesheet> {
  const res = await call<{ ok: boolean; timesheet: ConsultantTimesheet }>({
    action: "decideTimesheet",
    id,
    decision,
    decisionNote,
  });
  return res.timesheet;
}

/** The consultants on the roster, for the assignment picker. Staff only. */
export async function listConsultantProfiles(): Promise<UserProfile[]> {
  ensureConfigured();
  const snap = await getDocs(query(collection(db, "userProfiles"), where("role", "==", "consultant")));
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        uid: d.id,
        email: String(x.email ?? ""),
        displayName: String(x.displayName ?? ""),
        role: "consultant" as const,
        createdAt: toMillis(x.createdAt),
        updatedAt: toMillis(x.updatedAt),
      };
    })
    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
}
