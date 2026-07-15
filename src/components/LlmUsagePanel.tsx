import { LlmUsageSummary } from "../lib/resume";

const fmtCost = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const fmtNum = (n: number) => n.toLocaleString();

// Cumulative LLM usage — overall totals + a per-model breakdown. Shown on the
// Dashboard and Resume Reports pages.
export default function LlmUsagePanel({ summary, compact = false }: { summary?: LlmUsageSummary; compact?: boolean }) {
  if (!summary || summary.count === 0) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: "1.05rem" }}>LLM usage to date</h2>
      <div className="stat-grid" style={{ marginBottom: summary.byModel.length ? "1rem" : 0 }}>
        <Stat label="Resumes assessed" value={fmtNum(summary.count)} />
        <Stat label="Total tokens" value={fmtNum(summary.totalTokens)} />
        <Stat label="Total est. cost" value={fmtCost(summary.totalCost)} />
        {summary.balance != null ? (
          <Stat label="Budget balance" value={`${fmtCost(summary.balance)} / ${fmtCost(summary.budget)}`} />
        ) : null}
      </div>

      {!compact && (summary.byModel.length > 0 || summary.byFeature.length > 0) && (
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          {summary.byModel.length > 0 && (
            <div className="table-wrap" style={{ flex: 1, minWidth: 260 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th style={{ textAlign: "right" }}>Calls</th>
                    <th style={{ textAlign: "right" }}>Tokens</th>
                    <th style={{ textAlign: "right" }}>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((m) => (
                    <tr key={`${m.provider}/${m.model}`}>
                      <td style={{ whiteSpace: "normal", fontWeight: 600 }}>
                        {m.provider ? `${m.provider} / ` : ""}{m.model}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtNum(m.count)}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(m.totalTokens)}</td>
                      <td style={{ textAlign: "right" }}>{fmtCost(m.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary.byFeature.length > 0 && (
            <div className="table-wrap" style={{ flex: 1, minWidth: 260 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th style={{ textAlign: "right" }}>Calls</th>
                    <th style={{ textAlign: "right" }}>Tokens</th>
                    <th style={{ textAlign: "right" }}>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byFeature.map((f) => (
                    <tr key={f.feature}>
                      <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{f.feature}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(f.count)}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(f.totalTokens)}</td>
                      <td style={{ textAlign: "right" }}>{fmtCost(f.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}
