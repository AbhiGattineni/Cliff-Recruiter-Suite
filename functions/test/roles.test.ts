import { describe, it, expect } from "vitest";
import {
  isRole, isStaff, STAFF_ROLES, ROLES, roleForNewAccount, cleanBench, splitTotal,
} from "../src/timesheets.js";

describe("roles", () => {
  it("counts a bench sales recruiter as staff", () => {
    // They work here. Only a placed consultant is an outsider.
    expect(isStaff("benchsales")).toBe(true);
    expect(STAFF_ROLES).toContain("benchsales");
    expect(isStaff("consultant")).toBe(false);
  });

  it("recognises every role it offers, and nothing else", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    expect(isRole("bench sales")).toBe(false);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("still starts a staff address as employee, not bench sales", () => {
    // The new role is assigned by an admin, never guessed from an email.
    expect(roleForNewAccount("someone@cliff-services.com")).toBe("employee");
    expect(roleForNewAccount("someone@gmail.com")).toBe("consultant");
  });
});

describe("cleanBench", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    subKey: "anil challa|ramy infotech|vj -2|2026-09-21",
    consultant: "Anil Challa",
    vendor: "Ramy Infotech",
    jobTitle: "VJ -2",
    submittedOn: "2026-09-21",
    hours: 4,
    ...over,
  });

  it("keeps a well-formed row", () => {
    expect(cleanBench([row()])).toEqual([row()]);
  });

  it("drops a row with no key — it identifies no submission", () => {
    expect(cleanBench([row({ subKey: "  " })])).toEqual([]);
  });

  it("merges a repeated submission rather than storing it twice", () => {
    const out = cleanBench([row({ hours: 2 }), row({ hours: 3 })]);
    expect(out).toHaveLength(1);
    expect(out[0].hours).toBe(5);
  });

  it("refuses hours outside a day, naming the consultant", () => {
    expect(() => cleanBench([row({ hours: 0 })])).toThrow(/Anil Challa/);
    expect(() => cleanBench([row({ hours: 25 })])).toThrow(/between 0 and 24/);
    expect(() => cleanBench([row({ hours: "abc" })])).toThrow();
  });

  it("is empty for anything that isn't a list", () => {
    expect(cleanBench(undefined)).toEqual([]);
    expect(cleanBench("nope")).toEqual([]);
  });
});

describe("splitTotal", () => {
  const job = (hours: number) => ({ jobCode: "CS-1", jobTitle: "", client: "", hours });
  const sub = (hours: number) => ({
    subKey: `k${hours}`, consultant: "A", vendor: "", jobTitle: "", submittedOn: "", hours,
  });

  it("adds requirements and bench submissions together", () => {
    // A day that was both is one day, not two half-counted ones.
    expect(splitTotal([job(5)], [sub(3)])).toBe(8);
  });

  it("works when only one side is filled", () => {
    expect(splitTotal([job(8)], [])).toBe(8);
    expect(splitTotal([], [sub(8)])).toBe(8);
    expect(splitTotal([], [])).toBe(0);
  });
});
