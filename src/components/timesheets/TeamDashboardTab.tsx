import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import { listTeamTimesheets, listLeaveRequests, decideLeaveRequest, Role } from "../../lib/timesheets";

const todayIso = () => DateTime.local().toFormat("yyyy-MM-dd");
const STATUS_PILL: Record<string, string> = { pending: "amber", approved: "green", rejected: "red" };
const TYPE_LABEL: Record<string, string> = { half: "Half day", full: "One day", multi: "Multiple days" };

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (d <= end) {
    out.push(d.toFormat("yyyy-MM-dd"));
    d = d.plus({ days: 1 });
  }
  return out;
}

export default function TeamDashboardTab({ role }: { role: Role }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(DateTime.local().startOf("month").toFormat("yyyy-MM-dd"));
  const [to, setTo] = useState(todayIso());

  const tsQ = useQuery({ queryKey: ["teamTimesheets", from, to], queryFn: () => listTeamTimesheets(from, to) });
  const leavesQ = useQuery({ queryKey: ["allLeaves", role], queryFn: () => listLeaveRequests(role) });

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setDecidingId(id);
    setDecideError(null);
    try {
      await decideLeaveRequest(id, decision, "");
      await qc.invalidateQueries({ queryKey: ["allLeaves"] });
    } catch (e) {
      setDecideError(friendlyError(e));
    } finally {
      setDecidingId(null);
    }
  };

  const rangeDays = useMemo(() => daysBetween(from, to), [from, to]);
  const today = todayIso();

  const rows = useMemo(() => {
    if (!tsQ.data) return [];
    const { entries, users } = tsQ.data;
    const approvedLeaves = (leavesQ.data ?? []).filter((l) => l.status === "approved");
    return users
      .map((u) => {
        const myEntries = entries.filter((e) => e.uid === u.uid);
        const filledDates = new Set(myEntries.map((e) => e.date));
        const myLeaveDates = new Set<string>();
        approvedLeaves
          .filter((l) => l.uid === u.uid)
          .forEach((l) => daysBetween(l.startDate, l.endDate).forEach((d) => myLeaveDates.add(d)));
        const missing = rangeDays.filter((d) => d <= today && !filledDates.has(d) && !myLeaveDates.has(d));
        const totalHours = myEntries.reduce((s, e) => s + e.hours, 0);
        return { user: u, filled: filledDates.size, missing, totalHours };
      })
      .sort((a, b) => b.missing.length - a.missing.length || a.user.email.localeCompare(b.user.email));
  }, [tsQ.data, leavesQ.data, rangeDays, today]);

  const pendingLeaves = (leavesQ.data ?? []).filter((l) => l.status === "pending");
  const decidedLeaves = (leavesQ.data ?? []).filter((l) => l.status !== "pending");

  return (
    <div>
      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Timesheet completion</h2>
        <p className="sub">Everyone is expected to log hours every day. Approved leave days don&#39;t count as missing.</p>
        {tsQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "20vh" }}>
            <div className="spinner dark" />
          </div>
        ) : tsQ.error ? (
          <div className="alert error">{friendlyError(tsQ.error)}</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th style={{ textAlign: "right" }}>Days filled</th>
                  <th style={{ textAlign: "right" }}>Total hours</th>
                  <th>Missing days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.uid} className={r.missing.length > 0 ? "red" : ""}>
                    <td style={{ fontWeight: 600 }}>{r.user.displayName || r.user.email}</td>
                    <td className="muted">{r.user.role}</td>
                    <td style={{ textAlign: "right" }}>{r.filled}</td>
                    <td style={{ textAlign: "right" }}>{r.totalHours}</td>
                    <td>
                      {r.missing.length === 0 ? (
                        <span className="pill green">All caught up</span>
                      ) : (
                        <span title={r.missing.join(", ")}>
                          <span className="pill red">{r.missing.length} missing</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Pending leave requests</h2>
        {decideError && <div className="alert error">{decideError}</div>}
        {leavesQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "15vh" }}>
            <div className="spinner dark" />
          </div>
        ) : pendingLeaves.length === 0 ? (
          <p className="muted">Nothing pending.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingLeaves.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.displayName || l.email}</td>
                    <td className="muted">{l.role}</td>
                    <td>{TYPE_LABEL[l.leaveType]}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {l.startDate === l.endDate ? l.startDate : `${l.startDate} → ${l.endDate}`}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.reason || <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn secondary"
                        style={{ padding: "0.3rem 0.6rem", marginRight: 6 }}
                        disabled={decidingId === l.id}
                        onClick={() => decide(l.id, "approved")}
                      >
                        Approve
                      </button>
                      <button
                        className="btn ghost"
                        style={{ padding: "0.3rem 0.6rem" }}
                        disabled={decidingId === l.id}
                        onClick={() => decide(l.id, "rejected")}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {decidedLeaves.length > 0 && (
        <div className="card">
          <h2>Decided</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {decidedLeaves.map((l) => (
                  <tr key={l.id}>
                    <td>{l.displayName || l.email}</td>
                    <td>{TYPE_LABEL[l.leaveType]}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {l.startDate === l.endDate ? l.startDate : `${l.startDate} → ${l.endDate}`}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[l.status]}`}>{l.status}</span>
                    </td>
                    <td className="muted">{l.decidedByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
