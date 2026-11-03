// Work Board — Jira-style issues (stories, tasks, bugs, epics) for the team.
//
// Issues live in the `boardIssues` collection and are written straight from the
// browser, on the same reasoning as `holidays`: the checks are "is this person
// staff" plus a shape check, which is what firestore.rules is for, and a Cloud
// Run service per write would cost CPU quota this project has run out of before.
//
// Ordering: every issue carries a numeric `order`. Moving a card gives it the
// midpoint between its new neighbours, so a move is one write to one document
// instead of renumbering a whole column.

import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";

export type IssueType = "story" | "task" | "bug" | "epic";
export type IssueStatus = "todo" | "in_progress" | "in_review" | "done";
export type IssuePriority = "highest" | "high" | "medium" | "low";

export interface Issue {
  id: string;
  key: string; // CLF-12 — assigned once at creation, never changes
  title: string;
  description: string;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority;
  assignee: string | null; // lower-cased email
  reporter: string; // email of the creator, exactly as in their auth token
  storyPoints: number | null;
  dueDate: string | null; // yyyy-mm-dd
  labels: string[];
  order: number;
  commentCount: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** A comment on an issue — boardIssues/{id}/comments. */
export interface IssueComment {
  id: string;
  text: string;
  author: string; // email exactly as in the author's auth token
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
}

/** One field that changed. Values are stored as display-ready strings; null means "empty". */
export interface ActivityChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** An entry in an issue's history — boardIssues/{id}/activity. Written once, never edited. */
export type ActivityAction = "created" | "updated" | "moved" | "commented" | "comment_edited" | "comment_deleted";
export const ACTIVITY_ACTIONS: ActivityAction[] = ["created", "updated", "moved", "commented", "comment_edited", "comment_deleted"];

export interface IssueActivity {
  id: string;
  actor: string;
  action: ActivityAction;
  changes: ActivityChange[];
  createdAt: Timestamp | null;
}

/** The fields a person edits in the create/edit dialog. */
export type IssueDraft = Pick<
  Issue,
  "title" | "description" | "type" | "status" | "priority" | "assignee" | "storyPoints" | "dueDate" | "labels"
>;

export const KEY_PREFIX = "CLF";
export const ORDER_STEP = 1024;
export const STORY_POINTS = [1, 2, 3, 5, 8, 13];

export const COLUMNS: { key: IssueStatus; label: string; color: string }[] = [
  { key: "todo", label: "To Do", color: "var(--c-slate)" },
  { key: "in_progress", label: "In Progress", color: "var(--c-blue)" },
  { key: "in_review", label: "In Review", color: "var(--c-amber)" },
  { key: "done", label: "Done", color: "var(--c-emerald)" },
];

export const TYPE_META: Record<IssueType, { label: string; icon: string; color: string }> = {
  story: { label: "Story", icon: "📗", color: "var(--c-emerald)" },
  task: { label: "Task", icon: "☑️", color: "var(--c-blue)" },
  bug: { label: "Bug", icon: "🐞", color: "var(--c-red)" },
  epic: { label: "Epic", icon: "⚡", color: "#7c3aed" },
};

export const PRIORITY_META: Record<IssuePriority, { label: string; icon: string; color: string }> = {
  highest: { label: "Highest", icon: "⇈", color: "var(--c-red)" },
  high: { label: "High", icon: "↑", color: "var(--c-amber)" },
  medium: { label: "Medium", icon: "=", color: "var(--c-blue)" },
  low: { label: "Low", icon: "↓", color: "var(--c-slate)" },
};

const ISSUES = collection(db, "boardIssues");
// Holds the next issue number so keys never repeat, even after deletes.
const COUNTER = doc(db, "boardMeta", "counter");

const TYPES = Object.keys(TYPE_META) as IssueType[];
const STATUSES = COLUMNS.map((c) => c.key);
const PRIORITIES = Object.keys(PRIORITY_META) as IssuePriority[];

// Documents are read defensively: a hand-edited or half-written document
// should render as a plain card, not take the whole board down.
function fromDoc(id: string, d: Record<string, unknown>): Issue {
  return {
    id,
    key: typeof d.key === "string" ? d.key : "—",
    title: typeof d.title === "string" ? d.title : "(untitled)",
    description: typeof d.description === "string" ? d.description : "",
    type: TYPES.includes(d.type as IssueType) ? (d.type as IssueType) : "task",
    status: STATUSES.includes(d.status as IssueStatus) ? (d.status as IssueStatus) : "todo",
    priority: PRIORITIES.includes(d.priority as IssuePriority) ? (d.priority as IssuePriority) : "medium",
    assignee: typeof d.assignee === "string" && d.assignee ? d.assignee : null,
    reporter: typeof d.reporter === "string" ? d.reporter : "",
    storyPoints: typeof d.storyPoints === "number" ? d.storyPoints : null,
    dueDate: typeof d.dueDate === "string" && d.dueDate ? d.dueDate : null,
    labels: Array.isArray(d.labels) ? d.labels.filter((l): l is string => typeof l === "string") : [],
    order: typeof d.order === "number" ? d.order : 0,
    commentCount: typeof d.commentCount === "number" ? Math.max(0, d.commentCount) : 0,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt : null,
    updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt : null,
  };
}

// Firestore rejects `undefined`, so every optional field becomes null here.
function clean(d: IssueDraft) {
  return {
    title: d.title.trim().slice(0, 200),
    description: d.description.trim().slice(0, 10000),
    type: d.type,
    status: d.status,
    priority: d.priority,
    assignee: d.assignee?.trim().toLowerCase() || null,
    storyPoints: d.storyPoints ?? null,
    dueDate: d.dueDate || null,
    labels: Array.from(new Set(d.labels.map((l) => l.trim()).filter(Boolean))).slice(0, 10),
  };
}

/** Live list of every issue, sorted by board order. Returns the unsubscribe function. */
export function subscribeIssues(onData: (issues: Issue[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    query(ISSUES, orderBy("order")),
    (snap) => onData(snap.docs.map((d) => fromDoc(d.id, d.data()))),
    onError
  );
}

/** Creates an issue with the next CLF-n key. The counter and the issue are written in one transaction. */
export async function createIssue(draft: IssueDraft, reporter: string, order: number): Promise<string> {
  const ref = doc(ISSUES);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER);
    const n = snap.exists() ? Number(snap.data().next) || 1 : 1;
    tx.set(COUNTER, { next: n + 1 });
    tx.set(ref, {
      ...clean(draft),
      key: `${KEY_PREFIX}-${n}`,
      reporter,
      order,
      commentCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(doc(activityCol(ref.id)), { actor: reporter, action: "created", changes: [], createdAt: serverTimestamp() });
  });
  return ref.id;
}

/**
 * Saves the dialog's fields and records what changed in the issue's history.
 * Pass `order` when the status changed so the card lands at the end of its new column.
 */
export async function updateIssue(id: string, draft: IssueDraft, before: Issue, actor: string, order?: number): Promise<void> {
  const changes = diffIssue(before, draft);
  const batch = writeBatch(db);
  batch.update(doc(ISSUES, id), {
    ...clean(draft),
    ...(order != null ? { order } : {}),
    updatedAt: serverTimestamp(),
  });
  if (changes.length) {
    batch.set(doc(activityCol(id)), { actor, action: "updated", changes, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

/** A drag-and-drop move. Changing column is logged; reordering within a column is not. */
export async function moveIssue(id: string, status: IssueStatus, order: number, fromStatus: IssueStatus, actor: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(ISSUES, id), { status, order, updatedAt: serverTimestamp() });
  if (fromStatus !== status) {
    batch.set(doc(activityCol(id)), {
      actor,
      action: "moved",
      changes: [{ field: "status", from: fromStatus, to: status }],
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

// ---- History -----------------------------------------------------------------

const activityCol = (issueId: string) => collection(db, "boardIssues", issueId, "activity");
const commentsCol = (issueId: string) => collection(db, "boardIssues", issueId, "comments");

const asText = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
};

/** Long text is kept in the history as a short excerpt, so the log stays small. */
const SNIPPET = 300;
const snippet = (t: string): string | null => {
  const x = t.trim().replace(/\s+/g, " ");
  if (!x) return null;
  return x.length > SNIPPET ? `${x.slice(0, SNIPPET)}…` : x;
};

/** Fields whose before/after values are recorded on every save. */
const TRACKED: (keyof IssueDraft)[] = ["title", "type", "status", "priority", "assignee", "storyPoints", "dueDate", "labels"];

function diffIssue(before: Issue, draft: IssueDraft): ActivityChange[] {
  const after = clean(draft);
  const out: ActivityChange[] = [];
  for (const f of TRACKED) {
    const a = asText(before[f]);
    const b = asText(after[f]);
    if (a !== b) out.push({ field: f, from: a, to: b });
  }
  if (before.description.trim() !== after.description) {
    out.push({ field: "description", from: snippet(before.description), to: snippet(after.description) });
  }
  return out;
}

function activityFromDoc(id: string, d: Record<string, unknown>): IssueActivity {
  const changes = Array.isArray(d.changes)
    ? d.changes
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({ field: String(c.field ?? ""), from: asText(c.from), to: asText(c.to) }))
    : [];
  const action = ACTIVITY_ACTIONS.includes(d.action as ActivityAction) ? (d.action as ActivityAction) : "updated";
  return {
    id,
    actor: typeof d.actor === "string" ? d.actor : "",
    action,
    changes,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt : null,
  };
}

/** Live history of one issue, newest first. */
export function subscribeActivity(issueId: string, onData: (a: IssueActivity[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    query(activityCol(issueId), orderBy("createdAt", "desc")),
    (snap) => onData(snap.docs.map((d) => activityFromDoc(d.id, d.data()))),
    onError
  );
}

// ---- Comments ----------------------------------------------------------------

export const COMMENT_MAX = 5000;

/** Live comments on one issue, oldest first (reads like a conversation). */
export function subscribeComments(issueId: string, onData: (c: IssueComment[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    query(commentsCol(issueId), orderBy("createdAt")),
    (snap) =>
      onData(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            text: typeof x.text === "string" ? x.text : "",
            author: typeof x.author === "string" ? x.author : "",
            createdAt: x.createdAt instanceof Timestamp ? x.createdAt : null,
            editedAt: x.editedAt instanceof Timestamp ? x.editedAt : null,
          };
        })
      ),
    onError
  );
}

const logEntry = (issueId: string, actor: string, action: ActivityAction, changes: ActivityChange[]) => [
  doc(activityCol(issueId)),
  { actor, action, changes, createdAt: serverTimestamp() },
] as const;

/** Adds a comment, bumps the card's comment count and records it in History — one write. */
export async function addComment(issueId: string, text: string, author: string): Promise<void> {
  const body = text.trim().slice(0, COMMENT_MAX);
  if (!body) return;
  const batch = writeBatch(db);
  batch.set(doc(commentsCol(issueId)), { text: body, author, createdAt: serverTimestamp() });
  batch.update(doc(ISSUES, issueId), { commentCount: increment(1), updatedAt: serverTimestamp() });
  batch.set(...logEntry(issueId, author, "commented", [{ field: "comment", from: null, to: snippet(body) }]));
  await batch.commit();
}

/** Edits your own comment; History keeps the old and new wording. */
export async function editComment(issueId: string, comment: IssueComment, text: string, actor: string): Promise<void> {
  const body = text.trim().slice(0, COMMENT_MAX);
  if (!body || body === comment.text) return;
  const batch = writeBatch(db);
  batch.update(doc(commentsCol(issueId), comment.id), { text: body, editedAt: serverTimestamp() });
  batch.set(...logEntry(issueId, actor, "comment_edited", [{ field: "comment", from: snippet(comment.text), to: snippet(body) }]));
  await batch.commit();
}

/** Deletes a comment. History keeps what it said and whose it was, so nothing disappears silently. */
export async function deleteComment(issueId: string, comment: IssueComment, actor: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(commentsCol(issueId), comment.id));
  batch.update(doc(ISSUES, issueId), { commentCount: increment(-1) });
  batch.set(...logEntry(issueId, actor, "comment_deleted", [{ field: comment.author, from: snippet(comment.text), to: null }]));
  await batch.commit();
}

export function deleteIssue(id: string): Promise<void> {
  return deleteDoc(doc(ISSUES, id));
}

/** An order value that sorts between two neighbours (either may be missing at a column edge). */
export function orderBetween(prev?: number, next?: number): number {
  if (prev == null && next == null) return ORDER_STEP;
  if (prev == null) return next! - ORDER_STEP;
  if (next == null) return prev + ORDER_STEP;
  return (prev + next) / 2;
}