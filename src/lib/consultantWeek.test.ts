import { describe, it, expect } from "vitest";
import {
  weekStartOf,
  weekDays,
  isWeekStart,
  weekIsComplete,
  weekTotals,
  weekAmount,
  weekSubmitError,
  OT_THRESHOLD_HOURS,
} from "./consultantWeek";

// 2026-08-31 is a Monday; the week runs to Sunday 2026-09-06.
const MON = "2026-08-31";
const days = weekDays(MON);
const full = (h: number) => Object.fromEntries(days.slice(0, 5).map((d) => [d, h]));

describe("week boundaries", () => {
  it("finds the Monday of any day in the week, including the Sunday", () => {
    expect(weekStartOf(MON)).toBe(MON);
    expect(weekStartOf("2026-09-02")).toBe(MON); // Wednesday
    expect(weekStartOf("2026-09-06")).toBe(MON); // Sunday still belongs to it
    expect(weekStartOf("2026-09-07")).toBe("2026-09-07"); // next Monday
  });

  it("lists seven days, Monday first", () => {
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(MON);
    expect(days[6]).toBe("2026-09-06");
  });

  it("only accepts a Monday as a week id", () => {
    expect(isWeekStart(MON)).toBe(true);
    expect(isWeekStart("2026-09-01")).toBe(false);
    expect(isWeekStart("nonsense")).toBe(false);
  });

  it("knows when the week is over", () => {
    expect(weekIsComplete(MON, "2026-09-06")).toBe(false); // still Sunday
    expect(weekIsComplete(MON, "2026-09-07")).toBe(true);
  });
});

describe("totals and overtime", () => {
  it("splits at 40 hours across the week, not per day", () => {
    // 12 hours on one day is still 12 regular hours.
    const t = weekTotals({ [days[0]]: 12 }, MON);
    expect(t.total).toBe(12);
    expect(t.regular).toBe(12);
    expect(t.overtime).toBe(0);
    expect(t.daysWorked).toBe(1);
  });

  it("counts everything past 40 as overtime", () => {
    const t = weekTotals(full(9), MON); // 5 x 9 = 45
    expect(t.total).toBe(45);
    expect(t.regular).toBe(OT_THRESHOLD_HOURS);
    expect(t.overtime).toBe(5);
  });

  it("ignores days outside the week", () => {
    const t = weekTotals({ ...full(8), "2026-09-14": 8 }, MON);
    expect(t.total).toBe(40);
  });

  it("prices overtime at time and a half", () => {
    const t = weekTotals(full(9), MON); // 40 regular + 5 OT
    expect(weekAmount(t, 100)).toBe(40 * 100 + 5 * 150);
    expect(weekAmount(t, 100, 2)).toBe(40 * 100 + 5 * 200);
  });
});

describe("what blocks a submission", () => {
  const today = "2026-09-07"; // the Monday after, so the week is complete

  it("accepts an ordinary week", () => {
    expect(weekSubmitError(full(8), MON, today)).toBeNull();
  });

  it("refuses a week that doesn't start on a Monday", () => {
    expect(weekSubmitError({}, "2026-09-01", today)).toMatch(/Monday/);
  });

  it("refuses an empty week", () => {
    expect(weekSubmitError({}, MON, today)).toMatch(/Enter the hours/);
  });

  it("refuses a day outside the week", () => {
    expect(weekSubmitError({ "2026-09-20": 8 }, MON, today)).toMatch(/isn't in the week/);
  });

  it("refuses impossible hours", () => {
    expect(weekSubmitError({ [days[0]]: 25 }, MON, today)).toMatch(/more than 24/);
    expect(weekSubmitError({ [days[0]]: -1 }, MON, today)).toMatch(/must be a number/);
  });

  it("refuses hours booked against a day that hasn't happened", () => {
    // Mid-week: Friday hasn't come yet.
    expect(weekSubmitError({ [days[4]]: 8 }, MON, "2026-09-02")).toMatch(/hasn't happened yet/);
    // ...but the days already worked are fine.
    expect(weekSubmitError({ [days[0]]: 8 }, MON, "2026-09-02")).toBeNull();
  });
});
