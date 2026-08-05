import { useEffect, useMemo, useState } from "react";

// Page sizes offered in the footer dropdown. Infinity = "All".
export const PAGE_SIZES = [10, 25, 50, 100, 250, Infinity];

const label = (n: number) => (Number.isFinite(n) ? String(n) : "All");

function readStored(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(`pageSize:${key}`);
    if (raw === "All") return Infinity;
    const n = Number(raw);
    return PAGE_SIZES.includes(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Client-side pagination over an in-memory array.
 *
 * `storageKey` persists the chosen page size per table, so picking 100 once
 * survives navigation and reloads.
 */
export function usePagination<T>(items: T[], initialPageSize = 25, storageKey?: string) {
  const [pageSize, setPageSizeState] = useState<number>(() => readStored(storageKey, initialPageSize));
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);

  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(0); // a resize invalidates the current offset
    if (storageKey) {
      try {
        localStorage.setItem(`pageSize:${storageKey}`, label(n));
      } catch {
        /* storage unavailable (private mode) — the choice just won't persist */
      }
    }
  };

  const pageItems = useMemo(
    () => (Number.isFinite(pageSize) ? items.slice(current * pageSize, current * pageSize + pageSize) : items),
    [items, current, pageSize]
  );

  return {
    page: current,
    setPage,
    pageCount,
    pageItems,
    pageSize,
    setPageSize,
    total: items.length,
    startIndex: Number.isFinite(pageSize) ? current * pageSize : 0, // continuous row numbering
  };
}

export default function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  /** Omit to hide the rows-per-page dropdown. */
  onPageSize?: (n: number) => void;
}) {
  if (total === 0) return null;
  const showingAll = !Number.isFinite(pageSize);
  const from = showingAll ? 1 : page * pageSize + 1;
  const to = showingAll ? total : Math.min((page + 1) * pageSize, total);

  return (
    <div className="pager">
      <div className="pager-left">
        <span className="muted">{from}–{to} of {total}</span>
        {onPageSize && (
          <label className="pager-size">
            <span className="muted">Rows</span>
            <select
              value={label(pageSize)}
              onChange={(e) => onPageSize(e.target.value === "All" ? Infinity : Number(e.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((n) => (
                <option key={label(n)} value={label(n)}>{label(n)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {pageCount > 1 && (
        <div className="pager-btns">
          <button disabled={page === 0} onClick={() => onPage(0)} aria-label="First">«</button>
          <button disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous">‹</button>
          <span className="muted">Page {page + 1} / {pageCount}</span>
          <button disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label="Next">›</button>
          <button disabled={page >= pageCount - 1} onClick={() => onPage(pageCount - 1)} aria-label="Last">»</button>
        </div>
      )}
    </div>
  );
}
