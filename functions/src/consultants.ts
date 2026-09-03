// Placed-consultant billing: assignments, weekly timesheets, approval.
//
// This is a different business from the recruiters' own timesheets, and shares
// nothing with them on purpose. A recruiter logs hours against a Ceipal
// requirement, today only, to be judged on. A consultant logs a whole week
// against one assignment, in arrears, to be INVOICED for. Same word, different
// object, different rules.
//
// Rates live apart from the assignment (see assignmentRates below) because
// Firestore rules grant or deny whole documents: a consultant has to be able to
// read their own assignment to know what they're filing against, and there is
// no way to hide a field from them inside it.

import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { UserProfile, Role } from "./timesheets.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OT_THRESHOLD_HOURS = 40;
const MAX_HOURS_PER_DAY = 24;

export interface Assignment {
  id: string;
  consultantUid: string;
  consultantName: string;
  consultantEmail: string;
  client: string; // who we invoice
  endClient: string; // where they actually sit, when it differs
  jobTitle: string;
  startDate: string;
  endDate: string | null; // null = open-ended
  poNumber: string;
  status: "active" | "ended";
  createdAt: number | null;
  updatedAt: number | null;
}

/** Money, kept in its own collection so it can be denied to the consultant wholesale. */
export interface AssignmentRates {
  billRate: number; // what the client pays us, per hour
  payRate: number; // what the consultant gets, per hour
  otMultiplier: number; // 1.5 unless the contract says otherwise
  currency: string;
}

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export interface ConsultantTimesheet {
  id: string; // `${assignmentId}_${weekStart}` — one week per assignment, no duplicates
  assignmentId: string;
  consultantUid: string;
  weekStart: string; // the Monday
  hours: Record<string, number>; // ISO date -> hours
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

function requireStaff(actor: UserProfile, roles: Role[] = ["admin", "manager"]): void {
  if (!roles.includes(actor.role)) {
    throw new Error("You don't have permission to do this.");
  }
}

function toMillis(v: unknown): number | null {
  return (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;
}

// ---- Invites ----------------------------------------------------------------

/**
 * Create a consultant's login and profile.
 *
 * We never choose or transmit a password. Firebase's own password-reset email
 * doubles as a "set your password" link, so there is no SMTP of ours in the
 * path and no credential to leak.
 *
 * The account is created WITH a random password all the same — one nobody ever
 * sees, not even us. An account made with no password at all has no
 * email/password provider attached, and Firebase will not send a reset for an
 * address it cannot find a password identity for: the invite appeared to work
 * and the email silently never came. The random value exists only so that
 * identity exists; it is discarded here and can never be used, because the only
 * way into the account is the reset link.
 *
 * A link is generated and returned as well. Email is the nice path, not a
 * dependable one — spam filters, a typo'd address, a corporate gateway — and
 * whoever sent the invite should be able to pass it on by hand rather than be
 * stuck waiting on someone else's mail server.
 */
export interface Invite {
  user: UserProfile;
  /** Firebase's set-password link. A credential: only ever returned to the staff member inviting. */
  resetLink: string;
}

/** Never used to sign in — only to give the account a password identity to reset. */
function throwawayPassword(): string {
  return `Cf-${randomUUID()}-${randomUUID()}`;
}

export async function inviteConsultant(
  actor: UserProfile,
  email: string,
  displayName: string
): Promise<Invite> {
  requireStaff(actor);
  const mail = String(email ?? "").trim().toLowerCase();
  const name = String(displayName ?? "").trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error("Enter a valid email address.");
  if (!name) throw new Error("Enter the consultant's name.");

  const auth = getAuth();
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(mail);
    uid = existing.uid;
    // Repair anyone invited before this function set a password: without a
    // password provider their reset email was never deliverable, so re-sending
    // it would fail exactly as the first one did.
    if (!existing.providerData.some((p) => p.providerId === "password")) {
      await auth.updateUser(uid, { password: throwawayPassword() });
    }
  } catch {
    const created = await auth.createUser({
      email: mail,
      displayName: name,
      emailVerified: false,
      password: throwawayPassword(),
    });
    uid = created.uid;
  }

  const db = getFirestore();
  const ref = db.collection("userProfiles").doc(uid);
  const snap = await ref.get();
  if (snap.exists && snap.data()!.role !== "consultant") {
    // Never quietly demote a member of staff because someone typed their address.
    throw new Error(`${mail} already has a staff account. Change their role instead.`);
  }
  await ref.set(
    {
      email: mail,
      displayName: name,
      role: "consultant" as Role,
      invitedByUid: actor.uid,
      invitedByName: actor.displayName || actor.email,
      createdAt: snap.exists ? snap.data()!.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const saved = await ref.get();
  const d = saved.data()!;
  return {
    user: {
      uid,
      email: String(d.email ?? ""),
      displayName: String(d.displayName ?? ""),
      role: (d.role as Role) ?? "consultant",
      createdAt: toMillis(d.createdAt),
      updatedAt: toMillis(d.updatedAt),
    },
    resetLink: await auth.generatePasswordResetLink(mail),
  };
}

/** A fresh set-password link for someone whose invite never arrived. Staff only. */
export async function consultantResetLink(actor: UserProfile, email: string): Promise<string> {
  requireStaff(actor);
  const mail = String(email ?? "").trim().toLowerCase();
  const auth = getAuth();
  const user = await auth.getUserByEmail(mail);
  if (!user.providerData.some((p) => p.providerId === "password")) {
    await auth.updateUser(user.uid, { password: throwawayPassword() });
  }
  return auth.generatePasswordResetLink(mail);
}

// ---- Assignments ------------------------------------------------------------

export async function saveAssignment(
  actor: UserProfile,
  raw: Record<string, unknown>
): Promise<Assignment> {
  requireStaff(actor);
  const consultantUid = String(raw.consultantUid ?? "").trim();
  const client = String(raw.client ?? "").trim().slice(0, 160);
  const jobTitle = String(raw.jobTitle ?? "").trim().slice(0, 200);
  const startDate = String(raw.startDate ?? "");
  const endDateRaw = String(raw.endDate ?? "").trim();
  const endDate = endDateRaw ? endDateRaw : null;

  if (!consultantUid) throw new Error("Pick the consultant this assignment is for.");
  if (!client) throw new Error("Enter the client we invoice.");
  if (!jobTitle) throw new Error("Enter the job title.");
  if (!DATE_RE.test(startDate)) throw new Error("Enter a valid start date.");
  if (endDate && !DATE_RE.test(endDate)) throw new Error("Enter a valid end date.");
  if (endDate && endDate < startDate) throw new Error("The end date is before the start date.");

  const billRate = Number(raw.billRate);
  const payRate = Number(raw.payRate);
  const otMultiplier = Number(raw.otMultiplier);
  if (!(Number.isFinite(billRate) && billRate >= 0)) throw new Error("Enter a valid bill rate.");
  if (!(Number.isFinite(payRate) && payRate >= 0)) throw new Error("Enter a valid pay rate.");
  // Not an error — a placement can be at cost — but worth refusing the typo of
  // a pay rate entered where the bill rate belongs.
  if (payRate > billRate * 3) throw new Error("The pay rate is far above the bill rate. Check the numbers.");

  const db = getFirestore();
  const profile = await db.collection("userProfiles").doc(consultantUid).get();
  if (!profile.exists) throw new Error("That consultant doesn't have an account yet. Invite them first.");
  const p = profile.data()!;
  if (p.role !== "consultant") throw new Error("Assignments can only be created for consultants.");

  const id = String(raw.id ?? "").trim();
  const ref = id ? db.collection("assignments").doc(id) : db.collection("assignments").doc();
  const existing = await ref.get();

  await ref.set(
    {
      consultantUid,
      consultantName: String(p.displayName ?? ""),
      consultantEmail: String(p.email ?? ""),
      client,
      endClient: String(raw.endClient ?? "").trim().slice(0, 160),
      jobTitle,
      startDate,
      endDate,
      poNumber: String(raw.poNumber ?? "").trim().slice(0, 80),
      status: raw.status === "ended" ? "ended" : "active",
      createdAt: existing.exists ? existing.data()!.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Rates are written to a parallel document the consultant can never read.
  await db
    .collection("assignmentRates")
    .doc(ref.id)
    .set(
      {
        assignmentId: ref.id,
        billRate: Math.round(billRate * 100) / 100,
        payRate: Math.round(payRate * 100) / 100,
        otMultiplier: Number.isFinite(otMultiplier) && otMultiplier > 0 ? otMultiplier : 1.5,
        currency: String(raw.currency ?? "USD").trim().slice(0, 8) || "USD",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  const saved = await ref.get();
  const d = saved.data()!;
  return {
    id: ref.id,
    consultantUid,
    consultantName: String(d.consultantName ?? ""),
    consultantEmail: String(d.consultantEmail ?? ""),
    client: String(d.client ?? ""),
    endClient: String(d.endClient ?? ""),
    jobTitle: String(d.jobTitle ?? ""),
    startDate: String(d.startDate ?? ""),
    endDate: d.endDate ? String(d.endDate) : null,
    poNumber: String(d.poNumber ?? ""),
    status: d.status === "ended" ? "ended" : "active",
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
  };
}

// ---- Weekly timesheets ------------------------------------------------------

function weekDays(weekStart: string): string[] {
  const out: string[] = [];
  const [y, m, d] = weekStart.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

/** Monday check, done from the date itself so a client can't invent a week. */
function isMonday(weekStart: string): boolean {
  if (!DATE_RE.test(weekStart)) return false;
  const [y, m, d] = weekStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

/**
 * A consultant filing their own week.
 *
 * Mirrors the checks in src/lib/consultantWeek.ts — the client shows them, this
 * enforces them. Once submitted a week is out of the consultant's hands; only a
 * rejection puts it back.
 */
export async function submitTimesheet(
  actor: UserProfile,
  assignmentId: string,
  weekStart: string,
  hoursRaw: unknown,
  note: string
): Promise<ConsultantTimesheet> {
  if (actor.role !== "consultant") throw new Error("Only a consultant files these timesheets.");
  if (!isMonday(weekStart)) throw new Error("A timesheet week has to start on a Monday.");

  const db = getFirestore();
  const aSnap = await db.collection("assignments").doc(String(assignmentId)).get();
  if (!aSnap.exists) throw new Error("That assignment doesn't exist.");
  const a = aSnap.data()!;
  if (a.consultantUid !== actor.uid) throw new Error("That isn't your assignment.");

  const days = weekDays(weekStart);
  const allowed = new Set(days);
  const today = new Date().toISOString().slice(0, 10);
  const hours: Record<string, number> = {};
  let total = 0;
  for (const [date, value] of Object.entries((hoursRaw ?? {}) as Record<string, unknown>)) {
    if (!allowed.has(date)) throw new Error(`${date} isn't in the week beginning ${weekStart}.`);
    const h = Number(value);
    if (!Number.isFinite(h) || h < 0) throw new Error(`Hours for ${date} must be a number.`);
    if (h > MAX_HOURS_PER_DAY) throw new Error(`${date} has more than ${MAX_HOURS_PER_DAY} hours.`);
    if (h > 0 && date > today) throw new Error(`${date} hasn't happened yet.`);
    if (h > 0) {
      hours[date] = Math.round(h * 100) / 100;
      total += h;
    }
  }
  total = Math.round(total * 100) / 100;
  if (total <= 0) throw new Error("Enter the hours you worked before submitting.");
  // Hours before the assignment started, or after it ended, can't be billed.
  for (const date of Object.keys(hours)) {
    if (date < String(a.startDate ?? "")) throw new Error(`${date} is before this assignment started.`);
    if (a.endDate && date > String(a.endDate)) throw new Error(`${date} is after this assignment ended.`);
  }

  const id = `${assignmentId}_${weekStart}`;
  const ref = db.collection("consultantTimesheets").doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    const st = existing.data()!.status as TimesheetStatus;
    if (st === "submitted") throw new Error("This week is already submitted and waiting for approval.");
    if (st === "approved") throw new Error("This week has been approved and can't be changed.");
  }

  const regular = Math.min(total, OT_THRESHOLD_HOURS);
  await ref.set(
    {
      assignmentId,
      consultantUid: actor.uid,
      consultantName: actor.displayName || actor.email,
      client: String(a.client ?? ""),
      weekStart,
      hours,
      total,
      regular: Math.round(regular * 100) / 100,
      overtime: Math.round((total - regular) * 100) / 100,
      status: "submitted" as TimesheetStatus,
      note: String(note ?? "").slice(0, 1000),
      submittedAt: FieldValue.serverTimestamp(),
      decidedByUid: null,
      decidedByName: null,
      decidedAt: null,
      decisionNote: "",
    },
    { merge: true }
  );
  const saved = await ref.get();
  return rowToTimesheet(id, saved.data()!);
}

/** A manager or admin approving or rejecting a submitted week. */
export async function decideTimesheet(
  actor: UserProfile,
  id: string,
  decision: "approved" | "rejected",
  decisionNote: string
): Promise<ConsultantTimesheet> {
  requireStaff(actor);
  if (decision !== "approved" && decision !== "rejected") throw new Error("Unknown decision.");
  const db = getFirestore();
  const ref = db.collection("consultantTimesheets").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw new Error("That timesheet doesn't exist.");
  const st = snap.data()!.status as TimesheetStatus;
  if (st !== "submitted") throw new Error(`This week is ${st}, so there's nothing to decide.`);

  await ref.set(
    {
      status: decision,
      decidedByUid: actor.uid,
      decidedByName: actor.displayName || actor.email,
      decidedAt: FieldValue.serverTimestamp(),
      decisionNote: String(decisionNote ?? "").slice(0, 1000),
    },
    { merge: true }
  );
  const saved = await ref.get();
  return rowToTimesheet(ref.id, saved.data()!);
}

function rowToTimesheet(id: string, x: Record<string, unknown>): ConsultantTimesheet {
  return {
    id,
    assignmentId: String(x.assignmentId ?? ""),
    consultantUid: String(x.consultantUid ?? ""),
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
