// Notification emails: leave requests and Work Board tickets.
//
// Deliberately a different mailbox from the meeting digest. The digest's
// EmailJS account has a small allowance (about 300 sends), and a busy board can
// burn through that in a morning — at which point tonight's digest silently
// fails. So these emails have their own account, configured in Preferences and
// stored in `appSettings/notifyEmail`, which only admins can read or write.
//
// Same storage reasoning as the EmailJS settings in mail.ts: Firestore rather
// than Secret Manager, because binding a new secret needs an IAM permission the
// deploy account does not have here, and rather than .env, because the GitHub
// deploy never writes one.
//
// Every send here is best-effort. A leave request or a ticket change must never
// fail because an email could not go out — the caller logs and carries on.

import nodemailer, { Transporter } from "nodemailer";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { sendViaEmailJs, EmailJsConfig, MailMessage } from "./mail.js";
import { getProfile, LeaveRequest, Role, STAFF_EMAIL_DOMAIN, UserProfile } from "./timesheets.js";

export const NOTIFY_DOC = "appSettings/notifyEmail";
const DEFAULT_PORTAL_URL = "https://portal.cliffservices.com";

// ---- Settings ----------------------------------------------------------------

export interface NotifyEvents {
  leaveRequested: boolean; // employee applies → admins and managers who can decide it
  leaveDecided: boolean; // approved / rejected → the employee
  ticketAssigned: boolean; // assigned a ticket → the new assignee
  ticketUpdated: boolean; // any other change or comment → assignee and reporter
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string; // the sending address
  fromName: string;
}

export interface NotifySettings {
  enabled: boolean;
  provider: "smtp" | "emailjs";
  smtp: SmtpSettings;
  emailjs: EmailJsConfig | null;
  events: NotifyEvents;
  portalUrl: string;
}

const s = (v: unknown) => String(v ?? "").trim();

export async function readNotifySettings(): Promise<NotifySettings> {
  let d: Record<string, unknown> = {};
  try {
    d = ((await getFirestore().doc(NOTIFY_DOC).get()).data() ?? {}) as Record<string, unknown>;
  } catch {
    /* unreadable → treated as "not configured" below */
  }
  const smtp = (d.smtp ?? {}) as Record<string, unknown>;
  const ej = (d.emailjs ?? {}) as Record<string, unknown>;
  const ev = (d.events ?? {}) as Record<string, unknown>;
  const emailjs: EmailJsConfig = {
    serviceId: s(ej.serviceId),
    templateId: s(ej.templateId),
    publicKey: s(ej.publicKey),
    privateKey: s(ej.privateKey),
  };
  return {
    // Absent means off, like the digest: nothing starts mailing people the
    // moment the code ships.
    enabled: d.enabled === true,
    provider: d.provider === "emailjs" ? "emailjs" : "smtp",
    smtp: {
      host: s(smtp.host),
      port: Number(smtp.port) || 587,
      user: s(smtp.user),
      password: String(smtp.password ?? ""),
      from: s(smtp.from),
      fromName: s(smtp.fromName) || "Cliff Recruiter Suite",
    },
    emailjs: emailjs.serviceId && emailjs.templateId && emailjs.publicKey && emailjs.privateKey ? emailjs : null,
    // Each event defaults to on once the feature itself is switched on.
    events: {
      leaveRequested: ev.leaveRequested !== false,
      leaveDecided: ev.leaveDecided !== false,
      ticketAssigned: ev.ticketAssigned !== false,
      ticketUpdated: ev.ticketUpdated !== false,
    },
    portalUrl: (s(d.portalUrl) || DEFAULT_PORTAL_URL).replace(/\/+$/, ""),
  };
}

/** What is missing, in words an admin can act on. Empty when sending can work. */
export function notifyMissing(cfg: NotifySettings): string[] {
  if (cfg.provider === "emailjs") {
    return cfg.emailjs ? [] : ["the EmailJS service ID, template ID, public key and private key"];
  }
  const m: string[] = [];
  if (!cfg.smtp.host) m.push("SMTP server");
  if (!cfg.smtp.from) m.push("From address");
  if (cfg.smtp.user && !cfg.smtp.password) m.push("SMTP password");
  return m;
}

// ---- Sending -----------------------------------------------------------------

let cached: { key: string; t: Transporter } | null = null;

function smtpTransport(c: SmtpSettings): Transporter {
  const key = `${c.host}:${c.port}:${c.user}:${c.password.length}`;
  if (cached?.key === key) return cached.t;
  const t = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465, // 465 is implicit TLS; 587 upgrades with STARTTLS
    auth: c.user ? { user: c.user, pass: c.password } : undefined,
  });
  cached = { key, t };
  return t;
}

/** One email per recipient, so nobody sees who else was told. */
async function deliver(cfg: NotifySettings, msg: MailMessage): Promise<void> {
  const missing = notifyMissing(cfg);
  if (missing.length) throw new Error(`Notification email isn't configured — missing ${missing.join(", ")}.`);
  if (cfg.provider === "emailjs") return sendViaEmailJs(msg, cfg.emailjs as EmailJsConfig);

  const t = smtpTransport(cfg.smtp);
  const failures: string[] = [];
  for (const to of msg.to) {
    try {
      await t.sendMail({
        from: { name: cfg.smtp.fromName, address: cfg.smtp.from },
        to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    } catch (e) {
      failures.push(`${to}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failures.length) throw new Error(`Failed for ${failures.join("; ")}`);
}

/** Only company addresses get these — a typed-in external address is never mailed. */
function staffOnly(emails: (string | null | undefined)[], exclude: string[] = []): string[] {
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const out = new Set<string>();
  for (const e of emails) {
    const x = s(e).toLowerCase();
    if (x && x.endsWith("@" + STAFF_EMAIL_DOMAIN) && !skip.has(x)) out.add(x);
  }
  return [...out];
}

async function sendIfOn(event: keyof NotifyEvents, build: (cfg: NotifySettings) => Promise<MailMessage | null>) {
  try {
    const cfg = await readNotifySettings();
    if (!cfg.enabled || !cfg.events[event] || notifyMissing(cfg).length) return;
    const msg = await build(cfg);
    if (!msg || msg.to.length === 0) return;
    await deliver(cfg, msg);
    logger.info("notify: sent", { event, recipients: msg.to.length });
  } catch (e) {
    // Never let an email failure undo the thing it was announcing.
    logger.warn("notify: failed", { event, error: e instanceof Error ? e.message : String(e) });
  }
}

// ---- Layout --------------------------------------------------------------------

function esc(x: string): string {
  return x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(title: string, rows: [string, string][], intro: string, button: { label: string; url: string }, extra = ""): string {
  const table = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px 6px 0;color:#5b6577;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#1f2933">${esc(v)}</td></tr>`
    )
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;color:#1f2933">
    <h2 style="margin:0 0 8px;font-size:18px;color:#0b1220">${esc(title)}</h2>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.5">${intro}</p>
    ${table ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px">${table}</table>` : ""}
    ${extra}
    <p style="margin:18px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#4a2fc4;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${esc(button.label)}</a></p>
    <p style="font-size:12px;color:#5b6577;margin:20px 0 0">Sent by the Cliff Recruiter Suite. You get this because you're involved in this ${title.toLowerCase().includes("leave") ? "leave request" : "ticket"}.</p>
  </div>`;
}

function textOf(title: string, rows: [string, string][], intro: string, url: string, extra = ""): string {
  return [title, "", intro, "", ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), extra ? `\n${extra}` : "", "", url]
    .filter((x) => x !== undefined)
    .join("\n");
}

// ---- Leave ---------------------------------------------------------------------

const LEAVE_TYPE: Record<string, string> = { half: "Half day", full: "Full day", multi: "Multiple days" };

function leaveDates(l: LeaveRequest): string {
  return l.startDate === l.endDate ? l.startDate : `${l.startDate} to ${l.endDate}`;
}

/** Who may decide a request, mirroring canDecide in timesheets.ts. */
function approverRoles(requester: Role): Role[] {
  return requester === "employee" || requester === "benchsales" ? ["admin", "manager"] : ["admin"];
}

export function notifyLeaveRequested(leave: LeaveRequest): Promise<void> {
  return sendIfOn("leaveRequested", async (cfg) => {
    const snap = await getFirestore().collection("userProfiles").where("role", "in", approverRoles(leave.role)).get();
    const to = staffOnly(
      snap.docs.filter((d) => d.data().active !== false && d.id !== leave.uid).map((d) => String(d.data().email ?? "")),
      [leave.email]
    );
    const who = leave.displayName || leave.email;
    const rows: [string, string][] = [
      ["Employee", `${who} (${leave.email})`],
      ["Type", LEAVE_TYPE[leave.leaveType] ?? leave.leaveType],
      ["Dates", leaveDates(leave)],
      ["Reason", leave.reason],
    ];
    const url = `${cfg.portalUrl}/timesheets`;
    const intro = `${esc(who)} has requested leave and is waiting for a decision.`;
    return {
      to,
      subject: `Leave request: ${who} — ${leaveDates(leave)}`,
      html: layout("New leave request", rows, intro, { label: "Review in the portal", url }),
      text: textOf("New leave request", rows, `${who} has requested leave and is waiting for a decision.`, url),
    };
  });
}

export function notifyLeaveDecided(leave: LeaveRequest): Promise<void> {
  return sendIfOn("leaveDecided", async (cfg) => {
    const approved = leave.status === "approved";
    const by = leave.decidedByName || leave.decidedByEmail || "a manager";
    const rows: [string, string][] = [
      ["Decision", approved ? "Approved" : "Rejected"],
      ["Type", LEAVE_TYPE[leave.leaveType] ?? leave.leaveType],
      ["Dates", leaveDates(leave)],
      ["Decided by", by],
      ["Note", leave.decisionNote],
    ];
    const url = `${cfg.portalUrl}/timesheets`;
    const title = approved ? "Leave approved" : "Leave rejected";
    return {
      to: staffOnly([leave.email]),
      subject: `Your leave for ${leaveDates(leave)} was ${approved ? "approved" : "rejected"}`,
      html: layout(title, rows, `Your leave request has been <strong>${approved ? "approved" : "rejected"}</strong> by ${esc(by)}.`, { label: "Open the portal", url }),
      text: textOf(title, rows, `Your leave request has been ${approved ? "approved" : "rejected"} by ${by}.`, url),
    };
  });
}

// ---- Work Board ------------------------------------------------------------------

const STATUS: Record<string, string> = { todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done" };
const TYPE: Record<string, string> = { story: "Story", task: "Task", bug: "Bug", epic: "Epic" };
const PRIORITY: Record<string, string> = { highest: "Highest", high: "High", medium: "Medium", low: "Low" };
const FIELD: Record<string, string> = {
  title: "Title",
  type: "Type",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  storyPoints: "Story points",
  dueDate: "Due date",
  labels: "Labels",
  description: "Description",
};

function shown(field: string, v: unknown): string {
  const x = s(v);
  if (!x) return field === "assignee" ? "Unassigned" : "none";
  if (field === "status") return STATUS[x] ?? x;
  if (field === "type") return TYPE[x] ?? x;
  if (field === "priority") return PRIORITY[x] ?? x;
  return x;
}

type Change = { field: string; from: unknown; to: unknown };

/** One line per history entry, worded like the History tab. */
function describe(action: string, changes: Change[], actor: string): string[] {
  const c0 = changes[0];
  switch (action) {
    case "created":
      return [`${actor} created this ticket.`];
    case "commented":
      return [`${actor} commented:`, `“${s(c0?.to)}”`];
    case "comment_edited":
      return [`${actor} edited a comment:`, `Before: “${s(c0?.from)}”`, `After: “${s(c0?.to)}”`];
    case "comment_deleted":
      return [`${actor} deleted a comment:`, `“${s(c0?.from)}”`];
    default:
      return changes.map((c) =>
        c.field === "description"
          ? `${actor} updated the description.`
          : `${actor} changed ${FIELD[c.field] ?? c.field}: ${shown(c.field, c.from)} → ${shown(c.field, c.to)}`
      );
  }
}

/**
 * The client calls this right after it writes a history entry. It names the
 * entry; everything else — who changed what, who to tell — is read back from
 * Firestore here, so a caller can't make the portal send arbitrary mail.
 */
export async function notifyBoardHandler(request: CallableRequest) {
  const uid = request.auth?.uid;
  const email = s(request.auth?.token?.email).toLowerCase();
  if (!uid || !email) throw new HttpsError("unauthenticated", "Sign in first.");
  const profile = await getProfile(uid);
  if (!profile || profile.role === "consultant" || profile.active === false) {
    throw new HttpsError("permission-denied", "Staff only.");
  }

  const issueId = s(request.data?.issueId);
  const activityId = s(request.data?.activityId);
  if (!issueId || !activityId || issueId.includes("/") || activityId.includes("/")) {
    throw new HttpsError("invalid-argument", "issueId and activityId are required.");
  }

  const db = getFirestore();
  const issueRef = db.collection("boardIssues").doc(issueId);
  const [issueSnap, actSnap] = await Promise.all([issueRef.get(), issueRef.collection("activity").doc(activityId).get()]);
  if (!issueSnap.exists || !actSnap.exists) return { ok: true, sent: false, reason: "Not found." };

  const act = actSnap.data()!;
  // Only the person who made the change can announce it, and only while it's fresh.
  if (s(act.actor).toLowerCase() !== email) throw new HttpsError("permission-denied", "That change isn't yours.");
  const at = (act.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? Date.now();
  if (Date.now() - at > 15 * 60 * 1000) return { ok: true, sent: false, reason: "Too old." };

  // Once per history entry, however many times the client retries.
  try {
    await db.collection("boardNotifications").doc(`${issueId}_${activityId}`).create({ at: FieldValue.serverTimestamp() });
  } catch {
    return { ok: true, sent: false, reason: "Already sent." };
  }

  const issue = issueSnap.data()!;
  const action = s(act.action);
  const changes: Change[] = Array.isArray(act.changes) ? (act.changes as Change[]) : [];
  const actorName = profile.displayName || email;
  const key = s(issue.key);
  const title = s(issue.title);
  const assignee = s(issue.assignee).toLowerCase();
  const reporter = s(issue.reporter).toLowerCase();

  // Who was just given the ticket, if anyone.
  const assignChange = changes.find((c) => c.field === "assignee" && s(c.to));
  const newlyAssigned = action === "created" ? assignee : assignChange ? s(assignChange.to).toLowerCase() : "";

  const lines = describe(action, changes, actorName);
  const rows = (_cfg: NotifySettings): [string, string][] => [
    ["Ticket", `${key} — ${title}`],
    ["Status", shown("status", issue.status)],
    ["Priority", shown("priority", issue.priority)],
    ["Assignee", shown("assignee", issue.assignee)],
    ["Due", s(issue.dueDate)],
  ];
  const changeHtml = `<div style="background:#f5f3ff;border-left:3px solid #4a2fc4;border-radius:0 6px 6px 0;padding:10px 12px;font-size:14px;line-height:1.5;margin:0 0 6px">${lines.map(esc).join("<br>")}</div>`;

  const jobs: Promise<void>[] = [];

  if (newlyAssigned && newlyAssigned !== email) {
    jobs.push(
      sendIfOn("ticketAssigned", async (cfg) => ({
        to: staffOnly([newlyAssigned]),
        subject: `[${key}] Assigned to you: ${title}`,
        html: layout("Ticket assigned to you", rows(cfg), `${esc(actorName)} assigned you a ticket on the Work Board.`, { label: "Open the Work Board", url: `${cfg.portalUrl}/board` }, changeHtml),
        text: textOf("Ticket assigned to you", rows(cfg), `${actorName} assigned you a ticket on the Work Board.`, `${cfg.portalUrl}/board`, lines.join("\n")),
      }))
    );
  }

  // Everyone else involved hears about the change — but not the person who made it,
  // and not someone who just got the "assigned to you" email for the same change.
  if (action !== "created") {
    jobs.push(
      sendIfOn("ticketUpdated", async (cfg) => ({
        to: staffOnly([assignee, reporter], [email, newlyAssigned]),
        subject: `[${key}] ${title} — ${lines[0].replace(/[:.]$/, "")}`,
        html: layout("Ticket updated", rows(cfg), `There's an update on a ticket you're involved in.`, { label: "Open the Work Board", url: `${cfg.portalUrl}/board` }, changeHtml),
        text: textOf("Ticket updated", rows(cfg), "There's an update on a ticket you're involved in.", `${cfg.portalUrl}/board`, lines.join("\n")),
      }))
    );
  }

  await Promise.all(jobs);
  return { ok: true, sent: true };
}

/** Admin "Send test email" in Preferences — uses the saved settings, sends to the admin. */
export async function notifyTestHandler(request: CallableRequest) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const profile: UserProfile | null = await getProfile(uid);
  if (!profile || profile.role !== "admin") throw new HttpsError("permission-denied", "Admins only.");

  const cfg = await readNotifySettings();
  const missing = notifyMissing(cfg);
  if (missing.length) throw new HttpsError("failed-precondition", `Missing ${missing.join(", ")}. Save the settings first.`);

  const to = staffOnly([s(request.data?.to) || profile.email]);
  if (to.length === 0) throw new HttpsError("invalid-argument", `Test emails go to @${STAFF_EMAIL_DOMAIN} addresses only.`);

  try {
    await deliver(cfg, {
      to,
      subject: "Test: Cliff Recruiter Suite notifications",
      html: layout("Notification email works", [["Provider", cfg.provider === "smtp" ? `SMTP (${cfg.smtp.host}:${cfg.smtp.port})` : "EmailJS"]], "This is a test from Preferences. Leave and ticket emails will be sent from this account.", { label: "Open the portal", url: cfg.portalUrl }),
      text: "This is a test from Preferences. Leave and ticket emails will be sent from this account.",
    });
  } catch (e) {
    throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e));
  }
  return { ok: true, to, provider: cfg.provider };
}