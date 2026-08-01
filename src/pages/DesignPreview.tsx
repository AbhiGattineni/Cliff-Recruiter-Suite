// Dev-only harness for the assessment layout — renders the sections and the
// verdict band against fixed sample data so the design can be checked without
// signing in or spending an LLM call. Route is registered only when
// import.meta.env.DEV is true, so it never reaches production.

import { ResumeReport } from "../lib/resumeReports";
import AssessmentDetail from "../components/AssessmentDetail";
import PortfolioDetail from "../components/PortfolioDetail";
import { LinkedinVerdict } from "../components/LinkedinCheck";
import Section from "../components/Section";
import VerdictBand, { toneForScore } from "../components/VerdictBand";
import { downloadResumeReportPdf } from "../lib/resumeReportPdf";
import { scoreLinkedin, verdictClass } from "../lib/linkedinScore";

const liSignals = {
  accountAgeMonths: 30,
  connections: 180,
  recommendations: 1,
  positionsCount: 2,
  endorsements: 6,
  hasPhoto: true,
  hasAbout: false,
  recentActivity: false,
};
const liAssessment = scoreLinkedin(liSignals, 7);

const SAMPLE: ResumeReport = {
  id: "preview",
  provider: "openai",
  model: "gpt-4o-mini",
  createdAt: Date.now(),
  createdByName: "Abhishek Gattineni",
  createdByEmail: "abhishek.g@cliff-services.com",
  candidateName: "Priya Raghavan",
  fitScore: 82,
  rating: "Strong",
  summary:
    "Seven years of React and TypeScript with direct ownership of a design system at her current employer. Cloud deployment experience matches the requirement, though the role's Kubernetes and GraphQL expectations aren't evidenced anywhere in the resume.",
  strengths: [
    "Seven years of production React, including two years leading a component library used by four teams.",
    "Strong TypeScript throughout — types are described as part of the review process, not an afterthought.",
    "Owned CI/CD migration from Jenkins to GitHub Actions, cutting build times roughly in half.",
    "Direct experience deploying to Firebase and AWS, matching the JD's cloud requirement.",
  ],
  gaps: [
    "No Kubernetes exposure mentioned despite it being a listed must-have.",
    "GraphQL appears once as a bullet with no supporting detail.",
  ],
  skillMatches: [
    { skill: "React", status: "matched" },
    { skill: "TypeScript", status: "matched" },
    { skill: "CI/CD", status: "matched" },
    { skill: "Firebase / AWS", status: "matched" },
    { skill: "Design systems", status: "matched" },
    { skill: "GraphQL", status: "partial" },
    { skill: "Testing (Jest/RTL)", status: "partial" },
    { skill: "Kubernetes", status: "missing" },
  ],
  aiGeneratedLikelihood: "Medium",
  aiGeneratedPercent: 34,
  aiGeneratedConfidence:
    "Several bullets follow an identical verb-task-outcome rhythm with buzzword-heavy phrasing, while the surrounding sections read naturally.",
  aiGeneratedLines: [
    { text: "Spearheaded the migration of a legacy codebase, leveraging modern tooling to drive measurable impact.", score: 88 },
    { text: "Orchestrated cross-functional collaboration to streamline the delivery pipeline end to end.", score: 81 },
    { text: "Built robust, scalable React components with a solid command of TypeScript.", score: 62 },
  ],
  extracted: {
    email: "priya.raghavan@example.com",
    phone: "+1 (512) 555-0148",
    totalExperienceYears: 7,
    currentTitle: "Senior Frontend Engineer",
    location: "Austin, TX",
  },
  githubUrl: "https://github.com/praghavan",
  linkedinUrl: "https://linkedin.com/in/praghavan",
  githubProfile: {
    login: "praghavan",
    url: "https://github.com/praghavan",
    avatarUrl: "",
    name: "Priya Raghavan",
    bio: "Frontend engineer. Design systems, TypeScript.",
    location: "Austin, TX",
    company: "@acme",
    blog: "",
    publicRepos: 27,
    followers: 61,
    createdAt: "2016-03-11T00:00:00Z",
  },
  portfolio: {
    portfolioScore: 85,
    rating: "Strong",
    summary:
      "The portfolio backs up the resume's React and TypeScript claims with several substantial, recently-pushed original repositories. Component-library work is clearly visible. No Kubernetes or infrastructure code is present publicly.",
    activityLevel: "Active",
    relevantRepos: [
      {
        name: "atlas-ui",
        url: "https://github.com/praghavan/atlas-ui",
        language: "TypeScript",
        stars: 143,
        lastPushed: "2026-07-14",
        whyRelevant:
          "A published React component library with full TypeScript types and visual regression tests — direct evidence of the design-system ownership the JD asks for.",
      },
      {
        name: "vite-starter-ts",
        url: "https://github.com/praghavan/vite-starter-ts",
        language: "TypeScript",
        stars: 22,
        lastPushed: "2026-05-02",
        whyRelevant: "Modern build tooling with a GitHub Actions pipeline, matching the CI/CD requirement.",
      },
      {
        name: "weather-dash",
        url: "https://github.com/praghavan/weather-dash",
        language: "JavaScript",
        stars: 4,
        lastPushed: "2025-11-19",
        whyRelevant: "REST API integration and client-side state management in a small but complete application.",
      },
    ],
    skillEvidence: [
      { skill: "React", status: "evidenced", note: "Primary language across 11 original repos" },
      { skill: "TypeScript", status: "evidenced", note: "atlas-ui is fully typed with strict mode on" },
      { skill: "CI/CD", status: "evidenced", note: "GitHub Actions workflows in 3 repos" },
      { skill: "GraphQL", status: "partial", note: "One repo consumes a GraphQL API but doesn't build one" },
      { skill: "Kubernetes", status: "missing", note: "No public evidence" },
    ],
    redFlags: [],
  },
  linkedinCheck: {
    profileUrl: "https://linkedin.com/in/praghavan",
    signals: liSignals,
    assessment: liAssessment,
    source: "manual",
    checkedAt: Date.now(),
  },
  promptTokens: 3120,
  completionTokens: 890,
  totalTokens: 4010,
  cost: 0.00121,
};

export default function DesignPreview() {
  const pf = SAMPLE.portfolio!;
  const li = SAMPLE.linkedinCheck!;
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Design preview</h1>
          <p className="muted" style={{ marginTop: "0.2rem" }}>
            Sample data. Dev-only route — not registered in production builds.
          </p>
        </div>
        <button className="btn" onClick={() => downloadResumeReportPdf(SAMPLE)}>⬇ Download sample PDF</button>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h2 style={{ marginBottom: 0 }}>{SAMPLE.candidateName}</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
              Senior Frontend Engineer · 7 yrs · Austin, TX
            </p>
          </div>
          <span className="pill green">✓ Saved to Resume Reports</span>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <VerdictBand
            verdicts={[
              { label: "Resume fit", score: SAMPLE.fitScore, note: SAMPLE.rating, tone: "green" },
              {
                label: "GitHub portfolio",
                score: pf.portfolioScore,
                note: `${pf.rating} · ${pf.activityLevel.toLowerCase()}`,
                tone: toneForScore(pf.portfolioScore),
              },
              {
                label: "LinkedIn",
                score: li.assessment.score,
                note: li.assessment.verdict,
                tone: verdictClass(li.assessment.verdict) as "green" | "amber" | "red" | "grey",
              },
            ]}
          />
        </div>

        <div style={{ marginTop: "1rem" }}>
          <AssessmentDetail a={SAMPLE} />
          <Section
            title="GitHub portfolio vs JD"
            icon="💻"
            index={3}
            defaultOpen
            summary={<span className={`pill ${toneForScore(pf.portfolioScore)}`}>{pf.relevantRepos.length} relevant repos</span>}
          >
            <PortfolioDetail portfolio={pf} profile={SAMPLE.githubProfile ?? null} githubUrl={SAMPLE.githubUrl} />
          </Section>
          <Section
            title="LinkedIn profile check"
            icon="🔗"
            index={4}
            summary={<span className={`pill ${verdictClass(li.assessment.verdict)}`}>{li.assessment.verdict}</span>}
          >
            <LinkedinVerdict check={li} />
          </Section>
        </div>
      </div>
    </div>
  );
}
