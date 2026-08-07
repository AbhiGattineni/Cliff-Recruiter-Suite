// Client wrappers for the signup OTP Cloud Functions + domain helpers.
//
// NOTE: Authentication is currently on hold — the app is open (see ProtectedRoute).
// These helpers stay here for when we wire auth up later (OTP via Cloud Functions,
// or Firebase's built-in email verification).

import { httpsCallable } from "firebase/functions";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, functions } from "../firebase";
import { ensureConfigured } from "./errors";

export const ALLOWED_DOMAIN = "cliff-services.com";

/** UX-side domain check (the Cloud Function enforces it authoritatively). */
export function isAllowedEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  return e.endsWith("@" + ALLOWED_DOMAIN);
}

export interface Actor {
  name: string;
  email: string;
}

/**
 * The currently signed-in user, as a display name + email. Passed to the save
 * callables so saved reports record who generated them (the Cloud Function
 * prefers the verified auth token, and falls back to this when the token's
 * `name` claim hasn't propagated yet — e.g. right after signup).
 */
export function currentActor(): Actor {
  const u = auth.currentUser;
  const email = u?.email ?? "";
  return { name: u?.displayName || email || "", email };
}

/**
 * Email a password-reset link (Firebase-hosted). Passwords are stored as
 * one-way hashes, so a forgotten password can only be reset, never looked up.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  ensureConfigured();
  await sendPasswordResetEmail(auth, email.trim());
}

