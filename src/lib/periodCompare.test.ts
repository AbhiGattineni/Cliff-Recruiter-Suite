import { describe, it, expect } from "vitest";
import {
  calendarDays,
  workingDays,
  previousPeriod,
  shiftedBack,
  overlaps,
  isCompletePeriod,
  delta,
  compareRecruiters,
  compareTeam,
} from "./periodCompare";
import { RecruiterStat, PipelineStage } from "./recruiterStats";

// Only the fields the comparison reads; the rest of RecruiterStat is irrelevant here.
const stat = (name: string, over: Partial<RecruiterStat> = {}): RecruiterStat =>
  ({
    name,
    requirements: 0,
    profiles: 0,
    counts: {},
    clientCount: 0,
    clientRate: 0,
    progressRate: 0,
    assignedCount: 0,
    targetBasis: "worked",
    targetBaseCount: 0,
    clientTarget: 0,
    index: 0,
    stageCounts: {} as Record<PipelineStage, number>,
    indexParts: { offer: 0, client: 0, vendor: 0, coverage: 0 },
    rows: [],
    jobGroups: [],
    noSubCount: 0,
    ...over,
  }) as RecruiterStat;

describe("period arithmetic", () => {
  it("counts calendar days inclusively", () => {
    expect(calendarDays({ from: "2026-08-26", to: "2026-09-04" })).toBe(10);
    expect(calendarDays({ from: "2026-08-26", to: "2026-08-26" })).toBe(1);
  });

  it("counts working days, skipping weekends", () => {
    // 26–28 Aug is Wed–Fri, 29–30 the weekend, 31 Aug–4 Sep Mon–Fri.
    expect(workingDays({ from: "2026-08-26", to: "2026-09-04" })).toBe(8);
    expect(workingDays({ from: "2026-08-29", to: "2026-08-30" })).toBe(0);
  });

  it("puts the previous period immediately before, at equal length", () => {
    expect(previousPeriod({ from: "2026-08-26", to: "2026-09-04" })).toEqual({
      from: "2026-08-16",
      to: "2026-08-25",
    });
  });

  it("shifts a period back whole months", () => {
    expect(shiftedBack({ from: "2026-08-26", to: "2026-09-04" }, 1)).toEqual({
      from: "2026-07-26",
      to: "2026-08-04",
    });
  });

  it("rejects an incomplete or backwards range instead of guessing", () => {
    expect(isCompletePeriod({ from: "", to: "2026-09-04" })).toBe(false);
    expect(isCompletePeriod({ from: "2026-09-04", to: "2026-08-26" })).toBe(false);
    expect(previousPeriod({ from: "", to: "" })).toBeNull();
    expect(workingDays({ from: "", to: "" })).toBe(0);
  });

  it("detects an overlapping baseline", () => {
    const cur = { from: "2026-08-26", to: "2026-09-04" };
    expect(overlaps(cur, { from: "2026-08-16", to: "2026-08-25" })).toBe(false);
    expect(overlaps(cur, { from: "2026-08-20", to: "2026-08-27" })).toBe(true);
  });
});

describe("delta", () => {
  it("compares counts per working day, so unequal ranges are honest", () => {
    // 20 over 10 days vs 15 over 5: fewer per day despite the bigger total.
    const d = delta(20, 15, 10, 5);
    expect(d.currentRate).toBe(2);
    expect(d.baselineRate).toBe(3);
    expect(d.pct).toBe(-33);
  });

  it("leaves a score alone rather than dividing it by days", () => {
    const d = delta(60, 50, 10, 5, "score");
    expect(d.currentRate).toBe(60);
    expect(d.pct).toBe(20);
  });

  it("has no percentage when there is nothing to divide by", () => {
    expect(delta(5, 0, 5, 5).pct).toBeNull();
    expect(delta(0, 0, 5, 5).pct).toBeNull();
  });

  it("survives a zero-length range without dividing by zero", () => {
    const d = delta(5, 5, 0, 0);
    expect(d.currentRate).toBe(0);
    expect(d.pct).toBeNull();
  });
});

describe("compareRecruiters", () => {
  const current = [
    stat("Abhishek Kc", { profiles: 10, clientCount: 4, index: 60 }),
    stat("Juhi Sinha", { profiles: 3, clientCount: 0, index: 20 }),
  ];
  const baseline = [
    stat("abhishek  kc", { profiles: 8, clientCount: 4, index: 50 }), // same person, messy name
    stat("Guru Deepthi", { profiles: 9, clientCount: 3, index: 55 }),
  ];
  const rows = compareRecruiters(current, baseline, 10, 10);
  const byName = (n: string) => rows.find((r) => r.name === n)!;

  it("matches people across periods regardless of name spacing or case", () => {
    expect(byName("Abhishek Kc").presence).toBe("both");
    expect(byName("Abhishek Kc").metrics.profiles.pct).toBe(25);
  });

  it("marks someone who only worked in the new period as new, not as infinite growth", () => {
    expect(byName("Juhi Sinha").presence).toBe("new");
    expect(byName("Juhi Sinha").metrics.profiles.pct).toBeNull();
  });

  it("keeps someone who only worked in the old period, so a drop-off is visible", () => {
    const gone = byName("Guru Deepthi");
    expect(gone.presence).toBe("gone");
    expect(gone.metrics.profiles.current).toBe(0);
    expect(gone.metrics.profiles.baseline).toBe(9);
  });

  it("reads offers from the pipeline stage counts", () => {
    const rows2 = compareRecruiters(
      [stat("A", { stageCounts: { offerAccepted: 2 } as Record<PipelineStage, number> })],
      [stat("A", { stageCounts: { offerAccepted: 1 } as Record<PipelineStage, number> })],
      5,
      5
    );
    expect(rows2[0].metrics.offers.pct).toBe(100);
  });
});

describe("compareTeam", () => {
  const current = [
    stat("A", { profiles: 10, clientCount: 5, index: 60 }),
    stat("B", { profiles: 10, clientCount: 1, index: 40 }),
  ];
  const baseline = [stat("A", { profiles: 10, clientCount: 5, index: 50 })];

  it("sums counts but averages the index", () => {
    const t = compareTeam(current, baseline, 10, 10);
    expect(t.metrics.profiles.current).toBe(20);
    expect(t.metrics.index.current).toBe(50); // (60+40)/2, not 100
    expect(t.metrics.index.baseline).toBe(50);
  });

  it("reports conversion, which more volume can quietly dilute", () => {
    const t = compareTeam(current, baseline, 10, 10);
    // Twice the profiles, only one more client submission: 50% -> 30%.
    expect(t.metrics.profiles.pct).toBe(100);
    expect(t.conversion.current).toBe(30);
    expect(t.conversion.baseline).toBe(50);
    expect(t.conversion.pct).toBe(-40);
  });

  it("reports headcount, so a change in team size is not read as performance", () => {
    expect(compareTeam(current, baseline, 10, 10).people).toEqual({ current: 2, baseline: 1 });
  });

  it("handles an empty baseline without dividing by zero", () => {
    const t = compareTeam(current, [], 10, 10);
    expect(t.metrics.profiles.pct).toBeNull();
    expect(t.metrics.index.baseline).toBe(0);
  });
});
