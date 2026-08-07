import { describe, it, expect } from "vitest";
import { buildResumeReportPdf } from "./resumeReportPdf";
import { aiHeadline } from "./resume";
import { ResumeReport } from "./resumeReports";
import { scoreLinkedin } from "./linkedinScore";

// Exercises the PDF layout end-to-end (section cards, page breaks, chip
// wrapping) via the builder, so nothing is written to disk.

const base = (): ResumeReport => ({
  id: "t",
  provider: "openai",
  model: "gpt-4o-mini",
  createdAt: Date.UTC(2026, 6, 1),
  candidateName: "Test Candidate",
  fitScore: 74,
  rating: "Strong",
  summary: "A summary sentence.",
  strengths: ["One", "Two"],
  gaps: ["A gap"],
  skillMatches: [
    { skill: "React", status: "matched" },
    { skill: "GraphQL", status: "partial" },
    { skill: "Kubernetes", status: "missing" },
  ],
  aiGeneratedLikelihood: "Medium",
  aiGeneratedPercent: 40,
  aiGeneratedConfidence: "Templated phrasing.",
  aiGeneratedLines: [{ text: "Spearheaded a thing leveraging React.", score: 70 }],
  extracted: { email: "a@b.com", phone: "123", totalExperienceYears: 5, currentTitle: "Dev", location: "TX" },
});

describe("buildResumeReportPdf", () => {
  it("renders a minimal report without a portfolio or LinkedIn check", () => {
    const { doc, filename } = buildResumeReportPdf(base());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(filename).toBe("Resume_Assessment_Test_Candidate_2026-07-01.pdf");
  });

  it("renders the full report with portfolio and LinkedIn sections", () => {
    const r = base();
    r.githubUrl = "https://github.com/x";
    r.linkedinUrl = "https://linkedin.com/in/x";
    r.portfolio = {
      portfolioScore: 85,
      rating: "Strong",
      summary: "Good portfolio.",
      activityLevel: "Active",
      relevantRepos: [
        {
          name: "repo-a",
          url: "https://github.com/x/a",
          language: "TypeScript",
          stars: 5,
          lastPushed: "2026-06-01",
          whyRelevant: "Relevant because of React.",
        },
      ],
      skillEvidence: [{ skill: "React", status: "evidenced", note: "several repos" }],
      redFlags: ["Only forks"],
    };
    const signals = { accountAgeMonths: 3, connections: 20, recommendations: 0, positionsCount: 1 };
    r.linkedinCheck = {
      profileUrl: "https://linkedin.com/in/x",
      signals,
      assessment: scoreLinkedin(signals, 5),
      source: "manual",
      checkedAt: Date.UTC(2026, 6, 1),
    };
    const { doc } = buildResumeReportPdf(r);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("paginates rather than overflowing when content is long", () => {
    const r = base();
    r.summary = "Sentence. ".repeat(400);
    r.strengths = Array.from({ length: 40 }, (_, i) => `Strength ${i} with a reasonably long description.`);
    r.gaps = Array.from({ length: 40 }, (_, i) => `Gap ${i} with a reasonably long description.`);
    r.skillMatches = Array.from({ length: 60 }, (_, i) => ({ skill: `Skill ${i}`, status: "matched" as const }));
    r.aiGeneratedLines = Array.from({ length: 60 }, (_, i) => ({
      text: `Flagged line ${i} leveraging React and TypeScript.`,
      score: 60,
    }));
    const { doc } = buildResumeReportPdf(r);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it("handles missing and empty fields without throwing", () => {
    const r = base();
    r.candidateName = "";
    r.summary = "";
    r.strengths = [];
    r.gaps = [];
    r.skillMatches = [];
    r.aiGeneratedLines = [];
    r.extracted = {};
    r.createdAt = null;
    const { doc, filename } = buildResumeReportPdf(r);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(filename).toBe("Resume_Assessment_candidate_report.pdf");
  });

  it("keeps a legacy report with string-only AI lines working", () => {
    const r = base();
    r.aiGeneratedLines = ["An older report stored plain strings here."];
    const { doc } = buildResumeReportPdf(r);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});

// ---- One AI number everywhere ----------------------------------------------
// The reports table showed the model's holistic guess while the detail view and
// PDF showed the measured flagged-over-total, so the same report read e.g. 85%
// in the list and 13% once opened.

describe("aiHeadline", () => {
  it("prefers the measured share over the model's estimate", () => {
    const r = base();
    r.totalLines = 70;
    r.aiGeneratedPercent = 85; // model's guess
    r.aiGeneratedLines = Array.from({ length: 9 }, (_, i) => ({ text: `Line ${i}`, score: 70 }));
    const ai = aiHeadline(r);
    expect(ai.measured).toEqual({ flagged: 9, total: 70, share: 13 });
    expect(ai.pct).toBe(13);
    expect(ai.modelPct).toBe(85);
    expect(ai.label).toBe("13%");
  });

  it("falls back to the model's estimate when no line count was recorded", () => {
    const r = base();
    r.totalLines = undefined;
    r.aiGeneratedPercent = 85;
    const ai = aiHeadline(r);
    expect(ai.measured).toBeNull();
    expect(ai.pct).toBe(85);
  });

  it("tones by the displayed number, not the model's", () => {
    const r = base();
    r.totalLines = 70;
    r.aiGeneratedPercent = 85; // red on its own
    r.aiGeneratedLines = [{ text: "One line", score: 70 }];
    expect(aiHeadline(r).tone).toBe("green"); // 1/70 = 1%
  });

  it("never reports more flagged lines than the resume has", () => {
    const r = base();
    r.totalLines = 3;
    r.aiGeneratedLines = Array.from({ length: 9 }, (_, i) => ({ text: `Line ${i}`, score: 70 }));
    const ai = aiHeadline(r);
    expect(ai.measured!.flagged).toBe(3);
    expect(ai.pct).toBe(100);
  });

  it("uses the likelihood word when there is no number at all", () => {
    const r = base();
    r.totalLines = undefined;
    r.aiGeneratedPercent = undefined;
    r.aiGeneratedLines = [];
    r.aiGeneratedLikelihood = "Medium";
    const ai = aiHeadline(r);
    expect(ai.pct).toBeNull();
    expect(ai.label).toBe("Medium");
  });
});
