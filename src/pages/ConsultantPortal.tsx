// The portal a placed consultant sees, and the only thing they see.
//
// Deliberately NOT the recruiter shell with items disabled: a consultant never
// learns that Recruiter Performance or the client tracker exist. Hiding UI
// isn't access control either — firestore.rules is what actually stops them
// reading anything here, and this page just declines to draw a door.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";
import {
  listAssignments,
  listConsultantTimesheets,
  submitTimesheet,
  Assignment,
  ConsultantTimesheet,
} from "../lib/consultants";
import {
  weekStartOf,
  weekDays,
  weekTotals,
  weekSubmitError,
  weekIsComplete,
  OT_THRESHOLD_HOURS,
} from "../lib/consultantWeek";
import { TIMESHEET_ZONE } from "../lib/timesheets";
import { todayInZone } from "../lib/serverClock";

const statusPill = (s: ConsultantTimesheet["status"]) =>
  s === "approved" ? "green" : s === "submitted" ? "amber" : s === "rejected" ? "red" : "grey";

export default function ConsultantPortal() {
  const { user, profile, signOut } = useAuth();
  const qc = useQueryClient();
  const uid = user?.uid ?? "";

  const assignmentsQ = useQuery({
    queryKey: ["myAssignments", uid],
    queryFn: () => listAssignments(uid),
    enabled: !!uid,
  });
  const sheetsQ = useQuery({
    queryKey: ["myConsultantTimesheets", uid],
    queryFn: () => listConsultantTimesheets(uid),
    enabled: !!uid,
  });

  const active = useMemo(
    () => (assignmentsQ.data ?? []).filter((a) => a.status === "active"),
    [assignmentsQ.data]
  );
  const [assignmentId, setAssignmentId] = useState("");
  const assignment: Assignment | undefined =
    active.find((a) => a.id === assignmentId) ?? active[0];

  // Default to the week just finished — the one they're most likely filing.
  const today = todayInZone(TIMESHEET_ZONE);
  const [weekStart, setWeekStart] = useState(() =>
    weekStartOf(DateTime.fromISO(todayInZone(TIMESHEET_ZONE)).minus({ days: 7 }).toFormat("yyyy-MM-dd"))
  );
  const days = weekDays(weekStart);

  const [hours, setHours] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const existing = (sheetsQ.data ?? []).find(
    (s) => s.assignmentId === assignment?.id && s.weekStart === weekStart
  );
  const locked = existing?.status === "submitted" || existing?.status === "approved";
  const shown = locked ? existing!.hours : hours;
  const totals = weekTotals(shown, weekStart);
  const blocker = weekSubmitError(shown, weekStart, today);

  const setDay = (date: string, value: string) => {
    setDone(false);
    setHours((cur) => {
      const next = { ...cur };
      const n = Number(value);
      if (!value || !Number.isFinite(n) || n <= 0) delete next[date];
      else next[date] = n;
      return next;
    });
  };

  const shiftWeek = (weeks: number) => {
    setWeekStart(DateTime.fromISO(weekStart).plus({ weeks }).toFormat("yyyy-MM-dd"));
    setHours({});
    setNote("");
    setDone(false);
    setError(null);
  };

  const submit = async () => {
    if (!assignment || blocker) return;
    setSaving(true);
    setError(null);
    try {
      await submitTimesheet(assignment.id, weekStart, hours, note);
      await qc.invalidateQueries({ queryKey: ["myConsultantTimesheets"] });
      setDone(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="portal">
      <header className="portal-bar">
        <div>
          <strong>Cliff Services</strong>
          <span className="muted"> · Timesheets</span>
        </div>
        <div className="portal-who">
          <span className="muted">{profile?.displayName || user?.email}</span>
          <button className="btn ghost" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>

      <main className="portal-main">
        {assignmentsQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "40vh" }}>
            <div className="spinner dark" />
          </div>
        ) : active.length === 0 ? (
          <div className="card">
            <h2>No active assignment</h2>
            <p className="muted" style={{ margin: 0 }}>
              There&#39;s no active assignment on your account yet, so there&#39;s nothing to file hours
              against. Your recruiter at Cliff Services can set one up.
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <h1 style={{ marginBottom: "0.2rem" }}>Your timesheet</h1>
              <p className="muted" style={{ marginTop: 0 }}>
                Fill the week you worked and submit it. Your hours go to Cliff Services for approval,
                and are what we invoice {assignment?.client} for.
              </p>

              <div className="row" style={{ alignItems: "flex-end" }}>
                {active.length > 1 && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Assignment</label>
                    <select
                      value={assignment?.id ?? ""}
                      onChange={(e) => { setAssignmentId(e.target.value); setHours({}); setDone(false); }}
                    >
                      {active.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.jobTitle} · {a.client}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field" style={{ margin: 0 }}>
                  <label>Week</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <button className="btn ghost" onClick={() => shiftWeek(-1)} title="Previous week">‹</button>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {DateTime.fromISO(days[0]).toFormat("d LLL")} – {DateTime.fromISO(days[6]).toFormat("d LLL yyyy")}
                    </span>
                    <button
                      className="btn ghost"
                      onClick={() => shiftWeek(1)}
                      disabled={weekStart >= weekStartOf(today)}
                      title="Next week"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </div>

              {assignment && (
                <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
                  {assignment.jobTitle} at {assignment.endClient || assignment.client}
                  {assignment.poNumber && ` · PO ${assignment.poNumber}`}
                </p>
              )}
            </div>

            <div className="card">
              {error && <div className="alert error">{error}</div>}
              {done && !error && <div className="alert success">Submitted. Cliff Services will review it.</div>}
              {existing && (
                <div className={`alert ${existing.status === "rejected" ? "error" : "info"}`}>
                  This week is <strong>{existing.status}</strong>
                  {existing.decidedByName && ` — ${existing.status} by ${existing.decidedByName}`}.
                  {existing.decisionNote && <> “{existing.decisionNote}”</>}
                  {existing.status === "rejected" && " Correct the hours and submit it again."}
                </div>
              )}

              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Date</th>
                      <th style={{ textAlign: "right", width: 140 }}>Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const dt = DateTime.fromISO(d);
                      const weekend = dt.weekday >= 6;
                      const future = d > today;
                      return (
                        <tr key={d} style={weekend ? { background: "#fafbfc" } : undefined}>
                          <td style={{ fontWeight: weekend ? 400 : 600 }}>{dt.toFormat("cccc")}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{dt.toFormat("d LLL")}</td>
                          <td style={{ textAlign: "right" }}>
                            <input
                              type="number"
                              min={0}
                              max={24}
                              step={0.25}
                              style={{ textAlign: "right" }}
                              value={shown[d] ?? ""}
                              placeholder={future ? "—" : "0"}
                              disabled={locked || future}
                              onChange={(e) => setDay(d, e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ textAlign: "right", fontWeight: 700 }}>Total</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.total}h</td>
                    </tr>
                    {totals.overtime > 0 && (
                      <tr>
                        <td colSpan={2} style={{ textAlign: "right" }} className="muted">
                          {OT_THRESHOLD_HOURS}h regular + overtime
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {totals.regular} + {totals.overtime}h
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {!locked && (
                <>
                  <div className="field" style={{ marginTop: "1rem" }}>
                    <label>Notes (optional)</label>
                    <textarea
                      rows={2}
                      style={{ minHeight: 60 }}
                      placeholder="Anything the approver should know — a short week, extra hours, time off."
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                  {blocker && totals.total > 0 && (
                    <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{blocker}</p>
                  )}
                  {!weekIsComplete(weekStart, today) && (
                    <p className="muted" style={{ fontSize: "0.85rem" }}>
                      This week isn&#39;t over yet — you can submit what you&#39;ve worked so far, or come
                      back at the end of the week.
                    </p>
                  )}
                  <button className="btn" onClick={submit} disabled={saving || !!blocker}>
                    {saving ? <span className="spinner" /> : "Submit for approval"}
                  </button>
                </>
              )}
            </div>

            <div className="card">
              <h2 style={{ fontSize: "1.05rem" }}>Your submitted weeks</h2>
              {(sheetsQ.data ?? []).length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Nothing submitted yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Assignment</th>
                        <th style={{ textAlign: "right" }}>Hours</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sheetsQ.data ?? []).map((s) => (
                        <tr key={s.id}>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {DateTime.fromISO(s.weekStart).toFormat("d LLL yyyy")}
                          </td>
                          <td className="muted">{s.client}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{s.total}h</td>
                          <td>
                            <span className={`pill ${statusPill(s.status)}`}>{s.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
