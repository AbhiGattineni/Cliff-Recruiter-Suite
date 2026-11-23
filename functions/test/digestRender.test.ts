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

function activity(rows: Record<string, unknown>[], active: string[] = [], staff: string[] = []): Activity {
  const activeRows = active.map((c) => ({ JobCode: c }));
  return {
    stats: buildStats(rows, activeRows, DAY),
    source: "live",
    fetchedAt: Date.UTC(2026, 8, 18, 22, 30),
    activeOk: true,
    submissionRows: rows,
    activeRows,
    staff,
  };
}

/** The "Recruiters" table, from its heading to the end of the section. */
const table = (html: string) => html.slice(html.indexOf(">Recruiters<"));

describe("renderActivityHtml", () => {
  it("says Yes with the count for someone who submitted, and No for someone who didn't", () => {
    const html = renderActivityHtml(
      activity([
        sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
        sub("B", "Bob Ray", "Ravi", "09/18/2026 08:00:00", "09/18/2026 11:00:00"),
        sub("C", "Cy Dee", "Quiet One", "09/10/2026 08:00:00", "09/10/2026 09:00:00"),
      ]),
      "Thursday"
    );
    const t = table(html);
    const ravi = t.slice(t.indexOf("Ravi"), t.indexOf("Quiet One"));
    const quiet = t.slice(t.indexOf("Quiet One"));
    expect(ravi).toContain("Yes");
    expect(ravi).toContain("<strong>2</strong>");
    expect(quiet).toContain("No");
    expect(quiet).not.toContain("Yes");
  });

  it("lists the people who submitted first", () => {
    const html = renderActivityHtml(
      activity([
        sub("C", "Cy Dee", "Aaron Idle", "09/10/2026 08:00:00", "09/10/2026 09:00:00"),
        sub("A", "Ann Lee", "Zed Busy", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
      ]),
      "Thursday"
    );
    const t = table(html);
    expect(t.indexOf("Zed Busy")).toBeLessThan(t.indexOf("Aaron Idle"));
  });

  it("says so plainly when Ceipal could not be read, instead of showing zeroes", () => {
    const html = renderActivityHtml(
      {
        stats: buildStats([], [], DAY),
        source: "none",
        fetchedAt: 0,
        activeOk: false,
        problem: "Ceipal auth failed (401)",
        submissionRows: [],
        activeRows: [],
      },
      "Thursday"
    );
    expect(html).toContain("Ceipal auth failed (401)");
    expect(html).not.toContain(">Recruiters<");
  });

  it("escapes a recruiter name rather than letting it inject markup", () => {
    const html = renderActivityHtml(
      activity([sub("A", "Ann Lee", "<script>x</script>", "09/18/2026 08:00:00", "09/18/2026 09:00:00")]),
      "Thursday"
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("copes with an activity that has no raw rows attached", () => {
    const a = activity([sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (a as any).submissionRows;
    expect(() => renderActivityHtml(a, "Thursday")).not.toThrow();
  });
});

describe("renderActivityText", () => {
  it("carries the same figures as the HTML", () => {
    const text = renderActivityText(
      activity(
        [
          sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
          sub("B", "Bob Ray", "Ravi", "09/18/2026 08:00:00", "09/18/2026 23:00:00"),
          sub("C", "Cy Dee", "Quiet One", "09/10/2026 08:00:00", "09/10/2026 09:00:00"),
        ],
        ["A"]
      ),
      "Thursday"
    );
    expect(text).toContain("Open requirements: 1");
    expect(text).toContain("Submissions today: 2 (1 on open requirements)");
    expect(text).toContain("Ravi: Yes — 2");
    expect(text).toContain("Quiet One: No");
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

describe("open requirements", () => {
  const rows = [sub("A", "Ann Lee", "Ravi", "09/18/2026 08:00:00", "09/18/2026 09:00:00")];

  // A count nobody managed to read must not render as a confident "0" — that
  // is indistinguishable from "there genuinely are none".
  it("shows a dash, not zero, when the count could not be read", () => {
    const html = renderActivityHtml(
      {
        stats: buildStats(rows, [], DAY),
        source: "cache",
        fetchedAt: 1,
        activeOk: false,
        problem: "fetch failed (401)",
        submissionRows: rows,
        activeRows: [],
      },
      "Thursday"
    );
    expect(html).toContain("could not be read");
    expect(html).toContain("fetch failed (401)");
    expect(html).toContain("&mdash;");
    const card = html.slice(html.indexOf("Open requirements") - 400, html.indexOf("Open requirements"));
    expect(card).not.toMatch(/>0</);
  });

  it("shows the number when it was read", () => {
    const activeRows = [{ JobCode: "A" }, { JobCode: "B" }];
    const html = renderActivityHtml(
      { stats: buildStats(rows, activeRows, DAY), source: "live", fetchedAt: 1, activeOk: true, submissionRows: rows, activeRows },
      "Thursday"
    );
    expect(html).not.toContain("could not be read");
    expect(html).toContain(">2<");
  });
});

describe("the roster", () => {
  // The whole point of the table: a recruiter who sent nothing is the finding,
  // so they have to appear rather than silently drop out.
  it("lists everyone Ceipal has as a submitter, whatever the date", () => {
    const html = renderActivityHtml(
      activity([
        sub("A", "Ann Lee", "Busy One", "09/18/2026 08:00:00", "09/18/2026 09:00:00"),
        sub("B", "Bob Ray", "Long Gone", "01/10/2026 08:00:00", "01/10/2026 09:00:00"),
      ]),
      "Thursday"
    );
    expect(html).toContain("Busy One");
    expect(html).toContain("Long Gone");
  });

  it("adds portal bench sales recruiters, once each, even with no Ceipal submissions", () => {
    const html = renderActivityHtml(
      activity(
        [sub("A", "Ann Lee", "Ravi Kumar Reddy", "09/18/2026 08:00:00", "09/18/2026 09:00:00")],
        [],
        ["Ravi Kumar", "New Person"]
      ),
      "Thursday"
    );
    const t = table(html);
    expect(t).toContain("New Person");
    // "Ravi Kumar" in the portal is the same person as Ceipal's "Ravi Kumar Reddy".
    expect(t.split("Ravi Kumar").length - 1).toBe(1);
  });
});