// Recruiter phone extensions (Vitel Global direct numbers). Used to label the
// phone-call metrics per recruiter. Names are matched loosely to the recruiter's
// name on the leaderboard (first-name / no-space prefix match).

export interface ExtEntry {
  name: string;
  ext: string;
  direct: string;
}

// Recruiter-facing extensions only (Operator/HR/Accounts omitted).
const EXTENSIONS: ExtEntry[] = [
  { name: "Mubal", ext: "104", direct: "571-833-1718" },
  { name: "Vipul", ext: "105", direct: "571-833-1721" },
  { name: "Sailaja", ext: "106", direct: "571-833-1711" },
  { name: "Alex", ext: "107", direct: "571-833-1712" },
  { name: "Gurudeepthi", ext: "108", direct: "571-833-1713" },
  { name: "Pavan", ext: "109", direct: "571-833-1728" },
  { name: "Juhi", ext: "110", direct: "571-833-1729" },
  { name: "Lalith", ext: "125", direct: "571-833-1724" },
  { name: "Venky", ext: "129", direct: "571-378-4901" },
  { name: "Abhishek KC", ext: "130", direct: "571-378-4902" },
  { name: "Deepu", ext: "131", direct: "571-378-4903" },
  { name: "Chinki", ext: "132", direct: "571-378-4904" },
  { name: "Nitin", ext: "111", direct: "571-463-1837" },
  { name: "Saurabh", ext: "112", direct: "571-685-2275" },
  { name: "Srujan", ext: "113", direct: "571-685-2025" },
  { name: "Veeresh", ext: "114", direct: "571-685-2083" },
  { name: "Chandra", ext: "115", direct: "571-685-2089" },
];

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find a recruiter's extension entry, or null if there's no match. */
export function extensionFor(recruiter: string): ExtEntry | null {
  const r = norm(recruiter);
  if (!r) return null;
  for (const e of EXTENSIONS) if (norm(e.name) === r) return e; // exact
  for (const e of EXTENSIONS) {
    const n = norm(e.name);
    if (r.startsWith(n) || n.startsWith(r)) return e; // first-name / prefix
  }
  return null;
}
