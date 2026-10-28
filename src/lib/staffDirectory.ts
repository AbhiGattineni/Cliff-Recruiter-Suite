// Staff directory — the list of people a Work Board issue can be assigned to.
//
// Why a separate collection: `userProfiles` can only be listed by admins and
// managers (see firestore.rules), and it holds more than a recruiter should see.
// This collection holds just { email, name } and every member of staff can read it.
//
// How it fills up:
//   1. Every staff member writes their OWN entry each time they open the portal.
//   2. When an admin or manager opens the portal, every active staff profile is
//      copied in and deactivated people are removed, so the list is complete
//      even for people who have not signed in since this shipped.

import { useEffect } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

export interface StaffMember {
  uid: string;
  email: string; // lower-cased
  name: string;
}

const STAFF_ROLES = ["admin", "manager", "employee", "benchsales"];
const DIR = collection(db, "staffDirectory");

const nameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");

// userProfiles was written before this existed, so look for a name under the
// usual field names and fall back to one derived from the email address.
function pickName(d: Record<string, unknown>, email: string): string {
  for (const k of ["displayName", "name", "fullName"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  }
  return nameFromEmail(email);
}

/** Live directory, sorted by name. */
export function subscribeDirectory(onData: (staff: StaffMember[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    DIR,
    (snap) =>
      onData(
        snap.docs
          .map((d) => {
            const x = d.data();
            const email = typeof x.email === "string" ? x.email.toLowerCase() : "";
            return { uid: d.id, email, name: typeof x.name === "string" && x.name ? x.name : nameFromEmail(email) };
          })
          .filter((s) => s.email)
          .sort((a, b) => a.name.localeCompare(b.name))
      ),
    onError
  );
}

async function registerSelf(uid: string, email: string, name: string) {
  await setDoc(doc(DIR, uid), { email: email.toLowerCase(), name: name.slice(0, 120), updatedAt: serverTimestamp() });
}

/** Admin/manager only: mirror active staff profiles into the directory. Writes only what changed. */
async function syncFromProfiles() {
  const [profiles, current] = await Promise.all([
    getDocs(query(collection(db, "userProfiles"), where("role", "in", STAFF_ROLES))),
    getDocs(DIR),
  ]);
  const existing = new Map(current.docs.map((d) => [d.id, d.data()]));
  const batch = writeBatch(db);
  let writes = 0;

  for (const p of profiles.docs) {
    const d = p.data();
    const email = typeof d.email === "string" ? d.email.toLowerCase() : "";
    if (!email) continue;
    const active = d.active !== false; // absent on older profiles means active
    const have = existing.get(p.id);
    if (!active) {
      if (have) { batch.delete(doc(DIR, p.id)); writes++; }
      continue;
    }
    const name = pickName(d, email);
    if (!have || have.email !== email || have.name !== name) {
      batch.set(doc(DIR, p.id), { email, name, updatedAt: serverTimestamp() });
      writes++;
    }
    if (writes >= 450) break; // stay under the 500-op batch limit; the next load picks up the rest
  }
  if (writes) await batch.commit();
}

/**
 * Call once from Layout. Keeps the signed-in person's own entry current and,
 * for admins/managers, the whole list. Failures are swallowed: the directory is
 * a convenience, and the app must work the same without it.
 */
export function useStaffDirectorySync() {
  const { user, profile } = useAuth();
  const role = (profile as unknown as { role?: string } | null)?.role;
  const uid = user?.uid;
  const email = user?.email;

  useEffect(() => {
    if (!uid || !email || !role || !STAFF_ROLES.includes(role)) return;
    const profileData = (profile ?? {}) as unknown as Record<string, unknown>;
    const name = user?.displayName?.trim() || pickName(profileData, email);
    registerSelf(uid, email, name).catch(() => {});
    if (role === "admin" || role === "manager") syncFromProfiles().catch(() => {});
    // Once per sign-in, not on every profile object change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, email, role]);
}