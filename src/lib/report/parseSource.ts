// Turn raw sources (Excel rows or Ceipal API JSON) into canonical records.
//
// Excel layout per the spec: a "Period:" row first, then the header row, then
// data. We locate the header row by picking the row that matches the most known
// field aliases, so the leading "Period:" row is skipped automatically.

import { DateTime } from "luxon";
import { JobRecord, SubmissionEvent } from "./types";
import {
  JOB_FIELD_ALIASES,
  SUB_FIELD_ALIASES,
  mapHeaders,
  headerMatchScore,
  mapObjectKeys,
} from "./columns";
import { parseTs } from "./dates";
import { SheetRows } from "./readExcel";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toInt(v: unknown): number | null {
  const s = str(v).replace(/[^0-9-]/g, "");
  if (s === "" || s === "-") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// ---- Excel path ------------------------------------------------------------

/** From a workbook's sheets, pick the one that best matches the given field set. */
function pickSheet(sheets: SheetRows[], aliases: Record<string, string[]>): SheetRows | null {
  let best: SheetRows | null = null;
  let bestScore = 0;
  for (const sheet of sheets) {
    const limit = Math.min(sheet.rows.length, 15);
    for (let i = 0; i < limit; i++) {
      const score = headerMatchScore(sheet.rows[i], aliases);
      if (score > bestScore) {
        bestScore = score;
        best = sheet;
      }
    }
  }
  return bestScore >= 2 ? best : sheets[0] ?? null;
}

/** Convert a sheet's rows into field->value objects, using the detected header row. */
function rowsToObjects(
  rows: string[][],
  aliases: Record<string, string[]>
): Record<string, string>[] {
  // Find header row (highest match score in the first 15 rows).
  let headerIdx = -1;
  let bestScore = 1; // require at least 2 matched fields
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const score = headerMatchScore(rows[i], aliases);
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }
  if (headerIdx === -1) return [];

  const headerMap = mapHeaders(rows[headerIdx], aliases); // index -> field
  const objects: Record<string, string>[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => str(c) === "")) continue;
    const obj: Record<string, string> = {};
    for (const [idxStr, field] of Object.entries(headerMap)) {
      obj[field] = str(row[Number(idxStr)]);
    }
    // Skip rows that carry no job code / applicant (footer rows etc.)
    objects.push(obj);
  }
  return objects;
}

function toJobRecord(o: Record<string, string>): JobRecord | null {
  const jobCode = str(o.jobCode);
  const jobTitle = str(o.jobTitle);
  // Keep records that have at least a job code OR a title (the Ceipal job-duration
  // report has no job code, so it's joined to submissions by title instead).
  if (!jobCode && !jobTitle) return null;
  return {
    jobCode,
    jobTitle,
    client: str(o.client),
    jobStatus: str(o.jobStatus),
    jobCreatedOn: parseTs(o.jobCreatedOn),
    numOfSubmissions: toInt(o.numOfSubmissions),
    internalScreeningRequired: str(o.internalScreeningRequired),
    recruitmentManager: str(o.recruitmentManager),
    payRate: str(o.payRate),
    jobModifiedOn: parseTs(o.jobModifiedOn),
    jobDescription: str(o.jobDescription),
    experience: str(o.experience),
    mandateSkills: str(o.mandateSkills),
    comments: str(o.comments),
  };
}

function toSubmissionEvent(o: Record<string, string>): SubmissionEvent | null {
  const jobCode = str(o.jobCode);
  const applicant = str(o.applicantName);
  if (!jobCode && !applicant) return null;
  return {
    jobCode,
    jobTitle: str(o.jobTitle),
    applicantName: applicant,
    submittedBy: str(o.submittedBy),
    client: str(o.client),
    submissionStatus: str(o.submissionStatus),
    statusChangedOn: parseTs(o.statusChangedOn),
    submittedOn: parseTs(o.submittedOn),
    accountManager: str(o.accountManager),
    jobCreatedOn: parseTs(o.jobCreatedOn),
  };
}

export function parseJobsFromSheets(sheets: SheetRows[]): JobRecord[] {
  const sheet = pickSheet(sheets, JOB_FIELD_ALIASES);
  if (!sheet) return [];
  return rowsToObjects(sheet.rows, JOB_FIELD_ALIASES)
    .map(toJobRecord)
    .filter((x): x is JobRecord => x !== null);
}

export function parseSubmissionsFromSheets(sheets: SheetRows[]): SubmissionEvent[] {
  const sheet = pickSheet(sheets, SUB_FIELD_ALIASES);
  if (!sheet) return [];
  return rowsToObjects(sheet.rows, SUB_FIELD_ALIASES)
    .map(toSubmissionEvent)
    .filter((x): x is SubmissionEvent => x !== null);
}

// ---- API path --------------------------------------------------------------

/** Coerce a Ceipal report API response into a flat array of row objects. */
export function apiToRowObjects(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "rows", "result", "results", "report_data", "reportData", "records"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    // Sometimes: { data: { rows: [...] } }
    for (const key of ["data", "result"]) {
      const inner = obj[key];
      if (inner && typeof inner === "object") {
        for (const k2 of ["rows", "data", "records"]) {
          if (Array.isArray((inner as Record<string, unknown>)[k2])) {
            return (inner as Record<string, unknown>)[k2] as Record<string, unknown>[];
          }
        }
      }
    }
  }
  return [];
}

function objectsToRecords<T>(
  rowObjs: Record<string, unknown>[],
  aliases: Record<string, string[]>,
  build: (o: Record<string, string>) => T | null
): T[] {
  if (rowObjs.length === 0) return [];
  const keyMap = mapObjectKeys(Object.keys(rowObjs[0]), aliases); // rawKey -> field
  const out: T[] = [];
  for (const raw of rowObjs) {
    const o: Record<string, string> = {};
    for (const [rawKey, field] of Object.entries(keyMap)) {
      o[field] = str(raw[rawKey]);
    }
    const rec = build(o);
    if (rec) out.push(rec);
  }
  return out;
}

export function parseJobsFromApi(json: unknown): JobRecord[] {
  return objectsToRecords(apiToRowObjects(json), JOB_FIELD_ALIASES, toJobRecord);
}

export function parseSubmissionsFromApi(json: unknown): SubmissionEvent[] {
  return objectsToRecords(apiToRowObjects(json), SUB_FIELD_ALIASES, toSubmissionEvent);
}

/** Collect every timestamp present in the parsed records (for "now"). */
export function collectTimestamps(jobs: JobRecord[], subs: SubmissionEvent[]): DateTime[] {
  const out: DateTime[] = [];
  for (const j of jobs) {
    if (j.jobCreatedOn) out.push(j.jobCreatedOn);
    if (j.jobModifiedOn) out.push(j.jobModifiedOn);
  }
  for (const s of subs) {
    if (s.statusChangedOn) out.push(s.statusChangedOn);
    if (s.submittedOn) out.push(s.submittedOn);
    if (s.jobCreatedOn) out.push(s.jobCreatedOn);
  }
  return out;
}
