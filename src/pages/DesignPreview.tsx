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
import { useState, useMemo } from "react";
import Pagination, { usePagination } from "../components/Pagination";
import IndexGuide from "../components/IndexGuide";
import { computeRecruiterStats } from "../lib/recruiterStats";
import { SubmissionEvent } from "../lib/report/types";
import { DateTime } from "luxon";
import ColumnFilter from "../components/ColumnFilter";
import { applyColumnFilters, optionsForColumn, activeFilterCount, ColumnSelections } from "../lib/columnFilter";
import { downloadResumeReportPdf } from "../lib/resumeReportPdf";
import { scoreLinkedin, verdictClass } from "../lib/linkedinScore";
import AskCard from "../components/ask/AskCard";
import { AskPlan, Row, runPlan, sanitizePlan } from "../lib/askEngine";
import { SUGGESTED_PROMPTS } from "../lib/askCatalog";
import { Lang } from "../lib/indexGuide";

// Enough rows to exercise every page size in the footer dropdown.
const DEMO_ROWS = Array.from({ length: 137 }, (_, i) => ({
  n: i + 1,
  client: ["Fannie Mae", "IBM", "Apple", "TCS", "cognizant"][i % 5],
  title: `Requirement ${i + 1}`,
  status: ["On Hold", "Closed", "Active"][i % 3],
}));

const DEMO_COLS = ["client", "title", "status"];

function PaginationDemo() {
  const [colFilters, setColFilters] = useState<ColumnSelections>({});
  const cellOf = (r: (typeof DEMO_ROWS)[number], col: string) =>
    (r as unknown as Record<string, string>)[col];
  const rows = applyColumnFilters(DEMO_ROWS, colFilters, cellOf);
  const count = activeFilterCount(colFilters);
  const setCol = (col: string, values: string[]) =>
    setColFilters((cur) => {
      const next = { ...cur };
      if (values.length) next[col] = values;
      else delete next[col];
      return next;
    });
  const p = usePagination(rows, 25, "designPreviewDemo");

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Table paging &amp; column filters</h3>
      <p className="muted" style={{ marginTop: "-0.25rem", fontSize: "0.85rem" }}>
        {DEMO_ROWS.length} sample rows. Tick values in a column header to narrow the table; the footer
        dropdown sets rows per page and is remembered per table.
      </p>
      {count > 0 && (
        <div className="colf-bar">
          <strong>Column filters</strong>
          {Object.entries(colFilters).map(([col, vals]) => (
            <span className="colf-chip" key={col}>
              {col}: {vals.length === 1 ? vals[0] : `${vals.length} values`}
              <button type="button" aria-label={`Clear ${col} filter`} onClick={() => setCol(col, [])}>×</button>
            </span>
          ))}
          <button className="btn ghost" style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }} onClick={() => setColFilters({})}>
            Clear all
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              {DEMO_COLS.map((c) => (
                <th key={c} className="colf-th">
                  <span className="colf-th-inner">
                    <span>{c}</span>
                    <ColumnFilter
                      column={c}
                      options={optionsForColumn(DEMO_ROWS, c, colFilters, cellOf)}
                      selected={colFilters[c] ?? []}
                      onChange={(v) => setCol(c, v)}
                    />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r, i) => (
              <tr key={r.n}>
                <td className="muted">{p.startIndex + i + 1}</td>
                <td>{r.client}</td>
                <td>{r.title}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={p.page}
        pageCount={p.pageCount}
        total={p.total}
        pageSize={p.pageSize}
        onPage={p.setPage}
        onPageSize={p.setPageSize}
      />
    </div>
  );
}

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

// A sample recruiter for the index guide.
const demoEvent = (cand: string, status: string, job: string): SubmissionEvent => ({
  jobCode: job,
  jobTitle: "Sample requirement",
  applicantName: cand,
  submittedBy: "Sample Recruiter",
  client: "Acme",
  submissionStatus: status,
  statusChangedOn: DateTime.fromISO("2026-08-04T10:00:00"),
  submittedOn: DateTime.fromISO("2026-08-01T10:00:00"),
  accountManager: "AM",
  jobCreatedOn: DateTime.fromISO("2026-07-01"),
});

function demoStat() {
  return computeRecruiterStats(
  [
    demoEvent("Cand A", "Submitted To Client", "J1"),
    demoEvent("Cand B", "Client Interview", "J1"),
    demoEvent("Cand C", "Submitted", "J2"),
  ],
  [],
  { periodScoped: true }
).stats[0];
}

// Ask Anything harness. Everything here is built lazily inside the component —
// see scripts/check-bundle.mjs for why a module-level call would be a problem.
function demoAskRows(): Row[] {
  const clients = ["Acme Health", "Northwind", "Globex", "Initech", "Umbrella", "Soylent", "Vandelay"];
  const statuses = ["Submitted", "Submitted To Client", "Client Interview", "Rejected", "Offer"];
  const recruiters = ["Ask Anything preview recruiter A", "Ask Anything preview recruiter B"];
  return Array.from({ length: 96 }, (_, i) => ({
    applicantName: `Candidate ${i + 1}`,
    jobCode: `REQ-${100 + (i % 12)}`,
    jobTitle: `Requirement ${1 + (i % 12)}`,
    client: clients[i % clients.length],
    recruiter: recruiters[i % recruiters.length],
    status: statuses[i % statuses.length],
    submittedOn: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}`,
    statusChangedOn: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}`,
    accountManager: "AM",
  }));
}

// The page furniture around the cards. Mirrors AskAnything.tsx's markup so the
// ask bar, prompt chips and saved-query list can be checked without signing in
// (the real page is behind the login gate and an admin/manager role).
function AskChromeDemo() {
  const [q, setQ] = useState("");
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Ask Anything page chrome</h3>
      <div className="ask-bar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Requirements received per client this month"
          aria-label="Ask a question about the data"
        />
        <button className="btn" type="button" disabled={!q.trim()}>🔎 Ask</button>
      </div>
      <div className="ask-prompts">
        {SUGGESTED_PROMPTS.map((p) => (
          <button key={p} type="button" className="ask-prompt" onClick={() => setQ(p)}>{p}</button>
        ))}
      </div>
      <h4 style={{ margin: "1rem 0 0.4rem", fontSize: "0.95rem" }}>Saved queries</h4>
      <div className="ask-saved">
        {[
          { n: "Clients to reconsider", shared: true },
          { n: "Hours logged per recruiter", shared: false },
          { n: "Open reqs with zero submissions", shared: false },
        ].map(({ n, shared }) => (
          <div className="ask-saved-item" key={n}>
            <button type="button">📌 {n}{shared && <span className="muted"> · Preview admin</span>}</button>
            <span className={`pill ${shared ? "green" : "grey"}`}>{shared ? "Shared" : "Private"}</span>
            <button type="button" className="ask-saved-del" aria-label={`Delete saved query ${n}`}>🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AskDemo() {
  const rows = useMemo(demoAskRows, []);
  const initial = useMemo(
    () =>
      sanitizePlan({
        table: "submissions",
        title: "Submissions by status",
        groupBy: "status",
        chart: "pie",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
        filters: [{ field: "client", op: "in", value: ["Acme Health", "Northwind", "Globex"] }],
      }),
    []
  );
  const [plan, setPlan] = useState<AskPlan | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const current = plan ?? initial;
  const result = useMemo(() => runPlan(rows, current), [rows, current]);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Ask Anything result card</h3>
      <p className="muted" style={{ marginTop: "-0.25rem", fontSize: "0.85rem" }}>
        Sample rows, no network. The chips re-run the query in the browser exactly as they do in the
        real page — the AI is never called for an edit.
      </p>
      <AskCard
        question="How are submissions going this month?"
        result={result}
        loading={false}
        error={null}
        narratives={{
          en: result.facts.topGroups.length
            ? `Across ${result.facts.totalRows} submissions this month, the largest group is ${result.facts.topGroups[0].label} with ${result.facts.topGroups[0].value}.`
            : `${result.facts.totalRows} submissions match this month.`,
          te: "ఈ నెల సబ్మిషన్లలో అతిపెద్ద విభాగం పైన చూపబడింది.",
          hi: "इस महीने के सबमिशन में सबसे बड़ा समूह ऊपर दिखाया गया है।",
        }}
        narrativeLang={lang}
        narrativeLoading={false}
        onLangChange={setLang}
        onRerun={setPlan}
        savesShared
        onSave={() => undefined}
        onDismiss={() => undefined}
      />
    </div>
  );
}

export default function DesignPreview() {
  const DEMO_STAT = useMemo(demoStat, []);
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

      <PaginationDemo />

      <AskChromeDemo />

      <AskDemo />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Performance index guide</h3>
        <p className="muted" style={{ marginTop: "-0.25rem", fontSize: "0.85rem" }}>
          Plain-language explanation with sample figures. Switch between English, Telugu and Hindi.
        </p>
        <IndexGuide stat={DEMO_STAT} />
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
