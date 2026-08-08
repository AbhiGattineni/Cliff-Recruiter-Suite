// Generic download for an Ask Anything result — any table/columns/rows, not
// tied to the specialised report-generation export in lib/report/buildXlsx.ts.

import ExcelJS from "exceljs";
import { CatalogColumn } from "./askCatalog";
import { Row } from "./askEngine";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "ask_result";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadAskResultCsv(title: string, columns: CatalogColumn[], rows: Row[]): void {
  const lines = [
    columns.map((c) => csvCell(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${safeName(title)}.csv`);
}

export async function downloadAskResultXlsx(title: string, columns: CatalogColumn[], rows: Row[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(title.slice(0, 31) || "Result");
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, Math.min(40, c.label.length + 6)) }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) sheet.addRow(columns.map((c) => r[c.key] ?? ""));
  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safeName(title)}.xlsx`
  );
}
