// A clock the browser can't lie about.
//
// Anything that decides which day a timesheet belongs to has to come from the
// server, not from `new Date()`. A machine with its date set wrongly — or set
// deliberately — otherwise shows a date the server then refuses, which reads to
// the user as the app being broken.
//
// The server is already the authority: saveEntry compares the submitted date
// against the Cloud Function's own clock, so a wrong local date can never file
// a wrong day. This only makes the UI agree with that instead of arguing with it.
//
// We keep the offset between the two clocks rather than a fixed timestamp, so
// time still advances between syncs. Elapsed time is measured with
// performance.now(), which is monotonic — changing the system clock mid-session
// moves Date.now() but not this, so the correction survives it.

import { DateTime } from "luxon";

let offsetMs: number | null = null; // serverNow - localNow at the moment of sync
let syncedAtPerf = 0; // performance.now() when the sync landed
let syncedServerMs = 0; // the server's own epoch ms at that moment

/** Record the server's clock. Called wherever a response carries a server timestamp. */
export function setServerNow(serverEpochMs: number): void {
  if (!Number.isFinite(serverEpochMs) || serverEpochMs <= 0) return;
  syncedAtPerf = typeof performance !== "undefined" ? performance.now() : 0;
  syncedServerMs = serverEpochMs;
  offsetMs = serverEpochMs - Date.now();
}

/** True once the server clock is known — before that we can only guess locally. */
export function serverClockKnown(): boolean {
  return offsetMs !== null;
}

/**
 * Epoch milliseconds, corrected to the server where possible.
 *
 * Falls back to the local clock when no sync has landed yet. That is only ever
 * a display guess: the server still refuses anything filed against the wrong
 * day, so the worst case is a stale-looking form, never a bad write.
 */
export function nowMs(): number {
  if (offsetMs === null) return Date.now();
  const perf = typeof performance !== "undefined" ? performance.now() : 0;
  const elapsed = perf - syncedAtPerf;
  // Monotonic elapsed time is preferred; if performance.now() is unavailable,
  // fall back to the offset applied to the (possibly adjusted) local clock.
  return elapsed >= 0 ? syncedServerMs + elapsed : Date.now() + offsetMs;
}

/** Today's date in the given zone, on the server's clock. */
export function todayInZone(zone: string): string {
  return DateTime.fromMillis(nowMs()).setZone(zone).toFormat("yyyy-MM-dd");
}
