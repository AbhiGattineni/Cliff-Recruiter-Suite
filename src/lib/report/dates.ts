// Date / duration helpers for the Ceipal report.
//
// The spec says: "Treat all timestamps as EST." We therefore parse every
// timestamp into a FIXED offset zone (UTC-5). Using a fixed offset (rather than
// the America/New_York zone, which switches to EDT in summer) keeps the maths
// deterministic and matches the report's stated "EST" framing. Because every
// timestamp lives in the same frame, inter-status durations are unaffected by
// the choice of offset anyway.

import { DateTime } from "luxon";

export const EST_ZONE = "UTC-5";
export const DASH = "–"; // en-dash, used for "not reached / missing"

// Formats we attempt, in order. Ceipal exports and the report API have used
// several of these over time, so we try a broad set.
const FORMATS = [
  "M/d/yyyy, h:mm:ss a",
  "M/d/yyyy h:mm:ss a",
  "M/d/yyyy h:mm a",
  "MM/dd/yyyy hh:mm:ss a",
  "MM/dd/yyyy hh:mm a",
  "MM/dd/yyyy HH:mm:ss",
  "MM/dd/yyyy HH:mm",
  "M/d/yyyy HH:mm:ss",
  "M/d/yyyy HH:mm",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd HH:mm",
  "M-d-yyyy h:mm:ss a",
  "MM-dd-yyyy HH:mm:ss",
  "dd-MM-yyyy HH:mm:ss",
  "MMM d, yyyy h:mm a",
  "MMM d, yyyy, h:mm:ss a",
  "d MMM yyyy HH:mm",
];

/** Parse a raw timestamp string into an EST-framed DateTime, or null. */
export function parseTs(raw: unknown): DateTime | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === DASH || s === "-" || s.toUpperCase() === "NA" || s.toUpperCase() === "N/A") {
    return null;
  }
  for (const fmt of FORMATS) {
    const dt = DateTime.fromFormat(s, fmt, { zone: EST_ZONE });
    if (dt.isValid) return dt;
  }
  // ISO fallback (interpret naive ISO as EST wall-clock).
  const iso = DateTime.fromISO(s, { zone: EST_ZONE });
  if (iso.isValid) return iso;
  return null;
}

/** Display a DateTime for the report, or DASH when null. */
export function fmtTs(dt: DateTime | null): string {
  if (!dt) return DASH;
  return dt.toFormat("MM/dd/yyyy hh:mm a");
}

/**
 * Format the elapsed time between two DateTimes as "Xd Yh Zm".
 * Returns DASH when either endpoint is missing or the interval is negative.
 */
export function fmtDuration(from: DateTime | null, to: DateTime | null): string {
  if (!from || !to) return DASH;
  const ms = to.toMillis() - from.toMillis();
  if (ms < 0) return DASH;
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
}

/** Latest of a list of DateTimes (ignores nulls); null if list is empty. */
export function maxDt(list: (DateTime | null)[]): DateTime | null {
  let best: DateTime | null = null;
  for (const dt of list) {
    if (dt && (!best || dt.toMillis() > best.toMillis())) best = dt;
  }
  return best;
}

/** Earliest of a list of DateTimes (ignores nulls); null if list is empty. */
export function minDt(list: (DateTime | null)[]): DateTime | null {
  let best: DateTime | null = null;
  for (const dt of list) {
    if (dt && (!best || dt.toMillis() < best.toMillis())) best = dt;
  }
  return best;
}
