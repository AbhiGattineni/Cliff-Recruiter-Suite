import { describe, it, expect } from "vitest";
import { scoreLinkedin } from "./linkedinScore";

describe("scoreLinkedin", () => {
  it("returns 'Not checked' when nothing is supplied", () => {
    const r = scoreLinkedin({});
    expect(r.verdict).toBe("Not checked");
    expect(r.known).toBe(0);
    expect(r.score).toBe(0);
  });

  it("flags a brand-new empty profile as High risk", () => {
    const r = scoreLinkedin({
      accountAgeMonths: 2,
      connections: 11,
      recommendations: 0,
      positionsCount: 1,
      endorsements: 0,
      hasPhoto: false,
      hasAbout: false,
      recentActivity: false,
    });
    expect(r.verdict).toBe("High risk");
    expect(r.redFlags).toContain("Profile was created less than 6 months ago.");
    expect(r.redFlags).toContain("No recommendations from anyone.");
  });

  it("rates a long-standing, well-connected profile as Established", () => {
    const r = scoreLinkedin({
      accountAgeMonths: 96,
      connections: 900,
      recommendations: 5,
      positionsCount: 4,
      endorsements: 40,
      hasPhoto: true,
      hasAbout: true,
      recentActivity: true,
    });
    expect(r.verdict).toBe("Established");
    expect(r.score).toBe(100);
    expect(r.redFlags).toHaveLength(0);
  });

  it("excludes unknown signals from the score instead of counting them as zero", () => {
    // Only two signals known, both strong — should not be dragged down by the rest.
    const r = scoreLinkedin({ connections: 800, recommendations: 4 });
    expect(r.known).toBe(2);
    expect(r.score).toBe(100);
    expect(r.verdict).toBe("Established");
  });

  it("does not call a new profile High risk when the known signals are strong", () => {
    const r = scoreLinkedin({
      accountAgeMonths: 3,
      connections: 700,
      recommendations: 4,
      positionsCount: 3,
      endorsements: 20,
      hasPhoto: true,
      hasAbout: true,
      recentActivity: true,
    });
    expect(r.verdict).not.toBe("High risk");
    expect(r.redFlags).toContain("Profile was created less than 6 months ago.");
  });

  it("needs at least two known signals before declaring High risk", () => {
    const r = scoreLinkedin({ accountAgeMonths: 1 });
    expect(r.known).toBe(1);
    expect(r.verdict).not.toBe("High risk");
  });

  it("cross-checks claimed resume experience against a new, empty profile", () => {
    const r = scoreLinkedin({ accountAgeMonths: 2, recommendations: 0, positionsCount: 0 }, 8);
    expect(r.redFlags.some((f) => f.includes("8 years"))).toBe(true);
  });

  it("does not raise the experience mismatch for an established profile", () => {
    const r = scoreLinkedin({ accountAgeMonths: 60, recommendations: 3, positionsCount: 4 }, 8);
    expect(r.redFlags.some((f) => f.includes("years of experience"))).toBe(false);
  });

  it("rates a thin but not brand-new profile as Thin", () => {
    const r = scoreLinkedin({
      accountAgeMonths: 24,
      connections: 20,
      recommendations: 0,
      positionsCount: 1,
      endorsements: 0,
      hasPhoto: false,
      hasAbout: false,
      recentActivity: false,
    });
    expect(r.verdict).toBe("Thin");
  });

  it("marks each supplied signal with a status and leaves absent ones unknown", () => {
    const r = scoreLinkedin({ connections: 600 });
    const conn = r.signals.find((s) => s.key === "connections")!;
    const recs = r.signals.find((s) => s.key === "recommendations")!;
    expect(conn.status).toBe("good");
    expect(conn.weight).toBeGreaterThan(0);
    expect(recs.status).toBe("unknown");
    expect(recs.weight).toBe(0);
  });
});
