// The deterministic core of Ask Anything.
//
// The LLM only ever produces an AskPlan — a JSON description of what to look
// at (table, filters, grouping, columns). Every number a user sees is computed
// HERE, in plain code, from data already loaded in the browser. The LLM never
// sees a row and never states a number on its own authority — see askNarrative
// for the one place it's allowed to phrase (not invent) a sentence.

import { DateTime } from "luxon";
import { ASK_TABLES, tableByKey, columnByKey, CatalogColumn } from "./askCatalog";
import { SubmissionEvent, JobRecord } from "./report/types";
import { ResumeReport } from "./resumeReports";
import { TimesheetEntry } from "./timesheets";
import { computeRecruiterStats, filterByActivity } from "./recruiterStats";
import { computeClientScores } from "./clientTracker";
import { computeClientRequirements } from "./clientRequirements";
import { aiHeadline } from "./resume";

export type FilterOp = "eq" | "contains" | "in" | "gte" | "lte" | "before" | "after" | "between";

export interface AskFilter {
  field: string;
  op: FilterOp;
  value: string | number | string[] | [string, string];
}

export interface AskPlan {
  table: string;
  title: string;
  filters: AskFilter[];
  dateFrom: string | null; // ISO yyyy-mm-dd
  dateTo: string | null;
  groupBy: string | null;
  metric: { field: string | null; agg: "count" | "sum" | "avg" };
  columns: string[];
  sort: { field: string; dir: "asc" | "desc" } | null;
  limit: number;
  chart: "pie" | "bar" | "none";
}

export type Row = Record<string, string | number | null>;

export interface AskResult {
  plan: AskPlan;
  columns: CatalogColumn[];
  rows: Row[]; // either raw rows (no groupBy) or grouped summary rows (label/value)
  totalRows: number; // rows before the display limit was applied
  grouped: boolean;
  chartData: { label: string; value: number }[] | null;
  facts: NarrativeFacts;
}

export interface NarrativeFacts {
  table: string;
  title: string;
  totalRows: number;
  dateFrom: string | null;
  dateTo: string | null;
  groupBy: string | null;
  metric: string; // human description, e.g. "count" or "sum of hours"
  topGroups: { label: string; value: number }[];
  overallMetric: number | null; // the metric summed/averaged across everything, when no groupBy
}

const DEFAULT_LIMIT = 500;

// ---------------------------------------------------------------------------
// Plan sanitisation — an LLM plan is untrusted input. Anything that doesn't
// match the catalog is dropped rather than trusted, so a hallucinated field
// name fails soft (ignored) instead of crashing the page.
// ---------------------------------------------------------------------------

export function sanitizePlan(raw: unknown): AskPlan {
  const o = (raw ?? {}) as Record<string, unknown>;
  const table = tableByKey(String(o.table ?? "")) ? String(o.table) : ASK_TABLES[0].key;
  const cat = tableByKey(table)!;
  const fieldKeys = new Set(cat.columns.map((c) => c.key));

  const filters: AskFilter[] = Array.isArray(o.filters)
    ? (o.filters as unknown[])
        .map((f) => sanitizeFilter(f, fieldKeys))
        .filter((f): f is AskFilter => f !== null)
    : [];

  const groupByRaw = typeof o.groupBy === "string" ? o.groupBy : null;
  const groupBy = groupByRaw && fieldKeys.has(groupByRaw) ? groupByRaw : null;

  const metricRaw = (o.metric ?? {}) as Record<string, unknown>;
  const metricField = typeof metricRaw.field === "string" && fieldKeys.has(metricRaw.field) ? metricRaw.field : null;
  const agg = metricRaw.agg === "sum" || metricRaw.agg === "avg" ? metricRaw.agg : "count";

  const columnsRaw = Array.isArray(o.columns) ? (o.columns as unknown[]).map(String) : [];
  const columns = columnsRaw.filter((c) => fieldKeys.has(c));

  const sortRaw = (o.sort ?? null) as Record<string, unknown> | null;
  const sort =
    sortRaw && typeof sortRaw.field === "string" && fieldKeys.has(sortRaw.field)
      ? { field: sortRaw.field, dir: sortRaw.dir === "asc" ? ("asc" as const) : ("desc" as const) }
      : null;

  const chart = o.chart === "pie" || o.chart === "bar" ? o.chart : o.chart === "none" ? "none" : groupBy ? "pie" : "none";

  return {
    table,
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 140) : cat.label,
    filters,
    dateFrom: isIsoDate(o.dateFrom) ? (o.dateFrom as string) : null,
    dateTo: isIsoDate(o.dateTo) ? (o.dateTo as string) : null,
    groupBy,
    metric: { field: metricField, agg },
    columns: columns.length ? columns : cat.defaultColumns.filter((c) => fieldKeys.has(c)),
    sort,
    limit: Number.isFinite(o.limit) && Number(o.limit) > 0 ? Math.min(Number(o.limit), 2000) : DEFAULT_LIMIT,
    chart,
  };
}

function sanitizeFilter(raw: unknown, fieldKeys: Set<string>): AskFilter | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const field = String(o.field ?? "");
  if (!fieldKeys.has(field)) return null;
  const ops: FilterOp[] = ["eq", "contains", "in", "gte", "lte", "before", "after", "between"];
  const op = ops.includes(o.op as FilterOp) ? (o.op as FilterOp) : "eq";
  if (o.value == null) return null;
  return { field, op, value: o.value as AskFilter["value"] };
}

function isIsoDate(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ---------------------------------------------------------------------------
// Row builders — turn already-typed app data into flat catalog rows.
// ---------------------------------------------------------------------------

const iso = (d: DateTime | null | undefined): string | null => (d && d.isValid ? d.toISODate() : null);

export function submissionsToRows(subs: SubmissionEvent[]): Row[] {
  return subs.map((s) => ({
    applicantName: s.applicantName || "",
    jobCode: s.jobCode || "",
    jobTitle: s.jobTitle || "",
    client: s.client || "",
    recruiter: s.submittedBy || "",
    status: s.submissionStatus || "",
    submittedOn: iso(s.submittedOn),
    statusChangedOn: iso(s.statusChangedOn),
    accountManager: s.accountManager || "",
  }));
}

export function requirementsToRows(jobs: JobRecord[]): Row[] {
  return jobs.map((j) => ({
    jobCode: j.jobCode || "",
    jobTitle: j.jobTitle || "",
    client: j.client || "",
    status: j.jobStatus || "",
    jobCreatedOn: iso(j.jobCreatedOn),
    submissionsCount: j.numOfSubmissions ?? 0,
    recruitmentManager: j.recruitmentManager || "",
    assignedTo: j.assignedTo || "",
    payRate: j.payRate || "",
    experience: j.experience || "",
    mandateSkills: j.mandateSkills || "",
  }));
}

/** Recruiter performance rows, scoped to a date range exactly like Recruiter Performance's own filter. */
export function recruitersToRows(subs: SubmissionEvent[], jobs: JobRecord[], from: string | null, to: string | null): Row[] {
  const dateActive = !!from || !!to;
  const filtered = filterByActivity(
    subs,
    from ? DateTime.fromISO(from) : null,
    to ? DateTime.fromISO(to).endOf("day") : null
  );
  const { stats } = computeRecruiterStats(filtered, jobs, { periodScoped: dateActive });
  return stats.map((s) => ({
    recruiter: s.name,
    requirementsWorked: s.requirements,
    profiles: s.profiles,
    clientSubmissions: s.clientCount,
    clientRatePct: Math.round(s.clientRate * 100),
    progressRatePct: Math.round(s.progressRate * 100),
    index: s.index,
  }));
}

/** Client rows — requirements received joined with submission response stats, both scoped the same way Client Tracker scopes them. */
export function clientsToRows(subs: SubmissionEvent[], jobs: JobRecord[], from: string | null, to: string | null): Row[] {
  const fromDt = from ? DateTime.fromISO(from) : null;
  const toDt = to ? DateTime.fromISO(to).endOf("day") : null;
  const filteredSubs = fromDt || toDt
    ? subs.filter((s) => {
        const d = s.submittedOn;
        if (!d) return false;
        if (fromDt && d < fromDt) return false;
        if (toDt && d > toDt) return false;
        return true;
      })
    : subs;

  const scores = computeClientScores(filteredSubs);
  const reqs = computeClientRequirements(jobs, fromDt, toDt);

  const byKey = new Map<string, Row>();
  for (const r of reqs) {
    byKey.set(r.key, {
      client: r.client,
      requirementsReceived: r.total,
      requirementsActive: r.active,
      requirementsOnHold: r.onHold,
      submissionsSent: 0,
      responseRatePct: 0,
      selected: 0,
      verdict: "unrated",
    });
  }
  for (const s of scores) {
    const key = s.client.toLowerCase().trim();
    const cur = byKey.get(key) ?? {
      client: s.client,
      requirementsReceived: 0,
      requirementsActive: 0,
      requirementsOnHold: 0,
      submissionsSent: 0,
      responseRatePct: 0,
      selected: 0,
      verdict: "unrated",
    };
    cur.submissionsSent = s.total;
    cur.responseRatePct = Math.round(s.responseRate * 100);
    cur.selected = s.selected;
    cur.verdict = s.verdict;
    byKey.set(key, cur);
  }
  return Array.from(byKey.values());
}

export function resumesToRows(reports: ResumeReport[]): Row[] {
  return reports.map((r) => {
    const ai = aiHeadline(r);
    return {
      candidateName: r.candidateName || "",
      fitScore: Math.round(Number(r.fitScore) || 0),
      rating: r.rating || "",
      aiGeneratedPercent: ai.pct ?? 0,
      currentTitle: r.extracted?.currentTitle || "",
      location: r.extracted?.location || "",
      experienceYears: Number(r.extracted?.totalExperienceYears) || 0,
      githubScore: r.portfolio?.portfolioScore ?? null,
      linkedinVerdict: r.linkedinCheck?.assessment?.verdict || "",
      provider: r.provider || "",
      createdAt: r.createdAt ? DateTime.fromMillis(r.createdAt).toISODate() : null,
    };
  });
}

export function timesheetsToRows(entries: TimesheetEntry[]): Row[] {
  const rows: Row[] = [];
  for (const e of entries) {
    for (const j of e.jobs ?? []) {
      rows.push({
        date: e.date,
        recruiter: e.displayName || e.email || "",
        jobCode: j.jobCode,
        jobTitle: j.jobTitle || "",
        client: j.client || "",
        hours: j.hours,
        notes: e.workedOn || "",
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Filtering, grouping, aggregation — the generic engine that runs a plan
// against a row set already built for the target table.
// ---------------------------------------------------------------------------

function matchFilter(row: Row, f: AskFilter): boolean {
  const v = row[f.field];
  switch (f.op) {
    case "eq":
      return String(v ?? "").toLowerCase() === String(f.value).toLowerCase();
    case "contains":
      return String(v ?? "").toLowerCase().includes(String(f.value).toLowerCase());
    case "in": {
      const list = (Array.isArray(f.value) ? f.value : [f.value]).map((x) => String(x).toLowerCase());
      return list.includes(String(v ?? "").toLowerCase());
    }
    case "gte":
      return Number(v) >= Number(f.value);
    case "lte":
      return Number(v) <= Number(f.value);
    case "before":
      return !!v && String(v) < String(f.value);
    case "after":
      return !!v && String(v) > String(f.value);
    case "between": {
      const [lo, hi] = Array.isArray(f.value) ? f.value : [f.value, f.value];
      if (v == null) return false;
      const numeric = typeof v === "number";
      return numeric ? Number(v) >= Number(lo) && Number(v) <= Number(hi) : String(v) >= String(lo) && String(v) <= String(hi);
    }
    default:
      return true;
  }
}

function applyDateRange(rows: Row[], dateField: string | null, from: string | null, to: string | null): Row[] {
  if (!dateField || (!from && !to)) return rows;
  return rows.filter((r) => {
    const v = r[dateField];
    if (!v) return false;
    if (from && String(v) < from) return false;
    if (to && String(v) > to) return false;
    return true;
  });
}

function aggregate(rows: Row[], groupBy: string, metric: AskPlan["metric"]): { label: string; value: number }[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r[groupBy] ?? "(blank)").trim() || "(blank)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out = Array.from(groups.entries()).map(([label, grp]) => {
    let value: number;
    if (metric.field && metric.agg === "sum") {
      value = grp.reduce((s, r) => s + (Number(r[metric.field!]) || 0), 0);
    } else if (metric.field && metric.agg === "avg") {
      value = grp.reduce((s, r) => s + (Number(r[metric.field!]) || 0), 0) / (grp.length || 1);
      value = Math.round(value * 100) / 100;
    } else {
      value = grp.length;
    }
    return { label, value };
  });
  return out.sort((a, b) => b.value - a.value);
}

/** Cap chart slices so a pie with 80 categories doesn't render as noise. */
function capForChart(data: { label: string; value: number }[], max: number): { label: string; value: number }[] {
  if (data.length <= max) return data;
  const top = data.slice(0, max - 1);
  const rest = data.slice(max - 1).reduce((s, d) => s + d.value, 0);
  return [...top, { label: "Other", value: rest }];
}

export function runPlan(rawRows: Row[], plan: AskPlan): AskResult {
  const cat = tableByKey(plan.table)!;
  const dateFiltered = applyDateRange(rawRows, cat.dateField, plan.dateFrom, plan.dateTo);
  const filtered = dateFiltered.filter((r) => plan.filters.every((f) => matchFilter(r, f)));

  const metricLabel = plan.metric.field
    ? `${plan.metric.agg} of ${columnByKey(cat, plan.metric.field)?.label ?? plan.metric.field}`
    : "count";

  if (plan.groupBy) {
    const grouped = aggregate(filtered, plan.groupBy, plan.metric);
    const sorted = plan.sort
      ? [...grouped].sort((a, b) => (plan.sort!.dir === "asc" ? 1 : -1) * (a.value - b.value))
      : grouped;
    const capped = sorted.slice(0, plan.limit);
    const chartData = plan.chart === "none" ? null : capForChart(sorted, plan.chart === "pie" ? 8 : 20);
    return {
      plan,
      columns: [
        { key: "label", label: columnByKey(cat, plan.groupBy)?.label ?? plan.groupBy, type: "string" },
        { key: "value", label: metricLabel, type: "number" },
      ],
      rows: capped.map((g) => ({ label: g.label, value: g.value })),
      totalRows: grouped.length,
      grouped: true,
      chartData,
      facts: {
        table: plan.table,
        title: plan.title,
        totalRows: filtered.length,
        dateFrom: plan.dateFrom,
        dateTo: plan.dateTo,
        groupBy: plan.groupBy,
        metric: metricLabel,
        topGroups: grouped.slice(0, 5),
        overallMetric: null,
      },
    };
  }

  const sortedRows = plan.sort
    ? [...filtered].sort((a, b) => {
        const va = a[plan.sort!.field];
        const vb = b[plan.sort!.field];
        const dir = plan.sort!.dir === "asc" ? 1 : -1;
        if (typeof va === "number" && typeof vb === "number") return dir * (va - vb);
        return dir * String(va ?? "").localeCompare(String(vb ?? ""));
      })
    : filtered;

  const cols = plan.columns.map((k) => columnByKey(cat, k)).filter((c): c is CatalogColumn => !!c);
  const overallMetric = plan.metric.field
    ? plan.metric.agg === "avg"
      ? Math.round((filtered.reduce((s, r) => s + (Number(r[plan.metric.field!]) || 0), 0) / (filtered.length || 1)) * 100) / 100
      : filtered.reduce((s, r) => s + (Number(r[plan.metric.field!]) || 0), 0)
    : filtered.length;

  return {
    plan,
    columns: cols.length ? cols : cat.columns.slice(0, 6),
    rows: sortedRows.slice(0, plan.limit),
    totalRows: filtered.length,
    grouped: false,
    chartData: null,
    facts: {
      table: plan.table,
      title: plan.title,
      totalRows: filtered.length,
      dateFrom: plan.dateFrom,
      dateTo: plan.dateTo,
      groupBy: null,
      metric: metricLabel,
      topGroups: [],
      overallMetric,
    },
  };
}
