import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listResumeReports, ResumeReport } from "../lib/resumeReports";
import { aiPercentOf } from "../lib/resume";
import { downloadResumeReportPdf } from "../lib/resumeReportPdf";
import { friendlyError } from "../lib/errors";
import AssessmentDetail from "../components/AssessmentDetail";
import Modal from "../components/Modal";

const fmtCost = (n?: number) => (n && n > 0 ? `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}` : "—");
const fmtTok = (n?: number) => (n && n > 0 ? n.toLocaleString() : "—");

export default function ResumeReports() {
  const [reports, setReports] = useState<ResumeReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ResumeReport | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listResumeReports();
      setReports(list);
      // Auto-open a report if arriving via ?open=<id>
      const openId = searchParams.get("open");
      if (openId) {
        const match = list.find((r) => r.id === openId);
        if (match) setSelected(match);
        searchParams.delete("open");
        setSearchParams(searchParams, { replace: true });
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ratingPill = (rating: string) =>
    rating === "Strong" ? "green" : rating === "Weak" ? "red" : "amber";
  const aiPill = (v: string) => (v === "Low" ? "green" : v === "High" ? "red" : "amber");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Resume Reports</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            Every resume assessment you&#39;ve generated. Click a row to view details, or download a PDF.
          </p>
        </div>
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? <span className="spinner dark" /> : "⟳"} Refresh
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {reports && reports.length > 0 && (() => {
        const tok = reports.reduce((a, r) => a + (r.totalTokens || 0), 0);
        const cost = reports.reduce((a, r) => a + (r.cost || 0), 0);
        return (
          <div className="card">
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
              <strong>LLM usage (these {reports.length} reports)</strong>
              <span className="muted">{fmtTok(tok)} tokens</span>
              <span className="muted">Est. cost {fmtCost(cost)}</span>
            </div>
          </div>
        );
      })()}

      <div className="card">
        {loading && !reports ? (
          <div className="center-load" style={{ minHeight: "30vh" }}>
            <div className="spinner dark" />
          </div>
        ) : reports && reports.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Candidate</th>
                  <th>Fit</th>
                  <th>Rating</th>
                  <th>AI-generated</th>
                  <th>Model</th>
                  <th style={{ textAlign: "right" }}>Tokens</th>
                  <th style={{ textAlign: "right" }}>Est. cost</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setSelected(r)}>
                    <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                    <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{r.candidateName || "—"}</td>
                    <td>{Math.round(Number(r.fitScore) || 0)}</td>
                    <td><span className={`pill ${ratingPill(r.rating)}`}>{r.rating}</span></td>
                    <td>
                      {(() => {
                        const p = aiPercentOf(r);
                        const cls = p != null ? (p > 65 ? "red" : p >= 30 ? "amber" : "green") : aiPill(r.aiGeneratedLikelihood);
                        return <span className={`pill ${cls}`}>{p != null ? `${p}%` : r.aiGeneratedLikelihood}</span>;
                      })()}
                    </td>
                    <td className="muted" style={{ fontSize: "0.8rem" }}>{r.provider} / {r.model}</td>
                    <td style={{ textAlign: "right" }}>{fmtTok(r.totalTokens)}</td>
                    <td style={{ textAlign: "right" }}>{fmtCost(r.cost)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn secondary"
                        style={{ padding: "0.35rem 0.7rem" }}
                        onClick={() => downloadResumeReportPdf(r)}
                      >
                        ⬇ PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
            <p>No resume reports yet.</p>
            <p style={{ fontSize: "0.9rem" }}>
              Run an assessment on the <Link to="/resume">Resume Parsing</Link> tab and it will appear here.
            </p>
          </div>
        )}
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.candidateName || "Resume report"}
        footer={
          <>
            <button className="btn ghost" onClick={() => setSelected(null)}>Close</button>
            {selected && (
              <button className="btn" onClick={() => downloadResumeReportPdf(selected)}>
                ⬇ Download PDF
              </button>
            )}
          </>
        }
      >
        {selected && (
          <>
            <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
              {selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "—"} · {selected.provider} / {selected.model}
              {(selected.totalTokens ?? 0) > 0 && (
                <>
                  {" · "}
                  {fmtTok(selected.promptTokens)} in + {fmtTok(selected.completionTokens)} out ={" "}
                  {fmtTok(selected.totalTokens)} tokens · Est. cost {fmtCost(selected.cost)}
                </>
              )}
            </p>
            <AssessmentDetail a={selected} />
          </>
        )}
      </Modal>
    </div>
  );
}
