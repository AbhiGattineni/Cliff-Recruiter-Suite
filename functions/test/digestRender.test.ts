import { describe, it, expect } from "vitest";
import { renderActivityHtml, renderActivityText, render, Activity } from "../src/digest";
import { buildStats } from "../src/recruiterStats";

const DAY = "2026-09-18";
const sub = (job: string, cand: string, by: string, posted: string, submitted: string) => ({
  JobCode: job,
  "Applicant Full Name": cand,
  "Submitted By": by,
  "Submission Status": "Submitted to Client",
  "Submitted On": submitted,
  "Job Created On": posted,
});

function activity(rows: Record<string, unknown>[], active: string[] = []): Activity {
  return {
    stats: buildStats(rows, active.map((c) => ({ JobCode: c })), DAY),
    source: "live",
    fetchedAt: Date.UTC(2026, 8, 18, 22, 30),
  };
}

const GREEN = "#e7f6ec";
const AMBER = "#fdf3da";
const RED = "#fdeaea";

describe("renderActivityHtml", () => {
  // Exactly one pill in the speed ladder carries a colour: the window the
  // legend sets a threshold for. Getting this wrong twice is why it is pinned.
  it("colours only the scored row of the speed ladder", () => {
    const a = activity([
      sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
      sub("B", "Bob Ray", "Ravi", "09/18/2026 08:00:00", "09/18/2026 20:00:00"),
    ]);
    const html = renderActivityHtml(a, "Thursday");

    const ladder = html.slice(html.indexOf("Answered within"), html.indexOf("By recruiter"));
    const coloured = [GREEN, AMBER, RED].reduce(
      (n, c) => n + ladder.split(c).length - 1,
      0
    );
    expect(coloured).toBe(1);
  });

  it("gives a fast recruiter green and a slow one red", () => {
    const html = renderActivityHtml(
      activity([
        sub("A", "Ann Lee", "Fastie", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
        sub("B", "Bob Ray", "Slowly", "09/18/2026 08:00:00", "09/18/2026 23:00:00"),
      ]),
      "Thursday"
    );
    // Rows sort by submissions then name, so with one each it is Fastie, Slowly.
    const table = html.slice(html.indexOf("By recruiter"));
    const fast = table.slice(table.indexOf("Fastie"), table.indexOf("Slowly"));
    const slow = table.slice(table.indexOf("Slowly"));
    expect(fast).toContain(GREEN);
    expect(slow).toContain(RED);
  });

  it("says so plainly when Ceipal could not be read, instead of showing zeroes", () => {
    const html = renderActivityHtml(
      { stats: buildStats([], [], DAY), source: "none", fetchedAt: 0, problem: "Ceipal auth failed (401)" },
      "Thursday"
    );
    expect(html).toContain("Ceipal auth failed (401)");
    expect(html).not.toContain("By recruiter");
  });

  it("escapes a recruiter name rather than letting it inject markup", () => {
    const html = renderActivityHtml(
      activity([sub("A", "Ann Lee", "<script>x</script>", "09/18/2026 08:00:00", "09/18/2026 09:00:00")]),
      "Thursday"
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderActivityText", () => {
  it("carries the same figures as the HTML", () => {
    const text = renderActivityText(
      activity(
        [
          sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
          sub("B", "Bob Ray", "Ravi", "09/18/2026 08:00:00", "09/18/2026 23:00:00"),
        ],
        ["A"]
      ),
      "Thursday"
    );
    expect(text).toContain("Open requirements: 1");
    expect(text).toContain("Submissions today: 2 (1 on open requirements)");
    expect(text).toContain("within 3h of posting: 1");
    expect(text).toContain("Ravi: 2 / 2 / 1 / 1,1,1 / 50%");
  });
});

describe("section order", () => {
  const brief = {
    overview: "An overview.",
    themes: ["A theme"],
    decisions: [],
    actionItems: [],
    risks: [],
  };
  const meetings = [
    { title: "Acme sync", date: "2026-09-18T14:00:00Z", organizer: "Ravi", participants: ["Ann"] },
  ];

  // The numbers come first because that is the half people act on before
  // breakfast; the brief is the read-when-you-have-a-minute half.
  it("puts recruiter activity above the meeting brief", () => {
    const a = activity([sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = render("Thursday", meetings as any, brief as any, 0, "m", "America/New_York", a);

    expect(c.html.indexOf("Recruiter activity")).toBeGreaterThan(-1);
    expect(c.html.indexOf("Recruiter activity")).toBeLessThan(c.html.indexOf("What was discussed"));
    expect(c.html.indexOf("What was discussed")).toBeLessThan(c.html.indexOf("Meetings covered"));

    expect(c.text.indexOf("Recruiter activity")).toBeLessThan(c.text.indexOf("What was discussed"));
  });

  // The blank-line separators in the text body have to ride on a non-empty
  // entry, because the builder filters "" out. A bare spacer silently vanishes.
  it("keeps blank lines between the text sections", () => {
    const a = activity([sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = render("Thursday", meetings as any, brief as any, 0, "m", "America/New_York", a);
    expect(c.text).toContain("\n\nRecruiter activity");
    expect(c.text).toContain("\n\nWhat was discussed");
  });
});
