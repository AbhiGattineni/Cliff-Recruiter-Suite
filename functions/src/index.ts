// Cloud Functions entry point.
// Callable functions:
//   - requestSignupOtp({ email, password, displayName }): start domain-locked signup, email an OTP.
//   - verifySignupOtp({ email, otp }): verify OTP, enable the account.
//   - ceipalReport({ report }): proxies a Ceipal custom report (auth required).
//   - parseResume({ resumeText, jobDescription }): LLM fit assessment (auth required).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { fetchReport, probeTotal } from "./ceipal.js";
import { readCache, readCacheMeta, writeCache, cacheEnvelope } from "./ceipalCache.js";
import { assessResume } from "./llm.js";
import {
  isAllowedEmail,
  allowedDomain,
  normalizeEmail,
  generateOtp,
  makeSalt,
  hashOtp,
  hashesEqual,
  sendOtpEmail,
  smtpConfigured,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
} from "./otp.js";

initializeApp();

// Secrets — set with: firebase functions:secrets:set NAME
const CEIPAL_PASSWORD = defineSecret("CEIPAL_PASSWORD");
const LLM_API_KEY = defineSecret("LLM_API_KEY"); // Ollama Cloud key
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY"); // OpenAI key
const SMTP_PASS = defineSecret("SMTP_PASS");

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

// ---- Self-service signup with emailed OTP (domain-locked) ------------------

const OTP_DEV_MODE = () => process.env.OTP_DEV_MODE === "true";

export const requestSignupOtp = onCall(
  { ...commonOpts, secrets: [SMTP_PASS], timeoutSeconds: 60 },
  async (request) => {
    const email = normalizeEmail(request.data?.email ?? "");
    const password: string = request.data?.password ?? "";
    const displayName: string = (request.data?.displayName ?? "").toString().slice(0, 80);

    // Authoritative domain lock — the browser check is only for UX.
    if (!isAllowedEmail(email)) {
      throw new HttpsError(
        "permission-denied",
        `Only @${allowedDomain()} email addresses can register.`
      );
    }
    if (password.length < 6) {
      throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
    }

    const auth = getAuth();
    const db = getFirestore();
    const emailKey = email;

    // Look up any existing account for this email.
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(email);
      if (existing.emailVerified && !existing.disabled) {
        throw new HttpsError("already-exists", "An account already exists. Please sign in instead.");
      }
      // Unverified/disabled account — update the password and keep it disabled until OTP passes.
      await auth.updateUser(existing.uid, { password, displayName: displayName || undefined, disabled: true });
      uid = existing.uid;
    } catch (err: unknown) {
      const code = (err as { code?: string; errorInfo?: { code?: string } })?.code
        ?? (err as { errorInfo?: { code?: string } })?.errorInfo?.code;
      if (err instanceof HttpsError) throw err;
      if (code === "auth/user-not-found") {
        const created = await auth.createUser({
          email,
          password,
          displayName: displayName || undefined,
          emailVerified: false,
          disabled: true, // enabled only after OTP verification
        });
        uid = created.uid;
      } else {
        throw new HttpsError("internal", "Could not start signup. Please try again.");
      }
    }

    // Resend cooldown.
    const ref = db.collection("signupOtps").doc(emailKey);
    const snap = await ref.get();
    if (snap.exists) {
      const createdAt = (snap.data()?.createdAt as number) ?? 0;
      if (Date.now() - createdAt < RESEND_COOLDOWN_MS) {
        throw new HttpsError("resource-exhausted", "Please wait a moment before requesting another code.");
      }
    }

    // Generate + store a hashed OTP.
    const otp = generateOtp();
    const salt = makeSalt();
    await ref.set({
      uid,
      otpHash: hashOtp(otp, salt),
      salt,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });

    // Deliver the code.
    if (smtpConfigured()) {
      try {
        await sendOtpEmail(email, otp, SMTP_PASS.value());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new HttpsError("internal", `Could not send the verification email: ${msg}`);
      }
      return { ok: true };
    }

    // No SMTP configured. In dev mode, return the code so local testing works.
    if (OTP_DEV_MODE()) {
      return { ok: true, devOtp: otp };
    }
    throw new HttpsError("failed-precondition", "Email sending is not configured. Set the SMTP secrets.");
  }
);

export const verifySignupOtp = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async (request) => {
    const email = normalizeEmail(request.data?.email ?? "");
    const otp: string = (request.data?.otp ?? "").toString().trim();
    if (!isAllowedEmail(email) || !/^\d{6}$/.test(otp)) {
      throw new HttpsError("invalid-argument", "Enter the 6-digit code sent to your email.");
    }

    const db = getFirestore();
    const auth = getAuth();
    const ref = db.collection("signupOtps").doc(email);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "No pending verification. Please request a new code.");
    }
    const data = snap.data()!;

    if (Date.now() > (data.expiresAt as number)) {
      await ref.delete();
      throw new HttpsError("deadline-exceeded", "The code has expired. Please request a new one.");
    }
    if ((data.attempts as number) >= MAX_ATTEMPTS) {
      await ref.delete();
      throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Please request a new code.");
    }

    const ok = hashesEqual(data.otpHash as string, hashOtp(otp, data.salt as string));
    if (!ok) {
      await ref.update({ attempts: (data.attempts as number) + 1 });
      throw new HttpsError("invalid-argument", "Incorrect code. Please try again.");
    }

    // Success — enable and verify the account, then clean up.
    await auth.updateUser(data.uid as string, { emailVerified: true, disabled: false });
    await ref.delete();
    return { ok: true };
  }
);

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

export const parseResume = onCall(
  { ...commonOpts, secrets: [LLM_API_KEY, OPENAI_API_KEY], timeoutSeconds: 120 },
  async (request) => {
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
);

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
      promptTokens: Number(usage?.promptTokens) || 0,
      completionTokens: Number(usage?.completionTokens) || 0,
      totalTokens: Number(usage?.totalTokens) || 0,
      cost: Number(usage?.cost) || 0,
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
export const llmAvailability = onCall(
  { ...commonOpts, secrets: [LLM_API_KEY, OPENAI_API_KEY], timeoutSeconds: 15 },
  async () => {
    return {
      ok: true,
      providers: {
        ollama: keyConfigured(LLM_API_KEY.value()),
        openai: keyConfigured(OPENAI_API_KEY.value()),
      },
    };
  }
);

// Cumulative LLM token usage & cost across all saved resume assessments, with an
// optional monthly budget (LLM_BUDGET_USD env) to show the remaining balance.
// Note: LLM providers don't expose live credit balance via a simple API, so the
// "balance" here is budget − spent, not the provider's actual account credit.
export const llmUsageSummary = onCall(
  { ...commonOpts, timeoutSeconds: 30 },
  async () => {
    const snap = await getFirestore().collection("resumeReports").select("totalTokens", "cost").get();
    let totalTokens = 0;
    let totalCost = 0;
    snap.docs.forEach((d) => {
      const x = d.data() as { totalTokens?: number; cost?: number };
      totalTokens += Number(x.totalTokens) || 0;
      totalCost += Number(x.cost) || 0;
    });
    const budget = Number(process.env.LLM_BUDGET_USD) || 0;
    return {
      ok: true,
      count: snap.size,
      totalTokens,
      totalCost,
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
      const x = d.data() as { name?: string; config?: unknown; createdAt?: { toMillis?: () => number } };
      return { id: d.id, name: x.name ?? "", config: x.config ?? {}, createdAt: x.createdAt?.toMillis?.() ?? null };
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
