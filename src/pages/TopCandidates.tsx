import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";
import {
  RESUME_ACCEPT,
  TopCandidate,
  TopCandidateDraft,
  addTopCandidate,
  deleteTopCandidate,
  resumeProblem,
  resumeUrl,
  subscribeTopCandidates,
  updateTopCandidate,
} from "../lib/topCandidates";
import "./TopCandidates.css";

/** What the ☆ button on a pool row hands over. */
export type TopPrefill = Partial<TopCandidateDraft> | null;

type Dialog = { mode: "add"; prefill: Partial<TopCandidateDraft> } | { mode: "edit"; row: TopCandidate } | null;

const fmtDate = (r: TopCandidate) =>
  r.createdAt ? r.createdAt.toDate().toLocaleDateString(undefined, { dateStyle: "medium" }) : "Just now";

export default function TopCandidates({
  prefill,
  onPrefillUsed,
  onCountChange,
}: {
  prefill: TopPrefill;
  onPrefillUsed: () => void;
  onCountChange?: (n: number) => void;
}) {
  const { user, profile } = useAuth();
  const me = user?.email ?? "";
  const role = (profile as unknown as { role?: string } | null)?.role ?? "";
  const isLead = role === "admin" || role === "manager";

  const [rows, setRows] = useState<TopCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeTopCandidates(
        (r) => { setRows(r); setError(null); onCountChange?.(r.length); },
        (e) => setError(friendlyError(e))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // A ☆ click on the pool opens the add form, filled in from that row.
  useEffect(() => {
    if (!prefill) return;
    setDialog({ mode: "add", prefill });
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) =>
      `${r.name} ${r.role} ${r.email} ${r.phone} ${r.submittedBy} ${r.notes}`.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const canChange = (r: TopCandidate) => isLead || r.addedBy.toLowerCase() === me.toLowerCase();

  const openResume = async (r: TopCandidate) => {
    // Open the tab inside the click, so pop-up blockers allow it; fill in the URL once it arrives.
    const tab = window.open("", "_blank");
    setOpening(r.id);
    try {
      const url = await resumeUrl(r);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(friendlyError(e));
    } finally {
      setOpening(null);
    }
  };

  const remove = async (r: TopCandidate) => {
    if (!window.confirm(`Remove ${r.name} from Top candidates? Their uploaded resume is deleted too.`)) return;
    try {
      await deleteTopCandidate(r);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <div className="card">
      <div className="tc-toolbar">
        <input
          className="tc-search"
          placeholder="🔍  Search top candidates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => setDialog({ mode: "add", prefill: {} })}>+ Add top candidate</button>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
        Your team&#39;s shortlist. Add someone here, or click <strong>☆</strong> on any row in <em>All candidates</em>.
      </p>

      {error && <div className="alert error" style={{ marginBottom: "0.6rem" }}>{error}</div>}

      {rows === null && !error ? (
        <div className="center-load" style={{ minHeight: "20vh" }}><div className="spinner dark" /></div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: "62vh" }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Candidate</th>
                <th>Role</th>
                <th>Resume</th>
                <th>Notes</th>
                <th>Added</th>
                <th style={{ width: 1 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.id}>
                  <td className="muted">{i + 1}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    {(r.email || r.phone) && (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>{[r.email, r.phone].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{r.role || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.resumePath ? (
                      <button type="button" className="tc-link" onClick={() => openResume(r)} disabled={opening === r.id} title={r.resumeName ?? undefined}>
                        {opening === r.id ? <span className="spinner dark" /> : "📄"} View resume
                      </button>
                    ) : canChange(r) ? (
                      <button type="button" className="tc-link" onClick={() => setDialog({ mode: "edit", row: r })}>+ Upload</button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "normal", maxWidth: 260 }} className="tc-notes" title={r.notes}>{r.notes || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }} title={r.addedBy ? `Added by ${r.addedBy}` : undefined}>{fmtDate(r)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canChange(r) && (
                      <>
                        <button type="button" className="tc-link" onClick={() => setDialog({ mode: "edit", row: r })}>Edit</button>
                        <button type="button" className="tc-link danger" onClick={() => remove(r)}>Remove</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "1.75rem", color: "var(--muted)" }}>
                    {search ? "No top candidates match your search." : "No top candidates yet. Click “+ Add top candidate” or the ☆ on any candidate."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <TopCandidateDialog
          key={dialog.mode === "edit" ? dialog.row.id : "add"}
          current={dialog.mode === "edit" ? dialog.row : null}
          prefill={dialog.mode === "add" ? dialog.prefill : {}}
          me={me}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TopCandidateDialog({
  current,
  prefill,
  me,
  onClose,
}: {
  current: TopCandidate | null;
  prefill: Partial<TopCandidateDraft>;
  me: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<TopCandidateDraft>(() => ({
    name: current?.name ?? prefill.name ?? "",
    role: current?.role ?? prefill.role ?? "",
    email: current?.email ?? prefill.email ?? "",
    phone: current?.phone ?? prefill.phone ?? "",
    // No longer shown or edited; kept so existing records and ☆ prefills don't lose it.
    submittedBy: current?.submittedBy ?? prefill.submittedBy ?? "",
    notes: current?.notes ?? prefill.notes ?? "",
  }));
  const [file, setFile] = useState<File | null>(null);
  const [removeResume, setRemoveResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = <K extends keyof TopCandidateDraft>(k: K, v: string) => setD((x) => ({ ...x, [k]: v }));

  const pick = (f: File | null) => {
    if (!f) return;
    const problem = resumeProblem(f);
    if (problem) {
      setErr(problem);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setErr(null);
    setFile(f);
    setRemoveResume(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!d.name.trim()) { setErr("Enter the candidate's name."); return; }
    if (!d.role.trim()) { setErr("Enter the role."); return; }
    setBusy(true);
    setErr(null);
    try {
      if (current) await updateTopCandidate(current, d, { resume: file, removeResume });
      else await addTopCandidate(d, me, file);
      onClose();
    } catch (e2) {
      setErr(friendlyError(e2));
      setBusy(false);
    }
  };

  const existing = current?.resumePath && !removeResume && !file ? current.resumeName : null;

  return (
    <div className="tc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="tc-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label={current ? "Edit top candidate" : "Add top candidate"}>
        <div className="tc-modal-head">
          <h3 style={{ margin: 0 }}>{current ? "Edit top candidate" : "⭐ Add top candidate"}</h3>
          <button type="button" className="tc-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <div className="alert error" style={{ margin: "0 0 0.75rem" }}>{err}</div>}

        <div className="tc-grid">
          <label className="tc-field">
            <span>Candidate name <em>*</em></span>
            <input className="tc-input" type="text" value={d.name} autoFocus maxLength={200} onChange={(e) => set("name", e.target.value)} placeholder="Full name" />
          </label>
          <label className="tc-field">
            <span>Role <em>*</em></span>
            <input className="tc-input" type="text" value={d.role} maxLength={200} onChange={(e) => set("role", e.target.value)} placeholder="e.g. Senior Java Developer" />
          </label>
          <label className="tc-field">
            <span>Email</span>
            <input className="tc-input" type="email" value={d.email} maxLength={200} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" />
          </label>
          <label className="tc-field">
            <span>Phone</span>
            <input className="tc-input" type="tel" value={d.phone} maxLength={50} onChange={(e) => set("phone", e.target.value)} placeholder="+1 555 123 4567" />
          </label>
          <div className="tc-field tc-span2">
            <span>Resume</span>
            <div className="tc-file">
              <button type="button" className="btn ghost tc-file-btn" onClick={() => fileRef.current?.click()}>📎 {file || existing ? "Replace file" : "Choose file"}</button>
              <span className="tc-file-name" title={file?.name ?? existing ?? undefined}>
                {file ? file.name : existing ? existing : removeResume ? "Will be removed on save" : "PDF or Word, up to 10 MB"}
              </span>
              {existing && <button type="button" className="tc-link danger" onClick={() => setRemoveResume(true)}>Remove</button>}
              <input ref={fileRef} type="file" accept={RESUME_ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </div>
          </div>
        </div>

        <label className="tc-field">
          <span>Notes</span>
          <textarea className="tc-input" rows={3} value={d.notes} maxLength={2000} onChange={(e) => set("notes", e.target.value)} placeholder="Why they're a top candidate, availability, rate, visa…" />
        </label>

        <div className="tc-modal-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? <span className="spinner" /> : current ? "Save" : "Add to Top candidates"}
          </button>
        </div>
      </form>
    </div>
  );
}