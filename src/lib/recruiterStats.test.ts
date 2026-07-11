import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { computeRecruiterStats, funnelOf } from "./recruiterStats";
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
