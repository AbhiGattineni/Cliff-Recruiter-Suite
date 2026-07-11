// Column-name mapping and status normalisation.
//
// Both the Excel-upload path and the Ceipal-API path funnel through these
// helpers so header spelling differences (spaces, punctuation, "#Of" vs
// "# of", etc.) do not break the pipeline.

export type CanonicalStatus =
  | "WAITING"
  | "INTERNAL_INTERVIEW"
  | "SELECTED"
  | "REJECTED"
  | "SUBMITTED"
  | "OTHER";

/** Lower-case, strip everything except a-z0-9 for tolerant header matching. */
export function normHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Canonical job-posting field -> list of accepted header spellings (normalised).
export const JOB_FIELD_ALIASES: Record<string, string[]> = {
  jobCode: ["jobcode", "code", "jobid", "requisitionid", "reqid"],
  jobTitle: ["jobtitle", "title", "positionname", "position", "requirementname"],
  client: ["client", "clientname", "endclient"],
  jobStatus: ["jobstatus", "status"],
  jobCreatedOn: ["jobcreatedon", "createdon", "jobcreated", "createddate", "postedon", "requirementcreated"],
  numOfSubmissions: ["ofsubmissions", "numberofsubmissions", "submissions", "submissioncount", "totalsubmissions", "ofsubmission"],
  internalScreeningRequired: ["internalscreeningrequired", "internalscreening", "screeningrequired"],
  recruitmentManager: ["recruitmentmanager", "recruitingmanager", "hiringmanager", "manager", "jobpostingcreatedby", "postingcreatedby"],
  payRate: ["payratesalary", "payrate", "salary", "rate", "billrate"],
  jobModifiedOn: ["jobmodifiedon", "modifiedon", "lastmodified", "updatedon"],
  jobDescription: ["jobdescription", "description", "jd", "jobdesc", "requirementdescription", "jobdetails"],
  experience: ["experience", "experiencerequired", "requiredexperience", "yearsofexperience", "totalexperience", "minexperience", "exp"],
  mandateSkills: ["mandateskills", "mandatoryskills", "mandatoryskill", "primaryskills", "keyskills", "requiredskills", "skillset", "skills", "musthaveskills"],
  comments: ["comments", "comment", "remarks", "additionalcomments", "concerns", "challenges", "notes"],
};

// Canonical submission-activity field -> accepted header spellings (normalised).
export const SUB_FIELD_ALIASES: Record<string, string[]> = {
  jobTitle: ["jobtitle", "title", "positionname", "position"],
  applicantName: ["applicantfullname", "applicantname", "candidatename", "candidate", "fullname", "applicant"],
  submittedBy: ["submittedby", "recruiter", "recruitername", "submittedbyrecruiter"],
  jobCode: ["jobcode", "code", "jobid", "requisitionid"],
  client: ["client", "clientname", "endclient"],
  submissionStatus: ["submissionstatus", "status", "currentstatus", "candidatestatus"],
  statusChangedOn: ["statuschangedon", "statuschanged", "statusdate", "changedon", "statuschangeddatetime"],
  submittedOn: ["submittedon", "submitteddate", "dateofsubmission", "submissiondate"],
  accountManager: ["accountmanager", "acctmanager", "requirementowner", "owner"],
  jobCreatedOn: ["jobcreatedon", "jobcreated", "requirementcreated"],
};

/**
 * Given a list of raw header cells, return a map: columnIndex -> canonicalField.
 * Only indexes whose header matches a known alias are included.
 */
export function mapHeaders(
  headers: unknown[],
  aliases: Record<string, string[]>
): Record<number, string> {
  const out: Record<number, string> = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    if (!n) return;
    for (const [field, als] of Object.entries(aliases)) {
      if (als.includes(n)) {
        out[i] = field;
        return;
      }
    }
    // Loose contains-match as a second pass (helps with minor variations).
    for (const [field, als] of Object.entries(aliases)) {
      if (out[i]) break;
      if (als.some((a) => n.includes(a) || a.includes(n))) {
        if (!Object.values(out).includes(field)) out[i] = field;
      }
    }
  });
  return out;
}

/** How many known fields a row of headers matches (used to locate the header row). */
export function headerMatchScore(headers: unknown[], aliases: Record<string, string[]>): number {
  return Object.keys(mapHeaders(headers, aliases)).length;
}

/** Map a key when reading API JSON objects (keys instead of positional headers). */
export function mapObjectKeys(
  keys: string[],
  aliases: Record<string, string[]>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const n = normHeader(key);
    for (const [field, als] of Object.entries(aliases)) {
      if (als.includes(n) && !Object.values(out).includes(field)) {
        out[key] = field;
        break;
      }
    }
  }
  // loose pass
  for (const key of keys) {
    if (out[key]) continue;
    const n = normHeader(key);
    for (const [field, als] of Object.entries(aliases)) {
      if (Object.values(out).includes(field)) continue;
      if (als.some((a) => n.includes(a) || a.includes(n))) {
        out[key] = field;
        break;
      }
    }
  }
  return out;
}

/** Normalise a raw submission-status string into one of the canonical buckets. */
export function normalizeStatus(raw: unknown): CanonicalStatus {
  const n = normHeader(raw); // lower + alnum only
  if (!n) return "OTHER";
  if (n.includes("waitingforevaluation") || n === "waiting") return "WAITING";
  if (n.includes("internalinterview") || n.includes("internalscreeningsubmitted")) return "INTERNAL_INTERVIEW";
  if (n.includes("selectedinternally")) return "SELECTED";
  if (n.includes("rejectedinternally")) return "REJECTED";
  // Submitted to vendor / client / end client, or a bare "submitted".
  if (
    n.includes("submittedtovendor") ||
    n.includes("submittedtoclient") ||
    n.includes("submittedtoendclient") ||
    n === "submitted"
  ) {
    return "SUBMITTED";
  }
  return "OTHER";
}
