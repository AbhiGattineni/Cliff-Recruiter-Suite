// Getting a message out of the building.
//
// Two providers, because they fail in completely different ways and this
// project has hit the second one's failure mode already:
//
//   EmailJS  — an HTTPS POST with an API key. Nothing to configure in the
//              deploy, nothing to open in the network, and the credentials
//              live in Firestore so they can be changed from the portal
//              without a redeploy.
//   SMTP     — the older path. Still here because it costs nothing to keep
//              and it is the way out if the EmailJS quota runs dry.
//
// EmailJS wins when it is configured, because configuring it is the thing an
// admin can actually do; SMTP needs someone with shell access to the repo.
//
// Neither is asked to think about *what* it is sending. This module takes a
// finished subject/text/html and gets it delivered, and that is all.

import nodemailer, { Transporter } from "nodemailer";
import { getFirestore } from "firebase-admin/firestore";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface EmailJsConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey: string;
}

export interface MailConfig {
  emailjs: EmailJsConfig | null;
  smtpPassword: string;
}

function env(name: string, fallback = ""): string {
  const v = process.env[name] ?? fallback;
  return v.startsWith("PLACEHOLDER") ? "" : v;
}

// ---- Where the EmailJS credentials live ------------------------------------
//
// Firestore, not a Cloud Functions secret, and not functions/.env.
//
// .env is out because the GitHub Actions deploy never writes one — every
// non-secret setting this codebase "reads from env" in production is in fact
// reading the fallback next to it in the source. A value that only exists on
// somebody's laptop is not configuration.
//
// Secret Manager is out because binding a new secret makes the deploy service
// account set an IAM policy on it, which it is not allowed to do here; that
// 403 has cost this project two deploys already. Firestore needs no new
// permission, no redeploy, and lets the private key be rotated from the
// Preferences page.
//
// The trade is that the key sits in a Firestore document rather than Secret
// Manager. It is scoped in firestore.rules to admins only — no consultant, no
// recruiter, no manager — and what it grants is "send email through the Cliff
// Services EmailJS account", which is the blast radius of the feature itself.

export const EMAILJS_DOC = "appSettings/emailjs";

/** Trimmed, and blank unless all four parts are present. */
function normalizeEmailJs(d: Record<string, unknown>): EmailJsConfig | null {
  const s = (k: string) => String(d[k] ?? "").trim();
  const cfg: EmailJsConfig = {
    serviceId: s("serviceId"),
    templateId: s("templateId"),
    publicKey: s("publicKey"),
    privateKey: s("privateKey"),
  };
  // Three-quarters configured is not configured. Sending with a missing piece
  // produces an EmailJS error an hour later in a log nobody is reading.
  return cfg.serviceId && cfg.templateId && cfg.publicKey && cfg.privateKey ? cfg : null;
}

/**
 * The stored EmailJS credentials, or null.
 *
 * Environment variables win when set, so the emulator can be pointed at a
 * throwaway EmailJS service without touching the production document.
 */
export async function readEmailJsConfig(): Promise<EmailJsConfig | null> {
  const fromEnv = normalizeEmailJs({
    serviceId: env("EMAILJS_SERVICE_ID"),
    templateId: env("EMAILJS_TEMPLATE_ID"),
    publicKey: env("EMAILJS_PUBLIC_KEY"),
    privateKey: env("EMAILJS_PRIVATE_KEY"),
  });
  if (fromEnv) return fromEnv;

  try {
    const snap = await getFirestore().doc(EMAILJS_DOC).get();
    return normalizeEmailJs((snap.data() ?? {}) as Record<string, unknown>);
  } catch {
    // An unreadable settings document means "not configured", which the
    // callers already handle. It does not mean the digest should throw.
    return null;
  }
}

/** Everything needed to send, gathered in one place. */
export async function readMailConfig(smtpPassword: string): Promise<MailConfig> {
  return { emailjs: await readEmailJsConfig(), smtpPassword };
}

// ---- Which provider, and whether either is usable --------------------------

export type MailProvider = "emailjs" | "smtp" | "none";

export function mailProvider(cfg: MailConfig): MailProvider {
  if (cfg.emailjs) return "emailjs";
  if (env("SMTP_HOST") && env("SMTP_FROM") && cfg.smtpPassword) return "smtp";
  return "none";
}

export function mailConfigured(cfg: MailConfig): boolean {
  return mailProvider(cfg) !== "none";
}

/**
 * What is missing, phrased for whoever has to fix it.
 *
 * A send that fails with "Invalid login" three layers down is much harder to
 * act on than being told up front which settings are blank — and with two
 * providers it also has to say *which* of the two it is talking about, or the
 * advice sends people to the wrong screen.
 */
export function mailMissing(cfg: MailConfig): string[] {
  if (mailConfigured(cfg)) return [];
  // Partial EmailJS config is the more likely half-finished state now, so name
  // its gaps rather than listing SMTP settings nobody intends to set.
  const partial = anyEmailJsFieldSet();
  if (partial) return missingEmailJsFields();

  return [
    "the EmailJS settings in Preferences (service ID, template ID, public key, private key)",
    "— or, for SMTP instead: SMTP_HOST, SMTP_FROM and the SMTP_PASS secret",
  ];
}

// These two only look at env, because a partially-filled Firestore document is
// reported by the client that wrote it; this path exists for emulator runs.
function anyEmailJsFieldSet(): boolean {
  return !!(
    env("EMAILJS_SERVICE_ID") ||
    env("EMAILJS_TEMPLATE_ID") ||
    env("EMAILJS_PUBLIC_KEY") ||
    env("EMAILJS_PRIVATE_KEY")
  );
}

function missingEmailJsFields(): string[] {
  const missing: string[] = [];
  if (!env("EMAILJS_SERVICE_ID")) missing.push("EMAILJS_SERVICE_ID");
  if (!env("EMAILJS_TEMPLATE_ID")) missing.push("EMAILJS_TEMPLATE_ID");
  if (!env("EMAILJS_PUBLIC_KEY")) missing.push("EMAILJS_PUBLIC_KEY");
  if (!env("EMAILJS_PRIVATE_KEY")) missing.push("EMAILJS_PRIVATE_KEY");
  return missing;
}

// ---- EmailJS ---------------------------------------------------------------

const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";

/**
 * EmailJS caps the size of a template parameter. The digest is normally a few
 * kilobytes, but a busy day with a long brief can grow it, and a rejected send
 * loses the whole digest. Past this size the plain-text body goes instead —
 * uglier, but it arrives.
 */
const MAX_HTML_CHARS = 45_000;

/**
 * The names the EmailJS template is expected to use.
 *
 * Documented here rather than only in the dashboard, because a template whose
 * field names drift from these fails silently: EmailJS happily accepts unknown
 * parameters and sends a blank email.
 */
function templateParams(msg: MailMessage, to: string): Record<string, string> {
  const oversized = msg.html.length > MAX_HTML_CHARS;
  return {
    to_email: to,
    subject: msg.subject,
    // `message` is the plain-text body, so a default EmailJS template — which
    // ships with {{message}} in it — produces something readable even before
    // anyone edits it.
    message: msg.text,
    // `message_html` is the real thing, for a template using {{{message_html}}}.
    message_html: oversized ? `<pre style="white-space:pre-wrap">${escapeHtml(msg.text)}</pre>` : msg.html,
    from_name: "Cliff Services",
    reply_to: env("SMTP_FROM") || to,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendViaEmailJs(msg: MailMessage, cfg: EmailJsConfig): Promise<void> {
  // One request per recipient, rather than one request with the rest bcc'd.
  //
  // Bcc would be cheaper against the monthly request allowance, but it depends
  // on the template having a Bcc field wired to a variable. If that field is
  // ever missing or renamed in the dashboard, the send still returns 200 and
  // everyone except the first recipient silently stops receiving the digest.
  // Paying a request each keeps delivery a property of this code.
  const failures: string[] = [];

  for (const to of msg.to) {
    try {
      await postEmailJs(msg, cfg, to);
    } catch (e) {
      failures.push(`${to}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // One bad address should not hide the fact that the other four were fine, so
  // this reports rather than aborting — but it does still throw, because a
  // digest that reached nobody must not be logged as sent.
  if (failures.length === msg.to.length) {
    throw new Error(`EmailJS rejected every recipient — ${failures.join("; ")}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `Sent to ${msg.to.length - failures.length} of ${msg.to.length} recipients; failed for ${failures.join("; ")}`
    );
  }
}

async function postEmailJs(msg: MailMessage, cfg: EmailJsConfig, to: string): Promise<void> {
  const res = await fetch(EMAILJS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: cfg.serviceId,
      template_id: cfg.templateId,
      user_id: cfg.publicKey,
      // The private key. Required for any call that did not come from a
      // browser, which is all of them here.
      accessToken: cfg.privateKey,
      template_params: templateParams(msg, to),
    }),
  });

  // Success is the literal string "OK", not JSON.
  const body = (await res.text()).trim();
  if (res.ok) return;

  throw new Error(explainEmailJsError(res.status, body));
}

/**
 * EmailJS answers with a bare status and a one-line reason. Two of those
 * reasons are things nobody guesses from the wording, so they get translated
 * into the action that fixes them.
 */
function explainEmailJsError(status: number, body: string): string {
  const reason = body.slice(0, 300) || `HTTP ${status}`;

  if (/non-?browser|disabled for non/i.test(body)) {
    return `EmailJS is refusing API calls from a server (${reason}). Turn on "Allow EmailJS API for non-browser applications" in the EmailJS dashboard under Account → Security.`;
  }
  if (status === 403 || /invalid.*(user|public).*(id|key)|api calls are disabled/i.test(body)) {
    return `EmailJS rejected the credentials (${reason}). Check the public and private keys, and that non-browser API calls are enabled under Account → Security.`;
  }
  if (status === 400 && /template/i.test(body)) {
    return `EmailJS rejected the template (${reason}). Check the template ID, and that its "To Email" field is set to {{to_email}}.`;
  }
  if (status === 402 || /limit|quota/i.test(body)) {
    return `The EmailJS monthly request allowance is used up (${reason}).`;
  }
  return `EmailJS refused the send (HTTP ${status}): ${reason}`;
}

// ---- SMTP ------------------------------------------------------------------

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

async function sendViaSmtp(msg: MailMessage, password: string): Promise<void> {
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

// ---- The one entry point ---------------------------------------------------

export async function sendMail(msg: MailMessage, cfg: MailConfig): Promise<void> {
  if (msg.to.length === 0) throw new Error("No recipients to send to.");

  switch (mailProvider(cfg)) {
    case "emailjs":
      return sendViaEmailJs(msg, cfg.emailjs as EmailJsConfig);
    case "smtp":
      return sendViaSmtp(msg, cfg.smtpPassword);
    default:
      throw new Error(`Email isn't configured — missing ${mailMissing(cfg).join(", ")}.`);
  }
}
