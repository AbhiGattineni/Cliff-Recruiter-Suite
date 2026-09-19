// Who receives the daily meeting digest, and whether it runs at all.
//
// Read straight from Firestore and written the same way, under the admin check
// in firestore.rules — the same shape as `holidays`, and for the same reason:
// the rule is the whole of the logic, and a Cloud Function to restate it would
// cost CPU quota this project has already been refused twice.
//
// The scheduled job reads this document server-side, so the list here is the
// list that gets mailed.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { AppError, ensureConfigured } from "./errors";

const SETTINGS_PATH = ["appSettings", "meetingDigest"] as const;

/** Matches the cap in firestore.rules, which is what actually enforces it. */
export const MAX_RECIPIENTS = 25;

export interface DigestSettings {
  enabled: boolean;
  recipients: string[];
}

export const EMPTY_SETTINGS: DigestSettings = { enabled: false, recipients: [] };

export async function getDigestSettings(): Promise<DigestSettings> {
  ensureConfigured();
  const snap = await getDoc(doc(db, ...SETTINGS_PATH));
  if (!snap.exists()) return EMPTY_SETTINGS;
  const d = snap.data() as Record<string, unknown>;
  return {
    enabled: d.enabled === true,
    recipients: Array.isArray(d.recipients)
      ? d.recipients.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [],
  };
}

export async function saveDigestSettings(settings: DigestSettings): Promise<void> {
  ensureConfigured();
  if (settings.recipients.length > MAX_RECIPIENTS) {
    throw new AppError(`At most ${MAX_RECIPIENTS} recipients.`);
  }
  await setDoc(doc(db, ...SETTINGS_PATH), {
    enabled: settings.enabled,
    recipients: settings.recipients,
  });
}

/** Light enough to catch a typo, loose enough not to argue about valid addresses. */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export interface SendNowResult {
  sent: boolean;
  reason?: string;
  meetingCount: number;
  recipients: number;
  /** Which provider carried it. With two configured, "sent" alone is ambiguous. */
  provider?: "emailjs" | "smtp" | "none";
}

/**
 * Send a digest immediately, to whoever asked for it.
 *
 * Runs the same code the schedule runs — a test that exercises a different
 * path proves nothing about the 22:30 job.
 */
export async function sendDigestNow(daysAgo: number, to?: string[]): Promise<SendNowResult> {
  ensureConfigured();
  const callable = httpsCallable<
    { action: string; daysAgo: number; to?: string[] },
    SendNowResult & { ok: boolean }
  >(functions, "firefliesMeetings");
  const res = await callable({ action: "sendDigest", daysAgo, to });
  return res.data;
}

export interface DigestPreview {
  subject: string;
  html: string;
  text: string;
  meetingCount: number;
}

/**
 * Render the digest without sending it.
 *
 * Runs `buildDigest` server-side — the same function the 10:30pm job uses — so
 * what comes back is the mail, not a mock-up of it.
 */
export async function previewDigest(daysAgo: number): Promise<DigestPreview> {
  ensureConfigured();
  const callable = httpsCallable<{ action: string; daysAgo: number }, DigestPreview & { ok: boolean }>(
    functions,
    "firefliesMeetings",
    // The brief runs an LLM over every transcript of the day, same as a real
    // send; the default callable timeout is far too short for that.
    { timeout: 300_000 }
  );
  const res = await callable({ action: "previewDigest", daysAgo });
  return res.data;
}
