// Client wrapper for the optional LinkedIn data-provider lookup.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { LinkedinSignals, LinkedinAssessment } from "./linkedinScore";

// What gets stored on a resume report.
export interface LinkedinCheck {
  profileUrl: string;
  signals: LinkedinSignals;
  assessment: LinkedinAssessment;
  source: "manual" | "provider";
  checkedAt: number; // epoch ms
}

export interface LookupResult {
  configured: boolean;
  signals: LinkedinSignals | null;
  message?: string;
}

/**
 * Ask the backend for profile signals. LinkedIn has no public API for
 * third-party profiles, so this only returns data when a commercial provider is
 * configured; otherwise `configured` is false and the recruiter fills the form in.
 */
export async function lookupLinkedin(profileUrl: string): Promise<LookupResult> {
  ensureConfigured();
  const callable = httpsCallable<
    { profileUrl: string },
    { ok: boolean; configured: boolean; signals?: LinkedinSignals; message?: string; error?: string }
  >(functions, "linkedinLookup");
  const res = await callable({ profileUrl });
  const d = res.data;
  if (!d?.ok) throw new Error(d?.error || "LinkedIn lookup failed.");
  return { configured: !!d.configured, signals: d.signals ?? null, message: d.message };
}
