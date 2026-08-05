import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { computeRecruiterStats, funnelOf, eventDate, filterByActivity } from "./recruiterStats";
import { SubmissionEvent, JobRecord } from "./report/types";

function job(over: Partial<JobRecord>): JobRecord {
  return {
    jobCode: "", jobTitle: "", client: "", jobStatus: "", jobCreatedOn: null,
    numOfSubmissions: null, internalScreeningRequired: "", recruitmentManager: "",
    payRate: "", jobModifiedOn: null, jobDescription: "", experience: "",
    mandateSkills: "", comments: "", assignedTo: "", ...over,
  };
}

function ev(
  recruiter: string,
  jobCode: string,
  applicant: string,
  status: string,
  tsMs: number
): SubmissionEvent {
  return {
    jobCode,
    jobTitle: "T",
    applicantName: applicant,
    submittedBy: recruiter,
    client: "C",
    submissionStatus: status,
    statusChangedOn: DateTime.fromMillis(tsMs),
    submittedOn: DateTime.fromMillis(tsMs),
    accountManager: "AM",
    jobCreatedOn: DateTime.fromMillis(0),
  };
}

describe("funnelOf", () => {
  it("separates Submitted (to AM) from Client/Vendor Submission", () => {
    expect(funnelOf("Submitted")).toBe("submitted");
    expect(funnelOf("Submitted to Client")).toBe("client");
    expect(funnelOf("Vendor Submission")).toBe("client");
  });
  it("returns unknown for unrecognised statuses (they keep their own label)", () => {
    expect(funnelOf("Paperwork Pending")).toBe("unknown");
  });
});

describe("computeRecruiterStats", () => {
  const subs: SubmissionEvent[] = [
    // Alice / John: submitted → later moved to client submission (latest wins)
    ev("Alice", "CS-1", "John", "Submitted", 1000),
    ev("Alice", "CS-1", "John", "Submitted to Client", 2000),
    // Alice / Sam: submitted to VENDOR — merges with client submission
    ev("Alice", "CS-4", "Sam", "Submitted to Vendor", 1800),
    // Alice / Jane on another req: waiting
    ev("Alice", "CS-2", "Jane", "Waiting for Evaluation", 1500),
    // Bob / Ravi: an unusual status — must keep its own name, not "Other"
    ev("Bob", "CS-1", "Ravi", "Paperwork Pending", 1200),
    // empty recruiter — ignored
    ev("", "CS-3", "Nobody", "Submitted", 900),
  ];

  const { stats, statuses } = computeRecruiterStats(subs);

  it("ignores empty recruiters", () => {
    expect(stats.map((s) => s.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("merges client & vendor submissions into one status, uses the latest status", () => {
    const alice = stats.find((s) => s.name === "Alice")!;
    expect(alice.counts["Client / Vendor Submission"]).toBe(2); // John (client) + Sam (vendor)
    expect(alice.counts["Waiting for Evaluation"]).toBe(1);
    expect(alice.counts["Submitted"]).toBeUndefined(); // John moved on; not double-counted
    expect(alice.profiles).toBe(3);
    expect(alice.requirements).toBe(3);
    expect(alice.clientCount).toBe(2);
    expect(alice.clientRate).toBeCloseTo(2 / 3);
  });

  it("never invents an 'Other' bucket — unknown statuses keep their name", () => {
    const bob = stats.find((s) => s.name === "Bob")!;
    expect(bob.counts["Paperwork Pending"]).toBe(1);
    expect(statuses.map((s) => s.label)).toContain("Paperwork Pending");
    expect(statuses.map((s) => s.label)).not.toContain("Other");
  });

  it("orders statuses by funnel and ranks the stronger recruiter first", () => {
    const labels = statuses.map((s) => s.label);
    expect(labels.indexOf("Client / Vendor Submission")).toBeLessThan(labels.indexOf("Waiting for Evaluation"));
    expect(stats[0].name).toBe("Alice");
    expect(stats[0].index).toBeGreaterThan(stats[1].index);
  });
});

describe("assigned requirements with no submissions", () => {
  const subs: SubmissionEvent[] = [ev("Alice", "CS-1", "John", "Submitted to Client", 2000)];
  const jobs: JobRecord[] = [
    job({ jobCode: "CS-1", jobTitle: "Dev", assignedTo: "Alice" }), // has a submission
    job({ jobCode: "CS-9", jobTitle: "QA", assignedTo: "Alice" }), // assigned, no submission
    job({ jobCode: "CS-8", jobTitle: "PM", assignedTo: "Someone Else" }), // not Alice's
  ];
  const { stats } = computeRecruiterStats(subs, jobs);
  const alice = stats.find((s) => s.name === "Alice")!;

  it("adds a no-submission row only for the recruiter's own assigned reqs", () => {
    expect(alice.noSubCount).toBe(1);
    const g9 = alice.jobGroups.find((x) => x.jobCode === "CS-9")!;
    expect(g9.assignedOnly).toBe(true);
    expect(g9.submissions.length).toBe(0);
    const g1 = alice.jobGroups.find((x) => x.jobCode === "CS-1")!;
    expect(g1.assignedOnly).toBe(false);
    expect(g1.submissions.length).toBe(1);
    expect(alice.jobGroups.some((x) => x.jobCode === "CS-8")).toBe(false);
  });

  it("sorts assigned-only requirements to the end", () => {
    expect(alice.jobGroups[alice.jobGroups.length - 1].assignedOnly).toBe(true);
  });
});

// ---- Period attribution -----------------------------------------------------
// A profile uploaded 31 Jul and client-submitted 4 Aug did the client-submission
// work in AUGUST. Attributing it to the upload date credited it to July and hid
// it from any August range entirely.

/** Event with independent upload and status-change dates. */
function ev2(
  recruiter: string,
  applicant: string,
  status: string,
  uploaded: string,
  changed: string
): SubmissionEvent {
  return {
    jobCode: "J1",
    jobTitle: "T",
    applicantName: applicant,
    submittedBy: recruiter,
    client: "C",
    submissionStatus: status,
    statusChangedOn: DateTime.fromISO(changed),
    submittedOn: DateTime.fromISO(uploaded),
    accountManager: "AM",
    jobCreatedOn: DateTime.fromISO("2026-07-01"),
  };
}

const UPLOADED = "2026-07-31T10:00:00";
const CLIENT_SUB = "2026-08-04T10:00:00";
const history = [
  ev2("Guru", "Alice", "Submitted", UPLOADED, UPLOADED),
  ev2("Guru", "Alice", "Client Submission", UPLOADED, CLIENT_SUB),
];
const day = (s: string) => DateTime.fromISO(s);

describe("eventDate", () => {
  it("uses the status-change date, not the upload date", () => {
    expect(eventDate(history[1])!.toISODate()).toBe("2026-08-04");
  });

  it("falls back to the upload date when there is no status-change date", () => {
    const e = { ...history[0], statusChangedOn: null } as SubmissionEvent;
    expect(eventDate(e)!.toISODate()).toBe("2026-07-31");
  });
});

describe("filterByActivity", () => {
  it("includes the client submission in the August range", () => {
    const aug = filterByActivity(history, day("2026-08-01"), day("2026-08-31T23:59:59"));
    expect(aug).toHaveLength(1);
    expect(aug[0].submissionStatus).toBe("Client Submission");
  });

  it("keeps only the upload event in the July range", () => {
    const jul = filterByActivity(history, day("2026-07-01"), day("2026-07-31T23:59:59"));
    expect(jul).toHaveLength(1);
    expect(jul[0].submissionStatus).toBe("Submitted");
  });

  it("returns everything when no range is given", () => {
    expect(filterByActivity(history, null, null)).toHaveLength(2);
  });
});

describe("period attribution end-to-end", () => {
  it("counts the client submission in August, not July", () => {
    const aug = computeRecruiterStats(
      filterByActivity(history, day("2026-08-01"), day("2026-08-31T23:59:59"))
    );
    expect(aug.stats[0].clientCount).toBe(1);

    const jul = computeRecruiterStats(
      filterByActivity(history, day("2026-07-01"), day("2026-07-31T23:59:59"))
    );
    expect(jul.stats[0].clientCount).toBe(0);
    expect(jul.stats[0].profiles).toBe(1);
  });

  it("shows the profile in both periods, at the status it held in each", () => {
    const jul = computeRecruiterStats(filterByActivity(history, day("2026-07-01"), day("2026-07-31T23:59:59")));
    const aug = computeRecruiterStats(filterByActivity(history, day("2026-08-01"), day("2026-08-31T23:59:59")));
    expect(jul.stats[0].rows[0].status).toBe("Submitted");
    expect(aug.stats[0].rows[0].status).toBe("Client / Vendor Submission");
  });

  it("keeps the original upload date on the row while attributing by activity", () => {
    const aug = computeRecruiterStats(filterByActivity(history, day("2026-08-01"), day("2026-08-31T23:59:59")));
    const row = aug.stats[0].rows[0];
    expect(row.submittedOn!.toISODate()).toBe("2026-07-31");
    expect(row.lastActivity!.toISODate()).toBe("2026-08-04");
  });

  it("does not lose the profile from an August range because it was uploaded in July", () => {
    // The old behaviour filtered on submittedOn, so this range returned nothing.
    const window = filterByActivity(history, day("2026-08-01"), day("2026-08-04T23:59:59"));
    expect(window.length).toBeGreaterThan(0);
  });
});
