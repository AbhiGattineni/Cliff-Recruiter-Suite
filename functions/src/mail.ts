// SMTP sending.
//
// nodemailer has been a dependency since the OTP signup flow was scoped, but
// nothing ever sent a message — consultant invites use Firebase's own
// password-reset links precisely so there was no SMTP of ours to run. This is
// the first thing in the codebase that actually needs a mailbox.
//
// Config is split the way the rest of the project splits it: host, port, user
// and from-address are non-secret and live in functions/.env; only the password
// is a Cloud Functions secret.

import nodemailer, { Transporter } from "nodemailer";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

function env(name: string, fallback = ""): string {
  const v = process.env[name] ?? fallback;
  return v.startsWith("PLACEHOLDER") ? "" : v;
}

/** True when enough is configured to attempt a send. */
export function smtpConfigured(password: string): boolean {
  return !!env("SMTP_HOST") && !!env("SMTP_FROM") && !!password;
}

/**
 * What is missing, phrased for whoever has to fix it.
 *
 * A send that fails with "Invalid login" three layers down is much harder to
 * act on than being told up front which of five settings is blank.
 */
export function smtpMissing(password: string): string[] {
  const missing: string[] = [];
  if (!env("SMTP_HOST")) missing.push("SMTP_HOST");
  if (!env("SMTP_FROM")) missing.push("SMTP_FROM");
  if (!password) missing.push("SMTP_PASS (secret)");
  return missing;
}

// One transport per warm instance. Creating it per send re-does the TLS
// handshake every time, and a digest goes to several people at once.
let cached: { transporter: Transporter; key: string } | null = null;

function transport(password: string): Transporter {
  const host = env("SMTP_HOST");
  const port = Number(env("SMTP_PORT", "587")) || 587;
  const user = env("SMTP_USER");
  const key = `${host}:${port}:${user}`;

  if (cached && cached.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 and 25 start plaintext and STARTTLS up. Getting
    // this backwards is the usual cause of a hang rather than an error.
    secure: port === 465,
    auth: user ? { user, pass: password } : undefined,
  });

  cached = { transporter, key };
  return transporter;
}

export async function sendMail(msg: MailMessage, password: string): Promise<void> {
  const missing = smtpMissing(password);
  if (missing.length) {
    throw new Error(`Email isn't configured — missing ${missing.join(", ")}.`);
  }
  if (msg.to.length === 0) throw new Error("No recipients to send to.");

  await transport(password).sendMail({
    from: env("SMTP_FROM"),
    // bcc, not to: a digest is the same message to several people, and there is
    // no reason for each recipient to learn the others' addresses.
    bcc: msg.to,
    to: env("SMTP_FROM"),
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
