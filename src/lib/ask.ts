// Client side of Ask Anything — talks to the "ai" function's askPlan /
// askNarrative / askSave / askList / askDelete actions, and loads the raw
// datasets the deterministic engine (askEngine.ts) runs plans against.

import { DateTime } from "luxon";
import { callAi } from "./ai";
import { fetchCeipalReport } from "./ceipal";
import { parseSubmissionsFromApi, parseJobsFromApi } from "./report/parseSource";
import { SubmissionEvent, JobRecord } from "./report/types";
import { listResumeReports, ResumeReport } from "./resumeReports";
import { listTeamTimesheets, TimesheetEntry } from "./timesheets";
import {
  AskPlan,
  Row,
  submissionsToRows,
  requirementsToRows,
  recruitersToRows,
  clientsToRows,
  resumesToRows,
  timesheetsToRows,
} from "./askEngine";

export interface SavedAskQuery {
  id: string;
  name: string;
  question: string;
  plan: AskPlan;
  /** Set server-side from the saver's role: an admin saves for the team, anyone else saves for themselves. */
  shared?: boolean;
  createdByUid?: string;
  createdByName?: string;
  createdAt: number | null;
}

/** NL question -> a (still untrusted) query plan. Caller must sanitizePlan() it. */
export async function askPlan(question: string, priorPlan: AskPlan | null): Promise<{ plan: unknown }> {
  const today = DateTime.local().toISODate() ?? "";
  return callAi<{ question: string; priorPlan: unknown; today: string }, { ok: boolean; plan?: unknown; error?: string }>(
    "askPlan",
    { question, priorPlan, today },
    { timeout: 60_000 }
  ).then((r) => {
    if (!r.ok || !r.plan) throw new Error(r.error || "Couldn't turn that into a query.");
    return { plan: r.plan };
  });
}

/** Grounded 1-3 sentence summary of an already-computed aggregate, in the given language. */
export async function askNarrative(facts: Record<string, unknown>, lang: "en" | "te" | "hi"): Promise<string> {
  const r = await callAi<{ facts: Record<string, unknown>; lang: string }, { ok: boolean; text?: string; error?: string }>(
    "askNarrative",
    { facts, lang },
    { timeout: 60_000 }
  );
  if (!r.ok || !r.text) throw new Error(r.error || "Couldn't generate a summary.");
  return r.text;
}

export async function saveAskQuery(name: string, question: string, plan: AskPlan): Promise<string> {
  const r = await callAi<{ name: string; question: string; plan: AskPlan }, { ok: boolean; id?: string }>("askSave", {
    name,
    question,
    plan,
  });
  return r.id ?? "";
}

export async function listAskQueries(): Promise<SavedAskQuery[]> {
  const r = await callAi<Record<string, never>, { ok: boolean; queries?: SavedAskQuery[] }>("askList", {});
  return r.queries ?? [];
}

export async function deleteAskQuery(id: string): Promise<void> {
  await callAi<{ id: string }, { ok: boolean }>("askDelete", { id });
}

// ---------------------------------------------------------------------------
// Debug log — a shared (Firestore-backed, not per-browser) record of every
// question run: the exact plan the AI produced and how many rows it matched.
// So a "why did this come back empty" report from anyone can be diagnosed by
// any admin/manager, not just reproduced live in the reporter's own browser.
// ---------------------------------------------------------------------------

export interface DebugLogEntry {
  id: string;
  createdAt: number | null;
  createdByUid?: string;
  createdByName?: string;
  question: string;
  source?: "ask" | "saved" | "edit";
  table?: string | null;
  /** The plan straight from the LLM, before sanitizePlan. Lets you tell "the AI picked a bad filter" apart from "sanitizePlan dropped a valid one". */
  rawPlan?: unknown;
  /** The plan actually executed. */
  plan?: AskPlan | null;
  rowsLoaded?: number | null;
  /** Set only when the plan grouped — the number of groups produced. */
  groups?: number | null;
  /** Rows that matched the plan's filters — the number that actually matters for "why is this empty". */
  rowsMatched?: number | null;
  error?: string | null;
}

export type DebugLogWrite = Omit<DebugLogEntry, "id" | "createdAt" | "createdByUid" | "createdByName">;

/** Fire-and-forget: a logging failure must never surface as a user-facing error. */
export async function writeDebugLog(entry: DebugLogWrite): Promise<void> {
  try {
    await callAi<DebugLogWrite, { ok: boolean }>("askDebugWrite", entry);
  } catch {
    // Best effort only.
  }
}

export async function listDebugLog(): Promise<DebugLogEntry[]> {
  const r = await callAi<Record<string, never>, { ok: boolean; entries?: DebugLogEntry[] }>("askDebugList", {});
  return r.entries ?? [];
}

/** Admin-only server-side — clears the shared log for everyone. */
export async function clearDebugLog(): Promise<void> {
  await callAi<Record<string, never>, { ok: boolean; cleared?: number }>("askDebugClear", {});
}

// ---------------------------------------------------------------------------
// Raw dataset loaders — one per underlying source, independently cacheable so
// asking two questions about "submissions" doesn't refetch Ceipal twice.
// ---------------------------------------------------------------------------

export async function loadSubmissions(): Promise<SubmissionEvent[]> {
  const json = await fetchCeipalReport("submissions");
  return parseSubmissionsFromApi(json);
}

export async function loadJobs(): Promise<JobRecord[]> {
  const json = await fetchCeipalReport("job_duration");
  return parseJobsFromApi(json);
}

export async function loadResumes(): Promise<ResumeReport[]> {
  return listResumeReports();
}

export async function loadTimesheets(): Promise<TimesheetEntry[]> {
  // All-time — the plan's own date range filters it at run time, same as every
  // other table, so a "last week" and an "all time" question both work without
  // refetching.
  const { entries } = await listTeamTimesheets("", "");
  return entries;
}

/** Which raw sources a table needs, so the page only loads what a plan actually touches. */
export function sourcesFor(table: string): Array<"submissions" | "jobs" | "resumes" | "timesheets"> {
  switch (table) {
    case "submissions":
      return ["submissions"];
    case "requirements":
      return ["jobs"];
    case "recruiters":
    case "clients":
      return ["submissions", "jobs"];
    case "resumes":
      return ["resumes"];
    case "timesheets":
      return ["timesheets"];
    default:
      return [];
  }
}

export interface RawBundle {
  submissions?: SubmissionEvent[];
  jobs?: JobRecord[];
  resumes?: ResumeReport[];
  timesheets?: TimesheetEntry[];
}

/** Build the flat catalog rows for a plan's table from whatever raw data is loaded. */
export function rowsForPlan(plan: AskPlan, raw: RawBundle): Row[] {
  switch (plan.table) {
    case "submissions":
      return submissionsToRows(raw.submissions ?? []);
    case "requirements":
      return requirementsToRows(raw.jobs ?? []);
    case "recruiters":
      return recruitersToRows(raw.submissions ?? [], raw.jobs ?? [], plan.dateFrom, plan.dateTo);
    case "clients":
      return clientsToRows(raw.submissions ?? [], raw.jobs ?? [], plan.dateFrom, plan.dateTo);
    case "resumes":
      return resumesToRows(raw.resumes ?? []);
    case "timesheets":
      return timesheetsToRows(raw.timesheets ?? []);
    default:
      return [];
  }
}
