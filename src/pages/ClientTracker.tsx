import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchCeipalReport, reportMeta } from "../lib/ceipal";
import { parseSubmissionsFromApi } from "../lib/report/parseSource";
import { SubmissionEvent } from "../lib/report/types";
import { friendlyError } from "../lib/errors";
import {
  computeClientScores,
  sortClientScores,
  portfolioStats,
  STAGE_META,
  STAGE_COLOR,
  STALE_DAYS,
  ClientScore,
  ClientSortKey,
  Verdict,
  Trend,
} from "../lib/clientTracker";
import Pagination, { usePagination } from "../components/Pagination";
import PieChart from "../components/PieChart";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtDate = (d: DateTime | null) => (d ? d.toFormat("MM/dd/yyyy") : "—");
const days = (n: number | null) => (n == null ? "—" : `${n}d`);

const SORTS: { key: ClientSortKey; label: string }[] = [
  { key: "total", label: "Most submissions" },
  { key: "reconsider", label: "Problem clients first" },
  { key: "responseRate", label: "Response rate" },
  { key: "response_time", label: "Fastest to respond" },
  { key: "selected", label: "Most selected" },
  { key: "waiting", label: "Longest waiting" },
  { key: "stale", label: "Most stale" },
];

const VERDICT: Record<Verdict, { label: string; pill: string; hint: string; color: string }> = {
  prioritize: { label: "🟢 Prioritize", pill: "green", hint: "Responsive — moving our profiles and/or selecting.", color: "#12b886" },
  watch: { label: "🟡 Watch", pill: "amber", hint: "Some movement, but no selections yet.", color: "#e0a800" },
  reconsider: { label: "🔴 Reconsider", pill: "red", hint: "No profile has ever moved past submission — silent.", color: "#c92a2a" },
};

const TREND: Record<Trend, { icon: string; color: string; title: string }> = {
  up: { icon: "↗", color: "#12b886", title: "Response rate rising vs the prior period" },
  down: { icon: "↘", color: "#c92a2a", title: "Response rate falling vs the prior period" },
  flat: { icon: "→", color: "#8aa4c8", title: "Response rate steady vs the prior period" },
  na: { icon: "·", color: "#adb5bd", title: "Not enough recent data to compare" },
};

// Proportional 5-stage funnel bar for one client.
function StageMeter({ s }: { s: ClientScore }) {
  const segs = STAGE_META.map((m) => ({ ...m, n: (s as unknown as Record<string, number>)[m.key] })).filter((x) => x.n > 0);
  return (
    <div title={segs.map((x) => `${x.n} ${x.label}`).join(" · ")} style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", background: "#eef1f5", minWidth: 140 }}>
      {segs.map((x) => (
        <div key={x.key} style={{ width: `${(x.n / s.total) * 100}%`, background: x.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {x.n / s.total > 0.12 && <span style={{ color: "#fff", fontSize: "0.66rem", fontWeight: 700 }}>{x.n}</span>}
        </div>
      ))}
    </div>
  );
}

// One step of the portfolio conversion funnel.
function FunnelStep({ label, value, base, color }: { label: string; value: number; base: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: 3 }}>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
      </div>
      <div style={{ height: 10, borderRadius: 3, background: "#eef1f5", overflow: "hidden" }}>
        <div style={{ width: `${base ? (value / base) * 100 : 0}%`, height: "100%", background: color }} />
      </div>
      <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>{base ? pct(value / base) : "—"} of submitted</div>
    </div>
  );
}

export default function ClientTracker() {
  const qc = useQueryClient();
  const subsQ = useQuery({
    queryKey: ["clientTrackerSubs"],
    queryFn: async () => {
      const json = await fetchCeipalReport("submissions");
      return { subs: parseSubmissionsFromApi(json), meta: reportMeta(json) };
    },
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  const hardRefresh = async () => {
    setRefreshing(true);
    setRefreshErr(null);
    try {
      const json = await fetchCeipalReport("submissions", { refresh: true });
      qc.setQueryData(["clientTrackerSubs"], { subs: parseSubmissionsFromApi(json), meta: reportMeta(json) });
    } catch (e) {
      setRefreshErr(friendlyError(e));
    } finally {
      setRefreshing(false);
    }
  };

  const subs: SubmissionEvent[] | null = subsQ.data?.subs ?? null;
  const meta = subsQ.data?.meta ?? null;

  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
  const [sortKey, setSortKey] = useState<ClientSortKey>("total");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const dateActive = !!submittedFrom || !!submittedTo;
  const filtered = useMemo(() => {
    if (!subs) return null;
    if (!dateActive) return subs;
    const from = submittedFrom ? DateTime.fromISO(submittedFrom) : null;
    const to = submittedTo ? DateTime.fromISO(submittedTo).endOf("day") : null;
    return subs.filter((s) => {
      const d = s.submittedOn;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [subs, submittedFrom, submittedTo, dateActive]);

  const scores = useMemo(() => (filtered ? computeClientScores(filtered) : []), [filtered]);
  const sorted = useMemo(() => sortClientScores(scores, sortKey), [scores, sortKey]);
  const board = usePagination(sorted, 25);
  const pf = useMemo(() => portfolioStats(scores), [scores]);

  const verdictPie = [
    { label: "Prioritize", value: pf.verdicts.prioritize, color: VERDICT.prioritize.color },
    { label: "Watch", value: pf.verdicts.watch, color: VERDICT.watch.color },
    { label: "Reconsider", value: pf.verdicts.reconsider, color: VERDICT.reconsider.color },
  ].filter((x) => x.value > 0);

  const toggle = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const error = subsQ.error ? friendlyError(subsQ.error) : refreshErr;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Client Tracker</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            For each client/vendor we submit to: how many profiles we sent and how far they moved.
            The timeline starts when a profile is <strong>submitted to the client/vendor</strong> — internal
            submissions don&#39;t count here. Use it to decide who to prioritise and who is sitting silently on our profiles.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn secondary" onClick={() => subsQ.refetch()} disabled={subsQ.isFetching || refreshing}>
            {subsQ.isFetching ? <span className="spinner dark" /> : "⟳"} Refresh
          </button>
          <button className="btn ghost" onClick={hardRefresh} disabled={subsQ.isFetching || refreshing} title="Pull the latest data directly from Ceipal (slower)">
            {refreshing ? <span className="spinner dark" /> : "↻"} From Ceipal
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {meta && !error && (
        <div className="alert info">
          {meta.fetched} submissions
          {meta.cachedAt ? ` · data as of ${new Date(meta.cachedAt).toLocaleString()} (cached)` : " · freshly pulled from Ceipal"}
        </div>
      )}

      {subsQ.isLoading ? (
        <div className="center-load" style={{ minHeight: "40vh" }}><div className="spinner dark" /></div>
      ) : subs ? (
        <>
          {/* Controls */}
          <div className="card">
            <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Submitted from</label>
                <input type="date" value={submittedFrom} onChange={(e) => setSubmittedFrom(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Submitted to</label>
                <input type="date" value={submittedTo} onChange={(e) => setSubmittedTo(e.target.value)} />
              </div>
              {dateActive && (
                <button className="btn ghost" style={{ padding: "0.4rem 0.7rem" }} onClick={() => { setSubmittedFrom(""); setSubmittedTo(""); }}>
                  Clear dates
                </button>
              )}
              <div className="field" style={{ margin: 0, minWidth: 200 }}>
                <label>Sort by</label>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as ClientSortKey)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                {STAGE_META.map((m) => (
                  <span key={m.key} className="muted" style={{ fontSize: "0.76rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color, display: "inline-block" }} />
                    {m.label.split(" (")[0]}
                  </span>
                ))}
              </div>
            </div>
            {dateActive && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                Profiles submitted {submittedFrom || "any time"} → {submittedTo || "today"}.
              </p>
            )}
          </div>

          {scores.length === 0 ? (
            <div className="card">
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
                <p>{dateActive ? "No client/vendor submissions in the selected date range." : "No client/vendor submissions found yet."}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="stat-grid">
                  <Stat label="Clients / Vendors" value={pf.clients} />
                  <Stat label="Profiles submitted to them" value={pf.totalSubs} />
                  <Stat label="Overall response rate" value={pct(pf.respondedRate)} />
                  <Stat label="Selected / offers" value={pf.selected} />
                  <Stat label="Avg time to first response" value={days(pf.avgTimeToResponseDays)} />
                  <Stat label={`Stale (>${STALE_DAYS}d, no reply)`} value={pf.staleTotal} />
                  <Stat label="🔴 Reconsider (no movement)" value={pf.verdicts.reconsider} />
                </div>
              </div>

              {/* Portfolio: verdict split + conversion funnel */}
              <div className="card">
                <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "center" }}>
                  {verdictPie.length > 0 && (
                    <div style={{ minWidth: 200 }}>
                      <PieChart title="Clients by verdict" data={verdictPie} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 320 }}>
                    <h3 style={{ margin: "0 0 0.75rem" }}>Conversion funnel (all client/vendor submissions)</h3>
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                      <FunnelStep label="Submitted" value={pf.totalSubs} base={pf.totalSubs} color="#8aa4c8" />
                      <FunnelStep label="Got a response" value={pf.responded} base={pf.totalSubs} color="#4c8bf5" />
                      <FunnelStep label="Reached interview" value={pf.interviewed} base={pf.totalSubs} color="#e0a800" />
                      <FunnelStep label="Selected / offer" value={pf.selected} base={pf.totalSubs} color="#12b886" />
                    </div>
                    <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.75rem", marginBottom: 0 }}>
                      Interview → selection: <strong>{pf.interviewToSelection != null ? pct(pf.interviewToSelection) : "—"}</strong>
                      {" "}of interviewed candidates are selected · {pf.staleTotal} profile{pf.staleTotal === 1 ? "" : "s"} stale
                      (waiting &gt; {STALE_DAYS}d with no reply).
                    </p>
                  </div>
                </div>
              </div>

              <div className="card">
                <p className="sub">
                  Click a client to see the individual profiles and its detailed metrics. Response = share of
                  submissions that got any feedback. A client is flagged 🔴 only when <strong>nothing has ever moved</strong> past submission.
                </p>
                <div className="table-wrap" style={{ maxHeight: "62vh" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}></th>
                        <th style={{ width: 40 }}>#</th>
                        <th>Client / Vendor</th>
                        <th style={{ textAlign: "right" }}>Submitted</th>
                        <th style={{ minWidth: 150 }}>Progress</th>
                        <th style={{ textAlign: "right" }}>Response</th>
                        <th style={{ textAlign: "center" }} title="Response-rate trend, recent vs prior 45 days">Trend</th>
                        <th style={{ textAlign: "right" }} title="Avg days from submission to first response">Resp. time</th>
                        <th style={{ textAlign: "right" }}>Selected</th>
                        <th style={{ textAlign: "right" }}>Waiting</th>
                        <th>Last activity</th>
                        <th>Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.pageItems.map((s, i) => {
                        const key = s.client.toLowerCase();
                        const open = expanded.has(key);
                        const v = VERDICT[s.verdict];
                        const tr = TREND[s.trend];
                        return (
                          <Fragment key={key}>
                            <tr onClick={() => toggle(key)} style={{ cursor: "pointer" }} className={s.verdict === "reconsider" ? "red" : ""}>
                              <td style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</td>
                              <td className="muted">{board.startIndex + i + 1}</td>
                              <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{s.client}</td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>{s.total}</td>
                              <td><StageMeter s={s} /></td>
                              <td style={{ textAlign: "right" }}>{pct(s.responseRate)}</td>
                              <td style={{ textAlign: "center", color: tr.color, fontWeight: 700 }} title={tr.title}>{tr.icon}</td>
                              <td style={{ textAlign: "right" }} className="muted">{days(s.avgTimeToResponseDays)}</td>
                              <td style={{ textAlign: "right" }}>{s.selected || "—"}</td>
                              <td style={{ textAlign: "right" }} title={s.maxWaitDays != null ? `oldest ${s.maxWaitDays}d` : ""}>
                                {s.submitted ? (
                                  <>
                                    {s.submitted} · {s.avgWaitDays ?? 0}d
                                    {s.staleCount > 0 && <span className="pill red" style={{ marginLeft: 4, fontSize: "0.66rem", padding: "0 5px" }}>{s.staleCount} stale</span>}
                                  </>
                                ) : "—"}
                              </td>
                              <td style={{ whiteSpace: "nowrap" }} className="muted">{fmtDate(s.lastActivity)}</td>
                              <td><span className={`pill ${v.pill}`} title={v.hint}>{v.label}</span></td>
                            </tr>
                            {open && (
                              <tr>
                                <td></td>
                                <td colSpan={11} style={{ background: "#f8fafc", padding: "0.6rem 0.75rem" }}>
                                  <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                                    <Metric label="Response rate" value={pct(s.responseRate)} />
                                    <Metric label="Reached interview" value={`${s.interviewReached} (${pct(s.interviewRate)})`} />
                                    <Metric label="Interview → selection" value={s.interviewToSelection != null ? pct(s.interviewToSelection) : "—"} />
                                    <Metric label="Submissions per selection" value={s.subsPerSelection != null ? s.subsPerSelection.toFixed(1) : "— (0 selected)"} />
                                    <Metric label="Avg time to response" value={days(s.avgTimeToResponseDays)} />
                                    <Metric label={`Stale (>${STALE_DAYS}d)`} value={String(s.staleCount)} />
                                  </div>
                                  <table className="data" style={{ margin: 0 }}>
                                    <thead>
                                      <tr>
                                        <th>Consultant</th>
                                        <th>Requirement</th>
                                        <th>Recruiter</th>
                                        <th>Current status</th>
                                        <th>Submitted on</th>
                                        <th style={{ textAlign: "right" }}>Resp. time</th>
                                        <th style={{ textAlign: "right" }}>Waiting</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {s.subs.map((r, j) => (
                                        <tr key={j}>
                                          <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{r.consultant || "—"}</td>
                                          <td style={{ whiteSpace: "normal" }}>{r.jobTitle || r.jobCode || "—"}</td>
                                          <td style={{ whiteSpace: "normal" }}>{r.recruiter || "—"}</td>
                                          <td style={{ whiteSpace: "normal" }}>
                                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                                              <span style={{ width: 10, height: 10, borderRadius: 2, background: STAGE_COLOR[r.stage], display: "inline-block" }} />
                                              {r.status || "—"}
                                            </span>
                                          </td>
                                          <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.submittedOn)}</td>
                                          <td style={{ textAlign: "right" }} className="muted">{r.timeToResponseDays != null ? days(r.timeToResponseDays) : "—"}</td>
                                          <td style={{ textAlign: "right" }} className="muted">
                                            {r.stage === "submitted" && r.daysWaiting != null ? (
                                              <span style={{ color: r.daysWaiting > STALE_DAYS ? "#c92a2a" : undefined, fontWeight: r.daysWaiting > STALE_DAYS ? 700 : undefined }}>{r.daysWaiting}d</span>
                                            ) : "—"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={board.page} pageCount={board.pageCount} total={board.total} pageSize={board.pageSize} onPage={board.setPage} />
              </div>
            </>
          )}
        </>
      ) : (
        <div className="card">
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
            <p>No submissions data. Pull it with Refresh, or check your Ceipal configuration.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: "0.75rem" }}>{label}</div>
    </div>
  );
}
