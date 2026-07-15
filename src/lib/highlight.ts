// Split text into segments, marking case-insensitive occurrences of any keyword.
// Longest keywords are matched first (so "Oracle SQL" wins over "SQL").

export interface Segment {
  text: string;
  match: boolean;
}

export function highlightKeywords(text: string, keywords: string[]): Segment[] {
  const kws = Array.from(
    new Set(
      (keywords || [])
        .map((k) => (k || "").trim())
        .filter((k) => k.length >= 2)
    )
  ).sort((a, b) => b.length - a.length);

  if (!kws.length || !text) return [{ text: text || "", match: false }];

  const escaped = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");

  const segments: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), match: false });
    segments.push({ text: m[0], match: true });
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length matches
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}
