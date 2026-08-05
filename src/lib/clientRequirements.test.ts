import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  computeClientRequirements,
  requirementTotals,
  bucketOf,
  isUnassignedClient,
  isInternalClient,
  UNASSIGNED_LABEL,
} from "./clientRequirements";
import { JobRecord } from "./report/types";

function job(client: string, created: string | null, status = "Active"): JobRecord {
  return {
    jobCode: `J${Math.random().toString(36).slice(2, 8)}`,
    jobTitle: "T",
    client,
    jobStatus: status,
    jobCreatedOn: created ? DateTime.fromISO(created) : null,
    numOfSubmissions: null,
    internalScreeningRequired: "",
    recruitmentManager: "",
    payRate: "",
    jobModifiedOn: null,
    jobDescription: "",
    experience: "",
    mandateSkills: "",
    comments: "",
    assignedTo: "",
  };
}
const d = (s: string) => DateTime.fromISO(s);

describe("bucketOf", () => {
  it("maps Ceipal's real status names", () => {
    expect(bucketOf("Active")).toBe("active");
    expect(bucketOf("On Hold")).toBe("onHold");
    expect(bucketOf("Hold by Client")).toBe("onHold");
    expect(bucketOf("Closed")).toBe("closed");
    expect(bucketOf("Draft")).toBe("other");
    expect(bucketOf("Filled")).toBe("other");
    expect(bucketOf("")).toBe("other");
  });
});

describe("client classification", () => {
  it("treats blank and NA as unassigned", () => {
    expect(isUnassignedClient("")).toBe(true);
    expect(isUnassignedClient("NA")).toBe(true);
    expect(isUnassignedClient("n/a")).toBe(true);
    expect(isUnassignedClient("IBM")).toBe(false);
  });

  it("recognises our own company", () => {
    expect(isInternalClient("Cliff Services Inc")).toBe(true);
    expect(isInternalClient("cliff services")).toBe(true);
    expect(isInternalClient("IBM")).toBe(false);
  });
});

describe("computeClientRequirements", () => {
  const jobs = [
    job("IBM", "2026-07-05", "Active"),
    job("IBM", "2026-07-20", "Closed"),
    job("IBM", "2026-08-02", "On Hold"),
    job("Apple", "2026-07-11", "Hold by Client"),
    job("NA", "2026-07-15", "Closed"),
    job("Cliff Services Inc", "2026-07-16", "Active"),
  ];

  it("counts only requirements received inside the range", () => {
    const jul = computeClientRequirements(jobs, d("2026-07-01"), d("2026-07-31T23:59:59"));
    expect(jul.find((r) => r.client === "IBM")!.total).toBe(2); // the 2 Aug one is excluded
  });

  it("breaks the count down by status", () => {
    const all = computeClientRequirements(jobs, null, null);
    const ibm = all.find((r) => r.client === "IBM")!;
    expect(ibm.total).toBe(3);
    expect(ibm.active).toBe(1);
    expect(ibm.closed).toBe(1);
    expect(ibm.onHold).toBe(1);
  });

  it("labels NA as unassigned rather than a client name", () => {
    const all = computeClientRequirements(jobs, null, null);
    const na = all.find((r) => r.unassigned)!;
    expect(na.client).toBe(UNASSIGNED_LABEL);
    expect(na.total).toBe(1);
  });

  it("flags our own company without hiding it", () => {
    const all = computeClientRequirements(jobs, null, null);
    const internal = all.find((r) => r.internal)!;
    expect(internal.client).toBe("Cliff Services Inc");
    expect(internal.total).toBe(1);
  });

  it("sorts by requirement count, busiest first", () => {
    const all = computeClientRequirements(jobs, null, null);
    expect(all[0].client).toBe("IBM");
  });

  it("records the first and last received dates", () => {
    const all = computeClientRequirements(jobs, null, null);
    const ibm = all.find((r) => r.client === "IBM")!;
    expect(ibm.firstReceived!.toISODate()).toBe("2026-07-05");
    expect(ibm.lastReceived!.toISODate()).toBe("2026-08-02");
  });

  it("excludes undated requirements only when a range is active", () => {
    const withUndated = [...jobs, job("Undated Co", null)];
    expect(computeClientRequirements(withUndated, null, null).some((r) => r.client === "Undated Co")).toBe(true);
    expect(
      computeClientRequirements(withUndated, d("2026-07-01"), d("2026-07-31")).some((r) => r.client === "Undated Co")
    ).toBe(false);
  });

  it("groups client names case-insensitively", () => {
    const rows = computeClientRequirements([job("cognizant", "2026-07-01"), job("Cognizant", "2026-07-02")], null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(2);
  });
});

describe("requirementTotals", () => {
  it("separates external clients from unassigned and internal", () => {
    const rows = computeClientRequirements(
      [
        job("IBM", "2026-07-05", "Active"),
        job("Apple", "2026-07-06", "Closed"),
        job("NA", "2026-07-07", "Closed"),
        job("Cliff Services Inc", "2026-07-08", "Active"),
      ],
      null,
      null
    );
    const t = requirementTotals(rows);
    expect(t.requirements).toBe(4);
    expect(t.clients).toBe(2); // IBM + Apple only
    expect(t.unassigned).toBe(1);
    expect(t.internal).toBe(1);
    expect(t.active).toBe(2);
    expect(t.closed).toBe(2);
  });
});
