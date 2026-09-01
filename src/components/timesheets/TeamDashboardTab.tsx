import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { friendlyError } from "../../lib/errors";
import { listTeamTimesheets, listLeaveRequests, decideLeaveRequest, Role, TimesheetEntry } from "../../lib/timesheets";
import { daysBetween, missingDays } from "../../lib/timesheetStats";
import FillOnBehalfModal from "./FillOnBehalfModal";

const todayIso = () => DateTime.local().toFormat("yyyy-MM-dd");
const STATUS_PILL: Record<string, string> = { pending: "amber", approved: "green", rejected: "red" };
const TYPE_LABEL: Record<string, string> = { half: "Half day", full: "One day", multi: "Multiple days" };

export default function TeamDashboardTab({ role }: { role: Role }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(DateTime.local().startOf("month").toFormat("yyyy-MM-dd"));
  const [to, setTo] = useState(todayIso());

  const tsQ = useQuery({ queryKey: ["teamTimesheets", from, to], queryFn: () => listTeamTimesheets(from, to) });
  const leavesQ = useQuery({ queryKey: ["allLeaves", role], queryFn: () => listLeaveRequests(role) });

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The day being filled on someone's behalf, if any. A recruiter can only fill
  // today, so a closed day is only ever recorded from here.
  const [filling, setFilling] = useState<{ uid: string; name: string; date: string } | null>(null);
  const toggle = (uid: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

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

  const today = todayIso();

  const rows = useMemo(() => {
    if (!tsQ.data) return [];
    const { entries, users } = tsQ.data;
    const approvedLeaves = (leavesQ.data ?? []).filter((l) => l.status === "approved");
    // Admins aren't tracked here — they're not expected to log hours, so they
    // shouldn't show up as a name with missing days.
    return users
      .filter((u) => u.role !== "admin")
      .map((u) => {
        const myEntries = entries.filter((e) => e.uid === u.uid).sort((a, b) => b.date.localeCompare(a.date));
        const filledDates = new Set(myEntries.map((e) => e.date));
        const myLeaveDates = new Set<string>();
        approvedLeaves
          .filter((l) => l.uid === u.uid)
          .forEach((l) => daysBetween(l.startDate, l.endDate).forEach((d) => myLeaveDates.add(d)));
        const missing = missingDays(from, to, today, filledDates, myLeaveDates);
        const totalHours = myEntries.reduce((s, e) => s + e.hours, 0);
        return { user: u, filled: filledDates.size, missing, totalHours, entries: myEntries };
      })
      .sort((a, b) => b.missing.length - a.missing.length || a.user.email.localeCompare(b.user.email));
  }, [tsQ.data, leavesQ.data, from, to, today]);

  const pendingLeaves = (leavesQ.data ?? []).filter((l) => l.status === "pending");
  const decidedLeaves = (leavesQ.data ?? []).filter((l) => l.status !== "pending");

  return (
    <div>
      {filling && (
        <FillOnBehalfModal
          uid={filling.uid}
          name={filling.name}
          date={filling.date}
          onClose={() => setFilling(null)}
        />
      )}
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
                  <th style={{ width: 24 }}></th>
                  <th>Name</th>
                  <th>Role</th>
                  <th style={{ textAlign: "right" }}>Days filled</th>
                  <th style={{ textAlign: "right" }}>Total hours</th>
                  <th>Missing days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded.has(r.user.uid);
                  return (
                    <Fragment key={r.user.uid}>
                      <tr
                        className={r.missing.length > 0 ? "red" : ""}
                        style={{ cursor: "pointer" }}
                        onClick={() => toggle(r.user.uid)}
                      >
                        <td style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</td>
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
                      {open && (
                        <tr>
                          <td></td>
                          <td colSpan={5} style={{ background: "#f8fafc", padding: "0.6rem 0.75rem" }}>
                            <TeamMemberDetail
                          entries={r.entries}
                          missing={r.missing}
                          onFill={(d) =>
                            setFilling({ uid: r.user.uid, name: r.user.displayName || r.user.email, date: d })
                          }
                        />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
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

/** One person's detail, expanded inline in the Timesheet completion table: which days are missing, and every entry actually filed. */
function TeamMemberDetail({
  entries,
  missing,
  onFill,
}: {
  entries: TimesheetEntry[];
  missing: string[];
  onFill: (date: string) => void;
}) {
  return (
    <>
      {missing.length > 0 && (
        <div style={{ marginBottom: "0.6rem" }}>
          <strong style={{ fontSize: "0.82rem" }}>Missing:</strong>{" "}
          {missing.map((d) => (
            <button
              type="button"
              className="pill red"
              key={d}
              style={{ marginRight: "0.3rem", border: "none", cursor: "pointer", font: "inherit", fontWeight: 600 }}
              title={`Fill ${d} on their behalf`}
              onClick={() => onFill(d)}
            >
              {d} +
            </button>
          ))}
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Click a day to fill it for them — it will show that you added it.
          </span>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>No timesheet entries in this range.</p>
      ) : (
        <table className="data" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Hours</th>
              <th>Requirement(s)</th>
              <th>Notes</th>
              <th>Filled by</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{e.date}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{e.hours}h</td>
                <td style={{ whiteSpace: "normal" }}>
                  {e.jobs.length
                    ? e.jobs.map((j) => `${j.jobCode}${j.jobTitle ? ` · ${j.jobTitle}` : ""} (${j.hours}h)`).join(", ")
                    : "—"}
                </td>
                <td style={{ whiteSpace: "normal" }} className="muted">{e.workedOn || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {e.filledByName ? (
                    <span className="pill amber" title={`Added on their behalf by ${e.filledByName}`}>
                      {e.filledByName}
                    </span>
                  ) : (
                    <span className="muted">Themselves</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
