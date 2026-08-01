// GitHub portfolio data — profile, repositories, and top READMEs condensed into
// a compact text summary the LLM can assess against a job description.
// Works unauthenticated (60 req/hr) or with a GITHUB_TOKEN secret (5000 req/hr).

const API = "https://api.github.com";

export interface GithubProfile {
  login: string;
  url: string;
  avatarUrl: string;
  name: string;
  bio: string;
  location: string;
  company: string;
  blog: string;
  publicRepos: number;
  followers: number;
  createdAt: string;
}

function headers(token?: string, accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = {
    accept,
    "user-agent": "cliff-recruiter-suite",
    "x-github-api-version": "2022-11-28",
  };
  if (token && !token.startsWith("PLACEHOLDER")) h.authorization = `Bearer ${token}`;
  return h;
}

async function gh(path: string, token?: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      "GitHub API rate limit reached. Set a GITHUB_TOKEN secret to raise the limit, or retry in a few minutes."
    );
  }
  if (!res.ok) throw new Error(`GitHub API error (${res.status}) for ${path}`);
  return res.json();
}

/** Accepts a full github.com URL or a bare username; returns the username ("" if invalid). */
export function parseGithubUsername(input: string): string {
  const s = String(input ?? "").trim();
  const m = s.match(/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?$/.test(s)) return s;
  return "";
}

function toProfile(u: Record<string, unknown>): GithubProfile {
  const s = (v: unknown) => String(v ?? "");
  return {
    login: s(u.login),
    url: s(u.html_url) || `https://github.com/${s(u.login)}`,
    avatarUrl: s(u.avatar_url),
    name: s(u.name),
    bio: s(u.bio),
    location: s(u.location),
    company: s(u.company),
    blog: s(u.blog),
    publicRepos: Number(u.public_repos) || 0,
    followers: Number(u.followers) || 0,
    createdAt: s(u.created_at),
  };
}

export async function fetchProfile(username: string, token?: string): Promise<GithubProfile | null> {
  const u = (await gh(`/users/${encodeURIComponent(username)}`, token)) as Record<string, unknown> | null;
  return u ? toProfile(u) : null;
}

/**
 * Search GitHub for likely profiles for a candidate — email match first (high
 * precision), then name matches. Returns full profiles for the top hits so the
 * recruiter can confirm the right person before anything is attached.
 */
export async function searchUsers(name: string, email: string, token?: string): Promise<GithubProfile[]> {
  const logins: string[] = [];
  const push = (r: unknown) => {
    const items = (r as { items?: Array<{ login?: string }> })?.items ?? [];
    for (const it of items) {
      const l = String(it?.login ?? "");
      if (l && !logins.includes(l)) logins.push(l);
    }
  };
  if (email.includes("@")) {
    push(await gh(`/search/users?q=${encodeURIComponent(`${email} in:email`)}&per_page=3`, token).catch(() => null));
  }
  if (name.trim()) {
    push(
      await gh(`/search/users?q=${encodeURIComponent(`${name.trim()} in:name type:user`)}&per_page=6`, token).catch(
        () => null
      )
    );
  }
  const profiles = await Promise.all(logins.slice(0, 5).map((l) => fetchProfile(l, token).catch(() => null)));
  return profiles.filter((p): p is GithubProfile => !!p);
}

interface RepoLite {
  name: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  fork: boolean;
  archived: boolean;
  pushedAt: string;
  topics: string[];
}

export interface PortfolioData {
  profile: GithubProfile;
  summaryText: string; // compact text handed to the LLM
  repoCount: number;
  originalRepoCount: number;
}

/** Fetch profile + repos (+ top READMEs) and fold them into an LLM-ready summary. */
export async function buildPortfolio(username: string, token?: string): Promise<PortfolioData> {
  const profile = await fetchProfile(username, token);
  if (!profile) throw new Error(`GitHub user "${username}" was not found.`);

  const raw = (await gh(`/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`, token)) as
    | Array<Record<string, unknown>>
    | null;
  const s = (v: unknown) => String(v ?? "");
  const repos: RepoLite[] = (raw ?? []).map((r) => ({
    name: s(r.name),
    url: s(r.html_url),
    description: s(r.description),
    language: s(r.language),
    stars: Number(r.stargazers_count) || 0,
    fork: r.fork === true,
    archived: r.archived === true,
    pushedAt: s(r.pushed_at).slice(0, 10),
    topics: Array.isArray(r.topics) ? (r.topics as unknown[]).map(s) : [],
  }));
  const originals = repos.filter((r) => !r.fork);

  const langCount = new Map<string, number>();
  for (const r of originals) {
    if (r.language) langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1);
  }
  const langLine = Array.from(langCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l} (${n})`)
    .join(", ");

  // README excerpts for the 3 most recently pushed original repos.
  const readmeTargets = originals.slice(0, 3);
  const readmes = await Promise.all(
    readmeTargets.map(async (r) => {
      try {
        const res = await fetch(`${API}/repos/${username}/${r.name}/readme`, {
          headers: headers(token, "application/vnd.github.raw+json"),
        });
        if (!res.ok) return null;
        const text = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 1200);
        return text ? { name: r.name, text } : null;
      } catch {
        return null;
      }
    })
  );

  const lines: string[] = [];
  lines.push(
    `PROFILE: ${profile.name || profile.login} (@${profile.login}) — ${profile.publicRepos} public repos, ` +
      `${profile.followers} followers, on GitHub since ${profile.createdAt.slice(0, 10)}.`
  );
  if (profile.bio) lines.push(`BIO: ${profile.bio}`);
  if (profile.company || profile.location) lines.push(`AT: ${[profile.company, profile.location].filter(Boolean).join(" · ")}`);
  if (langLine) lines.push(`LANGUAGES ACROSS ORIGINAL REPOS: ${langLine}`);
  lines.push(`REPOS: ${repos.length} listed (${originals.length} original, ${repos.length - originals.length} forks).`);
  lines.push("");
  lines.push("REPOSITORIES (most recently pushed first):");
  for (const r of repos.slice(0, 30)) {
    lines.push(
      `- ${r.name}${r.fork ? " [FORK]" : ""}${r.archived ? " [ARCHIVED]" : ""} | lang: ${r.language || "n/a"} | ` +
        `stars: ${r.stars} | last push: ${r.pushedAt || "n/a"} | url: ${r.url}` +
        `${r.topics.length ? ` | topics: ${r.topics.slice(0, 6).join(", ")}` : ""}` +
        `${r.description ? ` | ${r.description.slice(0, 160)}` : ""}`
    );
  }
  if (repos.length > 30) lines.push(`(… ${repos.length - 30} more repos omitted)`);
  const gotReadmes = readmes.filter((x): x is { name: string; text: string } => !!x);
  if (gotReadmes.length) {
    lines.push("");
    lines.push("README EXCERPTS (recent original repos):");
    for (const r of gotReadmes) lines.push(`--- ${r.name} ---\n${r.text}`);
  }

  return {
    profile,
    summaryText: lines.join("\n"),
    repoCount: repos.length,
    originalRepoCount: originals.length,
  };
}
