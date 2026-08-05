// Excel-style per-column filtering for tables.
//
// The key behaviour is cross-filtering: the values offered for a column are
// computed from the rows surviving every OTHER column's filter, so you can
// never tick a value that yields nothing. Ticking nothing in a column means
// "all" for that column.

export const BLANK = "(blank)";

export type ColumnSelections = Record<string, string[]>;

/** The display value used for filtering — empty/whitespace collapses to BLANK. */
export function cellValue(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "" ? BLANK : s;
}

function passes<T>(
  row: T,
  selections: ColumnSelections,
  get: (row: T, col: string) => unknown,
  skipCol?: string
): boolean {
  for (const [col, picked] of Object.entries(selections)) {
    if (!picked || picked.length === 0) continue; // empty = no constraint
    if (col === skipCol) continue;
    if (!picked.includes(cellValue(get(row, col)))) return false;
  }
  return true;
}

/** Rows matching every active column selection. */
export function applyColumnFilters<T>(
  rows: T[],
  selections: ColumnSelections,
  get: (row: T, col: string) => unknown
): T[] {
  const active = Object.values(selections).some((v) => v && v.length > 0);
  if (!active) return rows;
  return rows.filter((r) => passes(r, selections, get));
}

/**
 * Distinct, sorted values to offer for `col`, derived from rows that satisfy
 * all other columns' filters. Numeric-looking values sort numerically;
 * BLANK always sorts last.
 */
export function optionsForColumn<T>(
  rows: T[],
  col: string,
  selections: ColumnSelections,
  get: (row: T, col: string) => unknown
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!passes(r, selections, get, col)) continue;
    seen.add(cellValue(get(r, col)));
  }
  return sortValues([...seen]);
}

export function sortValues(values: string[]): string[] {
  const num = (v: string) => {
    const n = Number(v.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  };
  return values.sort((a, b) => {
    if (a === BLANK) return 1;
    if (b === BLANK) return -1;
    const na = num(a);
    const nb = num(b);
    if (na !== null && nb !== null) return na - nb;
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  });
}

/** How many columns currently constrain the table. */
export function activeFilterCount(selections: ColumnSelections): number {
  return Object.values(selections).filter((v) => v && v.length > 0).length;
}

/**
 * Drop selections for columns that are no longer present (e.g. the user hid a
 * column), so a hidden column can't silently keep filtering the table.
 */
export function pruneSelections(selections: ColumnSelections, columns: string[]): ColumnSelections {
  const keep: ColumnSelections = {};
  for (const c of columns) {
    const v = selections[c];
    if (v && v.length > 0) keep[c] = v;
  }
  return keep;
}
