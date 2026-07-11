// Client wrappers for the signup OTP Cloud Functions + domain helpers.
//
// NOTE: Authentication is currently on hold — the app is open (see ProtectedRoute).
// These helpers stay here for when we wire auth up later (OTP via Cloud Functions,
// or Firebase's built-in email verification).

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";

export const ALLOWED_DOMAIN = "cliff-services.com";

/** UX-side domain check (the Cloud Function enforces it authoritatively). */
export function isAllowedEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  return e.endsWith("@" + ALLOWED_DOMAIN);
}

interface RequestOtpResult {
  ok: boolean;
  devOtp?: string; // only present when the backend runs in OTP_DEV_MODE
}

interface VerifyResult {
  ok: boolean;
}

export async function requestSignupOtp(
  email: string,
  password: string,
  displayName: string
): Promise<RequestOtpResult> {
  ensureConfigured();
  const callable = httpsCallable<
    { email: string; password: string; displayName: string },
    RequestOtpResult
  >(functions, "requestSignupOtp");
  const res = await callable({ email: email.trim(), password, displayName: displayName.trim() });
  return res.data;
}

export async function verifySignupOtp(email: string, otp: string): Promise<VerifyResult> {
  ensureConfigured();
  const callable = httpsCallable<{ email: string; otp: string }, VerifyResult>(
    functions,
    "verifySignupOtp"
  );
  const res = await callable({ email: email.trim(), otp: otp.trim() });
  return res.data;
}
