import { describe, it, expect } from "vitest";
import { resumeSegments, countResumeLines, aiShare } from "./resumeLines";

const RESUME = `RICARDO E. VELEZ
Senior Cloud Automation Engineer
ricardo.velez@example.com | +1 (555) 010-2233 | linkedin.com/in/rvelez

PROFESSIONAL SUMMARY
Senior Cloud Automation and Infrastructure Engineer with 10+ years of hands-on experience delivering VMware-based Software Defined Data Center solutions at enterprise scale. I specialize in Aria Automation and Aria Orchestrator as the platform backbone for self-service provisioning.

EXPERIENCE
Dell Technologies — Austin, TX
2019 - Present
• At Dell Technologies I led a 12-person automation engineering team responsible for VMware Cloud Foundation environments spanning 10 global data centers.
• Architected and delivered an Aria Automation platform that provisioned over 50,000 VMs across 10 business units.
- Wrote the Python, PowerShell, and JavaScript that makes the automation work end to end.

SKILLS
VMware, Aria Automation, Python, PowerShell`;

describe("resumeSegments", () => {
  it("counts bullets and prose sentences, skipping headers and contact rows", () => {
    const segs = resumeSegments(RESUME);
    // 2 summary sentences + 3 bullets = 5
    expect(segs).toHaveLength(5);
    expect(segs.some((s) => s.startsWith("Senior Cloud Automation and Infrastructure Engineer"))).toBe(true);
    expect(segs.some((s) => s.startsWith("At Dell Technologies"))).toBe(true);
  });

  it("drops section headings and dates", () => {
    const segs = resumeSegments(RESUME);
    expect(segs).not.toContain("PROFESSIONAL SUMMARY");
    expect(segs).not.toContain("EXPERIENCE");
    expect(segs).not.toContain("SKILLS");
    expect(segs.some((s) => s.includes("2019 - Present"))).toBe(false);
  });

  it("drops the contact line", () => {
    expect(resumeSegments(RESUME).some((s) => s.includes("@example.com"))).toBe(false);
  });

  it("treats a multi-sentence bullet as one unit", () => {
    const segs = resumeSegments("• Built the platform end to end. It served ten business units reliably.");
    expect(segs).toHaveLength(1);
  });

  it("splits a prose paragraph into its sentences", () => {
    const segs = resumeSegments(
      "I designed the multi-site automation architecture from scratch. Then I wrote the tooling that operates it daily."
    );
    expect(segs).toHaveLength(2);
  });

  it("handles empty and whitespace input", () => {
    expect(countResumeLines("")).toBe(0);
    expect(countResumeLines("   \n\n  ")).toBe(0);
  });

  it("recognises several bullet glyphs and numbering", () => {
    const segs = resumeSegments(
      ["• First bullet describing a substantial achievement here.",
       "- Second bullet describing another substantial achievement.",
       "1. Third bullet describing yet another substantial achievement."].join("\n")
    );
    expect(segs).toHaveLength(3);
  });
});

describe("aiShare", () => {
  it("computes the measured share", () => {
    expect(aiShare(16, 42)).toEqual({ flagged: 16, total: 42, share: 38 });
  });

  it("returns null when the total is unknown, so callers can fall back", () => {
    expect(aiShare(16, null)).toBeNull();
    expect(aiShare(16, 0)).toBeNull();
    expect(aiShare(16, undefined)).toBeNull();
  });

  it("never reports more flagged than the total", () => {
    expect(aiShare(50, 40)).toEqual({ flagged: 40, total: 40, share: 100 });
  });
});
