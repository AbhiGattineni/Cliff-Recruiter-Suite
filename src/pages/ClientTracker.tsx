import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchCeipalReport, reportMeta } from "../lib/ceipal";
import { parseSubmissionsFromApi, parseJobsFromApi } from "../lib/report/parseSource";
import { SubmissionEvent, JobRecord } from "../lib/report/types";
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
import {
  computeClientRequirements,
  requirementTotals,
  clientKey,
  ClientRequirements,
} from "../lib/clientRequirements";
import Pagination, { usePagination } from "../components/Pagination";
import PieChart from "../components/PieChart";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtDate = (d: DateTime | null) => (d ? d.toFormat("MM/dd/yyyy") : "—");
const days = (n: number | null) => (n == null ? "—" : `${n}d`);

const SORTS: { key: ClientSortKey; label: string }[] = [
  { key: "total", label: "Most submissions" },
  { key: "requirements", label: "Most requirements received" },
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

// ---- Per-column header filters ----
const TREND_LABEL: Record<Trend, string> = {
  up: "↗ Rising",
  down: "↘ Falling",
  flat: "→ Steady",
  na: "· N/A",
};
const REQ_STATUS_OPTS = ["Active", "On hold", "Closed", "Other"];
const NO_SUBMISSIONS = "— No submissions";
const FILTER_COLS = ["client", "reqStatus", "trend", "verdict"] as const;
type FilterCol = (typeof FILTER_COLS)[number];
type TrackerRow = { key: string; client: string; score: ClientScore | null; req: ClientRequirements | null };

// The set of filterable values a row exposes for each column. Multiple values
// (e.g. a client with both active and hold requirements) mean the row matches
// if ANY selected value is present — same OR-within-column semantics as the
// report-generation filters.
function rowFacets(row: TrackerRow): Record<FilterCol, string[]> {
  const s = row.score;
  const req = row.req;
  const reqStatus: string[] = [];
  if (req) {
    if (req.active > 0) reqStatus.push("Active");
    if (req.onHold > 0) reqStatus.push("On hold");
    if (req.closed > 0) reqStatus.push("Closed");
    if (req.other > 0) reqStatus.push("Other");
  }
  return {
    client: [row.client],
    reqStatus,
    trend: [s ? TREND_LABEL[s.trend] : TREND_LABEL.na],
    verdict: [s ? VERDICT[s.verdict].label : NO_SUBMISSIONS],
  };
}

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
      // Requirements come from the job report; best-effort so a failure there
      // doesn't take down the submission metrics.
      const [subJson, jobRes] = await Promise.all([
        fetchCeipalReport("submissions"),
        fetchCeipalReport("job_duration").catch(() => null),
      ]);
      return {
        subs: parseSubmissionsFromApi(subJson),
        jobs: jobRes ? parseJobsFromApi(jobRes) : [],
        meta: reportMeta(subJson),
      };
    },
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  const hardRefresh = async () => {
    setRefreshing(true);
    setRefreshErr(null);
    try {
      const [subJson, jobRes] = await Promise.all([
        fetchCeipalReport("submissions", { refresh: true }),
        fetchCeipalReport("job_duration", { refresh: true }).catch(() => null),
      ]);
      qc.setQueryData(["clientTrackerSubs"], {
        subs: parseSubmissionsFromApi(subJson),
        jobs: jobRes ? parseJobsFromApi(jobRes) : [],
        meta: reportMeta(subJson),
      });
    } catch (e) {
      setRefreshErr(friendlyError(e));
    } finally {
      setRefreshing(false);
    }
  };

  const subs: SubmissionEvent[] | null = subsQ.data?.subs ?? null;
  const jobs: JobRecord[] = subsQ.data?.jobs ?? [];
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
  const pf = useMemo(() => portfolioStats(scores), [scores]);

  // Requirements RECEIVED from each client in the same window (by job created
  // date). Independent of submissions — a client can send requirements and
  // receive nothing back, which is exactly the gap worth seeing.
  const reqs = useMemo(
    () =>
      computeClientRequirements(
        jobs,
        submittedFrom ? DateTime.fromISO(submittedFrom) : null,
        submittedTo ? DateTime.fromISO(submittedTo).endOf("day") : null
      ),
    [jobs, submittedFrom, submittedTo]
  );
  const reqTotals = useMemo(() => requirementTotals(reqs), [reqs]);

  // Lifetime requirements per client — deliberately NOT date-filtered, so the
  // table can show "12 of 38 came in this period" rather than only the slice.
  const allTimeReqs = useMemo(() => computeClientRequirements(jobs, null, null), [jobs]);
  const allTimeByKey = useMemo(() => new Map(allTimeReqs.map((r) => [r.key, r])), [allTimeReqs]);
  const allTimeTotal = useMemo(() => allTimeReqs.reduce((n, r) => n + r.total, 0), [allTimeReqs]);

  // One row per client across BOTH sources, so clients that sent requirements
  // but got no submissions stop being invisible here.
  const merged = useMemo(() => {
    const rows = new Map<string, { key: string; client: string; score: ClientScore | null; req: ClientRequirements | null }>();
    for (const s of scores) {
      const k = clientKey(s.client);
      rows.set(k, { key: k, client: s.client, score: s, req: null });
    }
    for (const r of allTimeReqs) {
      if (!rows.has(r.key)) rows.set(r.key, { key: r.key, client: r.client, score: null, req: null });
    }
    for (const r of reqs) {
      const cur = rows.get(r.key);
      if (cur) cur.req = r;
      else rows.set(r.key, { key: r.key, client: r.client, score: null, req: r });
    }
    return Array.from(rows.values());
  }, [scores, reqs, allTimeReqs]);

  const sortedRows = useMemo(() => {
    if (sortKey === "requirements") {
      return [...merged].sort(
        (a, b) =>
          (b.req?.total ?? 0) - (a.req?.total ?? 0) ||
          (allTimeByKey.get(b.key)?.total ?? 0) - (allTimeByKey.get(a.key)?.total ?? 0) ||
          a.client.localeCompare(b.client)
      );
    }
    const order = sortClientScores(scores, sortKey).map((s) => clientKey(s.client));
    const rank = new Map(order.map((k, i) => [k, i]));
    // Clients with no submissions can't be ranked by a submission metric — they
    // sort after those that can, by requirement count.
    return [...merged].sort((a, b) => {
      const ra = rank.has(a.key) ? rank.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.key) ? rank.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return ra - rb || (b.req?.total ?? 0) - (a.req?.total ?? 0);
    });
  }, [merged, scores, sortKey, allTimeByKey]);

  // Per-column header filters (value multi-select, like report generation).
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});

  const facetOptions = useMemo(() => {
    const acc: Record<FilterCol, Set<string>> = {
      client: new Set(), reqStatus: new Set(), trend: new Set(), verdict: new Set(),
    };
    for (const row of sortedRows) {
      const f = rowFacets(row);
      for (const c of FILTER_COLS) for (const v of f[c]) acc[c].add(v);
    }
    return {
      client: [...acc.client].sort((a, b) => a.localeCompare(b)),
      reqStatus: REQ_STATUS_OPTS.filter((o) => acc.reqStatus.has(o)),
      trend: [TREND_LABEL.up, TREND_LABEL.down, TREND_LABEL.flat, TREND_LABEL.na].filter((o) => acc.trend.has(o)),
      verdict: [VERDICT.prioritize.label, VERDICT.watch.label, VERDICT.reconsider.label, NO_SUBMISSIONS].filter((o) => acc.verdict.has(o)),
    } as Record<FilterCol, string[]>;
  }, [sortedRows]);

  const anyColFilter = FILTER_COLS.some((c) => (colFilters[c]?.length ?? 0) > 0);

  const visibleRows = useMemo(() => {
    const active = FILTER_COLS.filter((c) => (colFilters[c]?.length ?? 0) > 0);
    if (!active.length) return sortedRows;
    return sortedRows.filter((row) => {
      const f = rowFacets(row);
      return active.every((c) => f[c].some((v) => colFilters[c].includes(v)));
    });
  }, [sortedRows, colFilters]);

  const board = usePagination(visibleRows, 25, "clientTracker");
  const noSubmissionClients = useMemo(
    () => merged.filter((r) => !r.score && (r.req?.total ?? 0) > 0 && !r.req?.unassigned).length,
    [merged]
  );

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
            How many requirements each client sent us, and what we did with them. <strong>Total reqs</strong> is
            everything that client has ever sent, ignoring the dates below; <strong>Reqs in range</strong> counts
            only those received inside the selected period. Submission columns count profiles we sent them.
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
                {submittedFrom || "any time"} → {submittedTo || "today"} · requirements counted by the date the
                client sent them, submissions by the date we sent the profile.
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
              {noSubmissionClients > 0 && (
                <div className="alert warn">
                  <strong>{noSubmissionClients}</strong> client{noSubmissionClients === 1 ? "" : "s"} sent
                  requirements in this period but received <strong>no submissions</strong> from us. They are
                  listed below with a red marker.
                </div>
              )}
              {reqTotals.unassigned > 0 && (
                <div className="alert info">
                  <strong>{reqTotals.unassigned}</strong> requirement{reqTotals.unassigned === 1 ? " has" : "s have"} no
                  client recorded in Ceipal and {reqTotals.unassigned === 1 ? "is" : "are"} grouped under
                  “Unassigned client”. Filling the client field in Ceipal will move them to the right row.
                </div>
              )}

              <div className="card">
                <div className="stat-grid">
                  <Stat label="Requirements (all time)" value={allTimeTotal} />
                  <Stat label={dateActive ? "Requirements in range" : "Requirements received"} value={reqTotals.requirements} />
                  <Stat label="Clients who sent them" value={reqTotals.clients} />
                  <Stat label="Clients / Vendors submitted to" value={pf.clients} />
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
                  Use the ⏷ funnel on a column header to filter by its values.
                </p>
                {anyColFilter && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.6rem" }}>
                    <span className="muted" style={{ fontSize: "0.82rem" }}>
                      Column filters active — showing <strong>{visibleRows.length}</strong> of {sortedRows.length} clients.
                    </span>
                    <button className="btn ghost" style={{ padding: "0.25rem 0.6rem" }} onClick={() => setColFilters({})}>
                      Clear filters
                    </button>
                  </div>
                )}
                <div className="table-wrap" style={{ maxHeight: "62vh" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}></th>
                        <th style={{ width: 40 }}>#</th>
                        <th>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            Client / Vendor
                            <HeaderFilter options={facetOptions.client} selected={colFilters.client ?? []} onChange={(v) => setColFilters((p) => ({ ...p, client: v }))} />
                          </span>
                        </th>
                        <th style={{ textAlign: "right" }} title="Every requirement this client has ever sent us — not affected by the date filter">
                          Total reqs<br /><span style={{ fontWeight: 400, fontSize: "0.72rem", opacity: 0.85 }}>all time</span>
                        </th>
                        <th style={{ textAlign: "right" }} title="Requirements this client sent us inside the selected date range">
                          Reqs<br /><span style={{ fontWeight: 400, fontSize: "0.72rem", opacity: 0.85 }}>in range</span>
                        </th>
                        <th style={{ minWidth: 118 }} title="Status of the requirements in the selected range">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            Req status
                            <HeaderFilter options={facetOptions.reqStatus} selected={colFilters.reqStatus ?? []} onChange={(v) => setColFilters((p) => ({ ...p, reqStatus: v }))} />
                          </span>
                        </th>
                        <th style={{ textAlign: "right" }}>Submitted</th>
                        <th style={{ minWidth: 150 }}>Progress</th>
                        <th style={{ textAlign: "right" }}>Response</th>
                        <th style={{ textAlign: "center" }} title="Response-rate trend, recent vs prior 45 days">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            Trend
                            <HeaderFilter options={facetOptions.trend} selected={colFilters.trend ?? []} onChange={(v) => setColFilters((p) => ({ ...p, trend: v }))} />
                          </span>
                        </th>
                        <th style={{ textAlign: "right" }} title="Avg days from submission to first response">Resp. time</th>
                        <th style={{ textAlign: "right" }}>Selected</th>
                        <th style={{ textAlign: "right" }}>Waiting</th>
                        <th>Last activity</th>
                        <th>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            Verdict
                            <HeaderFilter options={facetOptions.verdict} selected={colFilters.verdict ?? []} onChange={(v) => setColFilters((p) => ({ ...p, verdict: v }))} />
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.pageItems.map((row, i) => {
                        const s = row.score;
                        const req = row.req;
                        const allTime = allTimeByKey.get(row.key) ?? null;
                        const key = row.key;
                        const open = expanded.has(key);
                        const v = s ? VERDICT[s.verdict] : null;
                        const tr = s ? TREND[s.trend] : null;
                        return (
                          <Fragment key={key}>
                            <tr onClick={() => toggle(key)} style={{ cursor: "pointer" }} className={s?.verdict === "reconsider" ? "red" : ""}>
                              <td style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</td>
                              <td className="muted">{board.startIndex + i + 1}</td>
                              <td style={{ whiteSpace: "normal", fontWeight: 600 }}>
                                {row.client}
                                {allTime?.unassigned && (
                                  <span className="pill amber" style={{ marginLeft: 6, fontSize: "0.64rem", padding: "0 5px" }} title="Requirements with no client recorded in Ceipal — worth cleaning up at the source">
                                    no client set
                                  </span>
                                )}
                                {allTime?.internal && (
                                  <span className="pill grey" style={{ marginLeft: 6, fontSize: "0.64rem", padding: "0 5px" }} title="Our own company — internal/bench requirements, not external client demand">
                                    internal
                                  </span>
                                )}
                                {!s && (allTime?.total ?? 0) > 0 && (
                                  <span className="pill red" style={{ marginLeft: 6, fontSize: "0.64rem", padding: "0 5px" }} title="This client sent requirements but we have not submitted anyone">
                                    0 submissions
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 700 }} title={allTime ? `First ${fmtDate(allTime.firstReceived)} · latest ${fmtDate(allTime.lastReceived)}` : ""}>
                                {allTime?.total ?? "—"}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }} className={dateActive ? "" : "muted"}>
                                {req?.total ?? "—"}
                              </td>
                              <td>
                                {req && req.total > 0 ? (
                                  <span style={{ display: "inline-flex", gap: "0.3rem", flexWrap: "wrap", fontSize: "0.72rem" }}>
                                    {req.active > 0 && <span className="pill green" style={{ padding: "0 6px" }} title="Active">{req.active} act</span>}
                                    {req.onHold > 0 && <span className="pill amber" style={{ padding: "0 6px" }} title="On Hold / Hold by Client">{req.onHold} hold</span>}
                                    {req.closed > 0 && <span className="pill grey" style={{ padding: "0 6px" }} title="Closed">{req.closed} closed</span>}
                                    {req.other > 0 && <span className="pill grey" style={{ padding: "0 6px" }} title="Draft, Filled or other">{req.other} other</span>}
                                  </span>
                                ) : <span className="muted">—</span>}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>{s ? s.total : "—"}</td>
                              <td>{s ? <StageMeter s={s} /> : <span className="muted">—</span>}</td>
                              <td style={{ textAlign: "right" }}>{s ? pct(s.responseRate) : "—"}</td>
                              <td style={{ textAlign: "center", color: tr?.color, fontWeight: 700 }} title={tr?.title}>{tr?.icon ?? "·"}</td>
                              <td style={{ textAlign: "right" }} className="muted">{s ? days(s.avgTimeToResponseDays) : "—"}</td>
                              <td style={{ textAlign: "right" }}>{s ? s.selected || "—" : "—"}</td>
                              <td style={{ textAlign: "right" }} title={s?.maxWaitDays != null ? `oldest ${s.maxWaitDays}d` : ""}>
                                {s && s.submitted ? (
                                  <>
                                    {s.submitted} · {s.avgWaitDays ?? 0}d
                                    {s.staleCount > 0 && <span className="pill red" style={{ marginLeft: 4, fontSize: "0.66rem", padding: "0 5px" }}>{s.staleCount} stale</span>}
                                  </>
                                ) : "—"}
                              </td>
                              <td style={{ whiteSpace: "nowrap" }} className="muted">{s ? fmtDate(s.lastActivity) : "—"}</td>
                              <td>{v ? <span className={`pill ${v.pill}`} title={v.hint}>{v.label}</span> : <span className="muted">—</span>}</td>
                            </tr>
                            {open && (
                              <tr>
                                <td></td>
                                <td colSpan={14} style={{ background: "#f8fafc", padding: "0.6rem 0.75rem" }}>
                                  {(req?.total || allTime?.total) && (
                                    <div style={{ marginBottom: "0.8rem" }}>
                                      <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                                        {req && req.total > 0
                                          ? `Requirements received in range (${req.total} of ${allTime?.total ?? req.total} all time)`
                                          : `Requirements — all time (${allTime?.total ?? 0}); none in the selected range`}
                                      </div>
                                      <table className="data" style={{ margin: 0 }}>
                                        <thead>
                                          <tr><th>Req code</th><th>Requirement</th><th>Status</th><th>Received</th><th style={{ textAlign: "right" }}>Submissions</th></tr>
                                        </thead>
                                        <tbody>
                                          {(req && req.total > 0 ? req.jobs : allTime?.jobs ?? []).map((jr, k) => (
                                            <tr key={jr.jobCode || k}>
                                              <td>{jr.jobCode || "—"}</td>
                                              <td style={{ whiteSpace: "normal" }}>{jr.jobTitle || "—"}</td>
                                              <td>{jr.jobStatus || "—"}</td>
                                              <td style={{ whiteSpace: "nowrap" }}>{fmtDate(jr.jobCreatedOn)}</td>
                                              <td style={{ textAlign: "right" }}>{jr.numOfSubmissions ?? "—"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                  {!s && (
                                    <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                                      No profiles submitted to this client in the selected period.
                                    </p>
                                  )}
                                  {s && (
                                  <>
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
                                  </>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={board.page} pageCount={board.pageCount} total={board.total} pageSize={board.pageSize} onPage={board.setPage} onPageSize={board.setPageSize} />
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

function FunnelIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16l-6 7v6l-4 2v-8z" />
    </svg>
  );
}

// A compact column-header filter: a funnel button that opens a searchable
// checkbox list of the column's distinct values. The panel is position:fixed so
// the table's scroll container can't clip it.
function HeaderFilter({ options, selected, onChange }: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true); // capture: any ancestor scroll
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const openPanel = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = 230;
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    }
    setOpen((o) => !o);
  };
  const toggleVal = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const shown = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const active = selected.length > 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); openPanel(); }}
        title="Filter this column"
        aria-label="Filter column"
        style={{
          border: "none", background: active ? "var(--brand-light)" : "transparent",
          color: active ? "var(--brand)" : "var(--muted)", cursor: "pointer",
          borderRadius: 6, padding: "2px 4px", lineHeight: 1, display: "inline-flex",
          alignItems: "center", gap: 2,
        }}
      >
        <FunnelIcon filled={active} />
        {active && <span style={{ fontSize: "0.68rem", fontWeight: 700 }}>{selected.length}</span>}
      </button>
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed", top: pos.top, left: pos.left, zIndex: 1000, width: 230,
            background: "#fff", border: "1px solid var(--line)", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(16,24,40,0.14)", padding: "0.5rem",
            maxHeight: 320, display: "flex", flexDirection: "column",
            fontWeight: 400, textAlign: "left",
          }}
        >
          <input className="ms-search" placeholder="Search…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(options)}>Select all</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o} className="ms-item">
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggleVal(o)} />
                <span>{o}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="ms-empty">No matches</div>}
          </div>
        </div>
      )}
    </>
  );
}
