import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listReportConfigs,
  deleteReportConfig,
  SavedReportConfig,
  ReportConfigData,
} from "../lib/reportConfigs";
import { friendlyError } from "../lib/errors";

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
  const [configs, setConfigs] = useState<SavedReportConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setConfigs(await listReportConfigs());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the saved report “${name}”?`)) return;
    try {
      await deleteReportConfig(id);
      setConfigs((cs) => (cs ? cs.filter((c) => c.id !== id) : cs));
    } catch (err) {
      setError(friendlyError(err));
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
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? <span className="spinner dark" /> : "⟳"} Refresh
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        {loading && !configs ? (
          <div className="center-load" style={{ minHeight: "30vh" }}>
            <div className="spinner dark" />
          </div>
        ) : configs && configs.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Saved</th>
                  <th>Source</th>
                  <th>Filters</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => open(c.id)}>
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
