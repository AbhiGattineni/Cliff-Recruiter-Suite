// Cloud Functions entry point.
// Callable functions:
//   - ceipalReport({ report }): proxies a Ceipal custom report (auth required).
//   - parseResume({ resumeText, jobDescription }): LLM fit assessment (auth required).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { fetchReport, probeTotal } from "./ceipal.js";
import { readCache, readCacheMeta, writeCache, cacheEnvelope } from "./ceipalCache.js";
import { assessResume, matchRolesToJd, assessPortfolio, planAskQuery, narrateAskResult } from "./llm.js";
import { searchUsers, buildPortfolio, parseGithubUsername } from "./github.js";
import { fetchLinkedinSignals, providerConfigured, EMPTY_SIGNALS } from "./linkedin.js";
import {
  Role,
  UserProfile,
  getOrCreateProfile,
  getProfile,
  setRole,
  saveEntry,
  createLeaveRequest,
  decideLeave,
} from "./timesheets.js";

initializeApp();

// Secrets — set with: firebase functions:secrets:set NAME
const CEIPAL_PASSWORD = defineSecret("CEIPAL_PASSWORD");
const LLM_API_KEY = defineSecret("LLM_API_KEY"); // Ollama Cloud key
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY"); // OpenAI key
// Optional GitHub PAT — raises the API rate limit from 60 to 5000 req/hr.
// A "PLACEHOLDER" value means unauthenticated requests are used.
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");
// Optional commercial LinkedIn profile-data provider (LinkedIn itself has no
// public API for third-party profiles). Unset = recruiter enters signals by hand.
const LINKEDIN_API_KEY = defineSecret("LINKEDIN_API_KEY");

const commonOpts = {
  region: "us-central1",
  cors: true,
  // These non-secret values come from environment (.env for emulator, or set on deploy).
};

// ---- LLM providers ---------------------------------------------------------
type ProviderId = "ollama" | "openai";

function keyConfigured(v: string | undefined): boolean {
  return !!v && !v.startsWith("PLACEHOLDER");
}

/** Resolve a provider + model to a base URL + key. Throws if not configured. */
function resolveLlm(provider: ProviderId, model: string): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  if (provider === "openai") {
    const apiKey = OPENAI_API_KEY.value();
    if (!keyConfigured(apiKey)) {
      throw new HttpsError("failed-precondition", "OpenAI is not configured. Set the OPENAI_API_KEY secret.");
    }
    return {
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey,
      model: model || "gpt-4o-mini",
    };
  }
  // default: ollama
  const apiKey = LLM_API_KEY.value();
  if (!keyConfigured(apiKey)) {
    throw new HttpsError("failed-precondition", "Ollama is not configured. Set the LLM_API_KEY secret.");
  }
  return {
    baseUrl: process.env.LLM_BASE_URL || "https://ollama.com/v1",
    apiKey,
    model: model || process.env.LLM_MODEL || "gpt-oss:20b",
  };
}

function requireAuth(auth: { uid?: string } | undefined): void {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use this feature.");
  }
}

// ---- Timesheets / leave: auth + role helpers -------------------------------
// The rest of the app runs "auth on hold" (see comments below), but the
// approval chain here only means something if we know who's really calling —
// every timesheets/leave/role callable verifies the caller's token and reads
// their role from Firestore rather than trusting anything the client sends.

type CallableAuth = { uid?: string; token?: { email?: unknown; name?: unknown } } | undefined;

async function requireProfile(auth: CallableAuth): Promise<UserProfile> {
  requireAuth(auth);
  const profile = await getProfile(auth!.uid!);
  if (!profile) {
    throw new HttpsError(
      "failed-precondition",
      "Your profile hasn't been set up yet. Reload the app to finish sign-in."
    );
  }
  return profile;
}

function requireRole(profile: UserProfile, roles: Role[]): void {
  if (!roles.includes(profile.role)) {
    throw new HttpsError("permission-denied", "You don't have permission to do this.");
  }
}

// ---- Duplicate detection (by email / phone) --------------------------------
function normEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}
function normPhone(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

interface DuplicateInfo {
  id: string;
  candidateName: string;
  matchedOn: "email" | "phone";
  email: string;
  phone: string;
  createdAt: number | null;
}

/** Find an existing report matching the same email or phone. Returns null if none. */
async function findDuplicate(emailNorm: string, phoneNorm: string): Promise<DuplicateInfo | null> {
  const col = getFirestore().collection("resumeReports");
  const checks: Array<{ field: string; val: string; on: "email" | "phone" }> = [];
  if (emailNorm.includes("@") && emailNorm.length > 3) checks.push({ field: "emailNorm", val: emailNorm, on: "email" });
  if (phoneNorm.length >= 7) checks.push({ field: "phoneNorm", val: phoneNorm, on: "phone" });

  for (const c of checks) {
    // Equality-only query (no orderBy) so no composite index is required.
    const snap = await col.where(c.field, "==", c.val).limit(1).get();
    if (!snap.empty) {
      const d = snap.docs[0];
      const x = d.data() as { candidateName?: string; extracted?: { email?: string; phone?: string }; createdAt?: { toMillis?: () => number } };
      return {
        id: d.id,
        candidateName: x.candidateName ?? "",
        matchedOn: c.on,
        email: x.extracted?.email ?? "",
        phone: x.extracted?.phone ?? "",
        createdAt: x.createdAt?.toMillis?.() ?? null,
      };
    }
  }
  return null;
}

// Live-fetch both reports from Ceipal and store them in the cache.
async function refreshCeipalReport(report: "job_duration" | "submissions", password: string) {
  const data = (await fetchReport(report, password, 0)) as {
    result?: unknown[];
    total_available?: number;
  };
  const rows = Array.isArray(data.result) ? data.result : [];
  await writeCache(report, rows, Number(data.total_available) || rows.length);
  return data;
}

export const ceipalReport = onCall(
  { ...commonOpts, secrets: [CEIPAL_PASSWORD], timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    // AUTH ON HOLD: app runs in open mode. Re-enable requireAuth(request.auth)
    // once authentication is turned back on.
    void request;
    const report = request.data?.report;
    if (report !== "job_duration" && report !== "submissions") {
      throw new HttpsError("invalid-argument", "report must be 'job_duration' or 'submissions'.");
    }
    const refresh = request.data?.refresh === true;
    const password = CEIPAL_PASSWORD.value();
    const configured = !!password && !password.startsWith("PLACEHOLDER");

    const meta = await readCacheMeta(report);

    // Serve the cache when it exists and Ceipal hasn't changed. Freshness check is
    // a single cheap probe of Ceipal's current record_count vs the stored count.
    if (!refresh && meta && meta.recordCount > 0) {
      let unchanged = true;
      if (configured) {
        try {
          const currentTotal = await probeTotal(report, password);
          unchanged = currentTotal === (meta.totalAvailable || meta.recordCount);
        } catch {
          unchanged = true; // probe failed → keep serving cache rather than break
        }
      }
      if (unchanged) {
        const cached = await readCache(report);
        if (cached && cached.rows.length > 0) return { ok: true, data: cacheEnvelope(cached) };
      }
    }

    // Cache missing / stale / forced refresh → do the full pull and re-cache.
    if (!configured) {
      throw new HttpsError(
        "failed-precondition",
        "Ceipal password is not configured. Set the CEIPAL_PASSWORD secret."
      );
    }
    try {
      const data = await refreshCeipalReport(report, password);
      return { ok: true, data: { ...data, cachedAt: Date.now(), cached: false } };
    } catch (err) {
      // On failure, fall back to any stale cache so the app still works.
      const cached = await readCache(report);
      if (cached && cached.rows.length > 0) {
        return { ok: true, data: { ...cacheEnvelope(cached), stale: true } };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, data: null, error: msg };
    }
  }
);

// ---- Recruiter activity (job-board credits, pipeline updates, mail merge) ----
// These reports are large; we pull them, COUNT per recruiter/date, and discard —
// nothing is stored. Dates in the reports are MM/DD/YYYY [HH:mm:ss]; the client
// passes from/to as ISO yyyy-mm-dd (inclusive).
const activityNameKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function parseCeipalDay(s: string): number | null {
  const part = String(s ?? "").trim().split(/\s+/)[0];
  const p = part.split("/");
  if (p.length !== 3) return null;
  const mm = Number(p[0]), dd = Number(p[1]), yyyy = Number(p[2]);
  if (!yyyy || !mm || !dd) return null;
  return Date.UTC(yyyy, mm - 1, dd);
}
function parseIsoDay(s: string): number | null {
  const p = String(s ?? "").split("-");
  if (p.length !== 3) return null;
  const y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}
function rowsOfReport(d: unknown): Record<string, unknown>[] {
  const r = (d as { result?: unknown })?.result;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

interface ActivityAcc {
  pipelineUpdates: number;
  bulkEmails: number;
  diceCredits: number;
  monsterCredits: number;
  advSearchInternalDb: number; // NOT date-filtered — the report has no date column
}

export const recruiterActivity = onCall(
  { ...commonOpts, secrets: [CEIPAL_PASSWORD], timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    void request; // auth on hold (open mode)
    const password = CEIPAL_PASSWORD.value();
    if (!password || password.startsWith("PLACEHOLDER")) {
      throw new HttpsError("failed-precondition", "Ceipal password is not configured.");
    }
    const fromMs = parseIsoDay(String(request.data?.from ?? ""));
    const toMs = parseIsoDay(String(request.data?.to ?? ""));
    const inRange = (dayMs: number | null) =>
      dayMs != null && (fromMs == null || dayMs >= fromMs) && (toMs == null || dayMs <= toMs);

    const [pipe, mail, board, adv] = await Promise.all([
      fetchReport("pipeline_logs", password, 0),
      fetchReport("mail_merge", password, 0),
      fetchReport("job_board", password, 0),
      fetchReport("advanced_search", password, 0),
    ]);

    const by = new Map<string, ActivityAcc>();
    const acc = (name: unknown): ActivityAcc | null => {
      const k = activityNameKey(name);
      if (!k) return null;
      let a = by.get(k);
      if (!a) {
        a = { pipelineUpdates: 0, bulkEmails: 0, diceCredits: 0, monsterCredits: 0, advSearchInternalDb: 0 };
        by.set(k, a);
      }
      return a;
    };

    for (const r of rowsOfReport(pipe)) {
      if (!inRange(parseCeipalDay(String(r.StatusChangedOn ?? "")))) continue;
      const a = acc(r.StatusChangedBy);
      if (a) a.pipelineUpdates++;
    }
    for (const r of rowsOfReport(mail)) {
      if (!inRange(parseCeipalDay(String(r.MailsSentOn ?? "")))) continue;
      const a = acc(r.MemberName);
      if (a) a.bulkEmails += Number(r.MailsSent) || 0;
    }
    for (const r of rowsOfReport(board)) {
      if (!inRange(parseCeipalDay(String(r.ImportedOn ?? "")))) continue;
      const a = acc(r.UserName);
      if (!a) continue;
      const cnt = Number(r.Count) || 0;
      const jb = String(r.JobBoardName ?? "").toLowerCase();
      if (jb.includes("dice")) a.diceCredits += cnt;
      else if (jb.includes("monster")) a.monsterCredits += cnt;
    }
    // Advanced search report has no date column — running per-user InternalDB total.
    for (const r of rowsOfReport(adv)) {
      const a = acc(r.UserName);
      if (a) a.advSearchInternalDb += Number(r.InternalDB) || 0;
    }

    const byRecruiter: Record<string, ActivityAcc> = {};
    for (const [k, v] of by) byRecruiter[k] = v;
    return { ok: true, from: request.data?.from ?? null, to: request.data?.to ?? null, byRecruiter, fetchedAt: Date.now() };
  }
);

// Currently-open jobs (Ceipal "Active Jobs - All" report). Small live snapshot.
export const activeJobs = onCall(
  { ...commonOpts, secrets: [CEIPAL_PASSWORD], timeoutSeconds: 120, memory: "256MiB" },
  async (request) => {
    void request;
    const password = CEIPAL_PASSWORD.value();
    if (!password || password.startsWith("PLACEHOLDER")) {
      throw new HttpsError("failed-precondition", "Ceipal password is not configured.");
    }
    const s = (v: unknown) => String(v ?? "").trim();
    const n = (v: unknown) => Number(String(v ?? "").replace(/[^0-9-]/g, "")) || 0;
    const data = (await fetchReport("active_jobs", password, 0)) as { result?: Record<string, unknown>[] };
    const rows = Array.isArray(data.result) ? data.result : [];
    const jobs = rows.map((r) => ({
      jobCode: s(r.JobCode),
      jobTitle: s(r.JobTitle),
      client: s(r.Client),
      location: s(r.Location) || s(r.States),
      status: s(r.JobStatus),
      positions: n(r.NumberOfPositions),
      submissions: n(r["#OfSubmissions"]),
      clientSub: n(r["#OfClientSub"]),
      interviews: n(r["#OfInterviews"]),
      placements: n(r["#OfPlacements"]),
      recruitmentManager: s(r.RecruitmentManager),
      payRate: s(r["PayRate/Salary"]),
      remote: s(r.RemoteJob),
      jobCreated: s(r.JobCreated),
    }));
    return { ok: true, jobs, fetchedAt: Date.now() };
  }
);

// ---- Internally-selected candidate pool ------------------------------------
function parseCeipalMs(v: unknown): number {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return 0;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

// Prefer OpenAI (cheap gpt-4o-mini) for lightweight matching, else Ollama.
function pickLlm(): { provider: ProviderId; baseUrl: string; apiKey: string; model: string } {
  if (keyConfigured(OPENAI_API_KEY.value())) return { provider: "openai", ...resolveLlm("openai", "gpt-4o-mini") };
  return { provider: "ollama", ...resolveLlm("ollama", "") };
}

async function logLlmCall(
  feature: string,
  provider: string,
  model: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number }
): Promise<void> {
  await getFirestore().collection("llmCalls").add({
    feature,
    provider,
    model,
    promptTokens: Number(usage.promptTokens) || 0,
    completionTokens: Number(usage.completionTokens) || 0,
    totalTokens: Number(usage.totalTokens) || 0,
    cost: Number(usage.cost) || 0,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// Candidates already sourced/submitted (Ceipal "internally selected" report),
// de-duplicated to one row per candidate with the distinct roles they've been
// submitted to (used for JD matching).
export const candidatePool = onCall(
  { ...commonOpts, secrets: [CEIPAL_PASSWORD], timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    void request;
    const password = CEIPAL_PASSWORD.value();
    if (!password || password.startsWith("PLACEHOLDER")) {
      throw new HttpsError("failed-precondition", "Ceipal password is not configured.");
    }
    const s = (v: unknown) => String(v ?? "").trim();
    const data = (await fetchReport("selected_candidates", password, 0)) as { result?: Record<string, unknown>[] };
    const rows = Array.isArray(data.result) ? data.result : [];

    interface Cand {
      name: string; email: string; mobile: string; location: string; status: string;
      latestRole: string; latestClient: string; latestSubmittedOn: string; latestRecruiter: string;
      roles: string[]; count: number; _ms: number;
    }
    const byKey = new Map<string, Cand>();
    for (const r of rows) {
      const email = s(r.EmailAddress).toLowerCase();
      const phone = s(r.MobileNumber).replace(/\D/g, "");
      const name = s(r.ApplicantName) || `${s(r.ApplicantFirstName)} ${s(r.ApplicantLastName)}`.trim();
      const key = email || phone || `${name.toLowerCase()}|${s(r.ApplicantID)}`;
      if (!key) continue;
      const role = s(r.JobTitle);
      const ms = parseCeipalMs(r.SubmittedOn);

      let c = byKey.get(key);
      if (!c) {
        c = {
          name, email: s(r.EmailAddress), mobile: s(r.MobileNumber), location: s(r.ApplicantLocation),
          status: s(r.ProfileStatus), latestRole: role, latestClient: s(r.Client),
          latestSubmittedOn: s(r.SubmittedOn), latestRecruiter: s(r.SubmittedBy) || s(r.PrimaryRecruiter),
          roles: [], count: 0, _ms: ms,
        };
        byKey.set(key, c);
      }
      c.count++;
      if (role && !c.roles.includes(role)) c.roles.push(role);
      if (ms >= c._ms) {
        c._ms = ms;
        if (role) c.latestRole = role;
        c.latestClient = s(r.Client) || c.latestClient;
        c.latestSubmittedOn = s(r.SubmittedOn) || c.latestSubmittedOn;
        c.status = s(r.ProfileStatus) || c.status;
        c.latestRecruiter = s(r.SubmittedBy) || c.latestRecruiter;
      }
    }
    const candidates = Array.from(byKey.values())
      .sort((a, b) => b._ms - a._ms)
      .map(({ _ms, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ok: true, candidates, fetchedAt: Date.now() };
  }
);

// Match a pasted JD to the pool's distinct role titles (LLM). Returns the relevant
// titles; the client filters candidates by them. Usage is logged for the metrics.


// ---- GitHub portfolio -------------------------------------------------------

// Search GitHub for likely profiles for a candidate (email first, then name).
// The recruiter confirms the right match in the UI before anything is attached.

// Fetch a GitHub profile's repos/READMEs and assess the portfolio against a JD.

// Auto-fill LinkedIn credibility signals from a commercial data provider, when
// one is configured. Without a provider this reports configured:false and the
// recruiter fills the signals in by hand — the scoring is the same either way.
export const linkedinLookup = onCall(
  { ...commonOpts, secrets: [LINKEDIN_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    void request; // auth on hold (open mode)
    const profileUrl = String(request.data?.profileUrl ?? "").trim();
    if (!/linkedin\.com\/(in|pub)\//i.test(profileUrl)) {
      throw new HttpsError("invalid-argument", "Provide a LinkedIn profile URL.");
    }
    const apiKey = LINKEDIN_API_KEY.value();
    if (!providerConfigured(apiKey)) {
      return {
        ok: true,
        configured: false,
        signals: EMPTY_SIGNALS,
        message:
          "No LinkedIn data provider is configured. LinkedIn has no public API for third-party profiles, so enter the signals from the profile manually.",
      };
    }
    try {
      const signals = await fetchLinkedinSignals(profileUrl, apiKey, Date.now());
      return { ok: true, configured: true, signals };
    } catch (err) {
      return { ok: false, configured: true, error: err instanceof Error ? err.message : String(err) };
    }
  }
);

// Patch profile links / portfolio onto an already-saved resume report (the
// portfolio finishes after the report auto-saves, and links are editable).
export const updateResumeReport = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async (request) => {
    void request; // auth on hold (open mode)
    const id = String(request.data?.id ?? "");
    if (!id) throw new HttpsError("invalid-argument", "id is required.");
    const d = (request.data ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ("githubUrl" in d) patch.githubUrl = String(d.githubUrl ?? "");
    if ("linkedinUrl" in d) patch.linkedinUrl = String(d.linkedinUrl ?? "");
    if (d.portfolio && typeof d.portfolio === "object") patch.portfolio = d.portfolio;
    if (d.githubProfile && typeof d.githubProfile === "object") patch.githubProfile = d.githubProfile;
    if (d.linkedinCheck && typeof d.linkedinCheck === "object") patch.linkedinCheck = d.linkedinCheck;
    if (d.missingLinks && typeof d.missingLinks === "object") patch.missingLinks = d.missingLinks;
    if (d.totalLines !== undefined) patch.totalLines = Number(d.totalLines) || null;
    if (!Object.keys(patch).length) return { ok: true };
    patch.updatedAt = FieldValue.serverTimestamp();
    await getFirestore().collection("resumeReports").doc(id).set(patch, { merge: true });
    return { ok: true };
  }
);


// ---- AI / enrichment: one function, many actions ----------------------------
// These all do the same shape of work — take JSON, call an LLM or the GitHub
// API, return JSON — and each `onCall` is a separate Cloud Run service with its
// own reserved CPU. The project kept hitting the region's allowable-CPU quota,
// so they share one service and branch on `action`. Settings are the widest of
// the group (the portfolio fetch is the long pole).
type AiAction =
  | "parseResume"
  | "matchCandidatesToJd"
  | "githubPortfolio"
  | "githubSearch"
  | "llmAvailability"
  | "askPlan"
  | "askNarrative"
  | "askSave"
  | "askList"
  | "askDelete"
  | "askDebugWrite"
  | "askDebugList"
  | "askDebugClear";

export const ai = onCall(
  {
    ...commonOpts,
    secrets: [GITHUB_TOKEN, LLM_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request) => {
    const action = String(request.data?.action ?? "") as AiAction;
    switch (action) {
      case "parseResume": {
        // AUTH ON HOLD: the app runs in open mode, so callers aren't signed in.
        // Re-enable requireAuth(request.auth) once authentication is turned back on.
        void request; // (auth intentionally not enforced yet)
        const resumeText: string = request.data?.resumeText ?? "";
        const jobDescription: string = request.data?.jobDescription ?? "";
        const provider: ProviderId = request.data?.provider === "openai" ? "openai" : "ollama";
        const model: string = request.data?.model ?? "";
        if (resumeText.trim().length < 30 || jobDescription.trim().length < 20) {
          throw new HttpsError("invalid-argument", "Provide both resume text and a job description.");
        }
        const config = resolveLlm(provider, model); // throws failed-precondition if not configured
        try {
          const { assessment, usage } = await assessResume(resumeText, jobDescription, config);
          // Duplicate check by email/phone — flag before saving; the client decides.
          const emailNorm = normEmail(assessment.extracted?.email);
          const phoneNorm = normPhone(assessment.extracted?.phone);
          const duplicate = await findDuplicate(emailNorm, phoneNorm);
          return { ok: true, assessment, usage, provider, model: config.model, duplicate };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: msg };
        }
      }
      case "matchCandidatesToJd": {
        void request;
        const jd = String(request.data?.jobDescription ?? "");
        const roles = Array.isArray(request.data?.roles)
          ? (request.data.roles as unknown[]).map((r) => String(r)).filter((r) => r.trim())
          : [];
        if (jd.trim().length < 15) throw new HttpsError("invalid-argument", "Provide a job description.");
        if (!roles.length) return { ok: true, relevant: [] as string[] };
        const config = pickLlm();
        try {
          const { relevant, usage } = await matchRolesToJd(jd, roles, config);
          await logLlmCall("Candidate matching", config.provider, config.model, usage);
          return { ok: true, relevant, usage };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case "githubPortfolio": {
        void request; // auth on hold (open mode)
        const github = String(request.data?.github ?? "");
        const jobDescription = String(request.data?.jobDescription ?? "");
        const provider: ProviderId = request.data?.provider === "openai" ? "openai" : "ollama";
        const model: string = request.data?.model ?? "";
        const username = parseGithubUsername(github);
        if (!username) throw new HttpsError("invalid-argument", "Provide a GitHub profile URL or username.");
        if (jobDescription.trim().length < 20) throw new HttpsError("invalid-argument", "Provide the job description.");
        const config = resolveLlm(provider, model); // throws failed-precondition if not configured
        try {
          const data = await buildPortfolio(username, GITHUB_TOKEN.value());
          const { portfolio, usage } = await assessPortfolio(data.summaryText, jobDescription, config);
          await logLlmCall("Portfolio assessment", provider, config.model, usage);
          return { ok: true, profile: data.profile, portfolio, usage };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case "githubSearch": {
        void request; // auth on hold (open mode)
        const name = String(request.data?.name ?? "").trim();
        const email = String(request.data?.email ?? "").trim();
        if (!name && !email) {
          throw new HttpsError("invalid-argument", "Provide a candidate name or email to search GitHub.");
        }
        try {
          const matches = await searchUsers(name, email, GITHUB_TOKEN.value());
          return { ok: true, matches };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case "llmAvailability": {
        return {
          ok: true,
          providers: {
            ollama: keyConfigured(LLM_API_KEY.value()),
            openai: keyConfigured(OPENAI_API_KEY.value()),
          },
        };
      }

      // ---- Ask Anything (management query assistant) -----------------------
      // Gated to admin/manager — see requireProfile/requireRole above. The LLM
      // only ever returns a query plan or phrases an already-computed summary;
      // it never sees a data row. See askEngine.ts and llm.ts for why.
      case "askPlan": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        const question = String(request.data?.question ?? "").trim();
        if (!question) throw new HttpsError("invalid-argument", "Ask a question.");
        const priorPlan = request.data?.priorPlan ?? null;
        const today = String(request.data?.today ?? new Date().toISOString().slice(0, 10));
        const config = pickLlm();
        try {
          const { plan, usage } = await planAskQuery(question, priorPlan, today, config);
          await logLlmCall("Ask Anything — plan", config.provider, config.model, usage);
          return { ok: true, plan, usage };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case "askNarrative": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        const facts = (request.data?.facts ?? {}) as Record<string, unknown>;
        const lang = String(request.data?.lang ?? "en");
        const config = pickLlm();
        try {
          const { text, usage } = await narrateAskResult(facts, lang, config);
          await logLlmCall("Ask Anything — narrative", config.provider, config.model, usage);
          return { ok: true, text, usage };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case "askSave": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        const name = String(request.data?.name ?? "").trim().slice(0, 140);
        const question = String(request.data?.question ?? "").trim().slice(0, 500);
        const plan = request.data?.plan;
        if (!name || !plan) throw new HttpsError("invalid-argument", "name and plan are required.");
        // Who sees this is decided here, from the caller's own role — never
        // from anything the client sent. An admin saves for the team; a
        // manager's saved question is their own, because it can be about one
        // recruiter and that isn't everyone's business.
        const doc = await getFirestore().collection("askQueries").add({
          name,
          question,
          plan,
          shared: profile.role === "admin",
          createdByUid: profile.uid,
          createdByName: profile.displayName || profile.email,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, id: doc.id, shared: profile.role === "admin" };
      }
      case "askList": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        // Everything an admin shared, plus your own. Two reads merged in memory
        // rather than one `or` query: no composite index to deploy, and at a
        // couple of hundred saved questions the difference is noise.
        const col = getFirestore().collection("askQueries");
        const [sharedSnap, mineSnap] = await Promise.all([
          col.where("shared", "==", true).limit(200).get(),
          col.where("createdByUid", "==", profile.uid).limit(200).get(),
        ]);
        const byId = new Map<string, Record<string, unknown>>();
        for (const d of [...sharedSnap.docs, ...mineSnap.docs]) {
          const x = d.data() as Record<string, unknown>;
          const createdAt = x.createdAt as { toMillis?: () => number } | undefined;
          byId.set(d.id, { ...x, id: d.id, createdAt: createdAt?.toMillis?.() ?? null });
        }
        const queries = Array.from(byId.values()).sort(
          (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)
        );
        return { ok: true, queries: queries.slice(0, 200) };
      }
      case "askDelete": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        const id = String(request.data?.id ?? "");
        if (!id) return { ok: true };
        const ref = getFirestore().collection("askQueries").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return { ok: true };
        // Your own, always. Anyone else's — including the shared library — only
        // if you're an admin, so a manager can't delete what the team relies on.
        const owner = String(snap.data()?.createdByUid ?? "");
        if (owner !== profile.uid && profile.role !== "admin") {
          throw new HttpsError("permission-denied", "You can only delete the queries you saved.");
        }
        await ref.delete();
        return { ok: true };
      }

      // A per-query record of what the AI actually planned and how many rows it
      // matched -- shared across admins/managers (not per-browser) so a "why did
      // this come back empty" report from anyone can be diagnosed by anyone,
      // without needing to reproduce it live in that person's own browser.
      case "askDebugWrite": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        const question = String(request.data?.question ?? "").trim().slice(0, 500);
        if (!question) return { ok: true };
        const clamp = (v: unknown, max = 4000): unknown => {
          if (v === undefined || v === null) return null;
          const s = JSON.stringify(v);
          return s && s.length > max ? { truncated: true, preview: s.slice(0, max) } : v;
        };
        await getFirestore().collection("askDebugLog").add({
          question,
          source: String(request.data?.source ?? ""),
          table: request.data?.table ? String(request.data.table).slice(0, 60) : null,
          rawPlan: clamp(request.data?.rawPlan),
          plan: clamp(request.data?.plan),
          rowsLoaded: Number.isFinite(request.data?.rowsLoaded) ? Number(request.data.rowsLoaded) : null,
          groups: Number.isFinite(request.data?.groups) ? Number(request.data.groups) : null,
          rowsMatched: Number.isFinite(request.data?.rowsMatched) ? Number(request.data.rowsMatched) : null,
          error: request.data?.error ? String(request.data.error).slice(0, 500) : null,
          createdByUid: profile.uid,
          createdByName: profile.displayName || profile.email,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { ok: true };
      }
      case "askDebugList": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin", "manager"]);
        const snap = await getFirestore().collection("askDebugLog").orderBy("createdAt", "desc").limit(100).get();
        const entries = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const createdAt = x.createdAt as { toMillis?: () => number } | undefined;
          return { ...x, id: d.id, createdAt: createdAt?.toMillis?.() ?? null };
        });
        return { ok: true, entries };
      }
      case "askDebugClear": {
        const profile = await requireProfile(request.auth);
        requireRole(profile, ["admin"]);
        const snap = await getFirestore().collection("askDebugLog").limit(500).get();
        const batch = getFirestore().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        return { ok: true, cleared: snap.size };
      }

      default:
        throw new HttpsError("invalid-argument", `Unknown action "${action}".`);
    }
  }
);

// Who generated this record. Prefer the verified auth token (trustworthy);
// fall back to the client-supplied `by` for the brief window after signup
// before the token's `name`/`email` claims propagate.
function actorOf(
  auth: { token?: { name?: unknown; email?: unknown } } | undefined,
  by?: { name?: unknown; email?: unknown }
): { createdByName: string; createdByEmail: string } {
  const email = String(auth?.token?.email || by?.email || "");
  const name = String(auth?.token?.name || by?.name || email || "");
  return { createdByName: name, createdByEmail: email };
}

// Save an already-computed assessment to the reports history.
export const saveResumeReport = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async (request) => {
    void request; // auth on hold (open mode)
    const assessment = request.data?.assessment;
    const provider: string = request.data?.provider ?? "";
    const model: string = request.data?.model ?? "";
    const jobDescription: string = request.data?.jobDescription ?? "";
    const usage = request.data?.usage as
      | { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number; priced?: boolean }
      | undefined;
    if (!assessment || typeof assessment !== "object") {
      throw new HttpsError("invalid-argument", "assessment is required.");
    }
    const emailNorm = normEmail((assessment as { extracted?: { email?: string } }).extracted?.email);
    const phoneNorm = normPhone((assessment as { extracted?: { phone?: string } }).extracted?.phone);
    const doc = await getFirestore().collection("resumeReports").add({
      ...assessment,
      provider,
      model,
      jobDescriptionPreview: jobDescription.slice(0, 600),
      emailNorm,
      phoneNorm,
      githubUrl: String(request.data?.githubUrl ?? ""),
      linkedinUrl: String(request.data?.linkedinUrl ?? ""),
      portfolio: request.data?.portfolio && typeof request.data.portfolio === "object" ? request.data.portfolio : null,
      githubProfile:
        request.data?.githubProfile && typeof request.data.githubProfile === "object" ? request.data.githubProfile : null,
      linkedinCheck:
        request.data?.linkedinCheck && typeof request.data.linkedinCheck === "object" ? request.data.linkedinCheck : null,
      missingLinks:
        request.data?.missingLinks && typeof request.data.missingLinks === "object" ? request.data.missingLinks : null,
      totalLines: Number(request.data?.totalLines) || null,
      promptTokens: Number(usage?.promptTokens) || 0,
      completionTokens: Number(usage?.completionTokens) || 0,
      totalTokens: Number(usage?.totalTokens) || 0,
      cost: Number(usage?.cost) || 0,
      ...actorOf(request.auth, request.data?.by),
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, reportId: doc.id };
  }
);

// List saved resume assessments (most recent first) for the Resume Reports tab.
export const listResumeReports = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async (request) => {
    void request; // auth on hold (open mode)
    const limit = Math.min(Number(request.data?.limit) || 200, 500);
    const snap = await getFirestore()
      .collection("resumeReports")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    const reports = snap.docs.map((d) => {
      const x = d.data() as Record<string, unknown>;
      const createdAt = x.createdAt as { toMillis?: () => number } | undefined;
      return { id: d.id, ...x, createdAt: createdAt?.toMillis?.() ?? null };
    });
    return { ok: true, reports };
  }
);

// Which LLM providers are configured (have a real API key). The UI uses this to
// enable/disable providers in the model picker. Never returns key values.

// Cumulative LLM token usage & cost across all saved resume assessments, with an
// optional monthly budget (LLM_BUDGET_USD env) to show the remaining balance.
// Note: LLM providers don't expose live credit balance via a simple API, so the
// "balance" here is budget − spent, not the provider's actual account credit.
export const llmUsageSummary = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async () => {
    const db = getFirestore();
    const [rr, lc] = await Promise.all([
      db.collection("resumeReports").select("totalTokens", "cost", "model", "provider").get(),
      db.collection("llmCalls").select("totalTokens", "cost", "model", "provider", "feature").get(),
    ]);

    let totalTokens = 0;
    let totalCost = 0;
    const models = new Map<string, { model: string; provider: string; count: number; totalTokens: number; totalCost: number }>();
    const features = new Map<string, { feature: string; count: number; totalTokens: number; totalCost: number }>();
    const add = (feature: string, provider: string, model: string, tok: number, cost: number) => {
      totalTokens += tok;
      totalCost += cost;
      const mk = `${provider}/${model}`;
      let m = models.get(mk);
      if (!m) { m = { model, provider, count: 0, totalTokens: 0, totalCost: 0 }; models.set(mk, m); }
      m.count++; m.totalTokens += tok; m.totalCost += cost;
      let f = features.get(feature);
      if (!f) { f = { feature, count: 0, totalTokens: 0, totalCost: 0 }; features.set(feature, f); }
      f.count++; f.totalTokens += tok; f.totalCost += cost;
    };

    rr.docs.forEach((d) => {
      const x = d.data() as { totalTokens?: number; cost?: number; model?: string; provider?: string };
      add("Resume assessment", String(x.provider || ""), String(x.model || "unknown"), Number(x.totalTokens) || 0, Number(x.cost) || 0);
    });
    lc.docs.forEach((d) => {
      const x = d.data() as { totalTokens?: number; cost?: number; model?: string; provider?: string; feature?: string };
      add(String(x.feature || "Other"), String(x.provider || ""), String(x.model || "unknown"), Number(x.totalTokens) || 0, Number(x.cost) || 0);
    });

    const budget = Number(process.env.LLM_BUDGET_USD) || 0;
    return {
      ok: true,
      count: rr.size + lc.size,
      totalTokens,
      totalCost,
      byModel: Array.from(models.values()).sort((a, b) => b.count - a.count),
      byFeature: Array.from(features.values()).sort((a, b) => b.count - a.count),
      budget,
      balance: budget > 0 ? Math.max(0, budget - totalCost) : null,
    };
  }
);

// Record a report-generation run (for dashboard stats).
export const logReportRun = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    void request; // auth on hold (open mode)
    await getFirestore().collection("reportRuns").add({
      source: String(request.data?.source ?? ""),
      rowCount: Number(request.data?.rowCount) || 0,
      jobCount: Number(request.data?.jobCount) || 0,
      ...actorOf(request.auth, request.data?.by),
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }
);

// Aggregate counts for the dashboard.
export const dashboardStats = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async (request) => {
    void request; // auth on hold (open mode)
    const db = getFirestore();
    const [resumesCount, reportsCount] = await Promise.all([
      db.collection("resumeReports").count().get(),
      db.collection("reportRuns").count().get(),
    ]);
    // Read a bounded set for the breakdowns.
    const docs = await db
      .collection("resumeReports")
      .select("rating", "aiGeneratedLikelihood", "emailNorm", "fitScore")
      .limit(3000)
      .get();
    let strong = 0, moderate = 0, weak = 0, aiHigh = 0, scoreSum = 0, scoreCount = 0;
    const emails = new Set<string>();
    docs.forEach((d) => {
      const x = d.data() as { rating?: string; aiGeneratedLikelihood?: string; emailNorm?: string; fitScore?: number };
      if (x.rating === "Strong") strong++;
      else if (x.rating === "Weak") weak++;
      else moderate++;
      if (x.aiGeneratedLikelihood === "High") aiHigh++;
      if (typeof x.fitScore === "number") { scoreSum += x.fitScore; scoreCount++; }
      if (x.emailNorm) emails.add(x.emailNorm);
    });
    return {
      ok: true,
      stats: {
        resumesGenerated: resumesCount.data().count,
        reportsGenerated: reportsCount.data().count,
        distinctCandidates: emails.size,
        strongFit: strong,
        moderateFit: moderate,
        weakFit: weak,
        aiHigh,
        avgFitScore: scoreCount ? Math.round(scoreSum / scoreCount) : 0,
      },
    };
  }
);

// ---- Saved report configurations -------------------------------------------
export const saveReportConfig = onCall(
  { ...commonOpts, timeoutSeconds: 20 },
  async (request) => {
    void request; // auth on hold (open mode)
    const name = String(request.data?.name ?? "").trim();
    const config = request.data?.config;
    if (!name) throw new HttpsError("invalid-argument", "A name is required.");
    if (!config || typeof config !== "object") throw new HttpsError("invalid-argument", "config is required.");
    const doc = await getFirestore().collection("reportConfigs").add({
      name,
      config,
      ...actorOf(request.auth, request.data?.by),
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, id: doc.id };
  }
);

export const listReportConfigs = onCall(
  { ...commonOpts, timeoutSeconds: 20 },
  async (request) => {
    void request;
    const snap = await getFirestore()
      .collection("reportConfigs")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const configs = snap.docs.map((d) => {
      const x = d.data() as {
        name?: string;
        config?: unknown;
        createdAt?: { toMillis?: () => number };
        createdByName?: string;
        createdByEmail?: string;
      };
      return {
        id: d.id,
        name: x.name ?? "",
        config: x.config ?? {},
        createdAt: x.createdAt?.toMillis?.() ?? null,
        createdByName: x.createdByName ?? "",
        createdByEmail: x.createdByEmail ?? "",
      };
    });
    return { ok: true, configs };
  }
);

export const deleteReportConfig = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    void request;
    const id = String(request.data?.id ?? "");
    if (id) await getFirestore().collection("reportConfigs").doc(id).delete();
    return { ok: true };
  }
);

// ---- Timesheets, leave requests, and role management -----------------------

// Called once per sign-in (from AuthContext) to fetch-or-create the caller's
// role profile. Identity comes from the verified token, never the client.
export const ensureUserProfile = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    requireAuth(request.auth);
    const uid = request.auth!.uid!;
    const email = String(request.auth!.token.email ?? "");
    const displayName = String(request.auth!.token.name ?? email);
    const profile = await getOrCreateProfile(uid, email, displayName);
    return { ok: true, profile };
  }
);

export const setUserRole = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    const profile = await requireProfile(request.auth);
    requireRole(profile, ["admin"]);
    const targetUid = String(request.data?.uid ?? "");
    const role = request.data?.role;
    if (!targetUid) throw new HttpsError("invalid-argument", "uid is required.");
    if (role !== "admin" && role !== "manager" && role !== "employee") {
      throw new HttpsError("invalid-argument", "role must be admin, manager, or employee.");
    }
    try {
      const updated = await setRole(targetUid, role as Role);
      return { ok: true, user: updated };
    } catch (e) {
      throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e));
    }
  }
);

export const saveTimesheetEntry = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    const profile = await requireProfile(request.auth);
    const date = String(request.data?.date ?? "");
    const hours = Number(request.data?.hours);
    const workedOn = String(request.data?.workedOn ?? "");
    try {
      const entry = await saveEntry(profile, date, hours, workedOn, request.data?.jobs);
      return { ok: true, entry };
    } catch (e) {
      throw new HttpsError("invalid-argument", e instanceof Error ? e.message : String(e));
    }
  }
);

export const requestLeave = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    const profile = await requireProfile(request.auth);
    const leaveType = request.data?.leaveType;
    const startDate = String(request.data?.startDate ?? "");
    const endDate = String(request.data?.endDate ?? "");
    const reason = String(request.data?.reason ?? "");
    try {
      const leave = await createLeaveRequest(profile, leaveType, startDate, endDate, reason);
      return { ok: true, leave };
    } catch (e) {
      throw new HttpsError("invalid-argument", e instanceof Error ? e.message : String(e));
    }
  }
);

export const decideLeaveRequest = onCall(
  { ...commonOpts, timeoutSeconds: 15 },
  async (request) => {
    const profile = await requireProfile(request.auth);
    requireRole(profile, ["admin", "manager"]);
    const id = String(request.data?.id ?? "");
    const decision = request.data?.decision;
    const note = String(request.data?.note ?? "");
    if (decision !== "approved" && decision !== "rejected") {
      throw new HttpsError("invalid-argument", "decision must be 'approved' or 'rejected'.");
    }
    try {
      const leave = await decideLeave(profile, id, decision, note);
      return { ok: true, leave };
    } catch (e) {
      throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e));
    }
  }
);
