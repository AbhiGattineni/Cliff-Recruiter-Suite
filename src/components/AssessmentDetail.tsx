import { ResumeAssessment, normalizeAiLines, aiPercentOf } from "../lib/resume";
import { highlightKeywords } from "../lib/highlight";
import Section from "./Section";

// Fit assessment detail — used inline on Resume Parsing and inside the Resume
// Reports modal. Rendered as collapsible sections whose headers carry a summary
// pill, so a collapsed section still reports its headline finding.

export default function AssessmentDetail({ a, startIndex = 0 }: { a: ResumeAssessment; startIndex?: number }) {
  const aiLines = normalizeAiLines(a.aiGeneratedLines);
  const jdKeywords = (a.skillMatches ?? []).map((s) => s.skill);
  const aiPct = aiPercentOf(a);
  const aiClass =
    aiPct != null
      ? aiPct > 65 ? "red" : aiPct >= 30 ? "amber" : "green"
      : a.aiGeneratedLikelihood === "Low" ? "green" : a.aiGeneratedLikelihood === "High" ? "red" : "amber";

  const skills = a.skillMatches ?? [];
  const matched = skills.filter((s) => s.status === "matched").length;

  const details: [string, string | number | undefined][] = [
    ["Email", a.extracted?.email],
    ["Phone", a.extracted?.phone],
    ["Experience", a.extracted?.totalExperienceYears != null ? `${a.extracted.totalExperienceYears} yrs` : undefined],
    ["Current title", a.extracted?.currentTitle],
    ["Location", a.extracted?.location],
  ];
  const shown = details.filter(([, v]) => v != null && v !== "");

  return (
    <div>
      <Section
        title="Fit assessment"
        icon="🎯"
        index={startIndex}
        defaultOpen
        summary={
          <span className={`pill ${a.rating === "Strong" ? "green" : a.rating === "Weak" ? "red" : "amber"}`}>
            {a.strengths?.length ?? 0} strengths · {a.gaps?.length ?? 0} gaps
          </span>
        }
      >
        {a.summary && <p style={{ marginTop: 0 }}>{a.summary}</p>}
        <div className="row">
          <div>
            <h4 style={{ margin: "0 0 0.4rem", fontSize: "0.85rem", color: "var(--muted)" }}>Strengths</h4>
            {a.strengths?.length ? (
              <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
                {a.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>None noted.</p>
            )}
          </div>
          <div>
            <h4 style={{ margin: "0 0 0.4rem", fontSize: "0.85rem", color: "var(--muted)" }}>Gaps</h4>
            {a.gaps?.length ? (
              <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
                {a.gaps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>None noted.</p>
            )}
          </div>
        </div>

        {skills.length > 0 && (
          <>
            <h4 style={{ margin: "1rem 0 0.45rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              Skill match against the job description
            </h4>
            <div className="chips">
              {skills.map((s, i) => (
                <span className={`chip ${s.status}`} key={i} title={s.status}>
                  <span className="dot" aria-hidden="true" />
                  {s.skill}
                </span>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section
        title="AI-written content signal"
        icon="🤖"
        index={startIndex + 1}
        summary={
          <span className={`pill ${aiClass}`}>
            {aiPct != null ? `${aiPct}%` : a.aiGeneratedLikelihood}
            {aiLines.length > 0 ? ` · ${aiLines.length} lines` : ""}
          </span>
        }
      >
        {a.aiGeneratedConfidence && (
          <p className="muted" style={{ marginTop: 0, fontSize: "0.88rem" }}>{a.aiGeneratedConfidence}</p>
        )}
        {aiLines.length > 0 ? (
          <div className="ai-flags">
            <div className="ai-flags-head">⚠ Lines that read as AI-generated ({aiLines.length})</div>
            {jdKeywords.length > 0 && (
              <div className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.4rem" }}>
                <mark className="kw-hl">Highlighted</mark> = job-description skills in the point (possible
                keyword-stuffing).
              </div>
            )}
            {aiLines.map((line, i) => (
              <div className="ai-flag-line" key={i}>
                <span className="ai-tag">{Number.isFinite(line.score) ? `${Math.round(line.score)}%` : "AI"}</span>
                <span>
                  {highlightKeywords(line.text, jdKeywords).map((seg, j) =>
                    seg.match ? <mark className="kw-hl" key={j}>{seg.text}</mark> : <span key={j}>{seg.text}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>
            No specific lines were flagged as AI-generated.
          </p>
        )}
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.6rem", marginBottom: 0 }}>
          A probabilistic signal, not proof — treat it as one input alongside your own review.
        </p>
      </Section>

      {shown.length > 0 && (
        <Section
          title="Extracted details"
          icon="📇"
          index={startIndex + 2}
          summary={<span className="pill grey">{shown.length} fields</span>}
        >
          <div className="kv">
            {shown.map(([k, v]) => (
              <div className="kv-row" key={k}>
                <div className="kv-k">{k}</div>
                <div className="kv-v">{v}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
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
