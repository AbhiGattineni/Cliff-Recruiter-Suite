import { describe, it, expect } from "vitest";
import { parseSubmissionsFromApi } from "./parseSource";
import { buildReport } from "./transform";
import { DASH } from "./dates";

// Real Ceipal submissions-report shape (result array, real column names).
const apiJson = {
  success: 1,
  result: [
    {
      JobTitle: "VCF Automation Architect",
      ApplicantFullName: "Michael Polissaint",
      SubmittedBy: "Abhishek Kc",
      JobCode: "CS - 361",
      JobCreatedOn: "07/10/2026 15:15:03",
      Client: "Group Tobias LLC",
      SubmissionStatus: "Waiting for Evaluation",
      StatusChangedOn: "07/10/2026 15:29:50",
      SubmittedOn: "07/10/2026 15:29:17",
      AccountManager: "Pavan Jagarlamudi",
    },
    {
      JobTitle: "VCF Automation Architect",
      ApplicantFullName: "Michael Polissaint",
      SubmittedBy: "Abhishek Kc",
      JobCode: "CS - 361",
      JobCreatedOn: "07/10/2026 15:15:03",
      Client: "Group Tobias LLC",
      SubmissionStatus: "Submitted To Client",
      StatusChangedOn: "07/10/2026 18:05:00",
      SubmittedOn: "07/10/2026 15:29:17",
      AccountManager: "Pavan Jagarlamudi",
    },
    {
      JobTitle: "VCF Automation Architect",
      ApplicantFullName: "Sara Lin",
      SubmittedBy: "Abhishek Kc",
      JobCode: "CS - 361",
      JobCreatedOn: "07/10/2026 15:15:03",
      Client: "Group Tobias LLC",
      SubmissionStatus: "Waiting for Evaluation",
      StatusChangedOn: "07/10/2026 16:00:00",
      SubmittedOn: "07/10/2026 15:55:00",
      AccountManager: "Pavan Jagarlamudi",
    },
  ],
};

describe("Ceipal API → report pipeline", () => {
  const subs = parseSubmissionsFromApi(apiJson);
  const report = buildReport([], subs);

  it("parses the result array with real column names", () => {
    expect(subs.length).toBe(3);
    expect(subs[0].jobCode).toBe("CS - 361");
    expect(subs[0].applicantName).toBe("Michael Polissaint");
    expect(subs[0].jobCreatedOn).not.toBeNull();
  });

  it("produces one row per distinct candidate", () => {
    expect(report.candidateCount).toBe(2); // Michael + Sara
    expect(report.rows.length).toBe(2);
  });

  it("fills Job Created On + Job Age from the submission data", () => {
    const row = report.rows[0].cells;
    expect(row["Job Created On"]).not.toBe(DASH);
    expect(row["Job Age"]).not.toBe(DASH);
    expect(row["Job Title"]).toBe("VCF Automation Architect");
    expect(row["Client"]).toBe("Group Tobias LLC");
    expect(row["Job Code"]).toBe("CS - 361");
  });

  it("pivots statuses into their timestamp columns", () => {
    const michael = report.rows.find((r) => r.cells["Candidate"] === "Michael Polissaint")!;
    expect(michael.cells["Waiting for Evaluation (→ Req Owner)"]).not.toBe(DASH);
    expect(michael.cells["Submitted (→ Client/Vendor)"]).not.toBe(DASH);
    // duration from waiting -> submitted should be computed
    expect(michael.cells["→ time to Submitted"]).not.toBe(DASH);
  });

  it("counts stage buckets — client/vendor separate from submitted-to-AM", () => {
    const row = report.rows[0].cells;
    expect(row["# Submitted Profiles"]).toBe("2");
    // Michael reached "Submitted To Client" → client/vendor; Sara = Waiting.
    expect(row["# Submissions to Vendor/Client"]).toBe("1");
    expect(row["# Waiting for Evaluation"]).toBe("1");
    expect(row["# Submitted"]).toBe("0"); // bare "submitted to AM" only
  });
});
