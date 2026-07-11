import { Fragment, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { fetchCeipalReport, reportMeta } from "../lib/ceipal";
import { parseSubmissionsFromApi, parseJobsFromApi } from "../lib/report/parseSource";
import { SubmissionEvent, JobRecord } from "../lib/report/types";
import { friendlyError } from "../lib/errors";
import {
  computeRecruiterStats,
  sortStats,
  RecruiterStat,
  StatusMeta,
  SortKey,
  INDEX_WEIGHTS,
  TARGET_PER_ASSIGNED,
} from "../lib/recruiterStats";
import StageBar, { StageLegend } from "../components/StageBar";
import PieChart from "../components/PieChart";
import Modal from "../components/Modal";

const fmtDt = (d: DateTime | null) => (d ? d.toFormat("MM/dd/yyyy hh:mm a") : "—");

const SORTS: { key: SortKey; label: string }[] = [
  { key: "index", label: "Performance index" },
  { key: "clientRate", label: "Client/vendor submission rate" },
  { key: "progressRate", label: "Interview+ rate" },
  { key: "profiles", label: "Profiles submitted" },
  { key: "requirements", label: "Requirements worked" },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const medal = ["🥇", "🥈", "🥉"];
const indexPill = (v: number) => (v >= 60 ? "green" : v >= 35 ? "amber" : "red");

const INDEX_METRICS = [
  { key: "clientPerAssigned", weight: INDEX_WEIGHTS.clientPerAssigned, label: `Client/vendor vs target (${TARGET_PER_ASSIGNED} per assigned requirement)` },
  { key: "clientRate", weight: INDEX_WEIGHTS.clientRate, label: "Client/vendor rate (of profiles submitted)" },
  { key: "progressRate", weight: INDEX_WEIGHTS.progressRate, label: "Reached internal interview or beyond" },
  { key: "volume", weight: INDEX_WEIGHTS.volume, label: "Volume — profiles vs the busiest recruiter" },
  { key: "coverage", weight: INDEX_WEIGHTS.coverage, label: "Coverage — requirements worked vs the widest" },
] as const;

const targetBasis = (s: RecruiterStat) =>
  s.assignedCount > 0
    ? `${s.assignedCount} assigned requirement${s.assignedCount === 1 ? "" : "s"}`
    : `${s.requirements} worked requirement${s.requirements === 1 ? "" : "s"} — no Assigned-To data`;

// Explains the Performance Index. With `stat`, shows that recruiter's achieved %
// and point contribution per metric; without, just the generic weights.
function IndexExplainer({ stat }: { stat?: RecruiterStat }) {
  return (
    <details className="colpick" style={{ marginTop: "1rem" }}>
      <summary>
        <span className="colpick-title" style={{ fontSize: "0.95rem" }}>
          How the Performance Index{stat ? ` (${stat.index})` : ""} is calculated
        </span>
      </summary>
      <div className="colpick-body">
        <p className="muted" style={{ fontSize: "0.88rem", marginTop: 0 }}>
          A 0–100 score. The biggest driver is hitting the target of {TARGET_PER_ASSIGNED} client/vendor
          submissions per assigned requirement
          {stat ? ` — ${stat.clientCount} of ${stat.clientTarget} target (2 × ${targetBasis(stat)})` : ""}.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                <th style={{ textAlign: "right" }}>Weight</th>
                {stat && <th style={{ textAlign: "right" }}>Achieved</th>}
                {stat && <th style={{ textAlign: "right" }}>Points</th>}
              </tr>
            </thead>
            <tbody>
              {INDEX_METRICS.map((m) => {
                const v = stat ? stat.indexParts[m.key] : 0;
                const pts = Math.round(m.weight * v * 100);
                return (
                  <tr key={m.key}>
                    <td style={{ whiteSpace: "normal" }}>{m.label}</td>
                    <td style={{ textAlign: "right" }}>{pct(m.weight)}</td>
                    {stat && <td style={{ textAlign: "right" }}>{pct(v)}</td>}
                    {stat && <td style={{ textAlign: "right", fontWeight: 600 }}>{pts}</td>}
                  </tr>
                );
              })}
            </tbody>
            {stat && (
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Index</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{stat.index}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </details>
  );
}

export default function RecruiterPerformance() {
  const [subs, setSubs] = useState<SubmissionEvent[] | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(""); // "" = all recruiters
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    setFetchInfo(null);
    try {
      // Submissions are required; job postings (for "Assigned To") are best-effort.
      const [subRes, jobRes] = await Promise.allSettled([
        fetchCeipalReport("submissions", 0),
        fetchCeipalReport("job_duration", 0),
      ]);
      if (subRes.status === "rejected") throw subRes.reason;
      const subJson = subRes.value;
      const meta = reportMeta(subJson);
      setSubs(parseSubmissionsFromApi(subJson));
      setJobs(jobRes.status === "fulfilled" ? parseJobsFromApi(jobRes.value) : []);
      setFetchInfo(`Based on ${meta.fetched} of ${meta.total} submissions pulled from Ceipal.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter profiles by their submitted-on date. All of a candidate's event rows
  // carry the same SubmittedOn, so filtering events == filtering profiles.
  const dateActive = !!submittedFrom || !!submittedTo;
  const filteredSubs = useMemo(() => {
    if (!subs) return null;
    if (!submittedFrom && !submittedTo) return subs;
    const from = submittedFrom ? DateTime.fromISO(submittedFrom) : null;
    const to = submittedTo ? DateTime.fromISO(submittedTo).endOf("day") : null;
    return subs.filter((s) => {
      const d = s.submittedOn;
      if (!d) return false; // undated profiles can't be placed in a range
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [subs, submittedFrom, submittedTo]);

  const { stats: allStats, statuses } = useMemo(
    () => (filteredSubs ? computeRecruiterStats(filteredSubs, jobs) : { stats: [], statuses: [] }),
    [filteredSubs, jobs]
  );

  // Ranking by index is fixed (independent of sort/filter), so medals are stable.
  const rankByName = useMemo(() => {
    const m = new Map<string, number>();
    allStats.forEach((s, i) => m.set(s.name, i));
    return m;
  }, [allStats]);

  const sorted = useMemo(() => sortStats(allStats, sortKey), [allStats, sortKey]);
  const names = useMemo(() => allStats.map((s) => s.name).sort((a, b) => a.localeCompare(b)), [allStats]);
  const picked = selected ? allStats.find((s) => s.name === selected) ?? null : null;
  const pickedRank = picked ? rankByName.get(picked.name) ?? 0 : 0;

  const totals = useMemo(() => {
    const reqs = new Set<string>();
    let profiles = 0;
    let client = 0;
    for (const s of allStats) {
      profiles += s.profiles;
      client += s.clientCount;
    }
    if (filteredSubs) for (const s of filteredSubs) if (s.jobCode) reqs.add(s.jobCode);
    return { recruiters: allStats.length, requirements: reqs.size, profiles, client };
  }, [filteredSubs, allStats]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Recruiter Performance</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            Pick a recruiter to see the current status of every profile they submitted, or view the
            full leaderboard. Each profile is counted once, by its latest status.
          </p>
        </div>
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? <span className="spinner dark" /> : "⟳"} Refresh
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {fetchInfo && !error && <div className="alert info">{fetchInfo}</div>}

      {loading && !subs ? (
        <div className="center-load" style={{ minHeight: "40vh" }}>
          <div className="spinner dark" />
        </div>
      ) : subs ? (
        <>
          {/* ---- Controls ---- */}
          <div className="card">
            <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ margin: 0, minWidth: 220 }}>
                <label>Recruiter</label>
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">All recruiters ({names.length})</option>
                  {names.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Submitted from</label>
                <input type="date" value={submittedFrom} onChange={(e) => setSubmittedFrom(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Submitted to</label>
                <input type="date" value={submittedTo} onChange={(e) => setSubmittedTo(e.target.value)} />
              </div>
              {dateActive && (
                <button
                  className="btn ghost"
                  style={{ padding: "0.4rem 0.7rem" }}
                  onClick={() => { setSubmittedFrom(""); setSubmittedTo(""); }}
                >
                  Clear dates
                </button>
              )}
              <div className="field" style={{ margin: 0, minWidth: 200 }}>
                <label>Rank by</label>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }} />
              <StageLegend statuses={statuses} />
            </div>
            {dateActive && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                Profiles submitted {submittedFrom || "any time"} → {submittedTo || "today"} · {totals.profiles} profiles
                across {totals.recruiters} recruiters.
              </p>
            )}
          </div>

          {allStats.length === 0 ? (
            <div className="card">
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
                <p>{dateActive ? "No profiles were submitted in the selected date range." : "No recruiter activity found."}</p>
                {dateActive ? (
                  <button className="btn secondary" onClick={() => { setSubmittedFrom(""); setSubmittedTo(""); }}>
                    Clear dates
                  </button>
                ) : (
                  <p style={{ fontSize: "0.9rem" }}>Pull the submissions report with Refresh, or check your Ceipal configuration.</p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="stat-grid">
                  <Stat label="Recruiters" value={totals.recruiters} />
                  <Stat label="Requirements worked" value={totals.requirements} />
                  <Stat label="Profiles submitted" value={totals.profiles} />
                  <Stat
                    label="Client/vendor submissions"
                    value={`${totals.client} (${pct(totals.profiles ? totals.client / totals.profiles : 0)})`}
                  />
                </div>
              </div>

              <div className="card">
                <div className="table-wrap" style={{ maxHeight: "60vh" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>#</th>
                        <th>Recruiter</th>
                        <th style={{ textAlign: "right" }}>Reqs</th>
                        <th style={{ textAlign: "right" }}>Profiles</th>
                        <th style={{ minWidth: 200 }}>Current status of profiles</th>
                        <th style={{ textAlign: "right" }}>Client/Vendor</th>
                        <th style={{ textAlign: "right" }}>Index</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((s) => {
                        const rank = rankByName.get(s.name) ?? 0;
                        return (
                          <tr key={s.name} style={{ cursor: "pointer" }} onClick={() => setSelected(s.name)}>
                            <td style={{ fontWeight: 600 }}>{rank < 3 ? medal[rank] : rank + 1}</td>
                            <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{s.name}</td>
                            <td style={{ textAlign: "right" }}>{s.requirements}</td>
                            <td style={{ textAlign: "right" }}>{s.profiles}</td>
                            <td><StageBar counts={s.counts} statuses={statuses} /></td>
                            <td style={{ textAlign: "right" }}>
                              {s.clientCount}
                              <span className="muted" style={{ fontSize: "0.78rem" }}> · {pct(s.clientRate)}</span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <span className={`pill ${indexPill(s.index)}`}>{s.index}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <IndexExplainer />
              </div>
            </>
          )}

          <Modal
            open={!!picked}
            onClose={() => setSelected("")}
            wide
            title={picked ? `${pickedRank < 3 ? medal[pickedRank] + " " : ""}${picked.name}` : ""}
            footer={<button className="btn ghost" onClick={() => setSelected("")}>Close</button>}
          >
            {picked && <RecruiterModal stat={picked} statuses={statuses} />}
          </Modal>
        </>
      ) : (
        <div className="card">
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
            <p>No recruiter activity found.</p>
            <p style={{ fontSize: "0.9rem" }}>Pull the submissions report with Refresh, or check your Ceipal configuration.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RecruiterModal({ stat, statuses }: { stat: RecruiterStat; statuses: StatusMeta[] }) {
  const present = statuses.filter((st) => (stat.counts[st.label] ?? 0) > 0);
  const pieData = present.map((st) => ({ label: st.label, value: stat.counts[st.label], color: st.color }));
  const colorByStatus = new Map(statuses.map((s) => [s.label, s.color]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const jobs = stat.jobGroups;
  const submittedReqs = jobs.length - stat.noSubCount;

  const toggle = (key: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <span className={`pill ${indexPill(stat.index)}`}>Performance index {stat.index}</span>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {stat.profiles} profiles · {stat.requirements} requirements
        </span>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1rem" }}>
        <Stat label="Profiles submitted" value={stat.profiles} />
        <Stat label="Assigned requirements" value={stat.assignedCount} />
        <Stat label="Requirements worked" value={stat.requirements} />
        <Stat label="Client/vendor submissions" value={`${stat.clientCount} of ${stat.clientTarget} target`} />
        <Stat label="Reached interview+" value={pct(stat.progressRate)} />
      </div>

      {/* Status distribution: pie + share table */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <PieChart title="Profiles by current status" data={pieData} showLegend={false} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Current status</th>
                <th style={{ textAlign: "right" }}>Profiles</th>
                <th style={{ textAlign: "right" }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {present.map((st) => (
                <tr key={st.key}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                      <span style={{ width: 11, height: 11, background: st.color, borderRadius: 2, display: "inline-block" }} />
                      {st.label}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{stat.counts[st.label]}</td>
                  <td style={{ textAlign: "right" }} className="muted">{pct(stat.counts[st.label] / (stat.profiles || 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <IndexExplainer stat={stat} />

      {/* Submissions grouped by requirement — click a job to see its candidates */}
      <h3 style={{ margin: "1.5rem 0 0.5rem" }}>
        Submissions ({stat.profiles}) across {submittedReqs} requirement{submittedReqs === 1 ? "" : "s"}
        {stat.noSubCount > 0 ? ` · ${stat.noSubCount} assigned with no submissions` : ""}
      </h3>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.83rem" }}>Click a requirement to see its candidates.</p>
      <div className="table-wrap" style={{ maxHeight: "48vh" }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Req ID</th>
              <th>Requirement</th>
              <th>Client</th>
              <th>Job posted on</th>
              <th>First submission</th>
              <th>Time to 1st submission</th>
              <th style={{ textAlign: "right" }}>Submissions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, idx) => {
              const key = j.jobCode || j.jobTitle || String(idx);
              const open = expanded.has(key) && !j.assignedOnly;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => !j.assignedOnly && toggle(key)}
                    style={{ cursor: j.assignedOnly ? "default" : "pointer", background: j.assignedOnly ? "#fff8f0" : undefined }}
                  >
                    <td style={{ color: "var(--muted)" }}>{j.assignedOnly ? "" : open ? "▾" : "▸"}</td>
                    <td>{j.jobCode || "—"}</td>
                    <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{j.jobTitle || "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>{j.client || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDt(j.jobCreatedOn)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{j.assignedOnly ? "—" : fmtDt(j.firstSubmission)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{j.assignedOnly ? "—" : j.timeToFirst || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {j.assignedOnly ? <span className="pill amber">No submissions</span> : j.submissions.length}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td></td>
                      <td colSpan={7} style={{ background: "#f8fafc", padding: "0.5rem 0.75rem" }}>
                        <table className="data" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Consultant</th>
                              <th>Current status</th>
                              <th>Submitted on</th>
                            </tr>
                          </thead>
                          <tbody>
                            {j.submissions.map((r, i) => (
                              <tr key={i}>
                                <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{r.consultant || "—"}</td>
                                <td style={{ whiteSpace: "normal" }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: colorByStatus.get(r.status) ?? "#adb5bd", display: "inline-block" }} />
                                    {r.status}
                                  </span>
                                </td>
                                <td style={{ whiteSpace: "nowrap" }}>{fmtDt(r.submittedOn)}</td>
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
