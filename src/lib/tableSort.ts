// Click-to-sort for the generic report tables.
//
// These tables are built from whatever columns a Ceipal report happens to
// return, so a column's type is not known ahead of time and has to be inferred
// from the values themselves. Three shapes matter, because sorting any of them
// as plain text is visibly wrong: dates ("09/21/2026 17:37:28" puts October
// before September once a year turns over), numbers embedded in text
// ("USD/55/Hourly/C2C" sorts 5 before 48), and blanks, which should sink rather
// than lead.

export type SortDir = "asc" | "desc";
export interface Sort {
  col: string;
  dir: SortDir;
}

/**
 * Clicking a column cycles ascending -> descending -> unsorted, so the original
 * report order is always one more click away rather than unreachable.
 */
export function nextSort(current: Sort | null, col: string): Sort | null {
  if (!current || current.col !== col) return { col, dir: "asc" };
  if (current.dir === "asc") return { col, dir: "desc" };
  return null;
}

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/** Epoch ms for Ceipal's M/D/YYYY dates, or null when it is not one. */
export function asDate(v: string): number | null {
  const m = DATE.exec(v.trim());
  if (!m) return null;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/**
 * The number a value sorts by, or null when it has none.
 *
 * A bare number wins outright. Otherwise the first number embedded in the text
 * is used, which is what makes a column of "USD/55/Hourly/C2C" order by rate.
 */
export function asNumber(v: string): number | null {
  const plain = Number(v.replace(/[$,%\s]/g, ""));
  if (v.trim() !== "" && Number.isFinite(plain)) return plain;
  const m = v.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Ascending comparison. Blanks sort last in both directions. */
export function compareValues(a: unknown, b: unknown): number {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (x === "" && y === "") return 0;
  if (x === "") return 1;
  if (y === "") return -1;

  const dx = asDate(x);
  const dy = asDate(y);
  if (dx !== null && dy !== null) return dx - dy;

  const nx = asNumber(x);
  const ny = asNumber(y);
  if (nx !== null && ny !== null && nx !== ny) return nx - ny;

  return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Rows in sort order. Returns the input untouched when nothing is sorted, and
 * never mutates it.
 *
 * Blanks are held at the bottom rather than reversed with everything else: a
 * descending sort is for finding the largest value, and a column of empties at
 * the top serves nobody.
 */
export function sortRows<T>(rows: T[], sort: Sort | null, get: (row: T, col: string) => unknown): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = String(get(a, sort.col) ?? "").trim();
    const bv = String(get(b, sort.col) ?? "").trim();
    if (av === "" && bv !== "") return 1;
    if (bv === "" && av !== "") return -1;
    return sign * compareValues(av, bv);
  });
}

/** The arrow shown in a column header. */
export const sortIndicator = (sort: Sort | null, col: string): string =>
  sort?.col !== col ? "" : sort.dir === "asc" ? " ▲" : " ▼";
