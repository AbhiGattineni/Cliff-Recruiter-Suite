// Ask Anything — the management query page.
//
// Ask a plain-English question, get a table, a chart and a short summary back.
// The pipeline is deliberately split so no number is ever invented:
//
//   askPlan (LLM)  ->  sanitizePlan()  ->  runPlan() in the browser  ->  askNarrative (LLM)
//   picks WHAT to     drops anything     the ONLY place a number       phrases the numbers
//   look at           off-catalog        is computed                   runPlan already made
//
// Editing a card's chips, and re-running a saved query, both re-enter that
// pipeline *after* the LLM step — instant, free, and impossible to hallucinate.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import AskCard from "../components/ask/AskCard";
import { AskPlan, AskResult, runPlan, sanitizePlan } from "../lib/askEngine";
import { SUGGESTED_PROMPTS } from "../lib/askCatalog";
import { Lang } from "../lib/indexGuide";
import {
  RawBundle,
  SavedAskQuery,
  askNarrative,
  askPlan,
  deleteAskQuery,
  listAskQueries,
  loadJobs,
  loadResumes,
  loadSubmissions,
  loadTimesheets,
  rowsForPlan,
  saveAskQuery,
  sourcesFor,
} from "../lib/ask";

interface FeedItem {
  id: string;
  question: string;
  result: AskResult | null;
  loading: boolean;
  error: string | null;
  narratives: Partial<Record<Lang, string>>;
  narrativeLang: Lang;
  narrativeLoading: boolean;
}

// Ceipal reports are already cached server-side; five minutes in the browser on
// top of that is enough to stop a run of questions refetching the same report.
const RAW_STALE_MS = 5 * 60 * 1000;

/** How long a re-run waits before summarising, so a burst of chip edits costs one call. */
const NARRATE_DEBOUNCE_MS = 700;

let nextId = 0;
const newId = () => `ask-${++nextId}`;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function AskAnything() {
  const { profile, profileLoading } = useAuth();
  const canAsk = profile?.role === "admin" || profile?.role === "manager";

  const qc = useQueryClient();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [text, setText] = useState("");
  // Passed to askPlan as priorPlan so "now split that by month" works. A ref,
  // not state — nothing renders it, and callbacks must read the latest value.
  const lastPlan = useRef<AskPlan | null>(null);

  const savedQ = useQuery({ queryKey: ["askQueries"], queryFn: listAskQueries, enabled: canAsk });

  const patchItem = useCallback((id: string, patch: Partial<FeedItem>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  /** Load only the raw sources this plan's table actually needs, cached per source. */
  const loadRaw = useCallback(
    async (plan: AskPlan): Promise<RawBundle> => {
      const bundle: RawBundle = {};
      await Promise.all(
        sourcesFor(plan.table).map(async (src) => {
          const opts = { queryKey: ["askRaw", src], staleTime: RAW_STALE_MS } as const;
          switch (src) {
            case "submissions":
              bundle.submissions = await qc.ensureQueryData({ ...opts, queryFn: loadSubmissions });
              break;
            case "jobs":
              bundle.jobs = await qc.ensureQueryData({ ...opts, queryFn: loadJobs });
              break;
            case "resumes":
              bundle.resumes = await qc.ensureQueryData({ ...opts, queryFn: loadResumes });
              break;
            case "timesheets":
              bundle.timesheets = await qc.ensureQueryData({ ...opts, queryFn: loadTimesheets });
              break;
          }
        })
      );
      return bundle;
    },
    [qc]
  );

  // Every run of a card bumps its token. Anything slow that finishes against an
  // old token is dropped, so a fast run of chip edits can't have an earlier
  // result — or an earlier sentence — land on top of a later one.
  const runToken = useRef(new Map<string, number>());

  const narrate = useCallback(
    async (id: string, lang: Lang, facts: AskResult["facts"], token?: number) => {
      if (token !== undefined && runToken.current.get(id) !== token) return;
      patchItem(id, { narrativeLoading: true });
      try {
        const textOut = await askNarrative(facts as unknown as Record<string, unknown>, lang);
        if (token !== undefined && runToken.current.get(id) !== token) return;
        setItems((cur) =>
          cur.map((it) =>
            it.id === id ? { ...it, narratives: { ...it.narratives, [lang]: textOut }, narrativeLoading: false } : it
          )
        );
      } catch {
        // The card falls back to its own plain count line — the numbers are
        // already on screen, only the sentence is missing.
        patchItem(id, { narrativeLoading: false });
      }
    },
    [patchItem]
  );

  /** Everything after the LLM: load data, compute, summarise. Never calls askPlan. */
  const run = useCallback(
    async (id: string, plan: AskPlan) => {
      const token = (runToken.current.get(id) ?? 0) + 1;
      runToken.current.set(id, token);
      patchItem(id, { loading: true, error: null });
      try {
        const raw = await loadRaw(plan);
        if (runToken.current.get(id) !== token) return;
        const result = runPlan(rowsForPlan(plan, raw), plan);
        lastPlan.current = plan;
        // The old sentence described the old numbers, so it goes.
        patchItem(id, { result, loading: false, error: null, narratives: {}, narrativeLang: "en" });
        // Editing chips re-runs on every keystroke of a date field; let the
        // edits settle before spending an LLM call on a sentence about to be
        // replaced. The table and chart are already on screen either way.
        window.setTimeout(() => void narrate(id, "en", result.facts, token), NARRATE_DEBOUNCE_MS);
      } catch (e) {
        if (runToken.current.get(id) !== token) return;
        patchItem(id, { loading: false, error: errText(e) });
      }
    },
    [loadRaw, narrate, patchItem]
  );

  const addItem = useCallback((question: string): string => {
    const id = newId();
    const item: FeedItem = {
      id,
      question,
      result: null,
      loading: true,
      error: null,
      narratives: {},
      narrativeLang: "en",
      narrativeLoading: false,
    };
    setItems((cur) => [item, ...cur]); // newest first
    return id;
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      setText("");
      const id = addItem(q);
      try {
        const { plan: raw } = await askPlan(q, lastPlan.current);
        await run(id, sanitizePlan(raw));
      } catch (e) {
        patchItem(id, { loading: false, error: errText(e) });
      }
    },
    [addItem, patchItem, run]
  );

  const runSaved = useCallback(
    (saved: SavedAskQuery) => {
      const id = addItem(saved.question || saved.name);
      void run(id, sanitizePlan(saved.plan));
    },
    [addItem, run]
  );

  const save = useCallback(
    async (item: FeedItem, name: string) => {
      if (!item.result) return;
      await saveAskQuery(name, item.question, item.result.plan);
      await savedQ.refetch();
    },
    [savedQ]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteAskQuery(id);
      await savedQ.refetch();
    },
    [savedQ]
  );

  // The dashboard launcher navigates here with ?q=… — run it once, then drop
  // the param so a reload doesn't re-ask (and re-bill) the same question.
  const [params, setParams] = useSearchParams();
  const launched = useRef(false);
  useEffect(() => {
    const q = params.get("q");
    if (!q || launched.current || !canAsk) return;
    launched.current = true;
    void ask(q);
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
  }, [params, setParams, canAsk, ask]);

  if (profileLoading && !profile) {
    return (
      <div className="center-load" style={{ minHeight: "30vh" }}>
        <div className="spinner dark" />
      </div>
    );
  }

  if (!canAsk) {
    return (
      <div>
        <h1>Ask Anything</h1>
        <div className="alert info">
          Ask Anything is available to managers and admins — it reports across everyone&#39;s
          submissions, requirements, clients and timesheets. Ask an admin if you need access.
        </div>
      </div>
    );
  }

  const busy = items.some((it) => it.loading);
  const saved = savedQ.data ?? [];

  return (
    <div>
      <h1>Ask Anything</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        A plain-English question about submissions, requirements, recruiters, clients, resume
        assessments or timesheets. Every number below is computed from the data itself — the AI only
        decides what to look at and phrases the summary.
      </p>

      <div className="card">
        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Requirements received per client this month"
            aria-label="Ask a question about the data"
          />
          <button className="btn" type="submit" disabled={!text.trim() || busy}>
            {busy ? <span className="spinner" /> : "🔎"} Ask
          </button>
        </form>

        <div className="ask-prompts">
          {SUGGESTED_PROMPTS.map((p) => (
            <button key={p} type="button" className="ask-prompt" disabled={busy} onClick={() => void ask(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {saved.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.05rem" }}>Saved queries</h2>
          <p className="muted" style={{ marginTop: "-0.25rem", fontSize: "0.85rem" }}>
            Shared with every admin and manager. Re-running one is instant — it skips the AI and goes
            straight to the data.
          </p>
          <div className="ask-saved">
            {saved.map((s) => (
              <div className="ask-saved-item" key={s.id}>
                <button type="button" onClick={() => runSaved(s)} title={s.question || s.name}>
                  📌 {s.name}
                  {s.createdByName && <span className="muted"> · {s.createdByName}</span>}
                </button>
                <button
                  type="button"
                  className="ask-saved-del"
                  aria-label={`Delete saved query ${s.name}`}
                  onClick={() => void remove(s.id)}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Nothing asked yet. Pick one of the suggestions above, or type your own — you can change
            the table, dates, grouping and columns on the answer afterwards without asking again.
          </p>
        </div>
      )}

      {items.map((item) => (
        <AskCard
          key={item.id}
          question={item.question}
          result={item.result}
          loading={item.loading}
          error={item.error}
          narratives={item.narratives}
          narrativeLang={item.narrativeLang}
          narrativeLoading={item.narrativeLoading}
          onLangChange={(lang) => {
            patchItem(item.id, { narrativeLang: lang });
            if (item.result && !item.narratives[lang]) void narrate(item.id, lang, item.result.facts);
          }}
          onRerun={(plan) => void run(item.id, plan)}
          onSave={(name) => void save(item, name)}
          onDismiss={() => setItems((cur) => cur.filter((it) => it.id !== item.id))}
        />
      ))}
    </div>
  );
}
