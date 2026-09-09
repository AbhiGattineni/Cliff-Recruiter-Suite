// Comparing one date range against another.
//
// Deliberately generic: it knows about periods and metrics, not about why you
// are comparing them. "Did the sourcing tool we pay for earn its cost" is one
// question it answers; month-over-month, before-and-after a process change, and
// "is the new starter ramping" are the same shape and get the same treatment.
//
// Two things make an honest comparison, and both are handled here rather than
// left to whoever reads the table:
//
//   - Ranges of different lengths are compared per WORKING DAY. Six days of
//     work against ten is not a 40% decline, and a table that says so is worse
//     than no table.
//   - A percentage needs something to divide by. Going from nothing to three is
//     not "+300%", it has no percentage at all, and inventing one puts the
//     biggest number in the table against the smallest amount of evidence.

import { DateTime } from "luxon";
import { RecruiterStat } from "./recruiterStats";

export interface Period {
  from: string; // ISO yyyy-MM-dd
  to: string;
}

export const isCompletePeriod = (p: Period): boolean =>
  !!p.from && !!p.to && DateTime.fromISO(p.from).isValid && DateTime.fromISO(p.to).isValid && p.from <= p.to;

/** Calendar days in a period, inclusive of both ends. */
export function calendarDays(p: Period): number {
  if (!isCompletePeriod(p)) return 0;
  return Math.round(DateTime.fromISO(p.to).diff(DateTime.fromISO(p.from), "days").days) + 1;
}

/**
 * Working days (Mon–Fri) in a period, inclusive.
 *
 * Weekends are excluded on the same rule the timesheets use — nobody is
 * expected to work them, so counting them would penalise a range that happens
 * to span two weekends against one that spans one.
 */
export function workingDays(p: Period): number {
  if (!isCompletePeriod(p)) return 0;
  let d = DateTime.fromISO(p.from);
  const end = DateTime.fromISO(p.to);
  let n = 0;
  while (d <= end) {
    if (d.weekday <= 5) n += 1;
    d = d.plus({ days: 1 });
  }
  return n;
}

/** The period of equal calendar length ending the day before this one starts. */
export function previousPeriod(p: Period): Period | null {
  if (!isCompletePeriod(p)) return null;
  const len = calendarDays(p);
  const to = DateTime.fromISO(p.from).minus({ days: 1 });
  return { from: to.minus({ days: len - 1 }).toFormat("yyyy-MM-dd"), to: to.toFormat("yyyy-MM-dd") };
}

/** The same period shifted back a whole number of months — this month vs last. */
export function shiftedBack(p: Period, months: number): Period | null {
  if (!isCompletePeriod(p)) return null;
  return {
    from: DateTime.fromISO(p.from).minus({ months }).toFormat("yyyy-MM-dd"),
    to: DateTime.fromISO(p.to).minus({ months }).toFormat("yyyy-MM-dd"),
  };
}

/** Whether two periods overlap — a baseline that shares days with the current range double-counts. */
export function overlaps(a: Period, b: Period): boolean {
  if (!isCompletePeriod(a) || !isCompletePeriod(b)) return false;
  return a.from <= b.to && b.from <= a.to;
}

/**
 * A metric is either a COUNT, which grows with the length of the range and so
 * is compared per working day, or a SCORE already normalised to 0–100, which
 * must not be divided by anything.
 */
export type MetricKind = "count" | "score";

export interface Delta {
  current: number;
  baseline: number;
  /** Per working day for counts; the value itself for scores. What `pct` is computed from. */
  currentRate: number;
  baselineRate: number;
  /** Percent change of the rates, or null when there is no baseline to divide by. */
  pct: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function delta(
  current: number,
  baseline: number,
  currentDays: number,
  baselineDays: number,
  kind: MetricKind = "count"
): Delta {
  const rate = (v: number, days: number) => (kind === "score" ? v : days > 0 ? v / days : 0);
  const currentRate = round2(rate(current, currentDays));
  const baselineRate = round2(rate(baseline, baselineDays));
  return {
    current,
    baseline,
    currentRate,
    baselineRate,
    // Zero baseline has no percentage — see the note at the top of this file.
    pct: baselineRate > 0 ? Math.round(((currentRate - baselineRate) / baselineRate) * 100) : null,
  };
}

/** Whether a recruiter worked in both periods, only the new one, or only the old one. */
export type Presence = "both" | "new" | "gone";

export const COMPARE_METRICS = ["profiles", "clientCount", "offers", "requirements", "index"] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export const METRIC_KIND: Record<CompareMetric, MetricKind> = {
  profiles: "count",
  clientCount: "count",
  offers: "count",
  requirements: "count",
  index: "score",
};

export const METRIC_LABEL: Record<CompareMetric, string> = {
  profiles: "Profiles",
  clientCount: "Client/Vendor",
  offers: "Offers accepted",
  requirements: "Reqs",
  index: "Index",
};

export interface RecruiterDelta {
  name: string;
  presence: Presence;
  metrics: Record<CompareMetric, Delta>;
}

const metricValue = (s: RecruiterStat | undefined, m: CompareMetric): number => {
  if (!s) return 0;
  switch (m) {
    case "profiles":
      return s.profiles;
    case "clientCount":
      return s.clientCount;
    case "offers":
      return s.stageCounts?.offerAccepted ?? 0;
    case "requirements":
      return s.requirements;
    case "index":
      return s.index;
  }
};

function deltasFor(
  cur: RecruiterStat | undefined,
  base: RecruiterStat | undefined,
  curDays: number,
  baseDays: number
): Record<CompareMetric, Delta> {
  const out = {} as Record<CompareMetric, Delta>;
  for (const m of COMPARE_METRICS) {
    out[m] = delta(metricValue(cur, m), metricValue(base, m), curDays, baseDays, METRIC_KIND[m]);
  }
  return out;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Pair up the two leaderboards by recruiter.
 *
 * Everyone in either period appears. Someone who only worked in one of them is
 * marked rather than scored: a joiner is not an infinite improvement and a
 * leaver is not a collapse, and showing either as a percentage would be the
 * most eye-catching row in a table about something else entirely.
 */
export function compareRecruiters(
  current: RecruiterStat[],
  baseline: RecruiterStat[],
  currentDays: number,
  baselineDays: number
): RecruiterDelta[] {
  const curBy = new Map(current.map((s) => [key(s.name), s]));
  const baseBy = new Map(baseline.map((s) => [key(s.name), s]));

  const rows: RecruiterDelta[] = current.map((s) => {
    const base = baseBy.get(key(s.name));
    return {
      name: s.name,
      presence: base ? "both" : "new",
      metrics: deltasFor(s, base, currentDays, baselineDays),
    };
  });
  for (const s of baseline) {
    if (curBy.has(key(s.name))) continue;
    rows.push({
      name: s.name,
      presence: "gone",
      metrics: deltasFor(undefined, s, currentDays, baselineDays),
    });
  }
  return rows;
}

export interface TeamDelta {
  metrics: Record<CompareMetric, Delta>;
  /** Client/vendor submissions as a share of profiles — the conversion the volume hides. */
  conversion: Delta;
  people: { current: number; baseline: number };
}

/**
 * Team totals.
 *
 * `index` is averaged, not summed — it is a score out of 100, and adding five
 * of them together produces a number that means nothing and moves whenever
 * somebody joins.
 */
export function compareTeam(
  current: RecruiterStat[],
  baseline: RecruiterStat[],
  currentDays: number,
  baselineDays: number
): TeamDelta {
  const sum = (rows: RecruiterStat[], m: CompareMetric) =>
    rows.reduce((t, s) => t + metricValue(s, m), 0);
  const avgIndex = (rows: RecruiterStat[]) =>
    rows.length ? Math.round(rows.reduce((t, s) => t + s.index, 0) / rows.length) : 0;
  const rate = (rows: RecruiterStat[]) => {
    const p = sum(rows, "profiles");
    return p > 0 ? Math.round((sum(rows, "clientCount") / p) * 100) : 0;
  };

  const metrics = {} as Record<CompareMetric, Delta>;
  for (const m of COMPARE_METRICS) {
    metrics[m] =
      m === "index"
        ? delta(avgIndex(current), avgIndex(baseline), currentDays, baselineDays, "score")
        : delta(sum(current, m), sum(baseline, m), currentDays, baselineDays, "count");
  }

  return {
    metrics,
    conversion: delta(rate(current), rate(baseline), currentDays, baselineDays, "score"),
    people: { current: current.length, baseline: baseline.length },
  };
}
