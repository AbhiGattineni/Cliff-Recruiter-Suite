import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBenchSubmissions, joinBench, benchStats, discoverColumns, cell,
  autoMap, ColumnMap, BenchConsultant, Row,
} from "../lib/benchSubmissions";
import { applyColumnFilters, optionsForColumn, ColumnSelections } from "../lib/columnFilter";
import { friendlyError } from "../lib/errors";
import ColumnFilter from "../components/ColumnFilter";
import Pagination, { usePagination } from "../components/Pagination";
import { Sort, nextSort, sortRows, sortIndicator } from "../lib/tableSort";

type Tab = "bench" | "submissions";

const STORE = "benchSubmissions:columnMap";

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

  const [tab, setTab] = useState<Tab>("bench");
  const [benchFilters, setBenchFilters] = useState<ColumnSelections>({});
  const [subFilters, setSubFilters] = useState<ColumnSelections>({});
  const [search, setSearch] = useState("");
  const [benchSort, setBenchSort] = useState<Sort | null>(null);
  const [subSort, setSubSort] = useState<Sort | null>(null);
  // Corrections to the detected column mapping, kept per field so a fixed one
  // is not undone by re-detection when the reports refresh.
  const [overrides, setOverrides] = useState<Partial<ColumnMap>>(readOverrides);

  const bench = q.data?.bench ?? [];
  const submissions = q.data?.submissions ?? [];

  const map = useMemo<ColumnMap>(
    () => ({ ...autoMap(bench, submissions), ...overrides }),
    [bench, submissions, overrides]
  );
  const joined = useMemo(() => joinBench(bench, submissions, map), [bench, submissions, map]);
  const stats = useMemo(
    () => benchStats(joined, submissions, map.subStatus),
    [joined, submissions, map.subStatus]
  );

  const setField = (field: keyof ColumnMap, value: string) => {
    const next = { ...overrides, [field]: value || null };
    setOverrides(next);
    writeOverrides(next);
  };

  // Columns come from the rows themselves — these reports are configured in
  // Ceipal, not here, so whatever arrives is what the table shows.
  const benchCols = useMemo(() => discoverColumns(bench), [bench]);
  const subCols = useMemo(() => discoverColumns(submissions), [submissions]);

  // Two computed columns earn their place on the bench table: they are the
  // whole reason the two reports are read together.
  const SUBS = "Submissions";
  const STATUSES = "Submission statuses";
  const benchTableCols = useMemo(() => [...benchCols, SUBS, STATUSES], [benchCols]);

  const benchCell = (c: BenchConsultant, col: string): unknown => {
    if (col === SUBS) return c.count;
    if (col === STATUSES) return c.statuses.join(", ");
    return c.row[col];
  };
  const subCell = (r: Row, col: string): unknown => r[col];

  const matches = (values: unknown[]) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return values.some((v) => String(v ?? "").toLowerCase().includes(needle));
  };

  const benchRows = useMemo(() => {
    const filtered = applyColumnFilters(joined, benchFilters, benchCell);
    const searched = filtered.filter((c) => matches(benchTableCols.map((col) => benchCell(c, col))));
    return sortRows(searched, benchSort, benchCell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, benchFilters, benchTableCols, search, benchSort]);

  const subRows = useMemo(() => {
    const filtered = applyColumnFilters(submissions, subFilters, subCell);
    const searched = filtered.filter((r) => matches(subCols.map((col) => r[col])));
    return sortRows(searched, subSort, subCell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions, subFilters, subCols, search, subSort]);

  const benchPage = usePagination(benchRows, 25, "benchList");
  const subPage = usePagination(subRows, 25, "benchSubmissions");

  const clearFilters = () => {
    setBenchFilters({});
    setSubFilters({});
    setSearch("");
    setBenchSort(null);
    setSubSort(null);
  };
  const filterCount =
    Object.values(benchFilters).filter((v) => v?.length).length +
    Object.values(subFilters).filter((v) => v?.length).length;

  const benchNameCol = map.benchName;

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
            <details open={stats.covered === 0 && submissions.length > 0}>
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
                <MapField label="Submissions: status" value={map.subStatus} columns={subCols} onChange={(v) => setField("subStatus", v)} hint="Drives the status tiles" />
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
            {stats.covered === 0 && submissions.length > 0 && bench.length > 0 && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                None of the {submissions.length} submissions matched anyone on the bench. That
                usually means the two consultant columns above name different things — check the
                mapping.
              </p>
            )}
            {stats.byStatus.length === 0 && submissions.length > 0 && (
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                No column in the submissions report looks like a status, so there is nothing to
                count by. Every column is still in the Submissions tab.
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
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <div role="tablist" style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  className={`btn ${tab === "bench" ? "" : "ghost"}`}
                  role="tab"
                  aria-selected={tab === "bench"}
                  onClick={() => setTab("bench")}
                >
                  Bench ({benchRows.length})
                </button>
                <button
                  className={`btn ${tab === "submissions" ? "" : "ghost"}`}
                  role="tab"
                  aria-selected={tab === "submissions"}
                  onClick={() => setTab("submissions")}
                >
                  Submissions ({subRows.length})
                </button>
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search every column…"
                style={{ flex: "1 1 220px", minWidth: 180 }}
              />
              {(filterCount > 0 || search) && (
                <button className="btn ghost" onClick={clearFilters}>
                  Clear {filterCount > 0 ? `${filterCount} filter${filterCount > 1 ? "s" : ""}` : "search"}
                </button>
              )}
            </div>

            {tab === "bench" ? (
              benchCols.length === 0 ? (
                <p className="muted">The bench report came back with no rows.</p>
              ) : (
                <>
                  <div className="table-wrap" style={{ maxHeight: "60vh" }}>
                    <table className="data">
                      <thead>
                        <tr>
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
                                  options={optionsForColumn(joined, c, benchFilters, benchCell)}
                                  selected={benchFilters[c] ?? []}
                                  onChange={(v) => setBenchFilters((f) => ({ ...f, [c]: v }))}
                                />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {benchPage.pageItems.map((c, i) => (
                          <tr key={c.key || benchPage.startIndex + i} className={c.count === 0 ? "red" : ""}>
                            <td className="muted">{benchPage.startIndex + i + 1}</td>
                            {benchTableCols.map((col) => (
                              <td key={col} style={{ whiteSpace: "normal" }}>
                                {String(benchCell(c, col) ?? "") || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {benchRows.length === 0 && (
                          <tr>
                            <td colSpan={benchTableCols.length + 1} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                              Nothing on the bench matches these filters.
                            </td>
                          </tr>
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
              )
            ) : subCols.length === 0 ? (
              <p className="muted">The bench submissions report came back with no rows.</p>
            ) : (
              <>
                <div className="table-wrap" style={{ maxHeight: "60vh" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>#</th>
                        {subCols.map((c) => (
                          <th key={c} className="colf-th" aria-sort={ariaSort(subSort, c)}>
                            <span className="colf-th-inner">
                              <button
                                type="button"
                                className="sort-th"
                                onClick={() => setSubSort((s) => nextSort(s, c))}
                                title={`Sort by ${c}`}
                              >
                                {c}{sortIndicator(subSort, c)}
                              </button>
                              <ColumnFilter
                                column={c}
                                options={optionsForColumn(submissions, c, subFilters, subCell)}
                                selected={subFilters[c] ?? []}
                                onChange={(v) => setSubFilters((f) => ({ ...f, [c]: v }))}
                              />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {subPage.pageItems.map((r, i) => (
                        <tr key={subPage.startIndex + i}>
                          <td className="muted">{subPage.startIndex + i + 1}</td>
                          {subCols.map((col) => (
                            <td key={col} style={{ whiteSpace: "normal" }}>
                              {String(r[col] ?? "") || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {subRows.length === 0 && (
                        <tr>
                          <td colSpan={subCols.length + 1} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                            No submissions match these filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={subPage.page}
                  pageCount={subPage.pageCount}
                  total={subPage.total}
                  pageSize={subPage.pageSize}
                  onPage={subPage.setPage}
                  onPageSize={subPage.setPageSize}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
