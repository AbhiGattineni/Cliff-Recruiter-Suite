// Top candidates — a shortlist recruiters build by hand on the Candidate Pool page.
//
// Records live in Firestore `topCandidates`; each resume file lives in Firebase
// Storage under topCandidates/{id}/. Written straight from the browser, like the
// Work Board: the checks are "is this person staff" plus a shape check, which is
// exactly what the security rules are for.

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { app, db } from "../firebase";

export interface TopCandidate {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  submittedBy: string; // recruiter's name, as shown in Ceipal / the staff list
  notes: string;
  resumePath: string | null; // Storage path
  resumeName: string | null; // original file name, for display
  addedBy: string; // email of whoever added the record (from their auth token)
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type TopCandidateDraft = Pick<TopCandidate, "name" | "role" | "email" | "phone" | "submittedBy" | "notes">;

export const RESUME_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const RESUME_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};
export const RESUME_ACCEPT = ".pdf,.doc,.docx";

const COL = collection(db, "topCandidates");
const storage = () => getStorage(app);

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function fromDoc(id: string, d: Record<string, unknown>): TopCandidate {
  return {
    id,
    name: str(d.name, 200) || "(no name)",
    role: str(d.role, 200),
    email: str(d.email, 200),
    phone: str(d.phone, 50),
    submittedBy: str(d.submittedBy, 200),
    notes: str(d.notes, 2000),
    resumePath: typeof d.resumePath === "string" && d.resumePath ? d.resumePath : null,
    resumeName: typeof d.resumeName === "string" && d.resumeName ? d.resumeName : null,
    addedBy: str(d.addedBy, 200),
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt : null,
    updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt : null,
  };
}

function clean(d: TopCandidateDraft) {
  return {
    name: d.name.trim().slice(0, 200),
    role: d.role.trim().slice(0, 200),
    email: d.email.trim().toLowerCase().slice(0, 200),
    phone: d.phone.trim().slice(0, 50),
    submittedBy: d.submittedBy.trim().slice(0, 200),
    notes: d.notes.trim().slice(0, 2000),
  };
}

/** Live shortlist, newest first. */
export function subscribeTopCandidates(onData: (rows: TopCandidate[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    query(COL, orderBy("createdAt", "desc")),
    (snap) => onData(snap.docs.map((d) => fromDoc(d.id, d.data()))),
    onError
  );
}

/** Explains a bad file before any upload starts. Returns null when the file is fine. */
export function resumeProblem(file: File): string | null {
  const byName = /\.(pdf|docx?)$/i.test(file.name);
  if (!RESUME_TYPES[file.type] && !byName) return "The resume must be a PDF or Word file (.pdf, .doc, .docx).";
  if (file.size > RESUME_MAX_BYTES) return "The resume is larger than 10 MB.";
  return null;
}

async function uploadResume(id: string, file: File) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "resume";
  const path = `topCandidates/${id}/${Date.now()}-${safe}`;
  await uploadBytes(ref(storage(), path), file, { contentType: file.type || "application/octet-stream" });
  return { resumePath: path, resumeName: file.name.slice(0, 200) };
}

async function removeFile(path: string | null) {
  if (!path) return;
  // A file that is already gone is not worth failing the user's action over.
  await deleteObject(ref(storage(), path)).catch(() => {});
}

/** Adds a candidate. The resume uploads first, so a record never points at a file that isn't there. */
export async function addTopCandidate(draft: TopCandidateDraft, addedBy: string, resume: File | null): Promise<void> {
  const rec = doc(COL);
  const file = resume ? await uploadResume(rec.id, resume) : { resumePath: null, resumeName: null };
  await setDoc(rec, {
    ...clean(draft),
    ...file,
    addedBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Saves edits. Pass a resume to replace the file, or `removeResume` to drop it. */
export async function updateTopCandidate(
  current: TopCandidate,
  draft: TopCandidateDraft,
  opts: { resume?: File | null; removeResume?: boolean } = {}
): Promise<void> {
  let file: Record<string, unknown> | null = null;
  if (opts.resume) file = await uploadResume(current.id, opts.resume);
  else if (opts.removeResume) file = { resumePath: null, resumeName: null };
  await updateDoc(doc(COL, current.id), { ...clean(draft), ...(file ?? {}), updatedAt: serverTimestamp() });
  if (file) await removeFile(current.resumePath); // old file only goes once the record no longer needs it
}

export async function deleteTopCandidate(c: TopCandidate): Promise<void> {
  await deleteDoc(doc(COL, c.id));
  await removeFile(c.resumePath);
}

/** A link to view or download the resume. */
export function resumeUrl(c: TopCandidate): Promise<string> {
  if (!c.resumePath) return Promise.reject(new Error("No resume uploaded."));
  return getDownloadURL(ref(storage(), c.resumePath));
}