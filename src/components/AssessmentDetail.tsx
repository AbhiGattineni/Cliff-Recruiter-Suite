import { ResumeAssessment } from "../lib/resume";

// Full assessment detail — used inline on Resume Parsing and inside the
// Resume Reports modal. AI-generated lines are highlighted to stand out.
export default function AssessmentDetail({ a }: { a: ResumeAssessment }) {
  const ratingClass = a.rating === "Strong" ? "green" : a.rating === "Weak" ? "red" : "amber";
  const aiClass =
    a.aiGeneratedLikelihood === "Low" ? "green" : a.aiGeneratedLikelihood === "High" ? "red" : "amber";
  const aiLines = a.aiGeneratedLines ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <ScoreDial score={a.fitScore} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
            <span className={`pill ${ratingClass}`}>Fit: {a.rating}</span>
            <span className={`pill ${aiClass}`}>AI-generated: {a.aiGeneratedLikelihood}</span>
            {a.extracted?.currentTitle && <span className="pill grey">{a.extracted.currentTitle}</span>}
            {a.extracted?.totalExperienceYears != null && (
              <span className="pill grey">{a.extracted.totalExperienceYears} yrs exp</span>
            )}
          </div>
          <p style={{ margin: 0 }}>{a.summary}</p>
        </div>
      </div>

      <div className="row">
        <div>
          <h3>Strengths</h3>
          {a.strengths?.length ? (
            <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
              {a.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          ) : (
            <p className="muted">None noted.</p>
          )}
        </div>
        <div>
          <h3>Gaps</h3>
          {a.gaps?.length ? (
            <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
              {a.gaps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          ) : (
            <p className="muted">None noted.</p>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: "1rem" }}>Skill match</h3>
      {a.skillMatches?.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Skill</th><th>Status</th></tr></thead>
            <tbody>
              {a.skillMatches.map((s, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "normal" }}>{s.skill}</td>
                  <td>
                    <span className={`pill ${s.status === "matched" ? "green" : s.status === "partial" ? "amber" : "red"}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No skills listed.</p>
      )}

      <h3 style={{ marginTop: "1rem" }}>AI-generated content signal</h3>
      <p style={{ marginBottom: "0.5rem" }}>
        <span className={`pill ${aiClass}`}>{a.aiGeneratedLikelihood} likelihood</span>{" "}
        <span className="muted">{a.aiGeneratedConfidence}</span>
      </p>

      {aiLines.length > 0 ? (
        <div className="ai-flags">
          <div className="ai-flags-head">
            ⚠ Lines that read as AI-generated ({aiLines.length})
          </div>
          {aiLines.map((line, i) => (
            <div className="ai-flag-line" key={i}>
              <span className="ai-tag">AI</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          No specific lines were flagged as AI-generated.
        </p>
      )}
      <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
        This is a probabilistic signal, not proof — treat it as one input alongside your own review.
      </p>

      <h3 style={{ marginTop: "1rem" }}>Extracted details</h3>
      <div className="stat-grid">
        {(
          [
            ["Email", a.extracted?.email],
            ["Phone", a.extracted?.phone],
            ["Experience", a.extracted?.totalExperienceYears != null ? `${a.extracted.totalExperienceYears} yrs` : undefined],
            ["Title", a.extracted?.currentTitle],
            ["Location", a.extracted?.location],
          ] as [string, string | number | undefined][]
        )
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => (
            <div className="stat" key={k}>
              <div className="lbl">{k}</div>
              <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{v}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

export function ScoreDial({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = clamped >= 70 ? "#1e7e34" : clamped >= 45 ? "#a9700a" : "#9c0006";
  const deg = clamped * 3.6;
  return (
    <div
      style={{
        width: 120, height: 120, borderRadius: "50%",
        background: `conic-gradient(${color} ${deg}deg, #e6ebf1 ${deg}deg)`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      <div style={{ width: 92, height: 92, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: "1.7rem", fontWeight: 700, color }}>{clamped}</div>
        <div className="muted" style={{ fontSize: "0.72rem" }}>fit score</div>
      </div>
    </div>
  );
}
