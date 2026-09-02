// Staff side of consultant billing: who's placed, on what terms, what they've
// filed, and what it's worth.
//
// Admin/manager only, gated here and again by firestore.rules — assignmentRates
// is denied to consultants outright, which is why rates live in their own
// collection rather than as fields on the assignment.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";
import {
  listAssignments,
  listAssignmentRates,
  listConsultantTimesheets,
  listConsultantProfiles,
  inviteConsultant,
  resendInvite,
  saveAssignment,
  decideTimesheet,
  Assignment,
  ConsultantTimesheet,
} from "../lib/consultants";
import { weekAmount, weekTotals } from "../lib/consultantWeek";
import { downloadAskResultCsv, downloadAskResultXlsx } from "../lib/askExport";
import Modal from "../components/Modal";
import Pagination, { usePagination } from "../components/Pagination";

type Tab = "approvals" | "assignments" | "people" | "billing";

const money = (n: number, ccy = "USD") =>
  `${ccy === "USD" ? "$" : ccy + " "}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Consultants() {
  const { profile, profileLoading } = useAuth();
  const canSee = profile?.role === "admin" || profile?.role === "manager";
  const [tab, setTab] = useState<Tab>("approvals");

  const qc = useQueryClient();
  const assignmentsQ = useQuery({ queryKey: ["assignments"], queryFn: () => listAssignments(), enabled: canSee });
  const ratesQ = useQuery({ queryKey: ["assignmentRates"], queryFn: listAssignmentRates, enabled: canSee });
  const sheetsQ = useQuery({ queryKey: ["consultantTimesheets"], queryFn: () => listConsultantTimesheets(), enabled: canSee });
  const peopleQ = useQuery({ queryKey: ["consultantProfiles"], queryFn: listConsultantProfiles, enabled: canSee });

  const [editing, setEditing] = useState<Assignment | "new" | null>(null);
  const [inviting, setInviting] = useState(false);

  if (profileLoading && !profile) {
    return (
      <div className="center-load" style={{ minHeight: "30vh" }}>
        <div className="spinner dark" />
      </div>
    );
  }
  if (!canSee) {
    return (
      <div>
        <h1>Consultants</h1>
        <div className="alert info">
          Consultant billing is available to managers and admins — it carries pay and bill rates.
        </div>
      </div>
    );
  }

  const assignments = assignmentsQ.data ?? [];
  const rates = ratesQ.data ?? new Map();
  const sheets = sheetsQ.data ?? [];
  const pending = sheets.filter((s) => s.status === "submitted");

  return (
    <div>
      <h1>Consultants</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        People we placed at a client, the hours they file, and what those hours bill for.
      </p>

      <div className="segmented" style={{ marginBottom: "1rem" }}>
        <button className={tab === "approvals" ? "active" : ""} onClick={() => setTab("approvals")}>
          Approvals{pending.length > 0 ? ` (${pending.length})` : ""}
        </button>
        <button className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}>Assignments</button>
        <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>People</button>
        <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")}>Billing</button>
      </div>

      {tab === "approvals" && <Approvals sheets={sheets} onDone={() => qc.invalidateQueries({ queryKey: ["consultantTimesheets"] })} />}
      {tab === "assignments" && (
        <Assignments
          assignments={assignments}
          rates={rates}
          loading={assignmentsQ.isLoading}
          onEdit={setEditing}
        />
      )}
      {tab === "people" && (
        <People people={peopleQ.data ?? []} loading={peopleQ.isLoading} onInvite={() => setInviting(true)} />
      )}
      {tab === "billing" && <Billing sheets={sheets} assignments={assignments} rates={rates} />}

      {editing && (
        <AssignmentModal
          existing={editing === "new" ? null : editing}
          people={peopleQ.data ?? []}
          rates={rates}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["assignments"] });
            qc.invalidateQueries({ queryKey: ["assignmentRates"] });
          }}
        />
      )}
      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false);
            qc.invalidateQueries({ queryKey: ["consultantProfiles"] });
          }}
        />
      )}
    </div>
  );
}

// ---- Approvals -------------------------------------------------------------

function Approvals({ sheets, onDone }: { sheets: ConsultantTimesheet[]; onDone: () => void }) {
  const pending = sheets.filter((s) => s.status === "submitted");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id);
    setError(null);
    try {
      await decideTimesheet(id, decision, note[id] ?? "");
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const decided = sheets.filter((s) => s.status !== "submitted" && s.status !== "draft");

  return (
    <>
      <div className="card">
        <h2 style={{ fontSize: "1.05rem" }}>Waiting for approval</h2>
        {error && <div className="alert error">{error}</div>}
        {pending.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing waiting. Approved hours are billable.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Consultant</th>
                  <th>Client</th>
                  <th>Week</th>
                  <th style={{ textAlign: "right" }}>Reg</th>
                  <th style={{ textAlign: "right" }}>OT</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Note</th>
                  <th style={{ minWidth: 260 }}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.consultantName}</td>
                    <td>{s.client}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{DateTime.fromISO(s.weekStart).toFormat("d LLL yyyy")}</td>
                    <td style={{ textAlign: "right" }}>{s.regular}</td>
                    <td style={{ textAlign: "right" }} className={s.overtime > 0 ? "" : "muted"}>{s.overtime}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{s.total}h</td>
                    <td style={{ whiteSpace: "normal" }} className="muted">{s.note || "—"}</td>
                    <td>
                      <input
                        type="text"
                        placeholder="Reason (needed to reject)"
                        value={note[s.id] ?? ""}
                        onChange={(e) => setNote((n) => ({ ...n, [s.id]: e.target.value }))}
                        style={{ marginBottom: "0.35rem" }}
                      />
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button className="btn" style={{ padding: "0.3rem 0.7rem" }} disabled={busy === s.id} onClick={() => decide(s.id, "approved")}>
                          Approve
                        </button>
                        <button
                          className="btn ghost"
                          style={{ padding: "0.3rem 0.7rem" }}
                          disabled={busy === s.id || !(note[s.id] ?? "").trim()}
                          title={(note[s.id] ?? "").trim() ? "" : "Give a reason so they know what to fix"}
                          onClick={() => decide(s.id, "rejected")}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: "1.05rem" }}>Already decided</h2>
          <div className="table-wrap" style={{ maxHeight: "40vh" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Consultant</th>
                  <th>Week</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th>Status</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((s) => (
                  <tr key={s.id}>
                    <td>{s.consultantName}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{DateTime.fromISO(s.weekStart).toFormat("d LLL yyyy")}</td>
                    <td style={{ textAlign: "right" }}>{s.total}h</td>
                    <td>
                      <span className={`pill ${s.status === "approved" ? "green" : "red"}`}>{s.status}</span>
                    </td>
                    <td className="muted">{s.decidedByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Assignments -----------------------------------------------------------

function Assignments({
  assignments,
  rates,
  loading,
  onEdit,
}: {
  assignments: Assignment[];
  rates: Map<string, { billRate: number; payRate: number; currency: string }>;
  loading: boolean;
  onEdit: (a: Assignment | "new") => void;
}) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Assignments</h2>
        <button className="btn" onClick={() => onEdit("new")}>+ New assignment</button>
      </div>
      {loading ? (
        <div className="center-load" style={{ minHeight: "20vh" }}><div className="spinner dark" /></div>
      ) : assignments.length === 0 ? (
        <p className="muted">No assignments yet. Invite a consultant on the People tab, then place them here.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Consultant</th>
                <th>Client</th>
                <th>Role</th>
                <th>Dates</th>
                <th style={{ textAlign: "right" }}>Bill</th>
                <th style={{ textAlign: "right" }}>Pay</th>
                <th style={{ textAlign: "right" }}>Margin</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const r = rates.get(a.id);
                const margin = r ? r.billRate - r.payRate : 0;
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.consultantName}</td>
                    <td>{a.client}{a.endClient && a.endClient !== a.client && <span className="muted"> · {a.endClient}</span>}</td>
                    <td style={{ whiteSpace: "normal" }}>{a.jobTitle}</td>
                    <td style={{ whiteSpace: "nowrap" }} className="muted">
                      {a.startDate} → {a.endDate || "open"}
                    </td>
                    <td style={{ textAlign: "right" }}>{r ? money(r.billRate, r.currency) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r ? money(r.payRate, r.currency) : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: margin > 0 ? "#1e7e34" : "var(--danger)" }}>
                      {r ? money(margin, r.currency) : "—"}
                    </td>
                    <td><span className={`pill ${a.status === "active" ? "green" : "grey"}`}>{a.status}</span></td>
                    <td><button className="btn ghost" style={{ padding: "0.25rem 0.6rem" }} onClick={() => onEdit(a)}>Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- People ----------------------------------------------------------------

function People({
  people,
  loading,
  onInvite,
}: {
  people: { uid: string; email: string; displayName: string }[];
  loading: boolean;
  onInvite: () => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resend = async (email: string) => {
    setError(null);
    try {
      await resendInvite(email);
      setSent(email);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Consultants</h2>
        <button className="btn" onClick={onInvite}>+ Invite consultant</button>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Inviting creates their login and emails them a link to set their own password. We never send
        or store a password.
      </p>
      {error && <div className="alert error">{error}</div>}
      {sent && <div className="alert success">Set-password link re-sent to {sent}.</div>}
      {loading ? (
        <div className="center-load" style={{ minHeight: "20vh" }}><div className="spinner dark" /></div>
      ) : people.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Nobody invited yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Email</th><th></th></tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.uid}>
                  <td style={{ fontWeight: 600 }}>{p.displayName || "—"}</td>
                  <td className="muted">{p.email}</td>
                  <td>
                    <button className="btn ghost" style={{ padding: "0.25rem 0.6rem" }} onClick={() => resend(p.email)}>
                      Re-send invite
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

// ---- Billing ---------------------------------------------------------------

function Billing({
  sheets,
  assignments,
  rates,
}: {
  sheets: ConsultantTimesheet[];
  assignments: Assignment[];
  rates: Map<string, { billRate: number; payRate: number; otMultiplier: number; currency: string }>;
}) {
  const [from, setFrom] = useState(DateTime.local().minus({ months: 1 }).toFormat("yyyy-MM-dd"));
  const [to, setTo] = useState(DateTime.local().toFormat("yyyy-MM-dd"));

  // Only APPROVED hours are billable. Anything still submitted is not yet money.
  const rows = useMemo(() => {
    const byId = new Map(assignments.map((a) => [a.id, a]));
    return sheets
      .filter((s) => s.status === "approved" && s.weekStart >= from && s.weekStart <= to)
      .map((s) => {
        const a = byId.get(s.assignmentId);
        const r = rates.get(s.assignmentId);
        const totals = weekTotals(s.hours, s.weekStart);
        const bill = r ? weekAmount(totals, r.billRate, r.otMultiplier) : 0;
        const pay = r ? weekAmount(totals, r.payRate, r.otMultiplier) : 0;
        return {
          weekStart: s.weekStart,
          consultant: s.consultantName,
          client: s.client || a?.client || "",
          jobTitle: a?.jobTitle ?? "",
          poNumber: a?.poNumber ?? "",
          regular: totals.regular,
          overtime: totals.overtime,
          total: totals.total,
          bill,
          pay,
          margin: Math.round((bill - pay) * 100) / 100,
        };
      })
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.client.localeCompare(b.client));
  }, [sheets, assignments, rates, from, to]);

  const totals = rows.reduce(
    (acc, r) => ({ hours: acc.hours + r.total, bill: acc.bill + r.bill, pay: acc.pay + r.pay, margin: acc.margin + r.margin }),
    { hours: 0, bill: 0, pay: 0, margin: 0 }
  );
  const p = usePagination(rows, 25, "consultantBilling");

  const columns = [
    { key: "weekStart", label: "Week", type: "date" as const },
    { key: "client", label: "Client", type: "string" as const },
    { key: "consultant", label: "Consultant", type: "string" as const },
    { key: "jobTitle", label: "Role", type: "string" as const },
    { key: "poNumber", label: "PO", type: "string" as const },
    { key: "regular", label: "Regular hrs", type: "number" as const },
    { key: "overtime", label: "OT hrs", type: "number" as const },
    { key: "total", label: "Total hrs", type: "number" as const },
    { key: "bill", label: "Bill", type: "number" as const },
    { key: "pay", label: "Pay", type: "number" as const },
    { key: "margin", label: "Margin", type: "number" as const },
  ];
  const title = `Consultant billing ${from} to ${to}`;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Weeks from</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>to</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn secondary" disabled={!rows.length} onClick={() => downloadAskResultCsv(title, columns, rows)}>⬇ CSV</button>
        <button className="btn secondary" disabled={!rows.length} onClick={() => downloadAskResultXlsx(title, columns, rows)}>⬇ Excel</button>
      </div>

      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Approved weeks only — hours still waiting for approval aren&#39;t billable and aren&#39;t counted here.
      </p>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className="stat"><div className="num">{Math.round(totals.hours * 100) / 100}</div><div className="lbl">Billable hours</div></div>
        <div className="stat"><div className="num">{money(totals.bill)}</div><div className="lbl">To invoice</div></div>
        <div className="stat"><div className="num">{money(totals.pay)}</div><div className="lbl">Consultant pay</div></div>
        <div className="stat"><div className="num">{money(totals.margin)}</div><div className="lbl">Margin</div></div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">No approved weeks in this range.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Week</th><th>Client</th><th>Consultant</th><th>Role</th>
                  <th style={{ textAlign: "right" }}>Reg</th>
                  <th style={{ textAlign: "right" }}>OT</th>
                  <th style={{ textAlign: "right" }}>Bill</th>
                  <th style={{ textAlign: "right" }}>Pay</th>
                  <th style={{ textAlign: "right" }}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((r, i) => (
                  <tr key={`${r.weekStart}-${r.consultant}-${i}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.weekStart}</td>
                    <td>{r.client}</td>
                    <td>{r.consultant}</td>
                    <td style={{ whiteSpace: "normal" }} className="muted">{r.jobTitle}</td>
                    <td style={{ textAlign: "right" }}>{r.regular}</td>
                    <td style={{ textAlign: "right" }} className={r.overtime ? "" : "muted"}>{r.overtime}</td>
                    <td style={{ textAlign: "right" }}>{money(r.bill)}</td>
                    <td style={{ textAlign: "right" }} className="muted">{money(r.pay)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={p.page} pageCount={p.pageCount} total={p.total} pageSize={p.pageSize} onPage={p.setPage} onPageSize={p.setPageSize} />
        </>
      )}
    </div>
  );
}

// ---- Modals ----------------------------------------------------------------

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await inviteConsultant(email, name);
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Invite a consultant" onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <div className="alert info" style={{ fontSize: "0.85rem" }}>
        This creates their login and emails them a link to set their own password. They&#39;ll only ever
        see their own timesheet — never the recruiter suite.
      </div>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their full name" />
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their@email.com" />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn" onClick={submit} disabled={saving || !email.trim() || !name.trim()}>
          {saving ? <span className="spinner" /> : "Invite"}
        </button>
      </div>
    </Modal>
  );
}

function AssignmentModal({
  existing,
  people,
  rates,
  onClose,
  onSaved,
}: {
  existing: Assignment | null;
  people: { uid: string; email: string; displayName: string }[];
  rates: Map<string, { billRate: number; payRate: number; otMultiplier: number; currency: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = existing ? rates.get(existing.id) : undefined;
  const [f, setF] = useState({
    consultantUid: existing?.consultantUid ?? "",
    client: existing?.client ?? "",
    endClient: existing?.endClient ?? "",
    jobTitle: existing?.jobTitle ?? "",
    startDate: existing?.startDate ?? DateTime.local().toFormat("yyyy-MM-dd"),
    endDate: existing?.endDate ?? "",
    poNumber: existing?.poNumber ?? "",
    status: existing?.status ?? "active",
    billRate: String(r?.billRate ?? ""),
    payRate: String(r?.payRate ?? ""),
    otMultiplier: String(r?.otMultiplier ?? 1.5),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const margin = (Number(f.billRate) || 0) - (Number(f.payRate) || 0);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAssignment({
        id: existing?.id,
        consultantUid: f.consultantUid,
        client: f.client,
        endClient: f.endClient,
        jobTitle: f.jobTitle,
        startDate: f.startDate,
        endDate: f.endDate,
        poNumber: f.poNumber,
        status: f.status as "active" | "ended",
        billRate: Number(f.billRate),
        payRate: Number(f.payRate),
        otMultiplier: Number(f.otMultiplier) || 1.5,
      });
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open wide title={existing ? "Edit assignment" : "New assignment"} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <div className="field">
          <label>Consultant <span style={{ color: "var(--danger)" }}>*</span></label>
          <select value={f.consultantUid} onChange={(e) => set("consultantUid", e.target.value)} disabled={!!existing}>
            <option value="">Pick a consultant…</option>
            {people.map((p) => (
              <option key={p.uid} value={p.uid}>{p.displayName || p.email}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Job title <span style={{ color: "var(--danger)" }}>*</span></label>
          <input type="text" value={f.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Client we invoice <span style={{ color: "var(--danger)" }}>*</span></label>
          <input type="text" value={f.client} onChange={(e) => set("client", e.target.value)} />
        </div>
        <div className="field">
          <label>End client (if different)</label>
          <input type="text" value={f.endClient} onChange={(e) => set("endClient", e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Start date <span style={{ color: "var(--danger)" }}>*</span></label>
          <input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        <div className="field">
          <label>End date (blank = open-ended)</label>
          <input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
        <div className="field">
          <label>PO number</label>
          <input type="text" value={f.poNumber} onChange={(e) => set("poNumber", e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Bill rate /hr <span style={{ color: "var(--danger)" }}>*</span></label>
          <input type="number" min={0} step={0.01} value={f.billRate} onChange={(e) => set("billRate", e.target.value)} />
        </div>
        <div className="field">
          <label>Pay rate /hr <span style={{ color: "var(--danger)" }}>*</span></label>
          <input type="number" min={0} step={0.01} value={f.payRate} onChange={(e) => set("payRate", e.target.value)} />
        </div>
        <div className="field">
          <label>Overtime multiplier</label>
          <input type="number" min={1} step={0.1} value={f.otMultiplier} onChange={(e) => set("otMultiplier", e.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Margin <strong style={{ color: margin > 0 ? "#1e7e34" : "var(--danger)" }}>{money(margin)}</strong>/hr.
        Rates are never visible to the consultant — they&#39;re stored separately and denied by the
        security rules, not just hidden in the UI.
      </p>
      {existing && (
        <div className="field">
          <label>Status</label>
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
          </select>
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn" onClick={submit} disabled={saving}>
          {saving ? <span className="spinner" /> : "Save assignment"}
        </button>
      </div>
    </Modal>
  );
}
