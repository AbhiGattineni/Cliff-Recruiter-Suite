import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listReportConfigs,
  deleteReportConfig,
  SavedReportConfig,
  ReportConfigData,
} from "../lib/reportConfigs";
import { friendlyError } from "../lib/errors";
import Pagination, { usePagination } from "../components/Pagination";

// One-line human summary of the filters saved in a configuration.
function summarizeFilters(cfg: ReportConfigData): string {
  const parts: string[] = [];
  if (cfg.search) parts.push(`Search: “${cfg.search}”`);
  for (const [col, vals] of Object.entries(cfg.selFilters ?? {})) {
    if (vals && vals.length) parts.push(`${col}: ${vals.join(", ")}`);
  }
  if (cfg.submittedFrom || cfg.submittedTo)
    parts.push(`Submitted ${cfg.submittedFrom || "…"} → ${cfg.submittedTo || "…"}`);
  if (cfg.createdFrom || cfg.createdTo)
    parts.push(`Created ${cfg.createdFrom || "…"} → ${cfg.createdTo || "…"}`);
  return parts.length ? parts.join(" · ") : "No filters (full report)";
}

export default function SavedReports() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const configsQ = useQuery({ queryKey: ["reportConfigs"], queryFn: () => listReportConfigs() });
  const configs: SavedReportConfig[] = configsQ.data ?? [];
  const { page, setPage, pageCount, pageItems, pageSize, total, startIndex } = usePagination(configs, 25);
  const error = configsQ.error ? friendlyError(configsQ.error) : null;

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the saved report “${name}”?`)) return;
    try {
      await deleteReportConfig(id);
      qc.invalidateQueries({ queryKey: ["reportConfigs"] });
    } catch (err) {
      window.alert(friendlyError(err));
    }
  };

  const open = (id: string) => navigate(`/reports?config=${encodeURIComponent(id)}`);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Saved Reports</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            Report configurations you&#39;ve saved. Open one to load its filters on the Report
            Generation tab, then generate and download.
          </p>
        </div>
        <button className="btn secondary" onClick={() => configsQ.refetch()} disabled={configsQ.isFetching}>
          {configsQ.isFetching ? <span className="spinner dark" /> : "⟳"} Refresh
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        {configsQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "30vh" }}>
            <div className="spinner dark" />
          </div>
        ) : configs.length > 0 ? (
          <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Name</th>
                  <th>Saved</th>
                  <th>Source</th>
                  <th>Filters</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((c, i) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => open(c.id)}>
                    <td className="muted">{startIndex + i + 1}</td>
                    <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{c.name}</td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>
                      {c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>
                      {c.config.source === "upload" ? "Upload" : "Ceipal API"}
                    </td>
                    <td style={{ whiteSpace: "normal", fontSize: "0.85rem" }}>
                      {summarizeFilters(c.config)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn"
                        style={{ padding: "0.35rem 0.7rem", marginRight: "0.4rem" }}
                        onClick={() => open(c.id)}
                      >
                        Open
                      </button>
                      <button
                        className="btn ghost"
                        style={{ padding: "0.35rem 0.7rem" }}
                        onClick={() => remove(c.id, c.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} />
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
            <p>No saved reports yet.</p>
            <p style={{ fontSize: "0.9rem" }}>
              On the <Link to="/reports">Report Generation</Link> tab, set your filters and click
              &quot;Save current&quot; in the Filters section — it will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
