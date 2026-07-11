// Read an uploaded .xlsx into rows (array-of-arrays per sheet).
//
// Primary path: SheetJS (xlsx). It is tolerant of most files.
// Fallback path: Ceipal exports sometimes carry a malformed stylesheet that
// strict parsers reject ("Colors must be aRGB hex values"). If SheetJS throws,
// we read the raw XML directly (xl/worksheets/sheet1.xml + xl/sharedStrings.xml),
// exactly as the Python reference does.

import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface SheetRows {
  name: string;
  rows: string[][];
}

/** Convert an A1-style ref ("AB12") to a zero-based column index. */
function colIndexFromRef(ref: string): number {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  const letters = m[1];
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export async function readWorkbookRows(file: File): Promise<SheetRows[]> {
  const buf = await file.arrayBuffer();
  try {
    return readWithSheetJs(buf);
  } catch (err) {
    console.warn("SheetJS failed, falling back to raw XML parse:", err);
    return readWithRawXml(buf);
  }
}

function readWithSheetJs(buf: ArrayBuffer): SheetRows[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false, cellStyles: false });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }) as unknown as string[][];
    return { name, rows: rows.map((r) => (r || []).map((c) => (c == null ? "" : String(c)))) };
  });
}

async function readWithRawXml(buf: ArrayBuffer): Promise<SheetRows[]> {
  const zip = await JSZip.loadAsync(buf);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });

  // Shared strings table.
  const sharedStrings: string[] = [];
  const sstFile = zip.file("xl/sharedStrings.xml");
  if (sstFile) {
    const sstXml = await sstFile.async("string");
    const sst = parser.parse(sstXml);
    const sis = toArray(sst?.sst?.si);
    for (const si of sis) {
      sharedStrings.push(extractSiText(si));
    }
  }

  // Every worksheet under xl/worksheets/sheetN.xml
  const sheetFiles = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort();

  const results: SheetRows[] = [];
  for (const path of sheetFiles) {
    const xml = await zip.file(path)!.async("string");
    const doc = parser.parse(xml);
    const rowsXml = toArray(doc?.worksheet?.sheetData?.row);
    const rows: string[][] = [];
    for (const r of rowsXml) {
      const rowNum = parseInt(String(r?.["@_r"] ?? rows.length + 1), 10) - 1;
      const cells = toArray(r?.c);
      const rowArr: string[] = [];
      for (const c of cells) {
        const ref = String(c?.["@_r"] ?? "");
        const colIdx = ref ? colIndexFromRef(ref) : rowArr.length;
        rowArr[colIdx] = cellValue(c, sharedStrings);
      }
      rows[rowNum] = fill(rowArr);
    }
    results.push({ name: path, rows: fillRows(rows) });
  }
  return results;
}

function extractSiText(si: unknown): string {
  const s = si as Record<string, unknown>;
  if (s == null) return "";
  if (typeof s.t === "string") return s.t;
  if (s.t && typeof s.t === "object") return String((s.t as Record<string, unknown>)["#text"] ?? "");
  // rich text runs
  const runs = toArray((s as { r?: unknown }).r);
  if (runs.length) {
    return runs
      .map((run) => {
        const rt = (run as { t?: unknown }).t;
        if (typeof rt === "string") return rt;
        if (rt && typeof rt === "object") return String((rt as Record<string, unknown>)["#text"] ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

function cellValue(c: Record<string, unknown>, shared: string[]): string {
  if (c == null) return "";
  const t = c["@_t"];
  if (t === "s") {
    const idx = parseInt(String(getV(c)), 10);
    return shared[idx] ?? "";
  }
  if (t === "inlineStr") {
    const is = c["is"] as Record<string, unknown> | undefined;
    if (is) {
      if (typeof is.t === "string") return is.t;
      if (is.t && typeof is.t === "object") return String((is.t as Record<string, unknown>)["#text"] ?? "");
    }
    return "";
  }
  const v = getV(c);
  return v == null ? "" : String(v);
}

function getV(c: Record<string, unknown>): unknown {
  const v = c["v"];
  if (v == null) return c["#text"];
  if (typeof v === "object") return (v as Record<string, unknown>)["#text"];
  return v;
}

function fill(arr: string[]): string[] {
  for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = "";
  return arr;
}

function fillRows(rows: string[][]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < rows.length; i++) out.push(rows[i] ? fill(rows[i]) : []);
  return out;
}
