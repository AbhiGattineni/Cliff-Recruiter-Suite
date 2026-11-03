// Comments and history for one Work Board issue, shown under the edit dialog.

import { useEffect, useState, type KeyboardEvent } from "react";
import type { Timestamp } from "firebase/firestore";
import { friendlyError } from "../lib/errors";
import {
  COLUMNS,
  COMMENT_MAX,
  PRIORITY_META,
  TYPE_META,
  ActivityChange,
  IssueActivity,
  IssueComment,
  IssuePriority,
  IssueStatus,
  IssueType,
  addComment,
  deleteComment,
  editComment,
  subscribeActivity,
  subscribeComments,
} from "../lib/board";

type Tab = "comments" | "history";

const ACTION_ICON: Record<string, string> = {
  created: "✨", updated: "✏️", moved: "➡️", commented: "💬", comment_edited: "📝", comment_deleted: "🗑️",
};

const initials = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";

function ago(ts: Timestamp | null): string {
  if (!ts) return "just now";
  const s = (Date.now() - ts.toMillis()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return ts.toDate().toLocaleDateString();
}
const fullDate = (ts: Timestamp | null) => (ts ? ts.toDate().toLocaleString() : "");
/** "Nov 3, 2026, 12:41 PM · 5m ago" — the exact time, plus how long ago at a glance. */
const stamp = (ts: Timestamp | null): string => {
  if (!ts) return "Just now";
  const when = ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${when} · ${ago(ts)}`;
};

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  type: "Type",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  storyPoints: "Story points",
  dueDate: "Due date",
  labels: "Labels",
};

export default function WorkBoardActivity({
  issueId,
  actor,
  canModerate,
  nameOf,
}: {
  issueId: string;
  actor: string; // signed-in user's email as in their token
  canModerate: boolean; // admins/managers may delete anyone's comment
  nameOf: (email: string) => string;
}) {
  const [tab, setTab] = useState<Tab>("comments");
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [history, setHistory] = useState<IssueActivity[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => subscribeComments(issueId, setComments, (e) => setErr(friendlyError(e))), [issueId]);
  useEffect(() => subscribeActivity(issueId, setHistory, (e) => setErr(friendlyError(e))), [issueId]);

  const me = actor.toLowerCase();
  const display = (email: string) => (email ? nameOf(email.toLowerCase()) : "Someone");

  const post = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    setErr(null);
    try {
      await addComment(issueId, text, actor);
      setText("");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (c: IssueComment) => {
    if (!editText.trim()) return;
    try {
      await editComment(issueId, c, editText, actor);
      setEditingId(null);
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  const remove = async (c: IssueComment) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await deleteComment(issueId, c, actor);
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  // Cmd/Ctrl + Enter posts. Plain Enter is a new line. Either way it must not submit the edit form around us.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, run: () => void) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  };

  const valueText = (field: string, v: string | null): string => {
    if (v == null) return field === "assignee" ? "Unassigned" : "none";
    if (field === "status") return COLUMNS.find((c) => c.key === (v as IssueStatus))?.label ?? v;
    if (field === "type") return TYPE_META[v as IssueType]?.label ?? v;
    if (field === "priority") return PRIORITY_META[v as IssuePriority]?.label ?? v;
    if (field === "assignee") return nameOf(v.toLowerCase());
    return v;
  };

  const quote = (t: string | null, struck = false) =>
    t ? <div className={`wb-hist-quote${struck ? " struck" : ""}`}>{t}</div> : <div className="wb-hist-quote empty">(empty)</div>;

  const changeLine = (c: ActivityChange) => {
    if (c.field === "description") {
      return (
        <>
          updated the <strong>Description</strong>
          <div className="wb-hist-diff">
            <span className="muted">Before</span>{quote(c.from, true)}
            <span className="muted">After</span>{quote(c.to)}
          </div>
        </>
      );
    }
    if (c.field === "title") return <>renamed the issue from <em>“{c.from ?? ""}”</em> to <em>“{c.to ?? ""}”</em></>;
    return (
      <>
        changed <strong>{FIELD_LABEL[c.field] ?? c.field}</strong>{" "}
        <span className="wb-hist-from">{valueText(c.field, c.from)}</span> → <span className="wb-hist-to">{valueText(c.field, c.to)}</span>
      </>
    );
  };

  return (
    <section className="wb-activity">
      <div className="wb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "on" : ""} onClick={() => setTab("comments")}>
          💬 Comments{comments?.length ? ` (${comments.length})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
          🕘 History
        </button>
      </div>

      {err && <div className="alert error" style={{ margin: "0.5rem 0" }}>{err}</div>}

      {tab === "comments" ? (
        <>
          <div className="wb-comment-new">
            <span className="wb-avatar">{initials(display(actor))}</span>
            <div style={{ flex: 1 }}>
              <textarea
                rows={2}
                value={text}
                maxLength={COMMENT_MAX}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => onKey(e, post)}
                placeholder="Add a comment…  (⌘ + Enter to post)"
              />
              {text.trim() && (
                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.35rem" }}>
                  <button type="button" className="btn" style={{ padding: "0.3rem 0.8rem" }} onClick={post} disabled={posting}>
                    {posting ? <span className="spinner" /> : "Comment"}
                  </button>
                  <button type="button" className="btn ghost" style={{ padding: "0.3rem 0.8rem" }} onClick={() => setText("")}>Cancel</button>
                </div>
              )}
            </div>
          </div>

          {comments === null ? (
            <div className="muted wb-act-empty">Loading…</div>
          ) : comments.length === 0 ? (
            <div className="muted wb-act-empty">No comments yet.</div>
          ) : (
            <ul className="wb-comments">
              {comments.map((c) => {
                const mine = c.author.toLowerCase() === me;
                return (
                  <li key={c.id}>
                    <span className="wb-avatar">{initials(display(c.author))}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="wb-comment-head">
                        <strong>{display(c.author)}</strong>
                        <span className="muted" title={fullDate(c.createdAt)}>{stamp(c.createdAt)}</span>
                        {c.editedAt && <span className="muted" title={fullDate(c.editedAt)}>· edited {stamp(c.editedAt)}</span>}
                      </div>
                      {editingId === c.id ? (
                        <>
                          <textarea
                            rows={3}
                            autoFocus
                            value={editText}
                            maxLength={COMMENT_MAX}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => onKey(e, () => saveEdit(c))}
                          />
                          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.35rem" }}>
                            <button type="button" className="btn" style={{ padding: "0.3rem 0.8rem" }} onClick={() => saveEdit(c)}>Save</button>
                            <button type="button" className="btn ghost" style={{ padding: "0.3rem 0.8rem" }} onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <div className="wb-comment-body">{c.text}</div>
                      )}
                      {editingId !== c.id && (mine || canModerate) && (
                        <div className="wb-comment-actions">
                          {mine && <button type="button" onClick={() => { setEditingId(c.id); setEditText(c.text); }}>Edit</button>}
                          <button type="button" onClick={() => remove(c)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : history === null ? (
        <div className="muted wb-act-empty">Loading…</div>
      ) : history.length === 0 ? (
        <div className="muted wb-act-empty">No history yet. Every change, comment, edit and deletion from now on is recorded here.</div>
      ) : (
        <ul className="wb-history">
          {history.map((h) => (
            <li key={h.id}>
              <span className="wb-hist-icon" aria-hidden>{ACTION_ICON[h.action] ?? "•"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {h.action === "created" ? (
                  <div><strong>{display(h.actor)}</strong> created this issue</div>
                ) : h.action === "commented" ? (
                  <div><strong>{display(h.actor)}</strong> added a <strong>comment</strong>{quote(h.changes[0]?.to ?? null)}</div>
                ) : h.action === "comment_edited" ? (
                  <div>
                    <strong>{display(h.actor)}</strong> edited a <strong>comment</strong>
                    <div className="wb-hist-diff">
                      <span className="muted">Before</span>{quote(h.changes[0]?.from ?? null, true)}
                      <span className="muted">After</span>{quote(h.changes[0]?.to ?? null)}
                    </div>
                  </div>
                ) : h.action === "comment_deleted" ? (
                  <div>
                    <strong>{display(h.actor)}</strong> deleted {h.changes[0]?.field && h.changes[0].field.toLowerCase() !== h.actor.toLowerCase()
                      ? <>{display(h.changes[0].field)}&#39;s</> : "a"} <strong>comment</strong>
                    {quote(h.changes[0]?.from ?? null, true)}
                  </div>
                ) : (
                  h.changes.map((c, i) => (
                    <div key={i}><strong>{display(h.actor)}</strong> {changeLine(c)}</div>
                  ))
                )}
                <div className="wb-hist-time" title={fullDate(h.createdAt)}>🕒 {stamp(h.createdAt)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}