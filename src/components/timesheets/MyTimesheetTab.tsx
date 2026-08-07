import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import { listMyTimesheets, saveTimesheetEntry, TimesheetEntry, JobHours } from "../../lib/timesheets";
import { listOpenJobs } from "../../lib/openJobs";
import JobHoursPicker from "./JobHoursPicker";
import { useAuth } from "../../context/AuthContext";

const todayIso = () => DateTime.local().toFormat("yyyy-MM-dd");
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
  const [hours, setHours] = useState("8");
  const [workedOn, setWorkedOn] = useState("");
  const [jobs, setJobs] = useState<JobHours[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const pickDate = (d: string) => {
    setDate(d);
    setSaved(false);
    setError(null);
    const existing = byDate.get(d);
    setHours(existing ? String(existing.hours) : "8");
    setWorkedOn(existing?.workedOn ?? "");
    setJobs(existing?.jobs ?? []);
  };

  const selected = byDate.get(date);
  const jobTotal = Math.round(jobs.reduce((s, j) => s + (Number(j.hours) || 0), 0) * 100) / 100;
  // Block saving a requirement row left at zero — it reads as "worked on, no time".
  const jobsIncomplete = jobs.length > 0 && jobs.some((j) => !(Number(j.hours) > 0));

  const submit = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveTimesheetEntry(date, Number(hours), workedOn, jobs);
      await qc.invalidateQueries({ queryKey: ["myTimesheets"] });
      await qc.invalidateQueries({ queryKey: ["teamTimesheets"] });
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const missingDays = useMemo(() => {
    if (!entriesQ.data) return [];
    const days: string[] = [];
    let d = DateTime.fromISO(from);
    const end = DateTime.fromISO(to);
    while (d <= end) {
      const iso = d.toFormat("yyyy-MM-dd");
      if (!byDate.has(iso)) days.push(iso);
      d = d.plus({ days: 1 });
    }
    return days;
  }, [entriesQ.data, byDate, from, to]);

  return (
    <div>
      <div className="card">
        <h2>Fill your timesheet</h2>
        {error && <div className="alert error">{error}</div>}
        {saved && !error && <div className="alert success">Saved {date}.</div>}
        <div className="row">
          <div className="field">
            <label>Date</label>
            <input type="date" max={todayIso()} value={date} onChange={(e) => pickDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Hours worked{jobs.length > 0 && <span className="muted"> — from the split below</span>}</label>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={jobs.length > 0 ? String(jobTotal) : hours}
              disabled={jobs.length > 0}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
        </div>

        <JobHoursPicker
          jobs={jobs}
          options={openJobsQ.data ?? []}
          loading={openJobsQ.isLoading}
          error={openJobsQ.error ? friendlyError(openJobsQ.error) : null}
          onChange={setJobs}
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
            You already logged {selected.hours}h for this date — saving will update it.
          </p>
        )}
        <button className="btn" onClick={submit} disabled={saving || (jobs.length === 0 && !hours) || jobsIncomplete}>
          {saving ? <span className="spinner" /> : "Save"}
        </button>
      </div>

      {missingDays.length > 0 && (
        <div className="alert warn">
          You&#39;re missing <strong>{missingDays.length}</strong> day{missingDays.length === 1 ? "" : "s"} in the
          last {RANGE_DAYS} days: {missingDays.slice(0, 8).join(", ")}
          {missingDays.length > 8 ? "…" : ""}
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
                </tr>
              </thead>
              <tbody>
                {(entriesQ.data ?? []).map((e) => (
                  <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => pickDate(e.date)}>
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
                  </tr>
                ))}
                {(entriesQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
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
