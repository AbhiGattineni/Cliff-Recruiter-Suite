import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setServerNow, nowMs, todayInZone, serverClockKnown } from "./serverClock";

const ZONE = "America/New_York";
// 2026-09-02T04:30:00Z = 00:30 EDT on the 2nd — just past the Eastern rollover.
const REAL_NOW = Date.parse("2026-09-02T04:30:00Z");

describe("serverClock", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    // A browser whose system date is a week ahead.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-09T04:30:00Z"));
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  it("follows the server, not the machine's wrong clock", () => {
    setServerNow(REAL_NOW);
    expect(serverClockKnown()).toBe(true);
    expect(todayInZone(ZONE)).toBe("2026-09-02"); // not 2026-09-09
  });

  it("keeps following the server even if the system clock is changed afterwards", () => {
    setServerNow(REAL_NOW);
    // The user now drags the system date back a month, mid-session.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-02T04:30:00Z"));
    vi.spyOn(performance, "now").mockReturnValue(1000 + 60_000); // a real minute passed
    expect(todayInZone(ZONE)).toBe("2026-09-02");
    expect(nowMs()).toBe(REAL_NOW + 60_000);
  });

  it("advances with real elapsed time, so the day still rolls over", () => {
    setServerNow(Date.parse("2026-09-02T03:59:00Z")); // 23:59 EDT on the 1st
    expect(todayInZone(ZONE)).toBe("2026-09-01");
    vi.spyOn(performance, "now").mockReturnValue(1000 + 2 * 60_000); // two minutes later
    expect(todayInZone(ZONE)).toBe("2026-09-02");
  });

  it("ignores a nonsense server timestamp rather than corrupting the clock", () => {
    setServerNow(REAL_NOW);
    setServerNow(0);
    setServerNow(NaN);
    expect(todayInZone(ZONE)).toBe("2026-09-02");
  });
});
