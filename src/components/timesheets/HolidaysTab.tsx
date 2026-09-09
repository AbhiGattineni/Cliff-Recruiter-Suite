import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import { addHolidays, listHolidays, removeHoliday, Holiday } from "../../lib/holidays";
import { timesheetToday } from "../../lib/timesheets";

/**
 * Company holidays, for admins and managers.
 *
 * Adding one takes a day out of everybody's expected timesheet: it stops being
 * chased as missing, here and on the Team Dashboard and Recruiter Performance,
 * because all three read the same list. Anyone who did work that day can still
 * log it — the day is not blocked, only no longer required.
 */
export default function HolidaysTab() {
  const qc = useQueryClient();
  const holidaysQ = useQuery({ queryKey: ["holidays"], queryFn: listHolidays });

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const invalidate = () => {
    // Every screen that counts a missing day reads this list.
    qc.invalidateQueries({ queryKey: ["holidays"] });
  };

  const add = useMutation({
    mutationFn: () => addHolidays(from, to || from, name),
    onSuccess: (dates) => {
      setAdded(`${name.trim()} — ${dates.length} day${dates.length === 1 ? "" : "s"} marked.`);
      setName("");
      setFrom("");
      setTo("");
      invalidate();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: (date: string) => removeHoliday(date),
    onSuccess: invalidate,
    onError: (e) => setError(friendlyError(e)),
  });

  const submit = () => {
    setError(null);
    setAdded(null);
    add.mutate();
  };

  const today = timesheetToday();
  const rows = holidaysQ.data ?? [];
  const upcoming = rows.filter((h) => h.date >= today);
  const past = rows.filter((h) => h.date < today).reverse();

  return (
    <div>
      <div className="card">
        <h2>Add a holiday</h2>
        <p className="sub">
          Nobody is asked for a timesheet on a company holiday, and it isn&#39;t counted against them.
          It doesn&#39;t use anyone&#39;s leave, and someone who does work that day can still log the
          hours.
        </p>
        {error && <div className="alert error">{error}</div>}
        {added && !error && <div className="alert success">{added}</div>}
        <div className="row">
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Diwali, Christmas Day, Company offsite…"
            />
          </div>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>
              To <span className="muted" style={{ fontWeight: 400 }}>— leave blank for one day</span>
            </label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <button className="btn" onClick={submit} disabled={add.isPending || !from || !name.trim()}>
          {add.isPending ? <span className="spinner" /> : "Add holiday"}
        </button>
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem", marginBottom: 0 }}>
          A range marks each working day in it. Weekends are skipped — nothing was expected on them
          anyway.
        </p>
      </div>

      <HolidayTable
        title="Upcoming"
        rows={upcoming}
        loading={holidaysQ.isLoading}
        error={holidaysQ.error ? friendlyError(holidaysQ.error) : null}
        empty="No holidays booked yet."
        onRemove={(d) => remove.mutate(d)}
        removing={remove.isPending}
      />
      <HolidayTable
        title="Past"
        rows={past}
        loading={false}
        error={null}
        empty="Nothing yet."
        onRemove={(d) => remove.mutate(d)}
        removing={remove.isPending}
      />
    </div>
  );
}

function HolidayTable({
  title,
  rows,
  loading,
  error,
  empty,
  onRemove,
  removing,
}: {
  title: string;
  rows: Holiday[];
  loading: boolean;
  error: string | null;
  empty: string;
  onRemove: (date: string) => void;
  removing: boolean;
}) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {loading ? (
        <div className="center-load" style={{ minHeight: "15vh" }}>
          <div className="spinner dark" />
        </div>
      ) : error ? (
        <div className="alert error">{error}</div>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Holiday</th>
                <th>Added by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.date}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {h.date} <span className="muted">{DateTime.fromISO(h.date).toFormat("ccc")}</span>
                  </td>
                  <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{h.name}</td>
                  <td className="muted">{h.addedByName || "—"}</td>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ padding: "0.25rem 0.6rem" }}
                      disabled={removing}
                      onClick={() => onRemove(h.date)}
                      title="Everyone will be expected to file a timesheet for this day again"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
