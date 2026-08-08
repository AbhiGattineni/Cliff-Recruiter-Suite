import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import { AskPlan } from "../lib/askEngine";

// A local, per-browser record of every Ask Anything query run on this device —
// the question, the exact plan the AI produced, and how many rows it matched.
// Exists so a "why did this return nothing" report can be diagnosed from what
// the user sees in their own browser, without reproducing it live (which
// usually isn't possible — Ask Anything is behind a login this assistant
// can't sign into). Nothing here leaves the browser; it's a debugging aid,
// not telemetry.

export interface DebugLogEntry {
  id: string;
  ts: number;
  question: string;
  source?: "ask" | "saved" | "edit";
  table?: string;
  /** The plan straight from the LLM, before sanitizePlan. Lets you tell "the AI picked a bad filter" apart from "sanitizePlan dropped a valid one". */
  rawPlan?: unknown;
  /** The plan actually executed. */
  plan?: AskPlan | null;
  /** Rows in the source table before this plan's filters/date range were applied. */
  rowsLoaded?: number;
  /** Set only when the plan grouped — the number of groups produced. */
  groups?: number;
  /** Rows that matched the plan's filters — the number that actually matters for "why is this empty". */
  rowsMatched?: number;
  error?: string;
}

const MAX_ENTRIES = 50;
const STORAGE_KEY = "askDebugLog";

interface DebugLogValue {
  entries: DebugLogEntry[];
  push: (e: Omit<DebugLogEntry, "id" | "ts">) => void;
  clear: () => void;
}

const DebugLogContext = createContext<DebugLogValue | null>(null);

function readStored(): DebugLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStored(entries: DebugLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable (private browsing) — the in-memory log for
    // this page load still works, it just won't survive a reload.
  }
}

let nextId = 0;

export function DebugLogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DebugLogEntry[]>(readStored);

  const push = useCallback((e: Omit<DebugLogEntry, "id" | "ts">) => {
    const entry: DebugLogEntry = { ...e, id: `dbg-${++nextId}`, ts: Date.now() };
    setEntries((cur) => {
      const next = [entry, ...cur].slice(0, MAX_ENTRIES);
      writeStored(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    writeStored([]);
  }, []);

  return <DebugLogContext.Provider value={{ entries, push, clear }}>{children}</DebugLogContext.Provider>;
}

export function useDebugLog(): DebugLogValue {
  const ctx = useContext(DebugLogContext);
  if (!ctx) throw new Error("useDebugLog() must be used inside <DebugLogProvider>.");
  return ctx;
}
