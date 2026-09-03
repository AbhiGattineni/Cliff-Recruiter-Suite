import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import {
  listMyTimesheets,
  listMyLeaves,
  saveTimesheetEntry,
  TIMESHEET_ZONE_LABEL,
  timesheetToday,
  TimesheetEntry,
  JobHours,
} from "../../lib/timesheets";
import {
  EXPECTED_DAILY_HOURS,
  daysBetween,
  dayBreakdown,
  summariseDays,
  DayStatus,
} from "../../lib/timesheetStats";
import { listOpenJobs } from "../../lib/openJobs";
import JobHoursPicker from "./JobHoursPicker";
import { useAuth } from "../../context/AuthContext";

// The server only accepts today's date, decided in the team's zone and on the
// SERVER's clock. Deriving it from the browser meant a machine with the wrong
// system date offered a day the server refused; this follows the server instead.
const todayIso = () => timesheetToday();
const RANGE_DAYS = 30;

/** The one place a day's status turns into words, so the table reads the same way the totals count. */
function StatusPill({ status, hours }: { status: DayStatus; hours: number }) {
  switch (status) {
    case "filled":
      return <span className="pill green">Full day</span>;
    case "short":
      return (
        <span className="pill amber" title={`${EXPECTED_DAILY_HOURS - hours}h short of a full day`}>
          Short · {hours}h of {EXPECTED_DAILY_HOURS}
        </span>
      );
    case "missing":
      return <span className="pill red">Not filled</span>;
    case "leave":
      return <span className="pill grey">Approved leave</span>;
    default:
      return <span className="muted">—</span>;
  }
}

export default function MyTimesheetTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user!.uid;
  const from = DateTime.local().minus({ days: RANGE_DAYS }).toFormat("yyyy-MM-dd");
  const to = todayIso();

  const entriesQ = useQuery({
    queryKey: ["myTimesheets", uid, from, to],
    queryFn: () => listMyTimesheets(uid, from, to),
  });

  const byDate = useMemo(() => {
    const m = new Map<string, TimesheetEntry>();
    (entriesQ.data ?? []).forEach((e) => m.set(e.date, e));
    return m;
  }, [entriesQ.data]);

  // Open requirements for the picker — cached, so switching dates doesn't refetch.
  const openJobsQ = useQuery({ queryKey: ["openJobs"], queryFn: listOpenJobs, staleTime: 10 * 60_000 });

  // "Today" has to stay live. This was computed once when the tab mounted, so a
  // page left open across the rollover kept offering yesterday's date — which
  // the server then refused with "you can only fill today's timesheet", and the
  // date field is no longer editable, so the person was stuck until they
  // reloaded. Re-checked on a timer and whenever the tab regains focus.
  const [date, setDate] = useState(todayIso());
  useEffect(() => {
    const sync = () => setDate((cur) => (todayIso() === cur ? cur : todayIso()));
    const id = window.setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  const [workedOn, setWorkedOn] = useState("");
  const [jobs, setJobs] = useState<JobHours[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rolled, setRolledOver] = useState(false);

  // Today's entry, loaded into the form so a same-day correction starts from
  // what is already saved rather than from an empty form.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === date || !entriesQ.data) return;
    const rolledOver = loadedFor.current !== null;
    loadedFor.current = date;
    const existing = byDate.get(date);
    setWorkedOn(existing?.workedOn ?? "");
    setJobs(existing?.jobs ?? []);
    // A rollover under an open tab means anything typed was for yesterday, and
    // yesterday is now closed — say so rather than silently moving the date.
    if (rolledOver) {
      setSaved(false);
      setError(null);
      setRolledOver(true);
    }
  }, [date, entriesQ.data, byDate]);

  const selected = byDate.get(date);
  const jobTotal = Math.round(jobs.reduce((s, j) => s + (Number(j.hours) || 0), 0) * 100) / 100;
  // Block saving a requirement row left at zero — it reads as "worked on, no time".
  const jobsIncomplete = jobs.length > 0 && jobs.some((j) => !(Number(j.hours) > 0));
  // Date, hours and at least one requirement are all mandatory — hours is
  // derived from the requirement split, so requiring a job also requires hours.
  const canSave = !!date && jobs.length > 0 && jobTotal > 0 && !jobsIncomplete;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveTimesheetEntry(date, jobTotal, workedOn, jobs);
      await qc.invalidateQueries({ queryKey: ["myTimesheets"] });
      await qc.invalidateQueries({ queryKey: ["teamTimesheets"] });
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  // Approved leave, so a booked day off isn't chased as an unfilled one.
  const leavesQ = useQuery({ queryKey: ["myLeaves", uid], queryFn: () => listMyLeaves(uid) });
  const leaveDates = useMemo(() => {
    const set = new Set<string>();
    (leavesQ.data ?? [])
      .filter((l) => l.status === "approved")
      .forEach((l) => daysBetween(l.startDate, l.endDate).forEach((d) => set.add(d)));
    return set;
  }, [leavesQ.data]);

  // One pass over the whole range, from the shared definitions in
  // timesheetStats — so this tab, the Team Dashboard and Recruiter Performance
  // agree on what "unfilled" and "short" mean, and the counts below can't drift
  // from the rows they summarise.
  const days = useMemo(() => {
    const hoursByDate = new Map<string, number>();
    for (const [d, e] of byDate) hoursByDate.set(d, Number(e.hours) || 0);
    return dayBreakdown(from, to, todayIso(), hoursByDate, leaveDates);
  }, [byDate, leaveDates, from, to]);
  const totals = useMemo(() => summariseDays(days), [days]);
  // Newest first, and weekends dropped — nothing is owed on them, so listing
  // them would pad the table with rows nobody has to act on.
  const rows = useMemo(
    () => days.filter((d) => d.status !== "weekend" && d.status !== "future").reverse(),
    [days]
  );

  return (
    <div>
      <div className="card">
        <h2>Fill your timesheet</h2>
        {error && <div className="alert error">{error}</div>}
        {rolled && !error && (
          <div className="alert warn">
            The day rolled over to <strong>{date}</strong> while this page was open. Anything you had
            typed was for the previous day, which is now closed — a manager or admin can still fill it
            for you.
          </div>
        )}
        {saved && !error && <div className="alert success">Saved {date}.</div>}
        <div className="row">
          <div className="field">
            <label>Date</label>
            <input type="text" value={date} disabled readOnly />
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Today only. The day closes at midnight {TIMESHEET_ZONE_LABEL} and can&#39;t be filled or
              changed afterwards.
            </span>
          </div>
          <div className="field">
            <label>
              Hours worked <span style={{ color: "var(--danger)" }}>*</span>
              <span className="muted" style={{ fontWeight: 400 }}> — {EXPECTED_DAILY_HOURS}h expected</span>
            </label>
            <input type="number" value={jobTotal || ""} placeholder="0" disabled readOnly />
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Total from the requirements below — add one to set hours.
            </span>
          </div>
        </div>

        <JobHoursPicker
          jobs={jobs}
          options={openJobsQ.data ?? []}
          loading={openJobsQ.isLoading}
          error={openJobsQ.error ? friendlyError(openJobsQ.error) : null}
          onChange={setJobs}
          required
        />
        <div className="field">
          <label>Notes (optional)</label>
          <textarea
            rows={3}
            style={{ minHeight: 70 }}
            placeholder="Anything worth noting — calls, screening, admin, or work not tied to a requirement."
            value={workedOn}
            onChange={(e) => setWorkedOn(e.target.value)}
          />
        </div>
        {selected && (
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            You already logged {selected.hours}h today — saving replaces it. After midnight this day
            locks, and only a manager can fill it.
          </p>
        )}
        {jobsIncomplete && (
          <p style={{ fontSize: "0.82rem", color: "var(--danger)" }}>
            Enter hours for every requirement you added, or remove the ones you haven&#39;t.
          </p>
        )}
        {/* A full day is 9h. Said plainly and left as a warning rather than a
            block — someone on a half day shouldn't have to invent hours to
            save, and a forced 9 would make the whole number worthless. */}
        {jobTotal > 0 && jobTotal < EXPECTED_DAILY_HOURS && (
          <p className="alert warn" style={{ fontSize: "0.82rem", padding: "0.5rem 0.7rem" }}>
            That&#39;s {Math.round((EXPECTED_DAILY_HOURS - jobTotal) * 100) / 100}h short of a full{" "}
            {EXPECTED_DAILY_HOURS}h day. Add the missing time against a requirement if you worked it — you can
            still save a shorter day for a half day or leave.
          </p>
        )}
        {jobTotal > EXPECTED_DAILY_HOURS && (
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            {Math.round((jobTotal - EXPECTED_DAILY_HOURS) * 100) / 100}h over the expected {EXPECTED_DAILY_HOURS}h.
          </p>
        )}
        <button className="btn" onClick={submit} disabled={saving || !canSave}>
          {saving ? <span className="spinner" /> : "Save"}
        </button>
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem", marginBottom: 0 }}>
          Date, hours and at least one requirement worked on are all required. A full working day is{" "}
          {EXPECTED_DAILY_HOURS} hours.
        </p>
      </div>

      <div className="card">
        <h2>Your last {RANGE_DAYS} days</h2>
        <p className="sub">
          Counted over working days only — weekends and approved leave are never owed.
        </p>
        {entriesQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "20vh" }}>
            <div className="spinner dark" />
          </div>
        ) : entriesQ.error ? (
          <div className="alert error">{friendlyError(entriesQ.error)}</div>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <div className="num">
                  {totals.completion}
                  <span style={{ fontSize: "1rem" }}>%</span>
                </div>
                <div className="lbl">
                  Days accounted for ({totals.filled + totals.short} of {totals.expectedDays})
                </div>
              </div>
              <div className="stat">
                <div className="num">{totals.filled}</div>
                <div className="lbl">Full days ({EXPECTED_DAILY_HOURS}h or more)</div>
              </div>
              <div className="stat">
                <div className="num" style={totals.short ? { color: "#a9700a" } : undefined}>
                  {totals.short}
                </div>
                <div className="lbl">Short days</div>
              </div>
              <div className="stat">
                <div className="num" style={totals.missing ? { color: "var(--danger)" } : undefined}>
                  {totals.missing}
                </div>
                <div className="lbl">Not filled</div>
              </div>
              <div className="stat">
                <div className="num">{totals.leave}</div>
                <div className="lbl">Approved leave</div>
              </div>
              <div className="stat">
                <div className="num">{totals.hours}</div>
                <div className="lbl">Hours logged</div>
              </div>
            </div>

            {totals.shortfallHours > 0 ? (
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.9rem", marginBottom: 0 }}>
                <strong>{totals.shortfallHours}h</strong> behind the{" "}
                {totals.expectedDays * EXPECTED_DAILY_HOURS}h expected across {totals.expectedDays} working
                day{totals.expectedDays === 1 ? "" : "s"}
                {totals.missing > 0 && (
                  <> — a closed day can only be filled by a manager or admin, so ask them for those</>
                )}
                .
              </p>
            ) : (
              totals.expectedDays > 0 && (
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.9rem", marginBottom: 0 }}>
                  Every working day in the last {RANGE_DAYS} days is filled in full. Nothing outstanding.
                </p>
              )
            )}
          </>
        )}
      </div>

      {!entriesQ.isLoading && !entriesQ.error && (
        <div className="card">
          <h2>Day by day</h2>
          <p className="sub">
            Every working day in the range, filled or not — a gap shows up as a row rather than simply
            being absent.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th>Requirements</th>
                  <th>Notes</th>
                  <th>Filled by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const e = byDate.get(d.date);
                  return (
                    <tr key={d.date} className={d.status === "missing" ? "day-missing" : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {d.date}{" "}
                        <span className="muted">{DateTime.fromISO(d.date).toFormat("ccc")}</span>
                      </td>
                      <td>
                        <StatusPill status={d.status} hours={d.hours} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {e ? d.hours : <span className="muted">—</span>}
                      </td>
                      <td style={{ whiteSpace: "normal" }}>
                        {e?.jobs?.length ? (
                          e.jobs.map((j) => (
                            <span className="pill grey" key={j.jobCode} style={{ marginRight: "0.3rem" }}>
                              {j.jobCode} · {j.hours}h
                            </span>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "normal" }}>
                        {e?.workedOn || <span className="muted">—</span>}
                      </td>
                      <td style={{ whiteSpace: "normal" }}>
                        {!e ? (
                          <span className="muted">—</span>
                        ) : e.filledByName ? (
                          <span className="pill amber" title={`Filled on your behalf by ${e.filledByName}`}>
                            {e.filledByName}
                          </span>
                        ) : (
                          <span className="muted">You</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                      No working days in this range yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
