import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import {
  listMyTimesheets,
  listMyLeaves,
  saveTimesheetEntry,
  TIMESHEET_ZONE,
  TIMESHEET_ZONE_LABEL,
  TimesheetEntry,
  JobHours,
} from "../../lib/timesheets";
import { EXPECTED_DAILY_HOURS, daysBetween, missingDays, shortDays } from "../../lib/timesheetStats";
import { listOpenJobs } from "../../lib/openJobs";
import JobHoursPicker from "./JobHoursPicker";
import { useAuth } from "../../context/AuthContext";

// The server only accepts today's date, decided in the team's zone — so the
// form has to agree with it, not with whatever zone the browser happens to be in.
const todayIso = () => DateTime.now().setZone(TIMESHEET_ZONE).toFormat("yyyy-MM-dd");
const RANGE_DAYS = 30;

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

  const [date, setDate] = useState(todayIso());
  const [workedOn, setWorkedOn] = useState("");
  const [jobs, setJobs] = useState<JobHours[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Today's entry, loaded into the form so a same-day correction starts from
  // what is already saved rather than from an empty form.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === date || !entriesQ.data) return;
    loadedFor.current = date;
    const existing = byDate.get(date);
    setWorkedOn(existing?.workedOn ?? "");
    setJobs(existing?.jobs ?? []);
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

  // Both use the shared definitions in timesheetStats, so this tab, the Team
  // Dashboard and Recruiter Performance agree on what "unfilled" and "short"
  // mean. This tab used to count its own way and flagged weekends as missing.
  const missing = useMemo(
    () => missingDays(from, to, todayIso(), new Set(byDate.keys()), leaveDates),
    [byDate, leaveDates, from, to]
  );
  const short = useMemo(() => {
    const hoursByDate = new Map<string, number>();
    for (const [d, e] of byDate) hoursByDate.set(d, Number(e.hours) || 0);
    return shortDays(from, to, todayIso(), hoursByDate, leaveDates);
  }, [byDate, leaveDates, from, to]);

  return (
    <div>
      <div className="card">
        <h2>Fill your timesheet</h2>
        {error && <div className="alert error">{error}</div>}
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

      {missing.length > 0 && (
        <div className="alert warn">
          You&#39;re missing <strong>{missing.length}</strong> working day{missing.length === 1 ? "" : "s"} in the
          last {RANGE_DAYS} days: {missing.slice(0, 8).join(", ")}
          {missing.length > 8 ? "…" : ""}. A closed day can only be filled by a manager or admin — ask
          them to add it for you.
        </div>
      )}

      {short.length > 0 && (
        <div className="alert warn">
          <strong>{short.length}</strong> day{short.length === 1 ? "" : "s"} logged under the expected{" "}
          {EXPECTED_DAILY_HOURS}h:{" "}
          {short.slice(0, 8).map((d) => `${d.date} (${d.hours}h)`).join(", ")}
          {short.length > 8 ? "…" : ""}
        </div>
      )}

      <div className="card">
        <h2>Last {RANGE_DAYS} days</h2>
        {entriesQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "20vh" }}>
            <div className="spinner dark" />
          </div>
        ) : entriesQ.error ? (
          <div className="alert error">{friendlyError(entriesQ.error)}</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th>Requirements</th>
                  <th>Notes</th>
                  <th>Filled by</th>
                </tr>
              </thead>
              <tbody>
                {(entriesQ.data ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td style={{ textAlign: "right" }}>{e.hours}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {e.jobs?.length ? (
                        e.jobs.map((j) => (
                          <span className="pill grey" key={j.jobCode} style={{ marginRight: "0.3rem" }}>
                            {j.jobCode} · {j.hours}h
                          </span>
                        ))
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{e.workedOn || <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {e.filledByName ? (
                        <span className="pill amber" title={`Filled on your behalf by ${e.filledByName}`}>
                          {e.filledByName}
                        </span>
                      ) : (
                        <span className="muted">You</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(entriesQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                      No entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
