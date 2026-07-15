import { useEffect, useMemo, useState } from "react";

/** Client-side pagination over an in-memory array. Resets when the list shrinks. */
export function usePagination<T>(items: T[], pageSize = 25) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);

  const pageItems = useMemo(
    () => items.slice(current * pageSize, current * pageSize + pageSize),
    [items, current, pageSize]
  );

  return {
    page: current,
    setPage,
    pageCount,
    pageItems,
    pageSize,
    total: items.length,
    startIndex: current * pageSize, // for continuous row numbering
  };
}

export default function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div className="pager">
      <span className="muted">{from}–{to} of {total}</span>
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
