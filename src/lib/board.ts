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
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    updateDoc,
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
    createdAt: Timestamp | null;
    updatedAt: Timestamp | null;
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return ref.id;
  }
  
  /** Saves the dialog's fields. Pass `order` when the status changed so the card lands at the end of its new column. */
  export function updateIssue(id: string, draft: IssueDraft, order?: number): Promise<void> {
    return updateDoc(doc(ISSUES, id), {
      ...clean(draft),
      ...(order != null ? { order } : {}),
      updatedAt: serverTimestamp(),
    });
  }
  
  /** A drag-and-drop move: new column and/or new position. */
  export function moveIssue(id: string, status: IssueStatus, order: number): Promise<void> {
    return updateDoc(doc(ISSUES, id), { status, order, updatedAt: serverTimestamp() });
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