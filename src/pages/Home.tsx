// The dashboard IS Ask Anything — one tab, not two.
//
// The query pipeline is deliberately split so no number is ever invented:
//
//   askPlan (LLM)  ->  sanitizePlan()  ->  runPlan() in the browser  ->  askNarrative (LLM)
//
// Editing a card's chips, and re-running a saved query, both re-enter that
// pipeline after the LLM step.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import AskCard from "../components/ask/AskCard";
import { AskPlan, AskResult, runPlan, sanitizePlan } from "../lib/askEngine";
import { SUGGESTED_PROMPTS } from "../lib/askCatalog";
import { Lang } from "../lib/indexGuide";
import {
  DebugLogWrite,
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
  writeDebugLog,
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

const RAW_STALE_MS = 5 * 60 * 1000;
const NARRATE_DEBOUNCE_MS = 700;

let nextId = 0;
const newId = () => `ask-${++nextId}`;

const errText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

export default function Home() {
  const { user, profile, profileLoading } = useAuth();
  const { lang } = useLang();

  const canAsk =
    profile?.role === "admin" || profile?.role === "manager";

  const isAdmin = profile?.role === "admin";

  const qc = useQueryClient();
 

  const [items, setItems] = useState<FeedItem[]>([]);
  const [text, setText] = useState("");

  const lastPlan = useRef<AskPlan | null>(null);

  const logDebug = useCallback(
    (entry: DebugLogWrite) => {
      void writeDebugLog(entry).then(() =>
        qc.invalidateQueries({ queryKey: ["askDebugLog"] })
      );
    },
    [qc]
  );

  const savedQ = useQuery({
    queryKey: ["askQueries"],
    queryFn: listAskQueries,
    enabled: canAsk,
  });

  const patchItem = useCallback(
    (id: string, patch: Partial<FeedItem>) => {
      setItems((cur) =>
        cur.map((it) =>
          it.id === id ? { ...it, ...patch } : it
        )
      );
    },
    []
  );

  const loadRaw = useCallback(
    async (plan: AskPlan): Promise<RawBundle> => {
      const bundle: RawBundle = {};

      await Promise.all(
        sourcesFor(plan.table).map(async (src) => {
          const opts = {
            queryKey: ["askRaw", src],
            staleTime: RAW_STALE_MS,
          } as const;

          switch (src) {
            case "submissions":
              bundle.submissions = await qc.ensureQueryData({
                ...opts,
                queryFn: loadSubmissions,
              });
              break;

            case "jobs":
              bundle.jobs = await qc.ensureQueryData({
                ...opts,
                queryFn: loadJobs,
              });
              break;

            case "resumes":
              bundle.resumes = await qc.ensureQueryData({
                ...opts,
                queryFn: loadResumes,
              });
              break;

            case "timesheets":
              bundle.timesheets = await qc.ensureQueryData({
                ...opts,
                queryFn: loadTimesheets,
              });
              break;
          }
        })
      );

      return bundle;
    },
    [qc]
  );

  const runToken = useRef(new Map<string, number>());

  const narrate = useCallback(
    async (
      id: string,
      lang: Lang,
      facts: AskResult["facts"],
      token?: number
    ) => {
      if (
        token !== undefined &&
        runToken.current.get(id) !== token
      )
        return;

      patchItem(id, { narrativeLoading: true });

      try {
        const textOut = await askNarrative(
          facts as unknown as Record<string, unknown>,
          lang
        );

        if (
          token !== undefined &&
          runToken.current.get(id) !== token
        )
          return;

        setItems((cur) =>
          cur.map((it) =>
            it.id === id
              ? {
                  ...it,
                  narratives: {
                    ...it.narratives,
                    [lang]: textOut,
                  },
                  narrativeLoading: false,
                }
              : it
          )
        );
      } catch {
        patchItem(id, { narrativeLoading: false });
      }
    },
    [patchItem]
  );

  const run = useCallback(
    async (
      id: string,
      plan: AskPlan,
      meta?: {
        question: string;
        source: "ask" | "saved" | "edit";
        rawPlan?: unknown;
      }
    ) => {
      const token =
        (runToken.current.get(id) ?? 0) + 1;

      runToken.current.set(id, token);

      patchItem(id, {
        loading: true,
        error: null,
      });

      try {
        const raw = await loadRaw(plan);

        if (runToken.current.get(id) !== token)
          return;

        const sourceRows = rowsForPlan(plan, raw);
        const result = runPlan(sourceRows, plan);

        lastPlan.current = plan;

        patchItem(id, {
          result,
          loading: false,
          error: null,
          narratives: {},
          narrativeLang: lang,
        });

        if (meta) {
          logDebug({
            question: meta.question,
            source: meta.source,
            table: plan.table,
            rawPlan: meta.rawPlan,
            plan,
            rowsLoaded: sourceRows.length,
            groups: result.grouped
              ? result.totalRows
              : null,
            rowsMatched: result.grouped
              ? result.facts.totalRows
              : result.totalRows,
          });
        }

        window.setTimeout(
          () =>
            void narrate(
              id,
              lang,
              result.facts,
              token
            ),
          NARRATE_DEBOUNCE_MS
        );
      } catch (e) {
        if (runToken.current.get(id) !== token)
          return;

        const message = errText(e);

        patchItem(id, {
          loading: false,
          error: message,
        });

        if (meta) {
          logDebug({
            question: meta.question,
            source: meta.source,
            table: plan.table,
            rawPlan: meta.rawPlan,
            plan,
            error: message,
          });
        }
      }
    },
    [
      loadRaw,
      narrate,
      patchItem,
      lang,
      logDebug,
    ]
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

      setItems((cur) => [item, ...cur]);

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
        const { plan: raw } = await askPlan(
          q,
          lastPlan.current
        );

        await run(id, sanitizePlan(raw), {
          question: q,
          source: "ask",
          rawPlan: raw,
        });
      } catch (e) {
        const message = errText(e);

        patchItem(id, {
          loading: false,
          error: message,
        });

        logDebug({
          question: q,
          source: "ask",
          error: message,
        });
      }
    },
    [
      addItem,
      canAsk,
      patchItem,
      run,
      logDebug,
    ]
  );

  const runSaved = useCallback(
    (saved: SavedAskQuery) => {
      const question =
        saved.question || saved.name;

      const id = addItem(question);

      void run(id, sanitizePlan(saved.plan), {
        question,
        source: "saved",
      });
    },
    [addItem, run]
  );

  const save = useCallback(
    async (item: FeedItem, name: string) => {
      if (!item.result) return;

      await saveAskQuery(
        name,
        item.question,
        item.result.plan
      );

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

  useEffect(() => {
    setItems((cur) =>
      cur.map((it) =>
        it.result
          ? {
              ...it,
              narrativeLang: lang,
            }
          : it
      )
    );

    items.forEach((it) => {
      if (
        it.result &&
        !it.narratives[lang]
      ) {
        void narrate(
          it.id,
          lang,
          it.result.facts
        );
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const [params, setParams] =
    useSearchParams();

  const launched = useRef(false);

  useEffect(() => {
    const q = params.get("q");

    if (
      !q ||
      launched.current ||
      !canAsk
    )
      return;

    launched.current = true;

    void ask(q);

    const next =
      new URLSearchParams(params);

    next.delete("q");

    setParams(next, {
      replace: true,
    });
  }, [
    params,
    setParams,
    canAsk,
    ask,
  ]);

  if (profileLoading && !profile) {
    return (
      <div
        className="center-load"
        style={{ minHeight: "40vh" }}
      >
        <div className="spinner dark" />
      </div>
    );
  }

  const asked = items.length > 0;
  const busy = items.some(
    (it) => it.loading
  );

  const saved = savedQ.data ?? [];

  return (
    <div
      className={`home-wrap${
        asked ? " asked" : ""
      }`}
    >

      {/* =========================
          WELCOME
      ========================== */}

      <div className="home-intro">
        <div className="home-mark">
          Welcome to Cliff Recruiter Suite
        </div>

        <p className="muted home-tagline">
          Manage recruiting activity, track team
          performance, and ask Cliff AI anything
          about your recruiting data.
        </p>
      </div>


      {/* =========================
          TEAM OVERVIEW
      ========================== */}

      

     



      {/* =========================
          CLIFF AI
      ========================== */}

      {canAsk ? (
        <>
          <div className="cliff-ai-header">
      <div>
        <span className="cliff-ai-badge">AI</span>
        <h2>Ask Cliff AI</h2>
      </div>

      <p>
        Get instant insights from your recruiting data.
      </p>
    </div>
          <form
            className="ask-bar home-ask-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >

            <input
              value={text}
              onChange={(e) =>
                setText(e.target.value)
              }
              placeholder="e.g. submissions by status this week"
              aria-label="Ask anything about your data"
              autoFocus
            />

            <button
              className="btn"
              type="submit"
              disabled={
                !text.trim() || busy
              }
            >
              {busy ? (
                <span className="spinner" />
              ) : (
                "🔎"
              )}{" "}
              Ask
            </button>

          </form>


          {!asked && (
            <div className="home-prompts">

              {SUGGESTED_PROMPTS.map(
                (p) => (
                  <button
                    key={p}
                    type="button"
                    className="ask-prompt"
                    disabled={busy}
                    onClick={() =>
                      void ask(p)
                    }
                  >
                    {p}
                  </button>
                )
              )}

            </div>
          )}


          <div className="home-below">

            {saved.length > 0 && (
              <div className="card">

                <h2
                  style={{
                    fontSize: "1.05rem",
                  }}
                >
                  Saved queries
                </h2>

                <p
                  className="muted"
                  style={{
                    marginTop: "-0.25rem",
                    fontSize: "0.85rem",
                  }}
                >
                  The ones you saved, plus the
                  shared set an admin publishes
                  for everyone. Re-running one is
                  instant — it skips the AI and
                  goes straight to the data.
                </p>


                <div className="ask-saved">

                  {saved.map((s) => {

                    const mine =
                      s.createdByUid ===
                      user?.uid;

                    return (
                      <div
                        className="ask-saved-item"
                        key={s.id}
                      >

                        <button
                          type="button"
                          onClick={() =>
                            runSaved(s)
                          }
                          title={
                            s.question ||
                            s.name
                          }
                        >
                          📌 {s.name}

                          {s.shared &&
                            !mine &&
                            s.createdByName && (
                              <span className="muted">
                                {" "}
                                ·{" "}
                                {
                                  s.createdByName
                                }
                              </span>
                            )}
                        </button>


                        <span
                          className={`pill ${
                            s.shared
                              ? "green"
                              : "grey"
                          }`}
                          title={
                            s.shared
                              ? "Everyone with access to this page can see this"
                              : "Only you can see this"
                          }
                        >
                          {s.shared
                            ? "Shared"
                            : "Private"}
                        </span>


                        {(mine ||
                          isAdmin) && (
                          <button
                            type="button"
                            className="ask-saved-del"
                            aria-label={`Delete saved query ${s.name}`}
                            onClick={() =>
                              void remove(
                                s.id
                              )
                            }
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
                question={
                  item.question
                }
                result={item.result}
                loading={item.loading}
                error={item.error}
                narratives={
                  item.narratives
                }
                narrativeLang={
                  item.narrativeLang
                }
                narrativeLoading={
                  item.narrativeLoading
                }
                onRerun={(plan) =>
                  void run(
                    item.id,
                    plan,
                    {
                      question:
                        item.question,
                      source: "edit",
                    }
                  )
                }
                savesShared={
                  !!isAdmin
                }
                onSave={(name) =>
                  void save(
                    item,
                    name
                  )
                }
                onDismiss={() =>
                  setItems((cur) =>
                    cur.filter(
                      (it) =>
                        it.id !==
                        item.id
                    )
                  )
                }
              />
            ))}

          </div>
        </>
      ) : (

        <div
          className="alert info"
          style={{
            maxWidth: 620,
            width: "100%",
          }}
        >
          Asking questions about the data
          is available to managers and
          admins — it reports across
          everyone&apos;s submissions,
          requirements, clients and
          timesheets. Ask an admin if you
          need access.
        </div>

      )}

    </div>
  );
}
