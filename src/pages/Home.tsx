// The dashboard IS Ask Anything — one tab, not two. At rest it's just a
// centred bar, as close to google.com's homepage as this app gets. Asking a
// question morphs it in place (bar slides up, brand fades out, results grow
// in below) instead of routing to a second page.
//
// The query pipeline is deliberately split so no number is ever invented:
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
import { useLang } from "../context/LangContext";
import { useDebugLog } from "../context/DebugLogContext";
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

export default function Home() {
  const { user, profile, profileLoading } = useAuth();
  // One app-wide language, set from the floating switcher in the corner — see
  // the effect below that re-narrates any card missing a translation in it.
  const { lang } = useLang();
  const canAsk = profile?.role === "admin" || profile?.role === "manager";
  // An admin saving a query publishes it to the team; everyone else's saves are
  // their own. Decided server-side too — this only shapes what the UI promises.
  const isAdmin = profile?.role === "admin";

  const debugLog = useDebugLog();
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

  /**
   * Everything after the LLM: load data, compute, summarise. Never calls askPlan.
   * `meta` is only present for a fresh ask/saved-query run/chip edit (not the
   * language-switch re-narrate path) — it's what gets recorded to the debug
   * log, since that's the one place rowsLoaded/rowsMatched are already known.
   */
  const run = useCallback(
    async (id: string, plan: AskPlan, meta?: { question: string; rawPlan?: unknown }) => {
      const token = (runToken.current.get(id) ?? 0) + 1;
      runToken.current.set(id, token);
      patchItem(id, { loading: true, error: null });
      try {
        const raw = await loadRaw(plan);
        if (runToken.current.get(id) !== token) return;
        const sourceRows = rowsForPlan(plan, raw);
        const result = runPlan(sourceRows, plan);
        lastPlan.current = plan;
        // The old sentence described the old numbers, so it goes. Narrate in
        // whatever language the floating switcher is currently set to.
        patchItem(id, { result, loading: false, error: null, narratives: {}, narrativeLang: lang });
        if (meta) {
          debugLog.push({
            question: meta.question,
            table: plan.table,
            rawPlan: meta.rawPlan,
            plan,
            rowsLoaded: sourceRows.length,
            groups: result.grouped ? result.totalRows : undefined,
            rowsMatched: result.grouped ? result.facts.totalRows : result.totalRows,
          });
        }
        // Editing chips re-runs on every keystroke of a date field; let the
        // edits settle before spending an LLM call on a sentence about to be
        // replaced. The table and chart are already on screen either way.
        window.setTimeout(() => void narrate(id, lang, result.facts, token), NARRATE_DEBOUNCE_MS);
      } catch (e) {
        if (runToken.current.get(id) !== token) return;
        const message = errText(e);
        patchItem(id, { loading: false, error: message });
        if (meta) debugLog.push({ question: meta.question, table: plan.table, rawPlan: meta.rawPlan, plan, error: message });
      }
    },
    [loadRaw, narrate, patchItem, lang, debugLog]
  );

  const addItem = useCallback(
    (question: string): string => {
      const id = newId();
      const item: FeedItem = {
        id,
        question,
        result: null,
        loading: true,
        error: null,
        narratives: {},
        narrativeLang: lang,
        narrativeLoading: false,
      };
      setItems((cur) => [item, ...cur]); // newest first
      return id;
    },
    [lang]
  );

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || !canAsk) return;
      setText("");
      const id = addItem(q);
      try {
        const { plan: raw } = await askPlan(q, lastPlan.current);
        await run(id, sanitizePlan(raw), { question: q, rawPlan: raw });
      } catch (e) {
        const message = errText(e);
        patchItem(id, { loading: false, error: message });
        debugLog.push({ question: q, error: message });
      }
    },
    [addItem, canAsk, patchItem, run, debugLog]
  );

  const runSaved = useCallback(
    (saved: SavedAskQuery) => {
      const question = saved.question || saved.name;
      const id = addItem(question);
      void run(id, sanitizePlan(saved.plan), { question });
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

  // Switching the floating language icon should update every card on screen,
  // not just the next one asked. Cards that already have that language cached
  // (you switched to it before, on this or an earlier card) flip instantly —
  // only the ones missing a translation cost a fresh (grounded, still
  // number-free) askNarrative call.
  useEffect(() => {
    setItems((cur) => cur.map((it) => (it.result ? { ...it, narrativeLang: lang } : it)));
    items.forEach((it) => {
      if (it.result && !it.narratives[lang]) void narrate(it.id, lang, it.result.facts);
    });
    // Only the language switch itself should trigger this — re-running on every
    // `items`/`narrate` identity change would re-fire per keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Bookmarkable/shareable: landing on "/?q=…" asks it once, then drops the
  // param so a reload doesn't re-ask (and re-bill) the same question.
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
      <div className="center-load" style={{ minHeight: "40vh" }}>
        <div className="spinner dark" />
      </div>
    );
  }

  const asked = items.length > 0;
  const busy = items.some((it) => it.loading);
  const saved = savedQ.data ?? [];

  return (
    <div className={`home-wrap${asked ? " asked" : ""}`}>
      <div className="home-intro">
        <div className="home-mark">Cliff Recruiter Suite</div>
        <p className="muted home-tagline">Ask anything about your submissions, requirements, recruiters or clients.</p>
      </div>

      {canAsk ? (
        <>
          <form
            className="ask-bar home-ask-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. submissions by status this week"
              aria-label="Ask anything about your data"
              autoFocus
            />
            <button className="btn" type="submit" disabled={!text.trim() || busy}>
              {busy ? <span className="spinner" /> : "🔎"} Ask
            </button>
          </form>

          {!asked && (
            <div className="home-prompts">
              {SUGGESTED_PROMPTS.map((p) => (
                <button key={p} type="button" className="ask-prompt" disabled={busy} onClick={() => void ask(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="home-below">
            {saved.length > 0 && (
              <div className="card">
                <h2 style={{ fontSize: "1.05rem" }}>Saved queries</h2>
                <p className="muted" style={{ marginTop: "-0.25rem", fontSize: "0.85rem" }}>
                  The ones you saved, plus the shared set an admin publishes for everyone. Re-running one is
                  instant — it skips the AI and goes straight to the data.
                </p>
                <div className="ask-saved">
                  {saved.map((s) => {
                    const mine = s.createdByUid === user?.uid;
                    return (
                      <div className="ask-saved-item" key={s.id}>
                        <button type="button" onClick={() => runSaved(s)} title={s.question || s.name}>
                          📌 {s.name}
                          {s.shared && !mine && s.createdByName && <span className="muted"> · {s.createdByName}</span>}
                        </button>
                        <span className={`pill ${s.shared ? "green" : "grey"}`} title={s.shared ? "Everyone with access to this page can see this" : "Only you can see this"}>
                          {s.shared ? "Shared" : "Private"}
                        </span>
                        {(mine || isAdmin) && (
                          <button
                            type="button"
                            className="ask-saved-del"
                            aria-label={`Delete saved query ${s.name}`}
                            onClick={() => void remove(s.id)}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                onRerun={(plan) => void run(item.id, plan, { question: item.question })}
                savesShared={!!isAdmin}
                onSave={(name) => void save(item, name)}
                onDismiss={() => setItems((cur) => cur.filter((it) => it.id !== item.id))}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="alert info" style={{ maxWidth: 620, width: "100%" }}>
          Asking questions about the data is available to managers and admins — it reports across
          everyone&#39;s submissions, requirements, clients and timesheets. Ask an admin if you need access.
        </div>
      )}
    </div>
  );
}
