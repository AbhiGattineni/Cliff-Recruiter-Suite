// Count the scoreable units in a resume — the bullets and sentences the AI
// detector is asked to judge.
//
// This exists to give the AI-content signal a real denominator. Previously the
// UI showed "85% · 16 lines", where the 85 was the model's own holistic guess
// and the 16 was just how many lines it chose to list; the two numbers were
// unrelated and there was no total anywhere, so "16 of what?" had no answer.

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Lines that are structure, not prose — headers, dates, contact and list rows. */
function isStructural(line: string): boolean {
  const t = line.trim();
  if (t.length < 25) return true; // section titles, dates, short labels
  if (/^[A-Z0-9 &/|,.'-]+$/.test(t) && t.length < 60) return true; // ALL-CAPS heading
  if (/^[\s|•·—–-]*$/.test(t)) return true; // rule / separator
  // Contact lines: mostly email / phone / URL with little else.
  if (/@|https?:\/\/|linkedin\.com|github\.com/i.test(t) && t.length < 120 && !/[.!?]\s/.test(t)) return true;
  // Comma-separated lists (skills rows) — many commas, no sentence punctuation.
  const commas = (t.match(/,/g) ?? []).length;
  if (commas >= 2 && commas >= words(t) / 4 && !/[.!?]$/.test(t)) return true;
  return false;
}

// A bulleted line is a unit outright; running prose has to look like a
// sentence, which keeps job titles and company/location rows out of the count.
const MIN_BULLET_WORDS = 4;
const MIN_PROSE_WORDS = 8;

/** Strip a leading bullet glyph or numbering. */
function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[•·▪◦*\-–—]|\(?\d{1,2}[.)])\s+/, "").trim();
}

/**
 * Split resume text into the units an AI detector scores: one per bullet, and
 * one per sentence within running prose (a summary paragraph is several units).
 */
export function resumeSegments(text: string): string[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];

  const out: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripBullet(rawLine);
    if (!line || isStructural(line)) continue;

    // A bulleted line is one unit even when it contains several sentences;
    // a prose paragraph splits into its sentences.
    const bulleted = /^\s*(?:[•·▪◦*\-–—]|\(?\d{1,2}[.)])\s+/.test(rawLine);
    if (bulleted) {
      if (words(line) >= MIN_BULLET_WORDS) out.push(line);
      continue;
    }
    const sentences = line
      .split(/(?<=[.!?])\s+(?=[A-Z(])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25 && words(s) >= MIN_PROSE_WORDS);
    out.push(...sentences);
  }
  return out;
}

/** How many scoreable lines the resume has. */
export function countResumeLines(text: string): number {
  return resumeSegments(text).length;
}

export interface AiShare {
  flagged: number;
  total: number;
  share: number; // 0-100, flagged / total
}

/**
 * The measured share of the resume flagged as AI-written. Returns null when the
 * total isn't known (reports saved before this was recorded), so callers can
 * fall back to the model's own estimate and label it as such.
 */
export function aiShare(flagged: number, total: number | null | undefined): AiShare | null {
  if (!total || !Number.isFinite(total) || total <= 0) return null;
  const f = Math.max(0, Math.min(flagged, total));
  return { flagged: f, total, share: Math.round((f / total) * 100) };
}
