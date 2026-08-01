// LinkedIn profile signals.
//
// IMPORTANT: LinkedIn has no public API for reading third-party profiles, and
// scraping linkedin.com breaches their terms and is blocked for datacenter IPs.
// So this module does NOT fetch linkedin.com. It is a thin adapter over an
// optional commercial profile-data provider:
//
//   LINKEDIN_PROVIDER_URL  e.g. https://api.example.com/v1/linkedin
//   LINKEDIN_API_KEY       (secret) Bearer token for that provider
//
// When neither is configured the callable reports `configured: false` and the
// recruiter enters the signals by hand in the UI. Scoring is identical either way.

export interface LinkedinSignals {
  accountAgeMonths: number | null;
  connections: number | null;
  recommendations: number | null;
  endorsements: number | null;
  positionsCount: number | null;
  hasPhoto: boolean | null;
  hasAbout: boolean | null;
  recentActivity: boolean | null;
}

const EMPTY: LinkedinSignals = {
  accountAgeMonths: null,
  connections: null,
  recommendations: null,
  endorsements: null,
  positionsCount: null,
  hasPhoto: null,
  hasAbout: null,
  recentActivity: null,
};

export function providerConfigured(apiKey: string | undefined): boolean {
  return !!process.env.LINKEDIN_PROVIDER_URL && !!apiKey && !apiKey.startsWith("PLACEHOLDER");
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Months between an ISO-ish date string and now (null if unparseable). */
function monthsSince(v: unknown, nowMs: number): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s.length === 4 ? `${s}-01-01` : s);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((nowMs - ms) / (1000 * 60 * 60 * 24 * 30.44)));
}

/**
 * Map a provider payload onto our signals. Providers differ, so several common
 * field spellings are accepted; anything absent stays null (= "unknown", which
 * the scorer excludes rather than penalising).
 */
export function mapProviderPayload(raw: unknown, nowMs: number): LinkedinSignals {
  const d = (raw ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (d[k] !== undefined && d[k] !== null) return d[k];
    return undefined;
  };
  const arrLen = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);

  const experiences = pick("experiences", "experience", "positions");
  const recommendations = pick("recommendations", "recommendations_received", "recommendationsReceived");
  const photo = pick("profile_pic_url", "profilePicture", "photoUrl", "avatar");
  const about = pick("summary", "about", "headline");

  return {
    accountAgeMonths:
      n(pick("account_age_months", "accountAgeMonths")) ??
      monthsSince(pick("created_at", "createdAt", "joined", "member_since", "profileCreatedAt"), nowMs),
    connections: n(pick("connections", "connection_count", "connectionsCount", "follower_count")),
    recommendations: n(pick("recommendations_count", "recommendationsCount")) ?? arrLen(recommendations),
    endorsements: n(pick("endorsements_count", "endorsementsCount", "skill_endorsements")),
    positionsCount: n(pick("positions_count", "positionsCount")) ?? arrLen(experiences),
    hasPhoto: photo === undefined ? null : !!String(photo ?? "").trim(),
    hasAbout: about === undefined ? null : !!String(about ?? "").trim(),
    recentActivity: (() => {
      const a = pick("recent_activity", "recentActivity", "last_activity_at", "lastActivityAt");
      if (a === undefined) return null;
      if (typeof a === "boolean") return a;
      const months = monthsSince(a, nowMs);
      return months === null ? null : months <= 6;
    })(),
  };
}

/** Fetch signals for a profile URL from the configured provider. */
export async function fetchLinkedinSignals(
  profileUrl: string,
  apiKey: string,
  nowMs: number
): Promise<LinkedinSignals> {
  const base = String(process.env.LINKEDIN_PROVIDER_URL || "").replace(/\/+$/, "");
  const url = `${base}?url=${encodeURIComponent(profileUrl)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LinkedIn provider error (${res.status}): ${t.slice(0, 200)}`);
  }
  return mapProviderPayload(await res.json(), nowMs);
}

export { EMPTY as EMPTY_SIGNALS };
