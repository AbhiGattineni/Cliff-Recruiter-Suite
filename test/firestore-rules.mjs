// firestore.rules, run against the emulator.
//
// These rules are a language with its own semantics, and reading them is not
// the same as running them. Deactivation shipped as `myProfile().active ==
// false`, which looks obviously right and is not: reading a field a document
// does not have is an EVALUATION ERROR in this language rather than null, and
// the rule then denies. Every profile written before `active` existed had no
// such field, so the whole app answered "Missing or insufficient permissions"
// — to admins included — until `get("active", true)` replaced it.
//
// So the thing worth pinning is not the happy path. It is that a profile with
// NO `active` field still passes every check, which is what no amount of
// re-reading the rule established.
//
// Needs Java and the Firestore emulator: `npm run test:rules`. It is not part
// of `npm test` for that reason.
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "rules-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
});

// Seed profiles straight past the rules.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // The shape every existing account actually has: no `active` field at all.
  await setDoc(doc(db, "userProfiles/legacyAdmin"), { email: "a@cliff-services.com", role: "admin" });
  await setDoc(doc(db, "userProfiles/legacyEmployee"), { email: "e@cliff-services.com", role: "employee" });
  await setDoc(doc(db, "userProfiles/newBenchSales"), { email: "b@cliff-services.com", role: "benchsales", active: true });
  await setDoc(doc(db, "userProfiles/goneEmployee"), { email: "g@cliff-services.com", role: "employee", active: false });
  await setDoc(doc(db, "timesheetEntries/legacyEmployee_2026-10-02"), { uid: "legacyEmployee", date: "2026-10-02", hours: 9 });
  await setDoc(doc(db, "timesheetEntries/goneEmployee_2026-10-02"), { uid: "goneEmployee", date: "2026-10-02", hours: 9 });
  await setDoc(doc(db, "timesheetEntries/newBenchSales_2026-10-02"), { uid: "newBenchSales", date: "2026-10-02", hours: 9 });
});

const fs = (uid) => env.authenticatedContext(uid).firestore();
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + " — " + (e.message || e)); }
};

console.log("a profile with no `active` field (what every existing account looks like):");
await check("admin can list the roster", () => assertSucceeds(getDocs(collection(fs("legacyAdmin"), "userProfiles"))));
await check("employee can read their own timesheet entries", () =>
  assertSucceeds(getDoc(doc(fs("legacyEmployee"), "timesheetEntries/legacyEmployee_2026-10-02"))));
await check("employee still cannot list the roster", () =>
  assertFails(getDocs(collection(fs("legacyEmployee"), "userProfiles"))));

console.log("the new role:");
await check("bench sales counts as staff for their OWN entries", () =>
  assertSucceeds(getDoc(doc(fs("newBenchSales"), "timesheetEntries/newBenchSales_2026-10-02"))));
await check("bench sales still cannot read someone else's entries", () =>
  assertFails(getDoc(doc(fs("newBenchSales"), "timesheetEntries/legacyEmployee_2026-10-02"))));
await check("admin can read anyone's entries", () =>
  assertSucceeds(getDoc(doc(fs("legacyAdmin"), "timesheetEntries/legacyEmployee_2026-10-02"))));

console.log("a deactivated account:");
await check("cannot read even their own timesheet entries", () =>
  assertFails(getDoc(doc(fs("goneEmployee"), "timesheetEntries/goneEmployee_2026-10-02"))));
await check("cannot list the roster", () =>
  assertFails(getDocs(collection(fs("goneEmployee"), "userProfiles"))));
await check("CAN still read their own profile, so the app can say why", () =>
  assertSucceeds(getDoc(doc(fs("goneEmployee"), "userProfiles/goneEmployee"))));

await env.cleanup();
console.log(failures === 0 ? "\nALL RULES CHECKS PASSED" : `\n${failures} RULES CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
