// Central place to turn any thrown value into a clear, human-readable message,
// and to stop backend calls early when the app isn't configured yet.

import { isPlaceholderConfig } from "../firebase";

/** An error whose message is already user-friendly and can be shown as-is. */
export class AppError extends Error {}

export const NOT_CONFIGURED_MSG =
  "The app isn't connected to Firebase yet. Add your Firebase web config to .env and deploy the " +
  "Cloud Functions, then reload the page. (See README for setup.)";

/**
 * Throw a friendly error before making a network call if the app is still on
 * placeholder config — this avoids the raw CORS / “Failed to fetch” console error.
 */
export function ensureConfigured(): void {
  if (isPlaceholderConfig) {
    throw new AppError(NOT_CONFIGURED_MSG);
  }
}

const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/user-disabled":
    "This account hasn't been verified yet. Please finish signup and enter the OTP sent to your email.",
  "auth/email-already-in-use": "An account already exists with this email. Please sign in instead.",
  "auth/too-many-requests": "Too many attempts. Please wait a little while and try again.",
  "auth/invalid-email": "That email address doesn't look valid.",
  "auth/weak-password": "Password is too weak — use at least 6 characters.",
  "auth/network-request-failed": "Network error. Check your internet connection and try again.",
  "auth/operation-not-allowed":
    "Email/password sign-in is not enabled for this Firebase project (enable it in the console).",
};

// Firebase Functions codes we may hit when a call can't complete.
const FUNCTION_FALLBACKS: Record<string, string> = {
  "functions/unavailable": "Can't reach the server right now. Please try again in a moment.",
  // A failed fetch to a non-existent callable surfaces as functions/internal with a
  // generic message — most often it means the Cloud Functions aren't deployed yet.
  "functions/internal":
    "This service isn't available yet — the Cloud Functions may not be deployed. Please try again later or contact your administrator.",
  "functions/not-found":
    "This service isn't available yet — the Cloud Functions may not be deployed. Please contact your administrator.",
  "functions/deadline-exceeded": "The request timed out. Please try again.",
  "functions/unauthenticated": "Please sign in and try again.",
};

/** Strip framework prefixes and trailing "(code/...)." noise from a raw message. */
function clean(message: string): string {
  return message
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^Firebase:\s*/i, "")
    .replace(/\s*\([a-z-]+\/[a-z-]+\)\.?$/i, "")
    .trim();
}

export function friendlyError(err: unknown): string {
  if (err instanceof AppError) return err.message;

  const e = err as { code?: string; message?: string; details?: unknown };
  const code = (e?.code ?? "").toString();
  const rawMessage = (e?.message ?? String(err)).toString();
  const haystack = `${code} ${rawMessage}`.toLowerCase();

  // Network / CORS / server-unreachable — the most common case when unconfigured.
  if (
    /failed to fetch|networkerror|err_failed|cors|network-request-failed|load failed/.test(haystack)
  ) {
    return isPlaceholderConfig
      ? NOT_CONFIGURED_MSG
      : "Can't reach the server. Check your connection, and make sure the Cloud Functions are deployed.";
  }

  // Firebase Auth error codes.
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];

  // Firebase Functions errors: our Cloud Functions set friendly HttpsError messages,
  // so prefer the server message; fall back to a per-code default otherwise.
  if (code.startsWith("functions/")) {
    const cleaned = clean(rawMessage);
    if (cleaned && !/^internal$/i.test(cleaned)) return cleaned;
    return FUNCTION_FALLBACKS[code] ?? "Something went wrong on the server. Please try again.";
  }

  const cleaned = clean(rawMessage);
  return cleaned || "Something went wrong. Please try again.";
}
