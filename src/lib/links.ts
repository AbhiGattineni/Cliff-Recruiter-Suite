// Extract candidate profile links (GitHub / LinkedIn) from raw resume text.

// Paths on github.com that are site pages, not user profiles.
const GITHUB_RESERVED = new Set([
  "features", "topics", "collections", "trending", "marketplace", "orgs", "sponsors",
  "settings", "pulls", "issues", "explore", "notifications", "about", "contact",
  "pricing", "site", "blog", "apps", "login", "join", "search", "enterprise", "team",
]);

export interface ProfileLinks {
  github: string; // normalised https://github.com/<user> or ""
  linkedin: string; // normalised https://…linkedin.com/in/<slug> or ""
}

export function extractProfileLinks(text: string): ProfileLinks {
  const t = String(text ?? "");

  let github = "";
  const ghRe = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/gi;
  let m: RegExpExecArray | null;
  while ((m = ghRe.exec(t))) {
    const user = m[1].replace(/-+$/, "");
    if (user && !GITHUB_RESERVED.has(user.toLowerCase())) {
      github = `https://github.com/${user}`;
      break;
    }
  }

  let linkedin = "";
  const liM = t.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9\-_%]+(?:\.[A-Za-z0-9\-_%]+)*/i);
  if (liM) {
    let url = liM[0].replace(/\.+$/, "");
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    linkedin = url;
  }

  return { github, linkedin };
}

/** Normalise a GitHub URL/username typed or extracted elsewhere ("" if unusable). */
export function normalizeGithubUrl(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (/github\.com\//i.test(s)) return extractProfileLinks(s).github;
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?$/.test(s)) return `https://github.com/${s}`;
  return "";
}

/** Normalise a LinkedIn URL ("" if it doesn't look like one). */
export function normalizeLinkedinUrl(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return extractProfileLinks(s).linkedin;
}
