import { describe, it, expect } from "vitest";
import { benchSubmissionKey, isoDay, toBenchOptions, filterBenchOptions } from "./benchOptions";
import { autoMap, Row } from "./benchSubmissions";

describe("isoDay", () => {
  it("normalises whatever the report returns to one ISO day", () => {
    // Ceipal's own format and ISO must key the same submission identically,
    // or re-configuring the report orphans every timesheet entry made so far.
    expect(isoDay("09/21/2026 17:37:28")).toBe("2026-09-21");
    expect(isoDay("2026-09-21")).toBe("2026-09-21");
    expect(isoDay("")).toBe("");
    expect(isoDay("not a date")).toBe("");
  });
});

describe("benchSubmissionKey", () => {
  const base = { consultant: "Anil Challa", vendor: "Ramy Infotech", jobTitle: "VJ -2", submittedOn: "2026-09-21" };

  it("is stable across case and spacing", () => {
    expect(benchSubmissionKey(base)).toBe(
      benchSubmissionKey({ ...base, consultant: "  anil   challa ", vendor: "RAMY Infotech" })
    );
  });

  it("separates two submissions of the same person to different vendors", () => {
    expect(benchSubmissionKey(base)).not.toBe(benchSubmissionKey({ ...base, vendor: "EXL NEO" }));
  });

  it("separates the same submission shape made on different days", () => {
    expect(benchSubmissionKey(base)).not.toBe(benchSubmissionKey({ ...base, submittedOn: "2026-09-22" }));
  });
});

describe("toBenchOptions", () => {
  const subs: Row[] = [
    { VendorName: "Ramy Infotech", JobTitle: "VJ -2", SubmittedOn: "09/21/2026 17:37:28", ProfileStatus: "Submitted", ApplicantName: "Anil Challa" },
    { VendorName: "EXL NEO", JobTitle: "VJ -3", SubmittedOn: "08/02/2026 09:14:00", ProfileStatus: "Rejected By Client", ApplicantName: "Anil Challa" },
    { VendorName: "", JobTitle: "", SubmittedOn: "", ProfileStatus: "", ApplicantName: "" },
  ];
  const map = autoMap([{ FirstName: "Anil", LastName: "Challa" }], subs);

  it("reads the real report's columns into pickable rows", () => {
    const opts = toBenchOptions(subs, map, map.subVendor);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({
      consultant: "Anil Challa",
      vendor: "Ramy Infotech",
      jobTitle: "VJ -2",
      submittedOn: "2026-09-21",
      status: "Submitted",
    });
  });

  it("puts the most recent submission first", () => {
    expect(toBenchOptions(subs, map, map.subVendor).map((o) => o.submittedOn))
      .toEqual(["2026-09-21", "2026-08-02"]);
  });

  it("drops a row that identifies nothing rather than keying them all alike", () => {
    expect(toBenchOptions(subs, map, map.subVendor).some((o) => o.subKey === "|||")).toBe(false);
  });

  it("offers one option per submission, not one per person", () => {
    const keys = new Set(toBenchOptions(subs, map, map.subVendor).map((o) => o.subKey));
    expect(keys.size).toBe(2);
  });

  it("collapses a row duplicated in the report", () => {
    const dupes = [subs[0], { ...subs[0] }];
    expect(toBenchOptions(dupes, map, map.subVendor)).toHaveLength(1);
  });
});

describe("filterBenchOptions", () => {
  const opts = toBenchOptions(
    [
      { VendorName: "Ramy Infotech", JobTitle: "Data Engineer", SubmittedOn: "09/21/2026", ApplicantName: "Anil Challa" },
      { VendorName: "EXL NEO", JobTitle: "QA Lead", SubmittedOn: "09/22/2026", ApplicantName: "Mia Diaz" },
    ],
    autoMap([], [{ VendorName: "", JobTitle: "", SubmittedOn: "", ApplicantName: "" }]),
    "VendorName"
  );

  it("matches on any term, across consultant, vendor and role", () => {
    expect(filterBenchOptions(opts, "ramy").map((o) => o.consultant)).toEqual(["Anil Challa"]);
    expect(filterBenchOptions(opts, "qa").map((o) => o.consultant)).toEqual(["Mia Diaz"]);
  });

  it("requires every term to match", () => {
    expect(filterBenchOptions(opts, "anil exl")).toEqual([]);
    expect(filterBenchOptions(opts, "anil ramy")).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    expect(filterBenchOptions(opts, "  ")).toHaveLength(2);
  });
});
