// Build the downloadable, formatted .xlsx from the report rows using ExcelJS.
//
// Formatting per spec:
//  - Bold dark-blue header (fill 1F4E78, white text), frozen row 1, wrap text, Arial.
//  - Generic NA rows shaded peach (FCE4D6).
//  - Overdue red rows shaded FFC7CE with dark-red bold text (9C0006).

import ExcelJS from "exceljs";
import { COLUMNS, ReportResult } from "./types";

const HEADER_FILL = "FF1F4E78";
const HEADER_FONT = "FFFFFFFF";
const PEACH = "FFFCE4D6";
const RED_FILL = "FFFFC7CE";
const RED_TEXT = "FF9C0006";

// Sensible per-column widths (characters).
const WIDTHS: Record<string, number> = {
  "Job Code": 12,
  "Job Title": 26,
  Client: 20,
  "Job Status": 14,
  "Job Created On": 18,
  "Job Age": 14,
  "# Submissions to Vendor/Client": 14,
  "# Submitted Profiles": 12,
  "# Waiting for Evaluation": 12,
  "# Internal Interview": 12,
  "# Selected Internally": 12,
  "# Rejected Internally": 12,
  "# Submitted": 11,
  "# Other Statuses": 12,
  "Time Taken – 1st Submission": 16,
  "Time Taken – 2nd Submission": 16,
  "Time Taken – 3rd Submission": 16,
  "Internal Screening Required": 16,
  "Recruitment Manager": 20,
  "Pay Rate/Salary": 16,
  Experience: 16,
  "Mandate Skills": 32,
  "Job Description": 48,
  Comments: 42,
  Candidate: 22,
  "Recruiter (Submitted By)": 20,
  "Submitted On": 18,
  "Waiting for Evaluation (→ Req Owner)": 20,
  "→ time to Internal Interview": 16,
  "Internal Interview (Screening)": 20,
  "→ time to Internal Decision": 16,
  "Selected Internally": 18,
  "Rejected Internally": 18,
  "→ time to Submitted": 16,
  "Submitted (→ Client/Vendor)": 20,
  Note: 42,
};

export interface ReportInfo {
  generatedAt?: string;
  scope?: string;
  rowCount?: number;
  filters?: { label: string; value: string }[];
  columns?: string[]; // subset of COLUMNS to export (in canonical order); defaults to all
}

export async function buildWorkbook(result: ReportResult, info?: ReportInfo): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cliff Recruiter Suite";
  wb.created = new Date();

  // Which columns to export, kept in canonical order (defaults to all).
  const cols =
    info?.columns && info.columns.length
      ? COLUMNS.filter((c) => info.columns!.includes(c))
      : COLUMNS;

  // ---- Report Info sheet (records the basis of the report: scope + filters) ----
  if (info) {
    const iws = wb.addWorksheet("Report Info");
    iws.getColumn(1).width = 26;
    iws.getColumn(2).width = 70;
    const addRow = (a: string, b: string, opts: { bold?: boolean; header?: boolean } = {}) => {
      const r = iws.addRow([a, b]);
      r.getCell(1).font = { name: "Arial", bold: true, size: 10, color: { argb: "FF1F4E78" } };
      r.getCell(2).font = { name: "Arial", bold: !!opts.bold, size: opts.header ? 13 : 10 };
      if (opts.header) r.getCell(1).font = { name: "Arial", bold: true, size: 13, color: { argb: "FF1F4E78" } };
      r.getCell(2).alignment = { wrapText: true, vertical: "top" };
      return r;
    };
    addRow("Cliff Recruiter Suite", "Submissions Report", { header: true });
    addRow("Generated", info.generatedAt ?? "");
    if (info.scope) addRow("Fetch scope", info.scope);
    if (info.rowCount != null) addRow("Rows in this export", String(info.rowCount));
    addRow("Columns in this export", `${cols.length} of ${COLUMNS.length}`);
    iws.addRow([]);
    addRow("Filters applied", info.filters && info.filters.length ? "" : "None — all rows included");
    for (const f of info.filters ?? []) addRow(`  • ${f.label}`, f.value);
  }

  const ws = wb.addWorksheet("Submissions Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Columns / header.
  ws.columns = cols.map((c) => ({ header: c, key: c, width: WIDTHS[c] ?? 16 }));

  const headerRow = ws.getRow(1);
  headerRow.height = 34;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.font = { name: "Arial", bold: true, color: { argb: HEADER_FONT }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });

  // Data rows.
  for (const row of result.rows) {
    const values = cols.map((c) => row.cells[c] ?? "");
    const added = ws.addRow(values);
    added.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10, color: row.red ? { argb: RED_TEXT } : undefined, bold: row.red };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = thinBorder();
      if (row.red) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_FILL } };
      } else if (row.na) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACH } };
      }
    });
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function thinBorder(): ExcelJS.Borders {
  const s = { style: "thin" as const, color: { argb: "FFD9D9D9" } };
  return { top: s, left: s, bottom: s, right: s } as ExcelJS.Borders;
}
