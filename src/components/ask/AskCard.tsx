import { useState } from "react";
import { AskPlan, AskResult, sanitizePlan } from "../../lib/askEngine";
import { ASK_TABLES, tableByKey } from "../../lib/askCatalog";
import { downloadAskResultCsv, downloadAskResultXlsx } from "../../lib/askExport";
import { Lang } from "../../lib/indexGuide";
import PieChart from "../PieChart";
import BarChart from "../BarChart";
import MultiSelect from "../MultiSelect";
import Pagination, { usePagination } from "../Pagination";
import Modal from "../Modal";

const CHART_COLORS = ["#1F4E78", "#12b886", "#e0a800", "#c92a2a", "#7048e8", "#0ca678", "#f06595", "#495057"];

/** One result card in the Ask Anything feed: question, editable plan chips, summary, table, chart. */
export default function AskCard({
  question,
  result,
  loading,
  error,
  narratives,
  narrativeLang,
  narrativeLoading,
  onRerun,
  savesShared,
  onSave,
  onDismiss,
}: {
  question: string;
  result: AskResult | null;
  loading: boolean;
  error: string | null;
  narratives: Partial<Record<Lang, string>>;
  narrativeLang: Lang;
  narrativeLoading: boolean;
  onRerun: (plan: AskPlan) => void;
  /** Admins publish to the team; everyone else saves privately. Decided server-side — this is only what we promise. */
  savesShared: boolean;
  onSave: (name: string) => void;
  onDismiss: () => void;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(question.slice(0, 60));
  const board = usePagination(result?.rows ?? [], 10, undefined);

  if (loading) {
    return (
      <div className="card ask-card">
        <div className="ask-q">{question}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0" }}>
          <span className="spinner dark" /> <span className="muted">Working it out…</span>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="card ask-card">
        <div className="ask-q">{question}</div>
        <div className="alert error" style={{ marginBottom: 0 }}>{error || "Something went wrong."}</div>
        <button className="btn ghost" style={{ marginTop: "0.6rem" }} onClick={onDismiss}>Dismiss</button>
      </div>
    );
  }

  const plan = result.plan;
  const cat = tableByKey(plan.table)!;
  const chartColors = (result.chartData ?? []).map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  const patch = (p: Partial<AskPlan>) => onRerun(sanitizePlan({ ...plan, ...p }));
  const switchTable = (table: string) => onRerun(sanitizePlan({ table, title: plan.title }));
  const removeFilter = (idx: number) => patch({ filters: plan.filters.filter((_, i) => i !== idx) });

  const groupableCols = cat.columns.filter((c) => c.isGroupable);
  const metricCols = cat.columns.filter((c) => c.isMetric);

  return (
    <div className="card ask-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="ask-q">{question}</div>
          <h3 style={{ margin: "0.2rem 0 0" }}>{plan.title}</h3>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
          <button className="btn ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => setSaveOpen(true)} title="Save this query">
            💾
          </button>
          <button className="btn ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => downloadAskResultCsv(plan.title, result.columns, result.rows)} title="Download CSV">
            ⬇ CSV
          </button>
          <button className="btn ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={() => downloadAskResultXlsx(plan.title, result.columns, result.rows)} title="Download Excel">
            ⬇ Excel
          </button>
          <button className="btn ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={onDismiss} title="Remove from feed">✕</button>
        </div>
      </div>

      {/* Editable plan chips — tweak without asking again; re-runs instantly, no AI call. */}
      <div className="ask-chips">
        <label className="ask-chip-field">
          <span>Table</span>
          <select value={plan.table} onChange={(e) => switchTable(e.target.value)}>
            {ASK_TABLES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="ask-chip-field">
          <span>From</span>
          <input type="date" value={plan.dateFrom ?? ""} onChange={(e) => patch({ dateFrom: e.target.value || null })} />
        </label>
        <label className="ask-chip-field">
          <span>To</span>
          <input type="date" value={plan.dateTo ?? ""} onChange={(e) => patch({ dateTo: e.target.value || null })} />
        </label>
        <label className="ask-chip-field">
          <span>Group by</span>
          <select
            value={plan.groupBy ?? ""}
            onChange={(e) => patch({ groupBy: e.target.value || null, chart: e.target.value ? "pie" : "none" })}
          >
            <option value="">(none — list rows)</option>
            {groupableCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        {plan.groupBy && (
          <>
            <label className="ask-chip-field">
              <span>Measure</span>
              <select
                value={plan.metric.field ?? ""}
                onChange={(e) => patch({ metric: { field: e.target.value || null, agg: e.target.value ? "sum" : "count" } })}
              >
                <option value="">Count of rows</option>
                {metricCols.map((c) => <option key={c.key} value={c.key}>Sum of {c.label}</option>)}
              </select>
            </label>
            <label className="ask-chip-field">
              <span>Chart</span>
              <select value={plan.chart} onChange={(e) => patch({ chart: e.target.value as AskPlan["chart"] })}>
                <option value="pie">Pie</option>
                <option value="bar">Bar</option>
                <option value="none">Table only</option>
              </select>
            </label>
          </>
        )}
        {!plan.groupBy && (
          <div className="ask-chip-cols">
            <MultiSelect
              label="Columns"
              options={cat.columns.map((c) => c.label)}
              selected={plan.columns.map((k) => cat.columns.find((c) => c.key === k)?.label ?? k)}
              onChange={(labels) => {
                const keys = labels.map((l) => cat.columns.find((c) => c.label === l)?.key).filter((k): k is string => !!k);
                patch({ columns: keys });
              }}
            />
          </div>
        )}
      </div>

      {plan.filters.length > 0 && (
        <div className="ask-filters">
          {plan.filters.map((f, i) => (
            <span className="pill grey" key={`${f.field}-${i}`}>
              {cat.columns.find((c) => c.key === f.field)?.label ?? f.field} {f.op} {String(Array.isArray(f.value) ? f.value.join(", ") : f.value)}
              <button type="button" className="ask-filter-x" onClick={() => removeFilter(i)} aria-label="Remove filter">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Summary — grounded on the computed numbers, phrased in the app's current
          language (the floating switcher in the corner, not a per-card control —
          switching it re-narrates every card that doesn't already have that
          language cached; see AskAnything.tsx). */}
      <div className="ask-summary">
        {narrativeLoading ? (
          <p className="muted" style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
            <span className="spinner dark" /> Summarising…
          </p>
        ) : narratives[narrativeLang] ? (
          <p style={{ margin: 0 }}>{narratives[narrativeLang]}</p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {result.grouped
              ? `${result.totalRows} ${result.totalRows === 1 ? "group" : "groups"}, ${result.facts.totalRows} matching rows.`
              : `${result.totalRows} matching rows.`}
          </p>
        )}
      </div>

      {result.chartData && result.chartData.length > 0 && (
        <div className="card" style={{ background: "var(--brand-light)", marginBottom: "1rem" }}>
          {plan.chart === "bar" ? (
            <BarChart title={plan.title} data={result.chartData} />
          ) : (
            <PieChart title={plan.title} data={result.chartData.map((d, i) => ({ ...d, color: chartColors[i] }))} />
          )}
        </div>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {board.pageItems.map((r, i) => (
              <tr key={i}>
                {result.columns.map((c) => <td key={c.key} style={{ whiteSpace: "normal" }}>{r[c.key] ?? "—"}</td>)}
              </tr>
            ))}
            {board.pageItems.length === 0 && (
              <tr><td colSpan={result.columns.length} className="muted" style={{ textAlign: "center", padding: "1rem" }}>No matching rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={board.page} pageCount={board.pageCount} total={board.total} pageSize={board.pageSize} onPage={board.setPage} onPageSize={board.setPageSize} />
      {result.totalRows > result.rows.length && !result.grouped && (
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.4rem" }}>
          Showing the first {result.rows.length} of {result.totalRows} matching rows (raise the plan's limit to see more).
        </p>
      )}

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this query"
        footer={
          <>
            <button className="btn ghost" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button
              className="btn"
              onClick={() => { onSave(saveName.trim() || plan.title); setSaveOpen(false); }}
              disabled={!saveName.trim()}
            >
              Save
            </button>
          </>
        }
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Name</label>
          {/* type="text" is load-bearing: the global input styling keys off the attribute. */}
          <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Clients to reconsider" />
        </div>
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.6rem", marginBottom: 0 }}>
          {savesShared
            ? "As an admin, this is saved for everyone who can use this page."
            : "Only you will see this one."}{" "}
          Either way it re-runs instantly — no AI call needed.
        </p>
      </Modal>
    </div>
  );
}
