// Requirements (job postings) received per client.
//
// Deliberately separate from submissions: this counts what a client SENT US,
// keyed on the requirement's created date, whereas the submission metrics count
// what we sent them. A client can have requirements and zero submissions — that
// gap is the point of showing them together.

import { DateTime } from "luxon";
import { JobRecord } from "./report/types";

export const UNASSIGNED_LABEL = "Unassigned client";

/** Status buckets shown in the breakdown. Ceipal's raw names map onto these. */
export type ReqBucket = "active" | "onHold" | "closed" | "other";

export interface ClientRequirements {
  client: string; // display label
  key: string; // lowercased join key
  total: number;
  active: number;
  onHold: number;
  closed: number;
  other: number;
  unassigned: boolean; // client field was blank or "NA" in Ceipal
  internal: boolean; // our own company, not external demand
  firstReceived: DateTime | null;
  lastReceived: DateTime | null;
  jobs: JobRecord[];
}

/** Bucket a raw Ceipal job status. */
export function bucketOf(raw: string): ReqBucket {
  const n = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!n) return "other";
  if (n.includes("hold")) return "onHold"; // "On Hold", "Hold by Client"
  if (n.includes("closed") || n.includes("cancel")) return "closed";
  if (n.includes("active") || n.includes("open")) return "active";
  return "other"; // Draft, Filled, anything new
}

const BLANKISH = new Set(["", "na", "n/a", "none", "-", "unknown"]);

/** True when Ceipal has no real client recorded on the requirement. */
export function isUnassignedClient(raw: string): boolean {
  return BLANKISH.has(String(raw ?? "").trim().toLowerCase());
}

/** True for our own company — internal/bench reqs, not client demand. */
export function isInternalClient(raw: string): boolean {
  return /cliff\s*services/i.test(String(raw ?? ""));
}

export function clientKey(raw: string): string {
  if (isUnassignedClient(raw)) return "__unassigned__";
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * Group requirements by client, counting only those RECEIVED inside the range.
 *
 * A requirement with no created date can't be placed in a period, so it's
 * excluded whenever a range is active (and included when none is).
 */
export function computeClientRequirements(
  jobs: JobRecord[],
  from: DateTime | null,
  to: DateTime | null
): ClientRequirements[] {
  const map = new Map<string, ClientRequirements>();

  for (const j of jobs) {
    const d = j.jobCreatedOn;
    if (from || to) {
      if (!d) continue;
      if (from && d < from) continue;
      if (to && d > to) continue;
    }

    const raw = j.client ?? "";
    const key = clientKey(raw);
    const unassigned = isUnassignedClient(raw);

    let c = map.get(key);
    if (!c) {
      c = {
        client: unassigned ? UNASSIGNED_LABEL : String(raw).trim(),
        key,
        total: 0,
        active: 0,
        onHold: 0,
        closed: 0,
        other: 0,
        unassigned,
        internal: isInternalClient(raw),
        firstReceived: null,
        lastReceived: null,
        jobs: [],
      };
      map.set(key, c);
    }

    c.total++;
    c[bucketOf(j.jobStatus)]++;
    c.jobs.push(j);
    if (d) {
      if (!c.firstReceived || d < c.firstReceived) c.firstReceived = d;
      if (!c.lastReceived || d > c.lastReceived) c.lastReceived = d;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.client.localeCompare(b.client));
}

export interface RequirementTotals {
  requirements: number;
  clients: number; // external clients only
  active: number;
  onHold: number;
  closed: number;
  unassigned: number; // requirements with no client recorded
  internal: number; // requirements against our own company
}

export function requirementTotals(rows: ClientRequirements[]): RequirementTotals {
  const t: RequirementTotals = {
    requirements: 0, clients: 0, active: 0, onHold: 0, closed: 0, unassigned: 0, internal: 0,
  };
  for (const r of rows) {
    t.requirements += r.total;
    t.active += r.active;
    t.onHold += r.onHold;
    t.closed += r.closed;
    if (r.unassigned) t.unassigned += r.total;
    else if (r.internal) t.internal += r.total;
    else t.clients++;
  }
  return t;
}
