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
 * `maxRecords` caps how many rows are pulled (0 = fetch everything).
 * Returns the raw JSON payload from Ceipal (shape is normalised downstream).
 */
export async function fetchCeipalReport(
  report: CeipalReportKey,
  maxRecords = 0
): Promise<unknown> {
  ensureConfigured();
  const callable = httpsCallable<{ report: CeipalReportKey; maxRecords: number }, CeipalResponse>(
    functions,
    "ceipalReport",
    // Pulling every page from Ceipal can take well over the 70s SDK default.
    { timeout: 300_000 }
  );
  const res = await callable({ report, maxRecords });
  const payload = res.data;
  if (!payload?.ok) {
    throw new Error(payload?.error || "Ceipal request failed.");
  }
  return payload.data;
}

/** Read the total_available / record_count fields from a report envelope. */
export function reportMeta(data: unknown): { fetched: number; total: number } {
  const o = (data ?? {}) as { record_count?: number; total_available?: number };
  return { fetched: Number(o.record_count) || 0, total: Number(o.total_available) || 0 };
}
