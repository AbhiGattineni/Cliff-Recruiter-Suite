// Ceipal Custom Reports API proxy.
// Authenticates (email + password + apiKey) to get a bearer token, then GETs
// the requested report. Field names for the auth request follow Ceipal's
// documented createAuthtoken; adjust here if your tenant differs.

interface AuthResult {
  token: string;
}

// Simple in-memory token cache (per warm instance) to avoid re-auth on every call.
let cachedToken: { token: string; expires: number } | null = null;

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function reportUrl(report: "job_duration" | "submissions"): string {
  return report === "job_duration"
    ? env("CEIPAL_JOB_DURATION_URL")
    : env("CEIPAL_SUBMISSIONS_URL");
}

async function authenticate(password: string): Promise<AuthResult> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires > now + 60_000) {
    return { token: cachedToken.token };
  }

  const url = env("CEIPAL_AUTH_URL", "https://api.ceipal.com/v2/createAuthtoken/");
  // Ceipal expects camelCase apiKey (verified against the live createAuthtoken API).
  const body = {
    email: env("CEIPAL_EMAIL"),
    password,
    apiKey: env("CEIPAL_API_KEY"),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ceipal auth failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data: unknown = await res.json();
  const token = extractToken(data);
  if (!token) {
    throw new Error("Ceipal auth succeeded but no token was found in the response.");
  }
  // Ceipal tokens are typically valid for ~30 minutes.
  cachedToken = { token, expires: now + 25 * 60_000 };
  return { token };
}

function extractToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  for (const key of ["access_token", "token", "accessToken", "authtoken", "auth_token"]) {
    const v = o[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // Sometimes nested under data/result.
  for (const key of ["data", "result"]) {
    const inner = o[key];
    if (inner && typeof inner === "object") {
      const t = extractToken(inner);
      if (t) return t;
    }
  }
  return null;
}

const PAGE_SIZE = 100; // Ceipal caps the page size at 100 rows
const MAX_PAGES = 500; // safety stop (= up to 50,000 rows)

// Fetch ONE page, handling a mid-flight 401 by re-authenticating once.
async function fetchPage(url: string, password: string): Promise<Record<string, unknown>> {
  let token = (await authenticate(password)).token;
  let res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (res.status === 401) {
    cachedToken = null;
    token = (await authenticate(password)).token;
    res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ceipal report fetch failed (${res.status}): ${t.slice(0, 300)}`);
  }
  return checkPayload(await res.json()) as Record<string, unknown>;
}

/**
 * Fetch a Ceipal report, following pagination (?limit=100&page=N).
 * Stops after `maxRecords` rows (0/undefined = fetch everything). Returns one
 * envelope with the accumulated rows in `result`.
 */
export async function fetchReport(
  report: "job_duration" | "submissions",
  password: string,
  maxRecords = 0
): Promise<unknown> {
  const base = reportUrl(report);
  if (!base) throw new Error(`No endpoint configured for report "${report}".`);

  const allRows: unknown[] = [];
  let envelope: Record<string, unknown> = {};
  let totalAvailable = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}limit=${PAGE_SIZE}&page=${page}`;
    const json = await fetchPage(url, password);
    if (page === 1) {
      envelope = json;
      totalAvailable = Number(json.record_count) || 0;
    }
    const rows = Array.isArray(json.result) ? (json.result as unknown[]) : [];
    allRows.push(...rows);
    const hasNext = json.has_next_page === 1 || json.has_next_page === true || json.has_next_page === "1";
    if (!hasNext || rows.length === 0) break;
    if (maxRecords > 0 && allRows.length >= maxRecords) break;
  }

  const trimmed = maxRecords > 0 ? allRows.slice(0, maxRecords) : allRows;
  return {
    ...envelope,
    result: trimmed,
    record_count: trimmed.length,
    total_available: totalAvailable,
    pages_fetched: Math.ceil(allRows.length / PAGE_SIZE),
  };
}

// Ceipal returns HTTP 200 with { success: 0, message, data: null } on report-level
// errors (e.g. exceeding the 70-column limit). Surface that message to the caller.
function checkPayload(json: unknown): unknown {
  if (json && typeof json === "object") {
    const o = json as { success?: unknown; message?: unknown };
    const failed = o.success === 0 || o.success === false || o.success === "0";
    if (failed) {
      const msg = typeof o.message === "string" && o.message ? o.message : "Ceipal returned no data for this report.";
      throw new Error(`Ceipal: ${msg}`);
    }
  }
  return json;
}
