import { describe, it, expect } from "vitest";
import {
  applyColumnFilters,
  optionsForColumn,
  activeFilterCount,
  pruneSelections,
  sortValues,
  cellValue,
  BLANK,
} from "./columnFilter";

interface Row { client: string; status: string; recruiter: string }
const rows: Row[] = [
  { client: "IBM", status: "Closed", recruiter: "Guru" },
  { client: "IBM", status: "Active", recruiter: "Juhi" },
  { client: "Apple", status: "Closed", recruiter: "Guru" },
  { client: "Apple", status: "On Hold", recruiter: "Mubal" },
  { client: "TCS", status: "Active", recruiter: "" },
];
const get = (r: Row, c: string) => (r as unknown as Record<string, string>)[c];

describe("cellValue", () => {
  it("collapses empty and whitespace to BLANK", () => {
    expect(cellValue("")).toBe(BLANK);
    expect(cellValue("   ")).toBe(BLANK);
    expect(cellValue(null)).toBe(BLANK);
    expect(cellValue("IBM")).toBe("IBM");
  });
});

describe("applyColumnFilters", () => {
  it("returns every row when nothing is ticked", () => {
    expect(applyColumnFilters(rows, {}, get)).toHaveLength(5);
    expect(applyColumnFilters(rows, { client: [] }, get)).toHaveLength(5);
  });

  it("filters on one column", () => {
    const out = applyColumnFilters(rows, { client: ["IBM"] }, get);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.client === "IBM")).toBe(true);
  });

  it("treats multiple ticks in one column as OR", () => {
    const out = applyColumnFilters(rows, { client: ["IBM", "TCS"] }, get);
    expect(out).toHaveLength(3);
  });

  it("treats separate columns as AND", () => {
    const out = applyColumnFilters(rows, { client: ["IBM", "Apple"], status: ["Closed"] }, get);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.recruiter)).toEqual(["Guru", "Guru"]);
  });

  it("matches blanks via the BLANK token", () => {
    const out = applyColumnFilters(rows, { recruiter: [BLANK] }, get);
    expect(out).toHaveLength(1);
    expect(out[0].client).toBe("TCS");
  });
});

describe("optionsForColumn", () => {
  it("lists distinct values when nothing else is filtered", () => {
    expect(optionsForColumn(rows, "client", {}, get)).toEqual(["Apple", "IBM", "TCS"]);
  });

  it("cross-filters: options reflect other columns' selections", () => {
    // With status=Active, only IBM and TCS remain as possible clients.
    expect(optionsForColumn(rows, "client", { status: ["Active"] }, get)).toEqual(["IBM", "TCS"]);
  });

  it("ignores its own selection so ticked values stay listed", () => {
    const opts = optionsForColumn(rows, "client", { client: ["IBM"] }, get);
    expect(opts).toEqual(["Apple", "IBM", "TCS"]);
  });

  it("includes BLANK and sorts it last", () => {
    const opts = optionsForColumn(rows, "recruiter", {}, get);
    expect(opts[opts.length - 1]).toBe(BLANK);
  });

  it("never offers a value that would yield zero rows", () => {
    const sel = { status: ["On Hold"] };
    for (const v of optionsForColumn(rows, "client", sel, get)) {
      expect(applyColumnFilters(rows, { ...sel, client: [v] }, get).length).toBeGreaterThan(0);
    }
  });
});

describe("sortValues", () => {
  it("sorts numeric-looking values numerically, not as text", () => {
    expect(sortValues(["10", "9", "100"])).toEqual(["9", "10", "100"]);
  });
  it("sorts text case-insensitively", () => {
    expect(sortValues(["banana", "Apple"])).toEqual(["Apple", "banana"]);
  });
});

describe("activeFilterCount / pruneSelections", () => {
  it("counts only columns with ticks", () => {
    expect(activeFilterCount({ a: ["x"], b: [], c: ["y", "z"] })).toBe(2);
  });
  it("drops selections for columns no longer shown", () => {
    expect(pruneSelections({ a: ["x"], b: ["y"] }, ["a"])).toEqual({ a: ["x"] });
  });
});
