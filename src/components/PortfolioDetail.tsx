import { PortfolioAssessment, GithubProfile } from "../lib/github";

// GitHub portfolio assessment — shown on Resume Parsing after the fit
// assessment and inside the Resume Reports modal for saved reports.
export default function PortfolioDetail({
  portfolio,
  profile,
  githubUrl,
}: {
  portfolio: PortfolioAssessment;
  profile?: GithubProfile | null;
  githubUrl?: string;
}) {
  const ratingClass = portfolio.rating === "Strong" ? "green" : portfolio.rating === "Weak" ? "red" : "amber";
  const activityClass =
    portfolio.activityLevel === "Active" ? "green" : portfolio.activityLevel === "Dormant" ? "red" : "amber";
  const evidenceClass = (s: string) => (s === "evidenced" ? "green" : s === "partial" ? "amber" : "red");
  const url = githubUrl || profile?.url || "";

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        <span className={`pill ${ratingClass}`}>Portfolio: {portfolio.portfolioScore}/100 · {portfolio.rating}</span>
        <span className={`pill ${activityClass}`}>{portfolio.activityLevel}</span>
        {profile && (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {profile.publicRepos} public repos · {profile.followers} followers
            {profile.location ? ` · ${profile.location}` : ""}
          </span>
        )}
        {url && (
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: "0.85rem" }}>
            View profile ↗
          </a>
        )}
      </div>

      {portfolio.summary && <p style={{ marginTop: 0 }}>{portfolio.summary}</p>}

      {portfolio.redFlags?.length > 0 && (
        <div className="alert error" style={{ marginBottom: "0.75rem" }}>
          {portfolio.redFlags.map((f, i) => (
            <div key={i}>⚠ {f}</div>
          ))}
        </div>
      )}

      {portfolio.relevantRepos?.length > 0 ? (
        <>
          <h4 style={{ margin: "0.5rem 0 0.4rem" }}>Repositories relevant to this JD</h4>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Language</th>
                  <th>Stars</th>
                  <th>Last push</th>
                  <th>Why relevant</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.relevantRepos.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="muted">{r.language || "—"}</td>
                    <td>{r.stars > 0 ? `★ ${r.stars}` : "—"}</td>
                    <td className="muted">{r.lastPushed || "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>{r.whyRelevant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          No repositories relevant to this job description were found on the profile.
        </p>
      )}

      {portfolio.skillEvidence?.length > 0 && (
        <>
          <h4 style={{ margin: "0.9rem 0 0.4rem" }}>Skill evidence in public code</h4>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.skillEvidence.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "normal" }}>{e.skill}</td>
                    <td>
                      <span className={`pill ${evidenceClass(e.status)}`}>{e.status}</span>
                    </td>
                    <td className="muted" style={{ whiteSpace: "normal" }}>{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.5rem", marginBottom: 0 }}>
        Based only on public GitHub activity — private and employer work is invisible here, so treat a weak
        portfolio as absence of evidence, not evidence of absence.
      </p>
    </div>
  );
}
