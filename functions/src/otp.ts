// OTP + domain helpers for self-service signup.

import crypto from "node:crypto";
import nodemailer from "nodemailer";

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends
export const MAX_ATTEMPTS = 5;

/** The only email domain allowed to register. Overridable via env. */
export function allowedDomain(): string {
  return (process.env.ALLOWED_EMAIL_DOMAIN || "cliff-services.com").toLowerCase();
}

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  const e = normalizeEmail(email);
  // Basic shape check + exact domain match.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  return e.endsWith("@" + allowedDomain());
}

/** Cryptographically-random 6-digit code, zero-padded. */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function makeSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashOtp(otp: string, salt: string): string {
  return crypto.createHash("sha256").update(salt + ":" + otp).digest("hex");
}

/** Constant-time comparison of two hex hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(pass: string): nodemailer.Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER, pass },
  });
  return transporter;
}

export function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST || "";
  return host.length > 0 && !host.startsWith("PLACEHOLDER");
}

export async function sendOtpEmail(email: string, otp: string, smtpPass: string): Promise<void> {
  const from = process.env.SMTP_FROM || `Cliff Recruiter Suite <no-reply@${allowedDomain()}>`;
  const t = getTransporter(smtpPass);
  await t.sendMail({
    from,
    to: email,
    subject: "Your Cliff Recruiter Suite verification code",
    text:
      `Your verification code is ${otp}\n\n` +
      `It is valid for 10 minutes. If you did not request this, you can ignore this email.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:440px;margin:auto">` +
      `<h2 style="color:#1f4e78">Cliff Recruiter Suite</h2>` +
      `<p>Your verification code is:</p>` +
      `<div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#1f4e78;` +
      `background:#e8f0f8;padding:14px 0;text-align:center;border-radius:8px">${otp}</div>` +
      `<p style="color:#6b7280;font-size:13px">Valid for 10 minutes. ` +
      `If you did not request this, you can ignore this email.</p></div>`,
  });
}
