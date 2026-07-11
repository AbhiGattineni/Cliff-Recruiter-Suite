// Client wrappers around the Cloud Functions that proxy the Ceipal report APIs.
// The functions hold the Ceipal credentials; the browser never sees them.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";

export type CeipalReportKey = "job_duration" | "submissions";

interface CeipalResponse {
  ok: boolean;
  data: unknown;
  error?: string;
}

/**
 * Fetch one of the two Ceipal custom reports through the Cloud Function.
 * By default this reads the server-side cache (fast). Pass `{ refresh: true }`
 * to force a fresh pull from Ceipal (slower — repopulates the cache).
 * Returns the raw JSON payload (shape is normalised downstream).
 */
export async function fetchCeipalReport(
  report: CeipalReportKey,
  opts: { refresh?: boolean } = {}
): Promise<unknown> {
  ensureConfigured();
  const callable = httpsCallable<{ report: CeipalReportKey; refresh: boolean }, CeipalResponse>(
    functions,
    "ceipalReport",
    // A forced refresh pulls every page from Ceipal — can take minutes.
    { timeout: 540_000 }
  );
  const res = await callable({ report, refresh: opts.refresh === true });
  const payload = res.data;
  if (!payload?.ok) {
    throw new Error(payload?.error || "Ceipal request failed.");
  }
  return payload.data;
}

/** Read record_count / total_available / cache timestamp from a report envelope. */
export function reportMeta(data: unknown): { fetched: number; total: number; cachedAt: number | null } {
  const o = (data ?? {}) as { record_count?: number; total_available?: number; cachedAt?: number };
  return {
    fetched: Number(o.record_count) || 0,
    total: Number(o.total_available) || 0,
    cachedAt: o.cachedAt ?? null,
  };
}
