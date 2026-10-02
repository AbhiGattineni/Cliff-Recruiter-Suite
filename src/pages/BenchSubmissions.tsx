import { Fragment, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBenchSubmissions, joinBench, benchStats, discoverColumns, cell,
  autoMap, filterByDate, filterByStatus, filterByValues, distinctValues,
  statusCounts, unmatchedSubmissions,
  ColumnMap, BenchConsultant, Row,
} from "../lib/benchSubmissions";
import { applyColumnFilters, optionsForColumn, ColumnSelections } from "../lib/columnFilter";
import { friendlyError } from "../lib/errors";
import ColumnFilter from "../components/ColumnFilter";
import Pagination, { usePagination } from "../components/Pagination";
import { Sort, nextSort, sortRows, sortIndicator } from "../lib/tableSort";

type Coverage = "all" | "covered" | "idle";

const STORE = "benchSubmissions:columnMap";
/** The expandable row that collects submissions matching nobody on the bench. */
const UNMATCHED = "__unmatched__";

function readOverrides(): Partial<ColumnMap> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}") as Partial<ColumnMap>;
  } catch {
    return {}; // a corrupt or blocked store just means no corrections yet
  }
}

function writeOverrides(v: Partial<ColumnMap>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private mode — the correction lasts this session only */
  }
}

/** One "which column means what" picker. */
function MapField({
  label, value, columns, onChange, hint,
}: {
  label: string;
  value: string | null;
  columns: string[];
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.8rem" }}>
      <span className="muted">{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">(none detected)</option>
        {columns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {hint && <span className="muted" style={{ fontSize: "0.74rem" }}>{hint}</span>}
    </label>
  );
}

/** A labelled value picker in the filter bar, sharing the table headers' control. */
function BarFilter({
  label, column, options, selected, onChange,
}: {
  label: string;
  column: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.82rem" }}>
      <span className="muted">{label}</span>
      <ColumnFilter column={column} options={options} selected={selected} onChange={onChange} />
      {selected.length > 0 && <span className="muted">{selected.length}</span>}
    </span>
  );
}

/**
 * The submissions belonging to one bench row, as an inline sub-table.
 *
 * Module-level on purpose: a component declared inside the page would be a
 * new type on every render, so every expanded sub-table would remount — and
 * lose its scroll position — on each keystroke in the search box.
 */
function SubRows({ rows, cols, span }: { rows: Row[]; cols: string[]; span: number }) {
  return (
    <tr>
      <td
        colSpan={span}
        style={{ padding: "0.4rem 0.4rem 0.8rem 2.2rem", background: "var(--row-alt)" }}
      >
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
            No submissions match the filters above.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data" style={{ margin: 0 }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((col) => (
                      <td key={col} style={{ whiteSpace: "normal" }}>
                        {String(r[col] ?? "") || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  );
}

/** Screen readers announce the sort state from the header cell, not the arrow. */
const ariaSort = (sort: Sort | null, col: string): "ascending" | "descending" | "none" =>
  sort?.col !== col ? "none" : sort.dir === "asc" ? "ascending" : "descending";

export default function BenchSubmissions() {
  // Refresh means "go past the cache to Ceipal", on a ref so the tables keep
  // their rows while the live pull runs.
  const forceLive = useRef(false);
  const q = useQuery({
    queryKey: ["benchSubmissions"],
    queryFn: () => {
      const live = forceLive.current;
      forceLive.current = false;
      return getBenchSubmissions(live);
    },
  });

  const [benchFilters, setBenchFilters] = useState<ColumnSelections>({});
  const [search, setSearch] = useState("");
  const [benchSort, setBenchSort] = useState<Sort | null>(null);
  // Page-level filters. These narrow the submissions BEFORE the join, so the
  // tiles, the idle chips and every sub-row describe the same slice.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusPick, setStatusPick] = useState<string[]>([]);
  const [vendorPick, setVendorPick] = useState<string[]>([]);
  const [titlePick, setTitlePick] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<Coverage>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Corrections to the detected column mapping, kept per field so a fixed one
  // is not undone by re-detection when the reports refresh.
  const [overrides, setOverrides] = useState<Partial<ColumnMap>>(readOverrides);

  const bench = q.data?.bench ?? [];
  const submissions = q.data?.submissions ?? [];

  const map = useMemo<ColumnMap>(
    () => ({ ...autoMap(bench, submissions), ...overrides }),
    [bench, submissions, overrides]
  );

  // Option lists come from the unfiltered report, so a value can't vanish from
  // its own filter as soon as it is ticked.
  const allStatuses = useMemo(
    () => statusCounts(submissions, map.subStatus),
    [submissions, map.subStatus]
  );
  const vendorOptions = useMemo(
    () => distinctValues(submissions, map.subVendor),
    [submissions, map.subVendor]
  );
  const titleOptions = useMemo(
    () => distinctValues(submissions, map.subTitle),
    [submissions, map.subTitle]
  );

  const visibleSubs = useMemo(() => {
    let rows = filterByDate(submissions, map.subDate, from, to);
    rows = filterByStatus(rows, map.subStatus, statusPick);
    rows = filterByValues(rows, map.subVendor, vendorPick);
    rows = filterByValues(rows, map.subTitle, titlePick);
    return rows;
  }, [submissions, map.subDate, map.subStatus, map.subVendor, map.subTitle, from, to, statusPick, vendorPick, titlePick]);

  const joined = useMemo(() => joinBench(bench, visibleSubs, map), [bench, visibleSubs, map]);
  const stats = useMemo(
    () => benchStats(joined, visibleSubs, map.subStatus),
    [joined, visibleSubs, map.subStatus]
  );
  // Submissions that matched nobody. Shown rather than dropped: the usual
  // cause is a column mapped wrongly, and a silent drop looks like an empty
  // bench instead of a mapping to fix.
  const unmatched = useMemo(() => unmatchedSubmissions(joined, visibleSubs), [joined, visibleSubs]);

  const benchPool = useMemo(() => {
    if (coverage === "covered") return joined.filter((c) => c.count > 0);
    if (coverage === "idle") return joined.filter((c) => c.count === 0);
    return joined;
  }, [joined, coverage]);

  const setField = (field: keyof ColumnMap, value: string) => {
    const next = { ...overrides, [field]: value || null };
    setOverrides(next);
    writeOverrides(next);
  };

  // Columns come from the rows themselves — these reports are configured in
  // Ceipal, not here, so whatever arrives is what the table shows.
  const benchCols = useMemo(() => discoverColumns(bench), [bench]);
  const subCols = useMemo(() => discoverColumns(submissions), [submissions]);

  // Two computed columns earn their place on the bench row: they are the whole
  // reason the two reports are read together.
  const SUBS = "Submissions";
  const STATUSES = "Submission statuses";
  const benchTableCols = useMemo(() => [...benchCols, SUBS, STATUSES], [benchCols]);

  const benchCell = (c: BenchConsultant, col: string): unknown => {
    if (col === SUBS) return c.count;
    if (col === STATUSES) return c.statuses.join(", ");
    return c.row[col];
  };

  // Search spans a consultant AND their submissions, so typing a vendor finds
  // the person it was submitted for rather than nothing at all.
  const matches = (c: BenchConsultant) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    const hay = [
      ...benchTableCols.map((col) => benchCell(c, col)),
      ...c.submissions.flatMap((s) => subCols.map((col) => s[col])),
    ];
    return hay.some((v) => String(v ?? "").toLowerCase().includes(needle));
  };

  const benchRows = useMemo(() => {
    const filtered = applyColumnFilters(benchPool, benchFilters, benchCell);
    return sortRows(filtered.filter(matches), benchSort, benchCell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchPool, benchFilters, benchTableCols, subCols, search, benchSort]);

  const benchPage = usePagination(benchRows, 25, "benchList");

  const clearFilters = () => {
    setBenchFilters({});
    setSearch("");
    setBenchSort(null);
    setFrom("");
    setTo("");
    setStatusPick([]);
    setVendorPick([]);
    setTitlePick([]);
    setCoverage("all");
  };
  const filterCount =
    Object.values(benchFilters).filter((v) => v?.length).length +
    (from ? 1 : 0) +
    (to ? 1 : 0) +
    (statusPick.length > 0 ? 1 : 0) +
    (vendorPick.length > 0 ? 1 : 0) +
    (titlePick.length > 0 ? 1 : 0) +
    (coverage === "all" ? 0 : 1);

  const toggleStatus = (v: string) =>
    setStatusPick((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const benchNameCol = map.benchName;
  // +1 expander, +1 row number.
  const span = benchTableCols.length + 2;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Bench Submissions</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            The bench roster and the submissions made for it, read together — so the people
            with no submissions against their name are visible, not just the ones with some.
          </p>
        </div>
        <button
          className="btn secondary"
          onClick={() => { forceLive.current = true; q.refetch(); }}
          disabled={q.isFetching}
        >
          {q.isFetching ? <span className="spinner dark" /> : "⟳"} Refresh
        </button>
      </div>

      {q.isLoading ? (
        <div className="card"><div className="center-load" style={{ minHeight: "40vh" }}><div className="spinner dark" /></div></div>
      ) : q.error ? (
        <div className="card">
          <div className="alert error">
            <strong>Couldn&#39;t load bench submissions.</strong>
            <p style={{ margin: "0.4rem 0 0" }}>{friendlyError(q.error)}</p>
          </div>
        </div>
      ) : (
        <>
          {q.data?.stale && (
            <div className="alert error">
              <strong>
                Ceipal didn&#39;t answer — showing the last good pull
                {q.data.fetchedAt ? ` from ${new Date(q.data.fetchedAt).toLocaleString()}` : ""}.
              </strong>
              {q.data.problem && <p style={{ margin: "0.4rem 0 0" }}>{q.data.problem}</p>}
            </div>
          )}

          <div className="card">
            <details open={stats.covered === 0 && submissions.length > 0 && filterCount === 0}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }} className="muted">
                Column mapping — which column means what
              </summary>
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0.5rem 0" }}>
                These are detected from the report headers. If the numbers below look wrong — nobody
                matched, or a status tile counting something odd — the detection picked the wrong
                column. Correct it here; the choice is remembered.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.6rem" }}>
                <MapField label="Bench: consultant" value={map.benchName} columns={benchCols} onChange={(v) => setField("benchName", v)} />
                <MapField label="Bench: surname" value={map.benchLast} columns={benchCols} onChange={(v) => setField("benchLast", v)} hint="Only if the name is split across two columns" />
                <MapField label="Bench: email" value={map.benchEmail} columns={benchCols} onChange={(v) => setField("benchEmail", v)} hint="Optional" />
                <MapField label="Submissions: consultant" value={map.subName} columns={subCols} onChange={(v) => setField("subName", v)} hint="Must name the same person as the bench column" />
                <MapField label="Submissions: surname" value={map.subLast} columns={subCols} onChange={(v) => setField("subLast", v)} hint="Only if the name is split across two columns" />
                <MapField label="Submissions: email" value={map.subEmail} columns={subCols} onChange={(v) => setField("subEmail", v)} hint="Optional" />
                <MapField label="Submissions: status" value={map.subStatus} columns={subCols} onChange={(v) => setField("subStatus", v)} hint="Drives the status tiles and the status filter" />
                <MapField label="Submissions: date" value={map.subDate} columns={subCols} onChange={(v) => setField("subDate", v)} hint="Drives the date range filter" />
                <MapField label="Submissions: vendor" value={map.subVendor} columns={subCols} onChange={(v) => setField("subVendor", v)} hint="Drives the vendor filter" />
                <MapField label="Submissions: role" value={map.subTitle} columns={subCols} onChange={(v) => setField("subTitle", v)} hint="Drives the role filter" />
              </div>
              {Object.keys(overrides).length > 0 && (
                <button className="btn ghost" style={{ marginTop: "0.6rem" }} onClick={() => { setOverrides({}); writeOverrides({}); }}>
                  Reset to detected
                </button>
              )}
            </details>
          </div>

          <div className="card">
            <div className="stat-grid">
              <div className="stat">
                <div className="num">{stats.benchTotal}</div>
                <div className="lbl">On bench</div>
              </div>
              <div className="stat">
                <div className="num">{stats.submissionTotal}</div>
                <div className="lbl">Submissions</div>
              </div>
              <div className="stat">
                <div className="num">{stats.covered}</div>
                <div className="lbl">Submitted at least once</div>
              </div>
              <div className="stat">
                <div className="num">{stats.idle}</div>
                <div className="lbl">No submissions yet</div>
              </div>
              {stats.byStatus.map((s) => (
                <div className="stat" key={s.status}>
                  <div className="num">{s.count}</div>
                  <div className="lbl">{s.status}</div>
                </div>
              ))}
            </div>
            {stats.covered === 0 && visibleSubs.length > 0 && bench.length > 0 && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                None of the {visibleSubs.length} submissions matched anyone on the bench. That
                usually means the two consultant columns above name different things — check the
                mapping.
              </p>
            )}
            {stats.byStatus.length === 0 && visibleSubs.length > 0 && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                No column in the submissions report looks like a status, so there is nothing to
                count by. Every column is still on the submission rows below.
              </p>
            )}
          </div>

          {stats.idle > 0 && (
            <div className="card">
              <p className="sub" style={{ marginTop: 0 }}>
                {stats.idle} on the bench with no submission yet
              </p>
              <p style={{ margin: 0, lineHeight: 1.7 }}>
                {joined.filter((c) => c.count === 0).slice(0, 40).map((c, i) => (
                  <span key={c.key || i} className="chip" style={{ marginRight: "0.35rem" }}>
                    {c.name || cell(c.row, benchNameCol) || "(unnamed)"}
                  </span>
                ))}
                {stats.idle > 40 && <span className="muted"> +{stats.idle - 40} more</span>}
              </p>
            </div>
          )}

          <div className="card">
            {/* The filters sit here, immediately above the rows they govern,
                rather than three cards further up the page. */}
            <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "0.6rem" }}>
              {map.subDate ? (
                <>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Submitted from</label>
                    <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Submitted to</label>
                    <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: "0.8rem", maxWidth: 240 }}>
                  No date column detected, so there is no range to filter on — pick one in the
                  column mapping above.
                </p>
              )}

              <div className="field" style={{ margin: 0, minWidth: 190 }}>
                <label>Bench</label>
                <select value={coverage} onChange={(e) => setCoverage(e.target.value as Coverage)}>
                  <option value="all">Everyone on the bench</option>
                  <option value="covered">Submitted at least once</option>
                  <option value="idle">No submissions yet</option>
                </select>
              </div>

              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people and their submissions…"
                style={{ flex: "1 1 220px", minWidth: 180 }}
              />

              {(filterCount > 0 || search) && (
                <button className="btn ghost" onClick={clearFilters}>
                  Clear {filterCount > 0 ? `${filterCount} filter${filterCount > 1 ? "s" : ""}` : "search"}
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
              <BarFilter label="Vendor" column="Vendor" options={vendorOptions} selected={vendorPick} onChange={setVendorPick} />
              <BarFilter label="Role" column="Role" options={titleOptions} selected={titlePick} onChange={setTitlePick} />
              {allStatuses.length > 0 && (
                <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.82rem" }}>Status</span>
                  {allStatuses.map((sc) => {
                    const on = statusPick.includes(sc.status);
                    return (
                      <button
                        key={sc.status}
                        type="button"
                        className={`btn ${on ? "" : "ghost"}`}
                        style={{ padding: "0.2rem 0.55rem", fontSize: "0.78rem" }}
                        aria-pressed={on}
                        onClick={() => toggleStatus(sc.status)}
                      >
                        {sc.status} <span className="muted">{sc.count}</span>
                      </button>
                    );
                  })}
                </span>
              )}
            </div>

            <p className="sub" style={{ marginTop: 0 }}>
              {benchRows.length} on the bench · {visibleSubs.length} submission
              {visibleSubs.length === 1 ? "" : "s"} shown
              {submissions.length !== visibleSubs.length ? ` of ${submissions.length}` : ""}
              {(from || to) && " · undated rows are left out while a range is set"}
            </p>

            {benchCols.length === 0 && unmatched.length === 0 ? (
              <p className="muted">The bench report came back with no rows.</p>
            ) : (
              <>
                <div className="table-wrap" style={{ maxHeight: "60vh" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }} />
                        <th style={{ width: 44 }}>#</th>
                        {benchTableCols.map((c) => (
                          <th key={c} className="colf-th" aria-sort={ariaSort(benchSort, c)}>
                            <span className="colf-th-inner">
                              <button
                                type="button"
                                className="sort-th"
                                onClick={() => setBenchSort((s) => nextSort(s, c))}
                                title={`Sort by ${c}`}
                              >
                                {c}{sortIndicator(benchSort, c)}
                              </button>
                              <ColumnFilter
                                column={c}
                                options={optionsForColumn(benchPool, c, benchFilters, benchCell)}
                                selected={benchFilters[c] ?? []}
                                onChange={(v) => setBenchFilters((f) => ({ ...f, [c]: v }))}
                              />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {benchPage.pageItems.map((c, i) => {
                        const key = c.key || `row-${benchPage.startIndex + i}`;
                        const open = expanded.has(key);
                        return (
                          <Fragment key={key}>
                            <tr className={c.count === 0 ? "red" : ""}>
                              <td>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  style={{ padding: "0.1rem 0.4rem", fontSize: "0.8rem" }}
                                  aria-expanded={open}
                                  aria-label={`${open ? "Hide" : "Show"} submissions for ${c.name || "this consultant"}`}
                                  onClick={() => toggleRow(key)}
                                >
                                  {open ? "▾" : "▸"}
                                </button>
                              </td>
                              <td className="muted">{benchPage.startIndex + i + 1}</td>
                              {benchTableCols.map((col) => (
                                <td key={col} style={{ whiteSpace: "normal" }}>
                                  {String(benchCell(c, col) ?? "") || "—"}
                                </td>
                              ))}
                            </tr>
                            {open && <SubRows rows={c.submissions} cols={subCols} span={span} />}
                          </Fragment>
                        );
                      })}
                      {benchRows.length === 0 && (
                        <tr>
                          <td colSpan={span} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                            Nothing on the bench matches these filters.
                          </td>
                        </tr>
                      )}

                      {/* Last, and only when there are any: submissions whose
                          applicant is on nobody's roster row. */}
                      {unmatched.length > 0 && (
                        <Fragment>
                          <tr className="red">
                            <td>
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ padding: "0.1rem 0.4rem", fontSize: "0.8rem" }}
                                aria-expanded={expanded.has(UNMATCHED)}
                                aria-label={`${expanded.has(UNMATCHED) ? "Hide" : "Show"} unmatched submissions`}
                                onClick={() => toggleRow(UNMATCHED)}
                              >
                                {expanded.has(UNMATCHED) ? "▾" : "▸"}
                              </button>
                            </td>
                            <td className="muted">—</td>
                            <td colSpan={benchTableCols.length} style={{ whiteSpace: "normal" }}>
                              <strong>Matched nobody on the bench</strong>{" "}
                              <span className="muted">
                                — {unmatched.length} submission{unmatched.length === 1 ? "" : "s"}, usually
                                someone who has left the bench or a consultant column mapped to the wrong
                                thing.
                              </span>
                            </td>
                          </tr>
                          {expanded.has(UNMATCHED) && <SubRows rows={unmatched} cols={subCols} span={span} />}
                        </Fragment>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={benchPage.page}
                  pageCount={benchPage.pageCount}
                  total={benchPage.total}
                  pageSize={benchPage.pageSize}
                  onPage={benchPage.setPage}
                  onPageSize={benchPage.setPageSize}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
