import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchCeipalReport, reportMeta } from "../lib/ceipal";
import { parseSubmissionsFromApi, parseJobsFromApi } from "../lib/report/parseSource";
import { SubmissionEvent, JobRecord } from "../lib/report/types";
import { friendlyError } from "../lib/errors";
import {
  computeRecruiterStats,
  filterByActivity,
  sortStats,
  screeningOf,
  submissionsByJob,
  RecruiterStat,
  StatusMeta,
  SortKey,
  STAGE_POINTS,
  PIPELINE_STAGES,
  REQUIREMENT_TARGET_POINTS,
  MAX_WITHOUT_OFFER,
  TARGET_PER_ASSIGNED,
  PipelineStage,
} from "../lib/recruiterStats";
import { getRecruiterActivity, RecruiterActivity, ActivityCounts, activityNameKey } from "../lib/recruiterActivity";
import { extensionFor } from "../lib/extensions";
import { GUIDE, Lang } from "../lib/indexGuide";
import { useLang } from "../context/LangContext";
import StageBar, { StageLegend } from "../components/StageBar";
import PieChart from "../components/PieChart";
import Modal from "../components/Modal";
import Pagination, { usePagination } from "../components/Pagination";
import ActiveJobsCard from "../components/ActiveJobsCard";
import { listTeamTimesheets, listMyTimesheets, listLeaveRequests, listMyLeaves, TimesheetEntry, LeaveRequest } from "../lib/timesheets";
import {
  buildEffortIndex,
  effortFor,
  hoursOnJob,
  effortWithoutOutput,
  subsPerHour,
  nameKey,
  daysBetween,
  missingDays,
  EffortIndex,
  PersonEffort,
} from "../lib/timesheetStats";
import IndexGuide from "../components/IndexGuide";
import { useAuth } from "../context/AuthContext";

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

// The index components as leaderboard columns, best outcome first. Short headers
// because they sit next to nine other columns; the full localised name, the tier
// ceiling and the plain-English rule ride along in the cell's title. Keys match
// RecruiterStat.indexParts and GUIDE[lang].metrics, in the same order.
type IndexColKey = PipelineStage | "requirementTarget";
const INDEX_COLS: { key: IndexColKey; short: string }[] = [
  { key: "offerAccepted", short: "Offer" },
  { key: "clientSelected", short: "Client sel." },
  { key: "clientInterview", short: "Client int." },
  { key: "clientSubmitted", short: "To client" },
  { key: "vendorSubmitted", short: "To vendor" },
  { key: "requirementTarget", short: "Coverage" },
];

const MAX_OF: Record<IndexColKey, number> = {
  ...(Object.fromEntries(PIPELINE_STAGES.map((k) => [k, STAGE_POINTS[k].cap])) as Record<PipelineStage, number>),
  requirementTarget: REQUIREMENT_TARGET_POINTS,
};

/** Points earned on one tier, how many candidates produced them, and the ceiling. */
const partPoints = (s: RecruiterStat, key: IndexColKey) => {
  const points = s.indexParts[key];
  const max = MAX_OF[key];
  const count = key === "requirementTarget" ? null : s.stageCounts[key];
  return { points, max, count, achieved: max > 0 ? points / max : 0 };
};

// Same thresholds as the Index pill, applied to how much of the metric's own
// ceiling was reached — so a weak area reads red even when its weight is small.
const partColor = (achieved: number) =>
  achieved >= 0.6 ? "#1e7e34" : achieved >= 0.35 ? "#a9700a" : "var(--danger)";

const targetBasis = (s: RecruiterStat) =>
  s.targetBasis === "assigned"
    ? `${s.targetBaseCount} assigned requirement${s.targetBaseCount === 1 ? "" : "s"}`
    : `${s.targetBaseCount} requirement${s.targetBaseCount === 1 ? "" : "s"} worked in this period`;

// Hover text for the Index pill — the same tiers IndexGuide shows in the detail
// modal, in pipeline order (best outcome first) so what the recruiter actually
// landed reads before what they merely sent out.
const indexBreakdown = (s: RecruiterStat, lang: Lang) => {
  const t = GUIDE[lang];
  const rows = t.metrics.map((m) => {
    const max = MAX_OF[m.key] ?? 0;
    const points = Math.round(s.indexParts[m.key] * 10) / 10;
    const count = m.key === "requirementTarget" ? null : s.stageCounts[m.key];
    return { name: m.name, max, points, count };
  });
  return [
    `Performance Index: ${s.index}/100`,
    ...rows.map((r) => `${r.name}: ${r.count != null ? `${r.count} → ` : ""}${r.points}/${r.max} pts`),
    "Click the row for the full breakdown and how to improve it.",
  ].join("\n");
};

export default function RecruiterPerformance() {
  const [subs, setSubs] = useState<SubmissionEvent[] | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(""); // "" = all recruiters
  const [sortKey, setSortKey] = useState<SortKey>("index");
  // The five index components as columns. On by default — the point is that
  // everyone can see which part of the work is carrying the score and which
  // part is dragging it — but the table is wide, so it can be folded away.
  const [showParts, setShowParts] = useState(true);
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
  const { lang } = useLang();
  const { user, profile } = useAuth();
  // Everyone's timesheets, or just your own — decided below by role, and
  // enforced server-side by firestore.rules either way (an employee's query
  // is uid-scoped, so their browser never receives anyone else's entries).
  const canSeeTeamHours = profile?.role === "admin" || profile?.role === "manager";
  const myNameKey = nameKey(profile?.displayName || profile?.email || user?.displayName || user?.email || "");
  // Weekly activity (job-board / pipeline / mail-merge counts) — loaded on demand,
  // held in memory for the session and reused across recruiters (nothing stored).
  const [activity, setActivity] = useState<{ from: string; to: string; data: RecruiterActivity } | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityAttempt, setActivityAttempt] = useState<{ from: string; to: string } | null>(null);

  const loadActivity = async () => {
    const range = { from: submittedFrom, to: submittedTo };
    setActivityAttempt(range);
    setActivityLoading(true);
    setActivityError(null);
    try {
      const data = await getRecruiterActivity(range.from, range.to);
      setActivity({ ...range, data });
    } catch (e) {
      setActivityError(friendlyError(e));
    } finally {
      setActivityLoading(false);
    }
  };

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    setFetchInfo(null);
    try {
      // Submissions are required; job postings (for "Assigned To") are best-effort.
      const [subRes, jobRes] = await Promise.allSettled([
        fetchCeipalReport("submissions", { refresh }),
        fetchCeipalReport("job_duration", { refresh }),
      ]);
      if (subRes.status === "rejected") throw subRes.reason;
      const subJson = subRes.value;
      const meta = reportMeta(subJson);
      setSubs(parseSubmissionsFromApi(subJson));
      setJobs(jobRes.status === "fulfilled" ? parseJobsFromApi(jobRes.value) : []);
      setFetchInfo(
        `${meta.fetched} submissions` +
          (meta.cachedAt ? ` · data as of ${new Date(meta.cachedAt).toLocaleString()} (cached)` : " · freshly pulled from Ceipal")
      );
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
  // Attribute each event to when the status actually changed, not when the
  // profile was uploaded — see filterByActivity in lib/recruiterStats.
  const filteredSubs = useMemo(() => {
    if (!subs) return null;
    return filterByActivity(
      subs,
      submittedFrom ? DateTime.fromISO(submittedFrom) : null,
      submittedTo ? DateTime.fromISO(submittedTo).endOf("day") : null
    );
  }, [subs, submittedFrom, submittedTo]);

  // Logged hours for the same window. Admins/managers get everyone's; an
  // employee gets only their own (listMyTimesheets is uid-scoped, matching
  // the firestore.rules condition exactly) — so their row on the leaderboard
  // fills in normally while every other recruiter's Hours cell stays blank,
  // same as it always has.
  const effortQ = useQuery({
    queryKey: ["recruiterPerfTimesheets", submittedFrom, submittedTo, canSeeTeamHours, user?.uid],
    queryFn: async (): Promise<TimesheetEntry[]> => {
      if (canSeeTeamHours) return (await listTeamTimesheets(submittedFrom, submittedTo)).entries;
      if (!user) return [];
      return listMyTimesheets(user.uid, submittedFrom, submittedTo);
    },
    enabled: !!user,
    retry: false,
  });
  const timesheetEntries = useMemo(() => effortQ.data ?? [], [effortQ.data]);
  const effort: EffortIndex = useMemo(() => buildEffortIndex(timesheetEntries), [timesheetEntries]);

  // Approved leave, scoped the same way — needed so a day off doesn't count
  // as a missed timesheet in the "Missing days" section below.
  const leavesQ = useQuery({
    queryKey: ["recruiterPerfLeaves", canSeeTeamHours, profile?.role, user?.uid],
    queryFn: async (): Promise<LeaveRequest[]> => {
      if (canSeeTeamHours && profile) return listLeaveRequests(profile.role);
      if (!user) return [];
      return listMyLeaves(user.uid);
    },
    enabled: !!user,
    retry: false,
  });
  const leaves = useMemo(() => leavesQ.data ?? [], [leavesQ.data]);
  const today = DateTime.local().toFormat("yyyy-MM-dd");

  const { stats: allStats, statuses } = useMemo(
    () =>
      filteredSubs
        ? computeRecruiterStats(filteredSubs, jobs, { periodScoped: dateActive })
        : { stats: [], statuses: [] },
    [filteredSubs, jobs, dateActive]
  );

  // Ranking by index is fixed (independent of sort/filter), so medals are stable.
  const rankByName = useMemo(() => {
    const m = new Map<string, number>();
    allStats.forEach((s, i) => m.set(s.name, i));
    return m;
  }, [allStats]);

  const sorted = useMemo(() => sortStats(allStats, sortKey), [allStats, sortKey]);
  const board = usePagination(sorted, 25, "recruiterPerformance");
  // Submissions grouped by job — reused by the Active Jobs card (no extra fetch).
  const subsByJob = useMemo(() => (subs ? submissionsByJob(subs) : new Map()), [subs]);
  const names = useMemo(() => allStats.map((s) => s.name).sort((a, b) => a.localeCompare(b)), [allStats]);
  const picked = selected ? allStats.find((s) => s.name === selected) ?? null : null;
  const pickedRank = picked ? rankByName.get(picked.name) ?? 0 : 0;
  // Activity is valid only if it was loaded for the current date range.
  const activityMatches = !!activity && activity.from === submittedFrom && activity.to === submittedTo;
  const activityData = activityMatches ? activity!.data : null;

  // Auto-fetch activity when a recruiter modal is open — once per date range
  // (tracked by activityAttempt so an error doesn't loop).
  useEffect(() => {
    if (!picked || activityLoading) return;
    if (activityMatches) return;
    if (activityAttempt && activityAttempt.from === submittedFrom && activityAttempt.to === submittedTo) return;
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, submittedFrom, submittedTo, activityMatches, activityLoading]);

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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn secondary" onClick={() => load(false)} disabled={loading}>
            {loading ? <span className="spinner dark" /> : "⟳"} Refresh
          </button>
          <button className="btn ghost" onClick={() => load(true)} disabled={loading} title="Pull the latest data directly from Ceipal (slower)">
            ↻ From Ceipal
          </button>
        </div>
      </div>

      <ActiveJobsCard subsByJob={subsByJob} />

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
                <label>Activity from</label>
                <input type="date" value={submittedFrom} onChange={(e) => setSubmittedFrom(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Activity to</label>
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
              <label
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontWeight: 600, margin: 0, whiteSpace: "nowrap" }}
                title="Show what each recruiter scored on the five parts of the Performance Index"
              >
                <input
                  type="checkbox"
                  checked={showParts}
                  onChange={(e) => setShowParts(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Index breakdown
              </label>
              <div style={{ flex: 1 }} />
              <StageLegend statuses={statuses} />
            </div>
            {dateActive && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                Activity between {submittedFrom || "any time"} → {submittedTo || "today"} · {totals.profiles} profiles
                across {totals.recruiters} recruiters. A profile counts in the period its <strong>status
                changed</strong>, not when it was uploaded — so a candidate uploaded 31 Jul and submitted to
                the client on 4 Aug counts as August work.
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
                        <th style={{ textAlign: "right" }} title="Hours logged on timesheets in this range">Hours</th>
                        <th style={{ textAlign: "right" }} title="Client/vendor submissions per hour logged">Per hour</th>
                        {showParts &&
                          INDEX_COLS.map((c, i) => {
                            const m = GUIDE[lang].metrics[i];
                            return (
                              <th
                                key={c.key}
                                style={{ textAlign: "right", whiteSpace: "nowrap" }}
                                title={`${m.name} — up to ${MAX_OF[c.key]} of the 100 index points.\n\n${m.plain}`}
                              >
                                {c.short}
                                <span className="muted" style={{ fontWeight: 400 }}> /{MAX_OF[c.key]}</span>
                              </th>
                            );
                          })}
                        <th style={{ textAlign: "right" }}>Index</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.pageItems.map((s) => {
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
                            {(() => {
                              const e = effortFor(effort, s.name);
                              const h = e?.totalHours ?? 0;
                              const per = subsPerHour(s.clientCount, h);
                              return (
                                <>
                                  <td style={{ textAlign: "right" }} className={h ? "" : "muted"}>
                                    {h ? `${h}h` : "—"}
                                  </td>
                                  <td style={{ textAlign: "right" }} className="muted">
                                    {per != null ? per.toFixed(2) : "—"}
                                  </td>
                                </>
                              );
                            })()}
                            {showParts &&
                              INDEX_COLS.map((c, i) => {
                                const { achieved, max, points, count } = partPoints(s, c.key);
                                const m = GUIDE[lang].metrics[i];
                                return (
                                  <td
                                    key={c.key}
                                    style={{ textAlign: "right", whiteSpace: "nowrap", cursor: "help" }}
                                    title={`${m.name}\n${count != null ? `${count} candidate${count === 1 ? "" : "s"} — ` : ""}${Math.round(points * 10) / 10} of ${max} points.\n\n${m.example}`}
                                  >
                                    <span style={{ fontWeight: 600, color: partColor(achieved) }}>
                                      {Math.round(points * 10) / 10}
                                    </span>
                                    <span className="muted" style={{ fontSize: "0.75rem" }}> /{max}</span>
                                  </td>
                                );
                              })}
                            <td style={{ textAlign: "right" }}>
                              <span
                                className={`pill ${indexPill(s.index)}`}
                                style={{ cursor: "help" }}
                                title={indexBreakdown(s, lang)}
                              >
                                {s.index}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={board.page} pageCount={board.pageCount} total={board.total} pageSize={board.pageSize} onPage={board.setPage} onPageSize={board.setPageSize} />
                {showParts && (
                  <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", lineHeight: 1.6 }}>
                    <strong>Target /55</strong> client/vendor submissions against {TARGET_PER_ASSIGNED} per requirement ·{" "}
                    <strong>Client rate /25</strong> share of profiles that reached the client ·{" "}
                    <strong>Interview+ /20</strong> share that reached an interview or beyond. Each cell is the points
                    earned out of that metric&#39;s maximum, and the three add up to the Index. Green ≥ 60% of what the metric can give, red under 35%. Hover any cell for the rule
                    behind it, or click a row for the full guide.
                  </p>
                )}

                <IndexGuide />
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
            {picked && (
              <RecruiterModal
                stat={picked}
                statuses={statuses}
                from={submittedFrom}
                to={submittedTo}
                activity={activityData ? activityData.byRecruiter[activityNameKey(picked.name)] ?? null : null}
                activityFetchedAt={activityData?.fetchedAt ?? null}
                activityLoaded={!!activityData}
                activityLoading={activityLoading}
                activityError={activityError}
                onLoadActivity={loadActivity}
                effort={effort}
                timesheetEntries={timesheetEntries}
                leaves={leaves}
                today={today}
                canSeeTimesheetDetail={canSeeTeamHours || nameKey(picked.name) === myNameKey}
              />
            )}
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

function RecruiterModal({
  stat,
  statuses,
  from,
  to,
  activity,
  activityFetchedAt,
  activityLoaded,
  activityLoading,
  activityError,
  onLoadActivity,
  effort,
  timesheetEntries,
  leaves,
  today,
  canSeeTimesheetDetail,
}: {
  stat: RecruiterStat;
  statuses: StatusMeta[];
  from: string;
  to: string;
  activity: ActivityCounts | null;
  activityFetchedAt: number | null;
  activityLoaded: boolean;
  activityLoading: boolean;
  activityError: string | null;
  onLoadActivity: () => void;
  effort: EffortIndex;
  /** Whatever timesheet entries the page fetched — everyone's for an admin/manager, only the viewer's own otherwise. */
  timesheetEntries: TimesheetEntry[];
  /** Same scoping as timesheetEntries — needed so an approved day off doesn't count as a missed timesheet. */
  leaves: LeaveRequest[];
  today: string;
  /** True for admin/manager (any recruiter), or an employee looking at their own card. */
  canSeeTimesheetDetail: boolean;
}) {
  const present = statuses.filter((st) => (stat.counts[st.label] ?? 0) > 0);
  const pieData = present.map((st) => ({ label: st.label, value: stat.counts[st.label], color: st.color }));
  const colorByStatus = new Map(statuses.map((s) => [s.label, s.color]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const jobs = stat.jobGroups;
  const myEffort: PersonEffort | null = effortFor(effort, stat.name);
  const myEntries = useMemo(
    () =>
      timesheetEntries
        .filter((e) => nameKey(e.displayName || e.email) === nameKey(stat.name))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [timesheetEntries, stat.name]
  );
  const myMissingDays = useMemo(() => {
    if (!from || !to) return []; // "missing" is undefined over an unbounded range
    const filledDates = new Set(myEntries.map((e) => e.date));
    const leaveDates = new Set<string>();
    leaves
      .filter((l) => l.status === "approved" && nameKey(l.displayName || l.email) === nameKey(stat.name))
      .forEach((l) => daysBetween(l.startDate, l.endDate).forEach((d) => leaveDates.add(d)));
    return missingDays(from, to, today, filledDates, leaveDates);
  }, [myEntries, leaves, stat.name, from, to, today]);
  // Requirements with hours logged but nothing sent to a client in this period.
  const noOutput = useMemo(() => {
    const subsByCode = new Map<string, number>();
    for (const g of jobs) {
      if (!g.jobCode) continue;
      const clientSubs = g.submissions.filter((r) => /client|vendor|offer|placed|placement/i.test(r.status)).length;
      subsByCode.set(g.jobCode, clientSubs);
    }
    return effortWithoutOutput(myEffort, subsByCode);
  }, [myEffort, jobs]);
  const submittedReqs = jobs.length - stat.noSubCount;

  // Screening pass/fail over this recruiter's profiles in the selected range.
  let passed = 0;
  let failed = 0;
  for (const r of stat.rows) {
    const s = screeningOf(r.status);
    if (s === "passed") passed++;
    else if (s === "failed") failed++;
  }
  const rangeLabel = from || to ? `${from || "start"} → ${to || "today"}` : "all time";
  const ext = extensionFor(stat.name);
  const extLabel = ext ? `Ext ${ext.ext}` : "Ext n/a";
  // Server-metric cell: the number once loaded, a small spinner in its place while
  // loading (or before the auto-fetch kicks in), or a dash if the fetch failed.
  const srv = (v: number | undefined): ReactNode =>
    activity ? (
      v ?? 0
    ) : activityError ? (
      "—"
    ) : (
      <span
        className="spinner dark"
        style={{ width: 13, height: 13, borderWidth: "2px", display: "inline-block", verticalAlign: "middle" }}
      />
    );

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
        {myEffort && <Stat label="Hours logged" value={`${myEffort.totalHours}h over ${myEffort.days}d`} />}
        {myEffort && subsPerHour(stat.clientCount, myEffort.totalHours) != null && (
          <Stat
            label="Client/vendor per hour"
            value={String(subsPerHour(stat.clientCount, myEffort.totalHours)!.toFixed(2))}
          />
        )}
      </div>

      {myEffort && noOutput.length > 0 && (
        <div className="alert warn" style={{ marginBottom: "1rem" }}>
          <strong>Hours with no client submission.</strong>{" "}
          {noOutput.length} requirement{noOutput.length === 1 ? "" : "s"} had time logged but nothing sent to a
          client or vendor in this period:{" "}
          {noOutput.slice(0, 6).map((j) => (
            <span className="pill amber" key={j.jobCode} style={{ marginRight: "0.3rem" }}>
              {j.jobCode} · {j.hours}h
            </span>
          ))}
          {noOutput.length > 6 && <span className="muted">+{noOutput.length - 6} more</span>}
        </div>
      )}
      {myEffort && myEffort.attributedHours < myEffort.totalHours && (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: "-0.5rem" }}>
          {Math.round((myEffort.totalHours - myEffort.attributedHours) * 100) / 100}h of the{" "}
          {myEffort.totalHours}h logged wasn&#39;t booked to a requirement.
        </p>
      )}

      {/* Itemized timesheet entries — an employee only ever gets their own card
          here (see canSeeTimesheetDetail); an admin/manager sees any recruiter's. */}
      {canSeeTimesheetDetail && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.4rem" }}>
            Timesheet entries{myEntries.length > 0 ? ` (${myEntries.length})` : ""}
          </h3>
          {!from || !to ? (
            <p className="muted" style={{ fontSize: "0.82rem", marginTop: "-0.2rem" }}>
              Set a date range above to see missing days.
            </p>
          ) : myMissingDays.length > 0 ? (
            <div style={{ marginBottom: "0.6rem" }}>
              <strong style={{ fontSize: "0.82rem" }}>Missing:</strong>{" "}
              {myMissingDays.map((d) => (
                <span className="pill red" key={d} style={{ marginRight: "0.3rem" }}>{d}</span>
              ))}
            </div>
          ) : (
            <span className="pill green" style={{ marginBottom: "0.6rem", display: "inline-block" }}>All caught up</span>
          )}
          {myEntries.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>No timesheet entries in this range.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: "30vh" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Hours</th>
                    <th>Requirement(s)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {myEntries.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{e.date}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{e.hours}h</td>
                      <td style={{ whiteSpace: "normal" }}>
                        {e.jobs.length
                          ? e.jobs.map((j) => `${j.jobCode}${j.jobTitle ? ` · ${j.jobTitle}` : ""} (${j.hours}h)`).join(", ")
                          : "—"}
                      </td>
                      <td style={{ whiteSpace: "normal" }} className="muted">{e.workedOn || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Weekly activity — the numbers tracked from Ceipal (+ coming-soon sources) */}
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            Activity · {rangeLabel}
            {activityLoading && <span className="spinner dark" style={{ width: 14, height: 14, borderWidth: "2px" }} />}
          </h3>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {from || to ? "based on selected dates" : "all dates — pick a range on the tab"}
          </span>
        </div>
        <div className="activity-grid">
          <ActRow label="Positions worked on" value={stat.requirements} />
          <ActRow label="Submissions" value={stat.profiles} />
          <ActRow label="Passed screening" value={passed} />
          <ActRow label="Failed / rejected screening" value={failed} />
          <ActRow label="Pipeline status updates" value={srv(activity?.pipelineUpdates)} />
          <ActRow label="Bulk emails (mail merge)" value={srv(activity?.bulkEmails)} />
          <ActRow label="Dice credits used" value={srv(activity?.diceCredits)} />
          <ActRow label="Monster credits used" value={srv(activity?.monsterCredits)} />
          <ActRow label="Advanced search (internal DB) *" value={srv(activity?.advSearchInternalDb)} />
          <ActRow label="LinkedIn reach-outs (+ replied)" soon />
          <ActRow label={`Phone calls — outbound (${extLabel})`} soon />
          <ActRow label={`Phone calls — inbound (${extLabel})`} soon />
          <ActRow label="Profiles added to daily excel" soon />
        </div>
        <div style={{ marginTop: "0.6rem" }}>
          <span className="muted" style={{ fontSize: "0.76rem" }}>
            * Advanced search is a running total (Ceipal provides no date breakdown).
            {activityLoaded && activityFetchedAt ? ` Counts as of ${new Date(activityFetchedAt).toLocaleTimeString()}.` : ""}
          </span>
          {activityError && (
            <div className="alert error" style={{ marginTop: "0.5rem" }}>
              {activityError}{" "}
              <button className="btn ghost" style={{ padding: "0.15rem 0.5rem" }} onClick={onLoadActivity}>Retry</button>
            </div>
          )}
        </div>
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

      <IndexGuide stat={stat} />

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
              <th style={{ textAlign: "right" }} title="Hours logged against this requirement">Hours</th>
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
                    {(() => {
                      const h = hoursOnJob(effort, stat.name, j.jobCode);
                      return (
                        <td style={{ textAlign: "right" }} className={h ? "" : "muted"}>
                          {h ? `${h}h` : "—"}
                        </td>
                      );
                    })()}
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
                              <th title="When this status was set — what the date filter uses">Status changed</th>
                              <th title="When the profile was first uploaded">Uploaded</th>
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
                                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{fmtDt(r.lastActivity)}</td>
                                <td style={{ whiteSpace: "nowrap" }} className="muted">{fmtDt(r.submittedOn)}</td>
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

function ActRow({ label, value, soon }: { label: string; value?: ReactNode; soon?: boolean }) {
  return (
    <div className="activity-row">
      <span style={{ fontSize: "0.88rem" }}>{label}</span>
      {soon ? (
        <span className="pill grey" style={{ fontSize: "0.68rem" }}>Coming soon</span>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}
