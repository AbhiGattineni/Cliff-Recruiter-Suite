import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import { listMyLeaves, requestLeave, LeaveType } from "../../lib/timesheets";
import { useAuth } from "../../context/AuthContext";

const todayIso = () => DateTime.local().toFormat("yyyy-MM-dd");

const TYPE_LABEL: Record<LeaveType, string> = { half: "Half day", full: "One day", multi: "Multiple days" };
const STATUS_PILL: Record<string, string> = { pending: "amber", approved: "green", rejected: "red" };

export default function MyLeavesTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user!.uid;
  const leavesQ = useQuery({ queryKey: ["myLeaves", uid], queryFn: () => listMyLeaves(uid) });

  const [leaveType, setLeaveType] = useState<LeaveType>("full");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const changeType = (t: LeaveType) => {
    setLeaveType(t);
    if (t !== "multi") setEndDate(startDate);
  };
  const changeStart = (d: string) => {
    setStartDate(d);
    if (leaveType !== "multi" || endDate < d) setEndDate(d);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setSubmitted(false);
    try {
      await requestLeave(leaveType, startDate, leaveType === "multi" ? endDate : startDate, reason);
      setReason("");
      await qc.invalidateQueries({ queryKey: ["myLeaves"] });
      await qc.invalidateQueries({ queryKey: ["allLeaves"] });
      setSubmitted(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>Request leave</h2>
        {error && <div className="alert error">{error}</div>}
        {submitted && !error && <div className="alert success">Request submitted — pending approval.</div>}
        <div className="row">
          <div className="field">
            <label>Type</label>
            <select value={leaveType} onChange={(e) => changeType(e.target.value as LeaveType)}>
              <option value="half">Half day</option>
              <option value="full">One day</option>
              <option value="multi">Multiple days</option>
            </select>
          </div>
          <div className="field">
            <label>{leaveType === "multi" ? "Start date" : "Date"}</label>
            <input type="date" value={startDate} onChange={(e) => changeStart(e.target.value)} />
          </div>
          {leaveType === "multi" && (
            <div className="field">
              <label>End date</label>
              <input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          )}
        </div>
        <div className="field">
          <label>Reason</label>
          <textarea
            rows={2}
            style={{ minHeight: 60 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <button className="btn" onClick={submit} disabled={submitting}>
          {submitting ? <span className="spinner" /> : "Submit request"}
        </button>
      </div>

      <div className="card">
        <h2>Your requests</h2>
        {leavesQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "20vh" }}>
            <div className="spinner dark" />
          </div>
        ) : leavesQ.error ? (
          <div className="alert error">{friendlyError(leavesQ.error)}</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {(leavesQ.data ?? []).map((l) => (
                  <tr key={l.id}>
                    <td>{TYPE_LABEL[l.leaveType]}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {l.startDate === l.endDate ? l.startDate : `${l.startDate} → ${l.endDate}`}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.reason || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`pill ${STATUS_PILL[l.status]}`}>{l.status}</span>
                    </td>
                    <td className="muted" style={{ fontSize: "0.8rem" }}>
                      {l.decidedByName ? `${l.decidedByName}${l.decisionNote ? ` — ${l.decisionNote}` : ""}` : "—"}
                    </td>
                  </tr>
                ))}
                {(leavesQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                      No leave requests yet.
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
