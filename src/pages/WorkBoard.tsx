import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";
import {
  COLUMNS,
  PRIORITY_META,
  STORY_POINTS,
  TYPE_META,
  Issue,
  IssueDraft,
  IssuePriority,
  IssueStatus,
  IssueType,
  createIssue,
  deleteIssue,
  moveIssue,
  orderBetween,
  subscribeIssues,
  updateIssue,
} from "../lib/board";
import { StaffMember, subscribeDirectory } from "../lib/staffDirectory";
import "./WorkBoard.css";

type Dialog = { mode: "create"; status: IssueStatus } | { mode: "edit"; issue: Issue } | null;
type DropTarget = { status: IssueStatus; beforeId: string | null } | null;

const today = () => new Date().toISOString().slice(0, 10);
const initials = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
const fallbackName = (email: string) =>
  email.split("@")[0].split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");

/** One selectable person: everyone in the staff directory, plus anyone already assigned who has since left it. */
type Person = { email: string; name: string; inDirectory: boolean };

export default function WorkBoard() {
  const { user } = useAuth();
  const me = (user?.email ?? "").toLowerCase();

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all"); // all | me | unassigned | email
  const [typeFilter, setTypeFilter] = useState<IssueType | "all">("all");

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget>(null);

  // Staff directory for the assignee dropdown. If it can't be read (rules not
  // deployed yet), the board still works with the people found on issues.
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => subscribeDirectory(setStaff, () => setStaff([])), []);

  useEffect(
    () =>
      subscribeIssues(
        (list) => {
          setIssues(list);
          setError(null);
        },
        (e) => setError(friendlyError(e))
      ),
    []
  );

  const people = useMemo<Person[]>(() => {
    const m = new Map<string, Person>();
    for (const s of staff) m.set(s.email, { email: s.email, name: s.name, inDirectory: true });
    const extra = [me, ...(issues ?? []).map((i) => i.assignee)];
    for (const e of extra) if (e && !m.has(e)) m.set(e, { email: e, name: fallbackName(e), inDirectory: false });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, issues, me]);

  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.email, p.name]));
    return (email: string) => m.get(email) ?? fallbackName(email);
  }, [people]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (issues ?? []).filter((i) => {
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (assigneeFilter === "me" && i.assignee !== me) return false;
      if (assigneeFilter === "unassigned" && i.assignee) return false;
      if (!["all", "me", "unassigned"].includes(assigneeFilter) && i.assignee !== assigneeFilter) return false;
      if (q && !`${i.key} ${i.title} ${i.labels.join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [issues, search, typeFilter, assigneeFilter, me]);

  const byColumn = useMemo(() => {
    const m = new Map<IssueStatus, Issue[]>(COLUMNS.map((c) => [c.key, []]));
    for (const i of visible) m.get(i.status)!.push(i);
    return m;
  }, [visible]);

  const filtersOn = !!search || assigneeFilter !== "all" || typeFilter !== "all";

  // ---- ordering helpers (always against the FULL column, not the filtered view) ----
  const columnOf = (status: IssueStatus, excludeId?: string) =>
    (issues ?? []).filter((i) => i.status === status && i.id !== excludeId).sort((a, b) => a.order - b.order);

  const endOrder = (status: IssueStatus, excludeId?: string) => {
    const col = columnOf(status, excludeId);
    return orderBetween(col[col.length - 1]?.order, undefined);
  };

  // ---- drag and drop ----
  const onDrop = async (status: IssueStatus, beforeId: string | null) => {
    const id = dragId;
    setDragId(null);
    setDrop(null);
    if (!id || !issues) return;
    const moving = issues.find((i) => i.id === id);
    if (!moving) return;

    const col = columnOf(status, id);
    let order: number;
    if (beforeId && beforeId !== id) {
      const idx = col.findIndex((i) => i.id === beforeId);
      order = idx < 0 ? endOrder(status, id) : orderBetween(col[idx - 1]?.order, col[idx].order);
    } else {
      order = endOrder(status, id);
    }
    if (moving.status === status && moving.order === order) return;

    // Optimistic: move it locally now; the snapshot listener confirms or corrects.
    const before = issues;
    setIssues(issues.map((i) => (i.id === id ? { ...i, status, order } : i)).sort((a, b) => a.order - b.order));
    try {
      await moveIssue(id, status, order);
    } catch (e) {
      setIssues(before);
      setError(friendlyError(e));
    }
  };

  // ---- dialog save/delete ----
  const save = async (draft: IssueDraft) => {
    if (!dialog) return;
    if (dialog.mode === "create") {
      await createIssue(draft, user?.email ?? "", endOrder(draft.status));
    } else {
      const moved = draft.status !== dialog.issue.status;
      await updateIssue(dialog.issue.id, draft, moved ? endOrder(draft.status, dialog.issue.id) : undefined);
    }
    setDialog(null);
  };

  const remove = async (issue: Issue) => {
    if (!window.confirm(`Delete ${issue.key} "${issue.title}"? This can't be undone.`)) return;
    await deleteIssue(issue.id);
    setDialog(null);
  };

  return (
    <div className="wb">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Work Board</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            Team stories, tasks and bugs. Drag a card to change its status or position; click it to edit.
          </p>
        </div>
        <button className="btn" onClick={() => setDialog({ mode: "create", status: "todo" })}>
          + Create issue
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card wb-toolbar">
        <input
          className="wb-search"
          placeholder="Search key, title or label…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="wb-chips">
          <button className={`wb-chip${assigneeFilter === "all" ? " on" : ""}`} onClick={() => setAssigneeFilter("all")}>All</button>
          <button className={`wb-chip${assigneeFilter === "me" ? " on" : ""}`} onClick={() => setAssigneeFilter("me")}>Only my issues</button>
          <button className={`wb-chip${assigneeFilter === "unassigned" ? " on" : ""}`} onClick={() => setAssigneeFilter("unassigned")}>Unassigned</button>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <select value={["all", "me", "unassigned"].includes(assigneeFilter) ? "" : assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value || "all")}>
            <option value="">Any assignee</option>
            {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as IssueType | "all")}>
            <option value="all">All types</option>
            {(Object.keys(TYPE_META) as IssueType[]).map((t) => (
              <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>
            ))}
          </select>
        </div>
        {filtersOn && (
          <button className="btn ghost" style={{ padding: "0.4rem 0.7rem" }} onClick={() => { setSearch(""); setAssigneeFilter("all"); setTypeFilter("all"); }}>
            Clear filters
          </button>
        )}
      </div>

      {issues === null && !error ? (
        <div className="center-load" style={{ minHeight: "40vh" }}><div className="spinner dark" /></div>
      ) : (
        <div className="wb-board">
          {COLUMNS.map((col) => {
            const cards = byColumn.get(col.key) ?? [];
            const points = cards.reduce((n, i) => n + (i.storyPoints ?? 0), 0);
            const isTarget = drop?.status === col.key;
            return (
              <section
                key={col.key}
                className={`wb-col${isTarget ? " drop" : ""}`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  // Hovering the empty part of a column means "drop at the end".
                  if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("wb-cards")) {
                    setDrop({ status: col.key, beforeId: null });
                  }
                }}
                onDrop={(e) => { e.preventDefault(); onDrop(col.key, drop?.status === col.key ? drop.beforeId : null); }}
              >
                <header className="wb-col-head">
                  <span className="wb-dot" style={{ background: col.color }} />
                  <span className="wb-col-title">{col.label}</span>
                  <span className="wb-count">{cards.length}</span>
                  {points > 0 && <span className="wb-points" title="Story points in this column">{points} pts</span>}
                  <button className="wb-add" title={`Add to ${col.label}`} onClick={() => setDialog({ mode: "create", status: col.key })}>+</button>
                </header>
                <div className="wb-cards">
                  {cards.map((issue) => (
                    <div key={issue.id}>
                      {isTarget && drop?.beforeId === issue.id && dragId !== issue.id && <div className="wb-drop-line" />}
                      <IssueCard
                        issue={issue}
                        dragging={dragId === issue.id}
                        nameOf={nameOf}
                        onOpen={() => setDialog({ mode: "edit", issue })}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", issue.id);
                          setDragId(issue.id);
                        }}
                        onDragEnd={() => { setDragId(null); setDrop(null); }}
                        onDragOver={(e) => {
                          if (!dragId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          // Top half of a card → drop before it; bottom half → before the next one.
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          const idx = cards.findIndex((c) => c.id === issue.id);
                          const beforeId = after ? cards[idx + 1]?.id ?? null : issue.id;
                          if (drop?.status !== col.key || drop.beforeId !== beforeId) setDrop({ status: col.key, beforeId });
                        }}
                      />
                    </div>
                  ))}
                  {isTarget && drop?.beforeId === null && <div className="wb-drop-line" />}
                  {cards.length === 0 && !isTarget && (
                    <div className="wb-empty">{filtersOn ? "Nothing matches the filters" : "No issues"}</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {dialog && (
        <IssueDialog
          key={dialog.mode === "edit" ? dialog.issue.id : `new-${dialog.status}`}
          initial={dialog.mode === "edit" ? dialog.issue : null}
          defaultStatus={dialog.mode === "create" ? dialog.status : dialog.issue.status}
          people={people}
          me={me}
          onSave={save}
          onDelete={dialog.mode === "edit" ? () => remove(dialog.issue) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function IssueCard({
  issue,
  dragging,
  nameOf,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  issue: Issue;
  dragging: boolean;
  nameOf: (email: string) => string;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
}) {
  const t = TYPE_META[issue.type];
  const p = PRIORITY_META[issue.priority];
  const overdue = !!issue.dueDate && issue.status !== "done" && issue.dueDate < today();
  return (
    <article
      className={`wb-card${dragging ? " dragging" : ""}`}
      style={{ borderLeftColor: t.color }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      tabIndex={0}
      role="button"
      aria-label={`${issue.key} ${issue.title}`}
    >
      <div className={`wb-card-title${issue.status === "done" ? " done" : ""}`}>{issue.title}</div>
      {issue.labels.length > 0 && (
        <div className="wb-labels">
          {issue.labels.map((l) => <span key={l} className="wb-label">{l}</span>)}
        </div>
      )}
      <div className="wb-card-foot">
        <span title={t.label}>{t.icon}</span>
        <span className="wb-key">{issue.key}</span>
        {issue.dueDate && (
          <span className={`wb-due${overdue ? " overdue" : ""}`} title={overdue ? "Overdue" : "Due date"}>
            📅 {issue.dueDate.slice(5).replace("-", "/")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="wb-prio" style={{ color: p.color }} title={`${p.label} priority`}>{p.icon}</span>
        {issue.storyPoints != null && <span className="wb-sp" title="Story points">{issue.storyPoints}</span>}
        {issue.assignee ? (
          <span className="wb-avatar" title={`${nameOf(issue.assignee)} (${issue.assignee})`}>{initials(nameOf(issue.assignee))}</span>
        ) : (
          <span className="wb-avatar empty" title="Unassigned">?</span>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

function IssueDialog({
  initial,
  defaultStatus,
  people,
  me,
  onSave,
  onDelete,
  onClose,
}: {
  initial: Issue | null;
  defaultStatus: IssueStatus;
  people: Person[];
  me: string;
  onSave: (d: IssueDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<IssueDraft>(() => ({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    type: initial?.type ?? "task",
    status: initial?.status ?? defaultStatus,
    priority: initial?.priority ?? "medium",
    assignee: initial?.assignee ?? null,
    storyPoints: initial?.storyPoints ?? null,
    dueDate: initial?.dueDate ?? null,
    labels: initial?.labels ?? [],
  }));
  const [labelText, setLabelText] = useState((initial?.labels ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Live board updates re-render the parent, so onClose is read through a ref:
  // otherwise this effect would re-run and pull focus back to the title.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = <K extends keyof IssueDraft>(k: K, v: IssueDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) { setErr("Give the issue a title."); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSave({ ...draft, labels: labelText.split(",") });
    } catch (e2) {
      setErr(friendlyError(e2));
      setBusy(false);
    }
  };

  const del = async () => {
    if (!onDelete) return;
    setBusy(true);
    try { await onDelete(); } catch (e2) { setErr(friendlyError(e2)); setBusy(false); }
  };

  return (
    <div className="wb-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="wb-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label={initial ? `Edit ${initial.key}` : "Create issue"}>
        <div className="wb-modal-head">
          <h3 style={{ margin: 0 }}>
            {initial ? <><span className="wb-key">{initial.key}</span> Edit issue</> : "Create issue"}
          </h3>
          <button type="button" className="wb-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <div className="alert error" style={{ margin: "0 0 0.75rem" }}>{err}</div>}

        <div className="wb-grid2">
          <div className="field">
            <label>Type</label>
            <select value={draft.type} onChange={(e) => set("type", e.target.value as IssueType)}>
              {(Object.keys(TYPE_META) as IssueType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={draft.status} onChange={(e) => set("status", e.target.value as IssueStatus)}>
              {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Title *</label>
          <input ref={titleRef} value={draft.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Add bench report export to Saved Reports" />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea rows={5} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Details, acceptance criteria, links…" />
        </div>

        <div className="wb-grid2">
          <div className="field">
            <label>Assignee</label>
            <select value={draft.assignee ?? ""} onChange={(e) => set("assignee", e.target.value || null)}>
              <option value="">Unassigned</option>
              {people.filter((p) => p.inDirectory || p.email === draft.assignee || p.email === me).map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name} — {p.email}{p.email === me ? " (me)" : ""}
                </option>
              ))}
            </select>
            {me && draft.assignee !== me && (
              <button type="button" className="wb-link" onClick={() => set("assignee", me)}>Assign to me</button>
            )}
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={draft.priority} onChange={(e) => set("priority", e.target.value as IssuePriority)}>
              {(Object.keys(PRIORITY_META) as IssuePriority[]).map((p) => <option key={p} value={p}>{PRIORITY_META[p].icon} {PRIORITY_META[p].label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Story points</label>
            <select value={draft.storyPoints ?? ""} onChange={(e) => set("storyPoints", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {STORY_POINTS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Due date</label>
            <input type="date" value={draft.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
          </div>
        </div>

        <div className="field">
          <label>Labels <span className="muted" style={{ fontWeight: 400 }}>(comma-separated)</span></label>
          <input value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="frontend, ceipal, urgent" />
        </div>

        {initial && (
          <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.75rem" }}>
            Reported by {initial.reporter || "—"}
            {initial.createdAt && ` · created ${initial.createdAt.toDate().toLocaleDateString()}`}
            {initial.updatedAt && ` · updated ${initial.updatedAt.toDate().toLocaleString()}`}
          </p>
        )}

        <div className="wb-modal-foot">
          {onDelete && (
            <button type="button" className="btn ghost wb-danger" onClick={del} disabled={busy}>Delete</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? <span className="spinner" /> : initial ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
