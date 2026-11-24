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

export type ReportKey =
  | "job_duration"
  | "submissions"
  | "job_board"
  | "pipeline_logs"
  | "mail_merge"
  | "advanced_search"
  | "active_jobs"
  | "selected_candidates"
  | "bench_list"
  | "bench_submissions";

const REPORT_ENV: Record<ReportKey, string> = {
  job_duration: "CEIPAL_JOB_DURATION_URL",
  submissions: "CEIPAL_SUBMISSIONS_URL",
  job_board: "CEIPAL_JOB_BOARD_URL",
  pipeline_logs: "CEIPAL_PIPELINE_LOGS_URL",
  mail_merge: "CEIPAL_MAIL_MERGE_URL",
  advanced_search: "CEIPAL_ADV_SEARCH_URL",
  active_jobs: "CEIPAL_ACTIVE_JOBS_URL",
  selected_candidates: "CEIPAL_SELECTED_CANDIDATES_URL",
  bench_list: "CEIPAL_BENCH_LIST_URL",
  bench_submissions: "CEIPAL_BENCH_SUBMISSIONS_URL",
};

export function reportUrl(report: ReportKey): string {
  return env(REPORT_ENV[report]);
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
const CONCURRENCY = 5; // parallel page fetches (kept modest to avoid Ceipal rate limits)

function hasNextPage(json: Record<string, unknown>): boolean {
  const v = json.has_next_page;
  return v === 1 || v === true || v === "1";
}

function rowsOf(json: Record<string, unknown>): unknown[] {
  return Array.isArray(json.result) ? (json.result as unknown[]) : [];
}

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

export interface Diagnosis {
  authOk: boolean;
  authStatus: number;
  /** Which JSON field the token came out of, so a tenant that names it oddly is visible. */
  tokenField: string | null;
  /** First 8 chars only. Enough to tell a real token from a pasted apiKey, never the token. */
  tokenPrefix: string | null;
  reportStatus: number | null;
  /** Truncated response body, so Ceipal's own error text reaches the operator. */
  reportBody: string | null;
  recordCount: number | null;
  rowsReturned: number | null;
  error: string | null;
}

/**
 * Single-shot probe of one report URL: mint a token, then GET one row.
 * Built for "is this endpoint actually reachable with our credentials", so it
 * reports Ceipal's own status codes and error text rather than throwing them away.
 * Never returns the password or the full token.
 */
export async function diagnoseReport(url: string, password: string): Promise<Diagnosis> {
  const out: Diagnosis = {
    authOk: false, authStatus: 0, tokenField: null, tokenPrefix: null,
    reportStatus: null, reportBody: null, recordCount: null, rowsReturned: null, error: null,
  };

  // Auth leg. Bypasses the module token cache so the probe always tests a fresh mint.
  let token = "";
  try {
    const authUrl = env("CEIPAL_AUTH_URL", "https://api.ceipal.com/v2/createAuthtoken/");
    const res = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: env("CEIPAL_EMAIL"), password, apiKey: env("CEIPAL_API_KEY") }),
    });
    out.authStatus = res.status;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      out.error = `Auth failed (${res.status}): ${text.slice(0, 300)}`;
      return out;
    }
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      out.error = `Auth returned non-JSON: ${text.slice(0, 200)}`;
      return out;
    }
    const o = (data ?? {}) as Record<string, unknown>;
    for (const k of ["access_token", "token", "accessToken", "authtoken", "auth_token"]) {
      if (typeof o[k] === "string" && (o[k] as string).length > 0) {
        token = o[k] as string;
        out.tokenField = k;
        break;
      }
    }
    if (!token) {
      out.error = `Auth succeeded but no token field found. Keys: ${Object.keys(o).join(", ")}`;
      return out;
    }
    out.authOk = true;
    out.tokenPrefix = token.slice(0, 8);
  } catch (e) {
    out.error = `Auth request threw: ${(e as Error).message}`;
    return out;
  }

  // Report leg. One row is enough to prove access.
  try {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${sep}limit=1&page=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    out.reportStatus = res.status;
    const text = await res.text().catch(() => "");
    out.reportBody = text.slice(0, 600);
    if (res.ok) {
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        out.recordCount = Number(json.record_count) || 0;
        out.rowsReturned = Array.isArray(json.result) ? json.result.length : 0;
      } catch {
        out.error = "Report returned 200 but the body was not JSON.";
      }
    } else {
      out.error = `Report fetch failed (${res.status}).`;
    }
  } catch (e) {
    out.error = `Report request threw: ${(e as Error).message}`;
  }
  return out;
}

/**
 * Cheap freshness probe: fetch only page 1 (limit=1) and return Ceipal's current
 * record_count (the report's total available). One fast request, no full pull.
 */
export async function probeTotal(report: ReportKey, password: string): Promise<number> {
  const base = reportUrl(report);
  if (!base) throw new Error(`No endpoint configured for report "${report}".`);
  const sep = base.includes("?") ? "&" : "?";
  const json = await fetchPage(`${base}${sep}limit=1&page=1`, password);
  return Number(json.record_count) || 0;
}

/**
 * Fetch a Ceipal report, following pagination (?limit=100&page=N).
 * Stops after `maxRecords` rows (0/undefined = fetch everything). Returns one
 * envelope with the accumulated rows in `result`.
 */
export async function fetchReport(
  report: ReportKey,
  password: string,
  maxRecords = 0
): Promise<unknown> {
  const base = reportUrl(report);
  if (!base) throw new Error(`No endpoint configured for report "${report}".`);

  const sep = base.includes("?") ? "&" : "?";
  const pageUrl = (page: number) => `${base}${sep}limit=${PAGE_SIZE}&page=${page}`;

  // Page 1 (sequential): warms the auth-token cache and tells us the total.
  const first = await fetchPage(pageUrl(1), password);
  const totalAvailable = Number(first.record_count) || 0;
  const firstRows = rowsOf(first);

  // Only trust the total for parallel paging when it clearly spans many pages;
  // otherwise fall back to the safe sequential has_next_page walk.
  const reliableTotal = totalAvailable > PAGE_SIZE || (totalAvailable > 0 && !hasNextPage(first));

  const pageRows: unknown[][] = [firstRows];

  if (reliableTotal) {
    let lastPage = Math.ceil(totalAvailable / PAGE_SIZE);
    if (maxRecords > 0) lastPage = Math.min(lastPage, Math.ceil(maxRecords / PAGE_SIZE));
    lastPage = Math.min(lastPage, MAX_PAGES);

    const queue: number[] = [];
    for (let p = 2; p <= lastPage; p++) queue.push(p);
    const results = new Array<unknown[]>(lastPage + 1);
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const p = queue[next++];
        results[p] = rowsOf(await fetchPage(pageUrl(p), password));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    for (let p = 2; p <= lastPage; p++) pageRows.push(results[p] ?? []);
  } else {
    // Unknown/small total — walk sequentially until has_next_page is false.
    let hasNext = hasNextPage(first);
    let collected = firstRows.length;
    for (let page = 2; hasNext && page <= MAX_PAGES; page++) {
      if (maxRecords > 0 && collected >= maxRecords) break;
      const json = await fetchPage(pageUrl(page), password);
      const rows = rowsOf(json);
      pageRows.push(rows);
      collected += rows.length;
      if (rows.length === 0) break;
      hasNext = hasNextPage(json);
    }
  }

  const allRows = pageRows.flat();
  const trimmed = maxRecords > 0 ? allRows.slice(0, maxRecords) : allRows;
  return {
    ...first,
    result: trimmed,
    record_count: trimmed.length,
    total_available: totalAvailable,
    pages_fetched: pageRows.length,
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
