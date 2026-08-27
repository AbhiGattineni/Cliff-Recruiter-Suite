import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  computeRecruiterStats,
  funnelOf,
  eventDate,
  filterByActivity,
  bucketPoints,
  BUCKETS,
} from "./recruiterStats";
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
  it("separates internal, vendor and client submissions into their own tiers", () => {
    expect(funnelOf("Submitted")).toBe("submitted");
    expect(funnelOf("Submitted to Vendor")).toBe("vendorSubmitted");
    expect(funnelOf("Vendor Submission")).toBe("vendorSubmitted");
    // Reaching the client is a step past reaching the vendor, and scores higher.
    expect(funnelOf("Submitted to Client")).toBe("clientSubmitted");
    expect(funnelOf("Selected By Vendor")).toBe("clientSubmitted");
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

  it("keeps client and vendor submissions apart, and uses the latest status", () => {
    const alice = stats.find((s) => s.name === "Alice")!;
    // They used to share one "Client / Vendor Submission" label. The index now
    // scores them differently, so merging them would hide what it is measuring.
    expect(alice.counts["Submitted to Client"]).toBe(1); // John
    expect(alice.counts["Submitted to Vendor"]).toBe(1); // Sam
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
    expect(labels.indexOf("Submitted to Client")).toBeLessThan(labels.indexOf("Waiting for Evaluation"));
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
    expect(aug.stats[0].rows[0].status).toBe("Client Submission");
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

// ---- Client-side stages beyond a submission --------------------------------
// "Client Interview" used to match nothing and fall through to `unknown`,
// scoring zero on the metrics carrying 80% of the index — punishing a recruiter
// for an outcome BETTER than a plain client submission.

describe("funnelOf — client-side progress", () => {
  it("separates a client-side interview from a vendor-side one — different buckets", () => {
    expect(funnelOf("Client Interview")).toBe("clientInterview");
    expect(funnelOf("End Client Interview")).toBe("clientInterview");
    expect(funnelOf("Vendor Interview")).toBe("vendorInterview");
  });

  it("still treats internal interviews as internal", () => {
    expect(funnelOf("Internal Interview")).toBe("interview");
    expect(funnelOf("Internal Screening")).toBe("interview");
  });

  it("splits an offer that was taken from one that was merely released", () => {
    // "Released" means an offer went out and can still be declined.
    expect(funnelOf("Offer Released")).toBe("clientSelected");
    expect(funnelOf("Selected By Client")).toBe("clientSelected");
    // These mean the candidate actually started, or signed.
    expect(funnelOf("Offer Accepted")).toBe("offerAccepted");
    expect(funnelOf("Placed")).toBe("offerAccepted");
    expect(funnelOf("Joined")).toBe("offerAccepted");
    expect(funnelOf("Confirmation")).toBe("offerAccepted");
    // Picked by the vendor is the step that sends them on to the client.
    expect(funnelOf("Selected By Vendor")).toBe("clientSubmitted");
  });

  it("reads rejections as rejections even when client-side", () => {
    expect(funnelOf("Rejected By Vendor")).toBe("rejected");
    expect(funnelOf("Disqualified By Vendor")).toBe("rejected");
    expect(funnelOf("Rejected Internally")).toBe("rejected");
  });

  it("classifies a bare interview status instead of dropping it to unknown", () => {
    expect(funnelOf("Interview Scheduled")).toBe("interview");
  });
});

describe("index parts as leaderboard columns", () => {
  // The Recruiter Performance table shows each part's earned points beside the
  // Index, so the five must actually reconstruct it — otherwise the columns and
  // the total tell different stories to the person being measured.
  it("has the tier points sum to the index", () => {
    const { stats } = computeRecruiterStats(
      [
        ev("Juhi", "J1", "Cand A", "Submitted To Client", day(CLIENT_SUB).toMillis()),
        ev("Juhi", "J1", "Cand B", "Client Interview", day(CLIENT_SUB).toMillis()),
        ev("Juhi", "J2", "Cand C", "Submitted", day(UPLOADED).toMillis()),
        ev("Mubal", "J3", "Cand D", "Offer Accepted", day(CLIENT_SUB).toMillis()),
      ],
      [job({ jobCode: "J1", assignedTo: "Juhi" }), job({ jobCode: "J3", assignedTo: "Mubal" })]
    );
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) {
      const summed = Object.values(s.indexParts).reduce((a, b) => a + b, 0);
      expect(Math.min(100, Math.round(summed))).toBe(s.index);
    }
  });

  it("caps every tier at its own ceiling, so no column can run away", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      ev("Juhi", "J1", `Cand ${i}`, "Submitted To Vendor", day(CLIENT_SUB).toMillis())
    );
    const { stats } = computeRecruiterStats(many, [job({ jobCode: "J1", assignedTo: "Juhi" })]);
    expect(stats[0].indexParts.vendor).toBe(BUCKETS.vendor.points);
    expect(stats[0].index).toBeLessThanOrEqual(100);
  });
});

describe("bucket-weighted index", () => {
  const at = (recruiter: string, status: string, n = 1) =>
    Array.from({ length: n }, (_, i) =>
      ev(recruiter, "J1", `${recruiter} Cand ${i}`, status, day(CLIENT_SUB).toMillis())
    );

  it("splits the 100 points the way the business asked: 20/20/20/40", () => {
    expect(BUCKETS.offer.points).toBe(20);
    expect(BUCKETS.client.points).toBe(20);
    expect(BUCKETS.vendor.points).toBe(20);
    expect(BUCKETS.coverage.points).toBe(40);
    const total = Object.values(BUCKETS).reduce((a, b) => a + b.points, 0);
    expect(total).toBe(100);
  });

  it("fills the offer bucket on a single accepted offer", () => {
    expect(bucketPoints("offer", 1)).toBe(20);
    expect(bucketPoints("offer", 5)).toBe(20); // capped, not cumulative
  });

  it("scales a bucket with how many candidates reached it, then caps", () => {
    expect(bucketPoints("vendor", 3)).toBe(10); // half of the 6 target
    expect(bucketPoints("vendor", 6)).toBe(20);
    expect(bucketPoints("vendor", 100)).toBe(20);
  });

  it("has the four buckets sum to the index", () => {
    const { stats } = computeRecruiterStats(
      [
        ev("Juhi", "J1", "Cand A", "Submitted To Client", day(CLIENT_SUB).toMillis()),
        ev("Juhi", "J1", "Cand B", "Vendor Interview", day(CLIENT_SUB).toMillis()),
        ev("Mubal", "J3", "Cand D", "Offer Accepted", day(CLIENT_SUB).toMillis()),
      ],
      [job({ jobCode: "J1", assignedTo: "Juhi" }), job({ jobCode: "J3", assignedTo: "Mubal" })]
    );
    for (const s of stats) {
      const summed = Object.values(s.indexParts).reduce((a, b) => a + b, 0);
      expect(Math.min(100, Math.round(summed))).toBe(s.index);
    }
  });

  it("puts a client-side interview in the client bucket and a vendor one in the vendor bucket", () => {
    expect(funnelOf("Client Interview")).toBe("clientInterview");
    expect(funnelOf("End Client Interview")).toBe("clientInterview");
    expect(funnelOf("Vendor Interview")).toBe("vendorInterview");
    const clientSide = computeRecruiterStats(at("C", "Client Interview"), []).stats[0];
    const vendorSide = computeRecruiterStats(at("V", "Vendor Interview"), []).stats[0];
    expect(clientSide.indexParts.client).toBeGreaterThan(0);
    expect(clientSide.indexParts.vendor).toBe(0);
    expect(vendorSide.indexParts.vendor).toBeGreaterThan(0);
    expect(vendorSide.indexParts.client).toBe(0);
  });

  it("treats an offer that is only released as client-side, not as a win", () => {
    const released = computeRecruiterStats(at("R", "Offer Released"), []).stats[0];
    expect(released.indexParts.offer).toBe(0);
    expect(released.indexParts.client).toBeGreaterThan(0);
  });

  it("counts each candidate once, at the furthest stage they reached", () => {
    const s = computeRecruiterStats(at("R", "Offer Accepted"), []).stats[0];
    expect(s.profiles).toBe(1);
    expect(s.indexParts.offer).toBe(20);
    expect(s.indexParts.client).toBe(0);
    expect(s.indexParts.vendor).toBe(0);
  });

  it("makes coverage the single biggest share — worth double an accepted offer", () => {
    // A deliberate consequence of the 20/20/20/40 split: consistently sending 2
    // profiles per requirement outweighs landing one placement.
    expect(BUCKETS.coverage.points).toBe(2 * BUCKETS.offer.points);
  });
});

describe("index credit for client-side progress", () => {
  const at = (status: string) => [ev2("Juhi", "Sindhu", status, UPLOADED, CLIENT_SUB)];

  it("scores a client interview at least as well as a client submission", () => {
    const interview = computeRecruiterStats(at("Client Interview")).stats[0];
    const submission = computeRecruiterStats(at("Submitted To Vendor")).stats[0];
    expect(interview.clientCount).toBe(1);
    expect(interview.index).toBeGreaterThanOrEqual(submission.index);
  });

  it("no longer leaves a client interview scoring zero", () => {
    const s = computeRecruiterStats(at("Client Interview")).stats[0];
    expect(s.clientRate).toBe(1);
    expect(s.progressRate).toBe(1);
  });

  it("keeps its own label rather than merging into Client / Vendor Submission", () => {
    const s = computeRecruiterStats(at("Client Interview")).stats[0];
    expect(s.rows[0].status).toBe("Client Interview");
  });
});

// ---- Period-scoped target base ---------------------------------------------
// "2 client submissions per assigned requirement" is a lifetime expectation.
// Applying it to a one-day window measured a single submission against every
// requirement the recruiter had ever been assigned, so two recruiters with
// identical activity scored differently purely on lifetime assignment counts.

describe("period-scoped target base", () => {
  const oneDay = (recruiter: string) => [
    ev2(recruiter, `C-${recruiter}`, "Submitted To Vendor", CLIENT_SUB, CLIENT_SUB),
  ];
  // Same day's work, wildly different lifetime assignment.
  const heavy = job({ jobCode: "J1", assignedTo: "Heavy" });
  const manyJobs = Array.from({ length: 58 }, (_, i) => job({ jobCode: `A${i}`, assignedTo: "Heavy" }));
  const fewJobs = Array.from({ length: 34 }, (_, i) => job({ jobCode: `B${i}`, assignedTo: "Light" }));

  it("scores identical in-window activity identically, whatever the lifetime load", () => {
    const a = computeRecruiterStats(oneDay("Heavy"), [...manyJobs, heavy], { periodScoped: true }).stats[0];
    const b = computeRecruiterStats(oneDay("Light"), fewJobs, { periodScoped: true }).stats[0];
    expect(a.index).toBe(b.index);
    expect(a.targetBasis).toBe("worked");
    expect(a.targetBaseCount).toBe(1);
    expect(a.clientTarget).toBe(2);
  });

  it("still uses lifetime assigned requirements when no range is active", () => {
    const s = computeRecruiterStats(oneDay("Heavy"), manyJobs).stats[0];
    expect(s.targetBasis).toBe("assigned");
    expect(s.targetBaseCount).toBe(58);
    expect(s.clientTarget).toBe(116);
  });

  it("falls back to worked requirements when there is no Assigned-To data", () => {
    const s = computeRecruiterStats(oneDay("Nobody"), []).stats[0];
    expect(s.targetBasis).toBe("worked");
  });

  it("gives full credit for hitting 2 client submissions on the one requirement worked", () => {
    const two = [
      ev2("R", "Cand A", "Submitted To Vendor", CLIENT_SUB, CLIENT_SUB),
      { ...ev2("R", "Cand B", "Submitted To Client", CLIENT_SUB, CLIENT_SUB), jobCode: "J1" },
    ];
    const s = computeRecruiterStats(two, [], { periodScoped: true }).stats[0];
    expect(s.indexParts.coverage).toBe(BUCKETS.coverage.points);
  });
});
