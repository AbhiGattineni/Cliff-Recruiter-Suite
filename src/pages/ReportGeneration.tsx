import { useState, useRef, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { DateTime } from "luxon";
import { readWorkbookRows } from "../lib/report/readExcel";
import {
  parseJobsFromSheets,
  parseSubmissionsFromSheets,
  parseJobsFromApi,
  parseSubmissionsFromApi,
} from "../lib/report/parseSource";
import { buildReport } from "../lib/report/transform";
import { buildWorkbook } from "../lib/report/buildXlsx";
import { COLUMNS, ReportResult } from "../lib/report/types";
import { fetchCeipalReport, reportMeta } from "../lib/ceipal";
import { friendlyError } from "../lib/errors";
import { logReportRun } from "../lib/dashboard";
import MultiSelect from "../components/MultiSelect";
import PieChart from "../components/PieChart";
import ColumnPicker from "../components/ColumnPicker";
import Pagination, { usePagination } from "../components/Pagination";
import { orderColumns } from "../lib/report/columnMeta";
import {
  saveReportConfig,
  listReportConfigs,
  deleteReportConfig,
  SavedReportConfig,
} from "../lib/reportConfigs";

const TIME_SLOTS = [
  "Time Taken – 1st Submission",
  "Time Taken – 2nd Submission",
  "Time Taken – 3rd Submission",
];
const TIME_SLOT_TITLES = ["1st Submission", "2nd Submission", "3rd Submission"];
const TIME_BUCKETS = [
  { key: "< 4h", max: 4, color: "#1e7e34" },
  { key: "4–8h", max: 8, color: "#4a9e5c" },
  { key: "8–16h", max: 16, color: "#e0a800" },
  { key: "16–24h", max: 24, color: "#e8590c" },
  { key: "24–48h", max: 48, color: "#c92a2a" },
  { key: "48h+", max: Infinity, color: "#6b7280" },
];

// Parse a "Xd Yh Zm" duration cell into total hours (null if not a duration).
function durationHours(s: string): number | null {
  if (!s) return null;
  const m = s.match(/(\d+)d\s+(\d+)h\s+(\d+)m/);
  if (!m) return null;
  return Number(m[1]) * 24 + Number(m[2]) + Number(m[3]) / 60;
}

type Source = "api" | "upload";

// Columns offered as dropdown filters (low-cardinality). Job-level = posted jobs,
// candidate-level = submissions made.
const SELECT_FILTERS = [
  "Client",
  "Job Status",
  "Job Title",
  "Recruitment Manager",
  "Recruiter (Submitted By)",
] as const;

export default function ReportGeneration() {
  const [source, setSource] = useState<Source>("api");
  const [jobsFile, setJobsFile] = useState<File | null>(null);
  const [subsFile, setSubsFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const maxRecords = 0; // always fetch every record (0 = all)
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);

  // Saved configurations
  const [savedConfigs, setSavedConfigs] = useState<SavedReportConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  const jobsInput = useRef<HTMLInputElement>(null);
  const subsInput = useRef<HTMLInputElement>(null);

  // ---- Filters ----
  const [search, setSearch] = useState("");
  const [selFilters, setSelFilters] = useState<Record<string, string[]>>({});
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [visibleCols, setVisibleCols] = useState<string[]>([...COLUMNS]);

  const distinct = useMemo(() => {
    const m: Record<string, string[]> = {};
    if (!result) return m;
    for (const col of SELECT_FILTERS) {
      const set = new Set<string>();
      for (const r of result.rows) {
        const v = (r.cells[col] ?? "").trim();
        if (v && v !== "NA" && v !== "–") set.add(v);
      }
      m[col] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return m;
  }, [result]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    const df = submittedFrom ? DateTime.fromISO(submittedFrom) : null;
    const dt = submittedTo ? DateTime.fromISO(submittedTo).endOf("day") : null;
    const cf = createdFrom ? DateTime.fromISO(createdFrom) : null;
    const ct = createdTo ? DateTime.fromISO(createdTo).endOf("day") : null;
    const parse = (v: string) => {
      const d = DateTime.fromFormat(v || "", "MM/dd/yyyy hh:mm a");
      return d.isValid ? d : null;
    };
    return result.rows.filter((r) => {
      for (const col of SELECT_FILTERS) {
        const sel = selFilters[col];
        if (sel && sel.length && !sel.includes(r.cells[col])) return false;
      }
      if (q && !COLUMNS.some((c) => (r.cells[c] ?? "").toLowerCase().includes(q))) return false;
      if (df || dt) {
        const d = parse(r.cells["Submitted On"]);
        if (!d || (df && d < df) || (dt && d > dt)) return false;
      }
      if (cf || ct) {
        const d = parse(r.cells["Job Created On"]);
        if (!d || (cf && d < cf) || (ct && d > ct)) return false;
      }
      return true;
    });
  }, [result, search, selFilters, submittedFrom, submittedTo, createdFrom, createdTo]);

  const anyFilter =
    !!search ||
    Object.values(selFilters).some((a) => a && a.length > 0) ||
    !!submittedFrom || !!submittedTo || !!createdFrom || !!createdTo;

  const preview = usePagination(filteredRows, 50);

  // Distribution of time-to-submission, bucketed, counted once per job (time-taken
  // is a job-level value repeated on each candidate row → dedupe by Job Code).
  const timeStats = useMemo(() => {
    const counts = TIME_SLOTS.map(() => TIME_BUCKETS.map(() => 0));
    const seen = new Set<string>();
    let jobs = 0;
    for (const r of filteredRows) {
      const code = r.cells["Job Code"] || "";
      if (code) {
        if (seen.has(code)) continue;
        seen.add(code);
      }
      jobs++;
      TIME_SLOTS.forEach((slot, si) => {
        const h = durationHours(r.cells[slot]);
        if (h == null) return;
        let bi = TIME_BUCKETS.findIndex((b) => h < b.max);
        if (bi < 0) bi = TIME_BUCKETS.length - 1;
        counts[si][bi]++;
      });
    }
    return { counts, jobs };
  }, [filteredRows]);

  const clearFilters = () => {
    setSearch("");
    setSelFilters({});
    setSubmittedFrom("");
    setSubmittedTo("");
    setCreatedFrom("");
    setCreatedTo("");
  };

  // ---- Saved configurations ----
  const refreshConfigs = () => {
    listReportConfigs()
      .then(setSavedConfigs)
      .catch(() => {});
  };
  useEffect(() => {
    refreshConfigs();
  }, []);

  // Apply a config passed via ?config=<id> (from the Saved Reports tab), once loaded.
  useEffect(() => {
    const id = searchParams.get("config");
    if (!id || savedConfigs.length === 0) return;
    const c = savedConfigs.find((x) => x.id === id);
    if (c) {
      setSelectedConfigId(id);
      applyConfig(c);
    }
    searchParams.delete("config");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConfigs]);

  const applyConfig = (c: SavedReportConfig) => {
    const cfg = c.config;
    setSource(cfg.source ?? "api");
    setSearch(cfg.search ?? "");
    setSelFilters(cfg.selFilters ?? {});
    setSubmittedFrom(cfg.submittedFrom ?? "");
    setSubmittedTo(cfg.submittedTo ?? "");
    setCreatedFrom(cfg.createdFrom ?? "");
    setCreatedTo(cfg.createdTo ?? "");
    setVisibleCols(cfg.visibleCols?.length ? orderColumns(cfg.visibleCols) : [...COLUMNS]);
  };

  const saveCurrent = async () => {
    const name = window.prompt("Name this configuration:");
    if (!name || !name.trim()) return;
    try {
      await saveReportConfig(name.trim(), {
        source,
        maxRecords,
        search,
        selFilters,
        submittedFrom,
        submittedTo,
        createdFrom,
        createdTo,
        visibleCols,
      });
      refreshConfigs();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const deleteSelected = async () => {
    if (!selectedConfigId) return;
    try {
      await deleteReportConfig(selectedConfigId);
      setSelectedConfigId("");
      refreshConfigs();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const run = async (refresh = false) => {
    setError(null);
    setResult(null);
    setFetchInfo(null);
    clearFilters();
    setBusy(true);
    try {
      let jobs, subs;
      if (source === "api") {
        setStatus(refresh ? "Refreshing from Ceipal (this can take a minute)…" : "Loading report…");
        const [jobJson, subJson] = await Promise.all([
          fetchCeipalReport("job_duration", { refresh }),
          fetchCeipalReport("submissions", { refresh }),
        ]);
        const jm = reportMeta(jobJson);
        const sm = reportMeta(subJson);
        const asOf = sm.cachedAt || jm.cachedAt;
        setFetchInfo(
          `${sm.fetched} submissions and ${jm.fetched} jobs` +
            (asOf ? ` · data as of ${new Date(asOf).toLocaleString()} (cached)` : " · freshly pulled from Ceipal")
        );
        jobs = parseJobsFromApi(jobJson);
        subs = parseSubmissionsFromApi(subJson);
      } else {
        if (!jobsFile || !subsFile) {
          throw new Error("Please upload both the Job Postings and the Submission Activities files.");
        }
        setStatus("Reading uploaded files…");
        const [jobSheets, subSheets] = await Promise.all([
          readWorkbookRows(jobsFile),
          readWorkbookRows(subsFile),
        ]);
        jobs = parseJobsFromSheets(jobSheets);
        subs = parseSubmissionsFromSheets(subSheets);
      }

      if (jobs.length === 0 && subs.length === 0) {
        throw new Error("No recognisable rows found. Check that the sources are the correct Ceipal reports.");
      }

      setStatus("Building report…");
      const report = buildReport(jobs, subs);
      setResult(report);
      setStatus("");
      logReportRun(source, report.rows.length, report.jobCount); // fire-and-forget
    } catch (err: unknown) {
      setError(friendlyError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!result) return;
    if (visibleCols.length === 0) {
      setError("Select at least one column to download.");
      return;
    }
    setBusy(true);
    try {
      // Record the filter basis inside the file so there's no confusion later.
      const flines: { label: string; value: string }[] = [];
      if (search) flines.push({ label: "Search", value: search });
      for (const col of SELECT_FILTERS) {
        const sel = selFilters[col];
        if (sel && sel.length) flines.push({ label: col, value: sel.join(", ") });
      }
      if (submittedFrom || submittedTo)
        flines.push({ label: "Submitted on", value: `${submittedFrom || "…"} to ${submittedTo || "…"}` });
      if (createdFrom || createdTo)
        flines.push({ label: "Job created on", value: `${createdFrom || "…"} to ${createdTo || "…"}` });

      const blob = await buildWorkbook(
        { ...result, rows: filteredRows },
        {
          generatedAt: (result.generatedAt ?? DateTime.now()).toFormat("yyyy-LL-dd HH:mm"),
          scope: maxRecords ? `Latest ${maxRecords} records per report` : "All records",
          rowCount: filteredRows.length,
          filters: flines,
          columns: visibleCols,
        }
      );
      const stamp = (result.generatedAt ?? DateTime.now()).toFormat("yyyy-LL-dd_HHmm");
      triggerDownload(blob, `Ceipal_Submissions_Report_${stamp}.xlsx`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Report Generation</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Build the flat submissions report from Ceipal. Preview it here, then download the
        formatted Excel file.
      </p>

      <div className="card">
        <h2 style={{ marginBottom: 0, fontSize: "1.05rem" }}>Saved configurations</h2>
        {savedConfigs.length > 0 ? (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem" }}>
            <select
              style={{ maxWidth: 460 }}
              value={selectedConfigId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedConfigId(id);
                const c = savedConfigs.find((x) => x.id === id);
                if (c) applyConfig(c);
              }}
            >
              <option value="">Load a saved configuration…</option>
              {savedConfigs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.createdAt ? ` — ${new Date(c.createdAt).toLocaleString()}` : ""}
                </option>
              ))}
            </select>
            {selectedConfigId && (
              <button className="btn ghost" onClick={deleteSelected}>Delete</button>
            )}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.9rem" }}>
            No saved configurations yet. Generate a report, set your filters, then click &quot;Save current&quot; in the Filters section to reuse them later.
          </p>
        )}
      </div>

      <div className="card">
        <div className="segmented" style={{ marginBottom: "1rem" }}>
          <button className={source === "api" ? "active" : ""} onClick={() => setSource("api")}>
            Pull from Ceipal API
          </button>
          <button className={source === "upload" ? "active" : ""} onClick={() => setSource("upload")}>
            Upload exports
          </button>
        </div>

        {source === "api" ? (
          <div className="alert info" style={{ marginBottom: 0 }}>
            The app authenticates to Ceipal and fetches <strong>every</strong> record from both
            reports through the secure Cloud Function, then builds the full report. Use the filters
            below to narrow it down after it loads.
          </div>
        ) : (
          <div className="row">
            <FileDrop
              label="Job Postings export"
              file={jobsFile}
              inputRef={jobsInput}
              onPick={setJobsFile}
            />
            <FileDrop
              label="Submission Activities export"
              file={subsFile}
              inputRef={subsInput}
              onPick={setSubsFile}
            />
          </div>
        )}

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => run(false)} disabled={busy}>
            {busy && status ? <span className="spinner" /> : "📊"} Generate report
          </button>
          {source === "api" && (
            <button className="btn secondary" onClick={() => run(true)} disabled={busy} title="Pull the latest data directly from Ceipal (slower)">
              ↻ Refresh from Ceipal
            </button>
          )}
          {status && <span className="muted">{status}</span>}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {fetchInfo && <div className="alert info">{fetchInfo}</div>}

      {result && (
        <>
          <div className="card">
            <div className="stat-grid">
              <Stat label="Jobs" value={result.jobCount} />
              <Stat label="Candidate rows" value={result.candidateCount} />
              <Stat label="Overdue (red)" value={result.redCount} />
              <Stat
                label="Report time (EST)"
                value={result.generatedAt ? result.generatedAt.toFormat("MM/dd HH:mm") : "—"}
              />
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="alert warn">
              <strong>Notes:</strong>
              <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
                {result.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.warnings.length > 8 && <li>…and {result.warnings.length - 8} more.</li>}
              </ul>
            </div>
          )}

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <h2 style={{ marginBottom: 0 }}>Filters</h2>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  {filteredRows.length} of {result.rows.length} rows
                </span>
                {anyFilter && (
                  <button className="btn ghost" style={{ padding: "0.25rem 0.6rem" }} onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
                <button className="btn secondary" onClick={saveCurrent}>💾 Save current</button>
                <button className="btn" onClick={download} disabled={busy}>⬇ Download Excel</button>
              </div>
            </div>
            <div className="filter-grid">
              <div className="field" style={{ margin: 0 }}>
                <label>Search (any field)</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Job code, candidate, client…"
                />
              </div>
              {SELECT_FILTERS.map((col) => (
                <MultiSelect
                  key={col}
                  label={col}
                  options={distinct[col] ?? []}
                  selected={selFilters[col] ?? []}
                  onChange={(next) => setSelFilters((s) => ({ ...s, [col]: next }))}
                />
              ))}
              <div className="field" style={{ margin: 0 }}>
                <label>Submitted from</label>
                <input type="date" value={submittedFrom} onChange={(e) => setSubmittedFrom(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Submitted to</label>
                <input type="date" value={submittedTo} onChange={(e) => setSubmittedTo(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Job created from</label>
                <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Job created to</label>
                <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <ColumnPicker all={COLUMNS} selected={visibleCols} onChange={setVisibleCols} />
          </div>

          <div className="card">
            <h2>Preview</h2>
            <p className="sub">
              {filteredRows.length} rows{anyFilter ? " (filtered)" : ""} ·{" "}
              {visibleCols.length} of {COLUMNS.length} columns. Peach = NA row, red = overdue
              0-submission job. Download exports <strong>all</strong> {filteredRows.length} rows (the whole set, not just this page).
            </p>
            {visibleCols.length === 0 ? (
              <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                No columns selected — pick some above to preview and export.
              </div>
            ) : (
              <>
                <div className="table-wrap" style={{ maxHeight: "65vh" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>#</th>
                        {visibleCols.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.pageItems.map((row, i) => (
                        <tr key={preview.startIndex + i} className={row.red ? "red" : row.na ? "na" : ""}>
                          <td className="muted">{preview.startIndex + i + 1}</td>
                          {visibleCols.map((c) => (
                            <td key={c}>{row.cells[c] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                      {filteredRows.length === 0 && (
                        <tr>
                          <td colSpan={visibleCols.length + 1} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                            No rows match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination page={preview.page} pageCount={preview.pageCount} total={preview.total} pageSize={preview.pageSize} onPage={preview.setPage} />
              </>
            )}
          </div>

          <div className="card">
            <h2>Submission time distribution</h2>
            <p className="sub">
              How long from job creation to each submission, counted once per job
              ({timeStats.jobs} job{timeStats.jobs === 1 ? "" : "s"} in view
              {anyFilter ? ", filtered" : ""}).
            </p>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", justifyContent: "space-around" }}>
              {TIME_SLOTS.map((slot, si) => (
                <PieChart
                  key={slot}
                  title={TIME_SLOT_TITLES[si]}
                  data={TIME_BUCKETS.map((b, bi) => ({
                    label: b.key,
                    value: timeStats.counts[si][bi],
                    color: b.color,
                  }))}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FileDrop({
  label,
  file,
  inputRef,
  onPick,
}: {
  label: string;
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onPick: (f: File | null) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div
        className={`dropzone ${file ? "filled" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
      >
        {file ? (
          <>
            <div>📎 {file.name}</div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>Click to replace</div>
          </>
        ) : (
          <>Drop the .xlsx here, or click to choose</>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
