import { describe, it, expect } from "vitest";
import { nextSort, compareValues, sortRows, asDate, asNumber, sortIndicator } from "./tableSort";

describe("nextSort", () => {
  it("cycles asc, desc, then back to unsorted", () => {
    const a = nextSort(null, "Client");
    expect(a).toEqual({ col: "Client", dir: "asc" });
    const b = nextSort(a, "Client");
    expect(b).toEqual({ col: "Client", dir: "desc" });
    expect(nextSort(b, "Client")).toBeNull();
  });

  it("starts fresh at ascending on a different column", () => {
    expect(nextSort({ col: "Client", dir: "desc" }, "City")).toEqual({ col: "City", dir: "asc" });
  });
});

describe("asDate", () => {
  it("reads Ceipal's M/D/YYYY with a time", () => {
    expect(asDate("09/21/2026 17:37:28")).toBe(Date.UTC(2026, 8, 21, 17, 37, 28));
  });

  it("reads a bare date", () => {
    expect(asDate("9/5/2026")).toBe(Date.UTC(2026, 8, 5));
  });

  it("is null for text", () => {
    expect(asDate("Submitted")).toBeNull();
  });
});

describe("asNumber", () => {
  it("reads a plain number, ignoring currency and separators", () => {
    expect(asNumber("$1,250")).toBe(1250);
  });

  it("digs the rate out of embedded text", () => {
    expect(asNumber("USD/55/Hourly/C2C")).toBe(55);
  });

  it("is null for text with no digits", () => {
    expect(asNumber("Submitted")).toBeNull();
  });
});

describe("compareValues", () => {
  it("orders dates chronologically across a year boundary", () => {
    // Lexically "01/..." precedes "09/...", which is the bug this guards.
    expect(compareValues("09/21/2026 10:00:00", "01/05/2027 10:00:00")).toBeLessThan(0);
  });

  it("orders embedded rates numerically, not lexically", () => {
    expect(compareValues("USD/48/Hourly/C2C", "USD/5/Hourly/C2C")).toBeGreaterThan(0);
  });

  it("sorts blanks last in an ascending comparison", () => {
    expect(compareValues("", "Submitted")).toBeGreaterThan(0);
    expect(compareValues("Submitted", "")).toBeLessThan(0);
    expect(compareValues("", "")).toBe(0);
  });

  it("falls back to a case-insensitive text compare", () => {
    expect(compareValues("apple", "Banana")).toBeLessThan(0);
  });
});

describe("sortRows", () => {
  const get = (r: Record<string, unknown>, c: string) => r[c];

  it("returns the input untouched when unsorted", () => {
    const rows = [{ a: "2" }, { a: "1" }];
    expect(sortRows(rows, null, get)).toBe(rows);
  });

  it("does not mutate the input", () => {
    const rows = [{ a: "2" }, { a: "1" }];
    sortRows(rows, { col: "a", dir: "asc" }, get);
    expect(rows.map((r) => r.a)).toEqual(["2", "1"]);
  });

  it("sorts ascending and descending", () => {
    const rows = [{ a: "b" }, { a: "c" }, { a: "a" }];
    expect(sortRows(rows, { col: "a", dir: "asc" }, get).map((r) => r.a)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, { col: "a", dir: "desc" }, get).map((r) => r.a)).toEqual(["c", "b", "a"]);
  });

  it("keeps blanks at the bottom in BOTH directions", () => {
    const rows = [{ a: "b" }, { a: "" }, { a: "a" }];
    expect(sortRows(rows, { col: "a", dir: "asc" }, get).map((r) => r.a)).toEqual(["a", "b", ""]);
    expect(sortRows(rows, { col: "a", dir: "desc" }, get).map((r) => r.a)).toEqual(["b", "a", ""]);
  });

  it("sorts a numeric column by value", () => {
    const rows = [{ n: 9 }, { n: 10 }, { n: 1 }];
    expect(sortRows(rows, { col: "n", dir: "asc" }, get).map((r) => r.n)).toEqual([1, 9, 10]);
  });

  it("sorts a column missing from some rows without dropping them", () => {
    const rows = [{ a: "b" }, {}, { a: "a" }];
    expect(sortRows(rows, { col: "a", dir: "asc" }, get)).toHaveLength(3);
  });
});

describe("sortIndicator", () => {
  it("marks only the sorted column", () => {
    expect(sortIndicator({ col: "a", dir: "asc" }, "a")).toBe(" ▲");
    expect(sortIndicator({ col: "a", dir: "desc" }, "a")).toBe(" ▼");
    expect(sortIndicator({ col: "a", dir: "asc" }, "b")).toBe("");
    expect(sortIndicator(null, "a")).toBe("");
  });
});
