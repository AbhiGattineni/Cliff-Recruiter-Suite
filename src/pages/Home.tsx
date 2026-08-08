import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "../lib/dashboard";
import { getLlmUsageSummary } from "../lib/resume";
import LlmUsagePanel from "../components/LlmUsagePanel";

export default function Home() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");
  const statsQ = useQuery({ queryKey: ["dashboardStats"], queryFn: () => getDashboardStats() });
  const usageQ = useQuery({ queryKey: ["llmUsageSummary"], queryFn: () => getLlmUsageSummary() });
  const stats = statsQ.data ?? null;
  const loading = statsQ.isLoading;

  return (
    <div>
      <h1>Recruiter Tools</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Cliff Services recruiter suite — pick a tool to begin.
      </p>

      {/* Launcher for Ask Anything. The question travels as ?q= and is answered there. */}
      <div className="card" style={{ marginTop: "1.25rem" }}>
        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault();
            const q = ask.trim();
            navigate(q ? `/ask?q=${encodeURIComponent(q)}` : "/ask");
          }}
        >
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask anything about your data… e.g. submissions by status this week"
            aria-label="Ask anything about your data"
          />
          <button className="btn" type="submit">🔎 Ask</button>
        </form>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginTop: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard label="Resumes assessed" value={stats?.resumesGenerated} loading={loading} />
        <StatCard label="Reports generated" value={stats?.reportsGenerated} loading={loading} />
        <StatCard label="Distinct candidates" value={stats?.distinctCandidates} loading={loading} />
        <StatCard label="Strong-fit" value={stats?.strongFit} loading={loading} />
        <StatCard label="Avg fit score" value={stats?.avgFitScore} loading={loading} />
        <StatCard label="AI-generated (High)" value={stats?.aiHigh} loading={loading} />
      </div>

      {stats && (stats.strongFit + stats.moderateFit + stats.weakFit) > 0 && (
        <div className="card" style={{ marginTop: "0.25rem" }}>
          <h2 style={{ fontSize: "1.05rem" }}>Fit breakdown</h2>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
            <span><span className="pill green">Strong</span> {stats.strongFit}</span>
            <span><span className="pill amber">Moderate</span> {stats.moderateFit}</span>
            <span><span className="pill red">Weak</span> {stats.weakFit}</span>
          </div>
        </div>
      )}

      <div style={{ marginTop: "0.25rem" }}>
        <LlmUsagePanel summary={usageQ.data} />
      </div>

      {/* Tools */}
      <div className="tool-grid" style={{ marginTop: "1.25rem" }}>
        <div className="card tool-card" onClick={() => navigate("/resume")}>
          <div className="icon">📄</div>
          <h2>Resume Parsing</h2>
          <p className="muted">
            Upload a candidate resume and a job description. Get a fit score, rating, a short
            review, a skill match, and a signal on how much of the resume looks AI-generated.
          </p>
          <button className="btn secondary">Open Resume Parsing</button>
        </div>

        <div className="card tool-card" onClick={() => navigate("/resume-reports")}>
          <div className="icon">🗂️</div>
          <h2>Resume Reports</h2>
          <p className="muted">
            Browse every resume assessment you&#39;ve generated, view the details, and download
            any report as a PDF.
          </p>
          <button className="btn secondary">Open Resume Reports</button>
        </div>

        <div className="card tool-card" onClick={() => navigate("/reports")}>
          <div className="icon">📊</div>
          <h2>Report Generation</h2>
          <p className="muted">
            Build the flat submissions report from Ceipal — pull live from the report APIs or
            upload the exports. Filter, preview, then download the formatted Excel file.
          </p>
          <button className="btn secondary">Open Report Generation</button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  return (
    <div className="stat">
      <div className="num">{loading ? "…" : value ?? 0}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}
