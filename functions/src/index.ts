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

import { fetchReport } from "./ceipal.js";
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

export const ceipalReport = onCall(
  { ...commonOpts, secrets: [CEIPAL_PASSWORD], timeoutSeconds: 120 },
  async (request) => {
    // AUTH ON HOLD: app runs in open mode. Re-enable requireAuth(request.auth)
    // once authentication is turned back on.
    void request;
    const report = request.data?.report;
    if (report !== "job_duration" && report !== "submissions") {
      throw new HttpsError("invalid-argument", "report must be 'job_duration' or 'submissions'.");
    }
    const password = CEIPAL_PASSWORD.value();
    if (!password || password.startsWith("PLACEHOLDER")) {
      throw new HttpsError(
        "failed-precondition",
        "Ceipal password is not configured. Set the CEIPAL_PASSWORD secret."
      );
    }
    // maxRecords: 0 = fetch everything (paginate all); otherwise cap the fetch.
    const maxRecords = Math.max(0, Math.min(Number(request.data?.maxRecords) || 0, 50000));
    try {
      const data = await fetchReport(report, password, maxRecords);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, data: null, error: msg };
    }
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
      const assessment = await assessResume(resumeText, jobDescription, config);
      // Duplicate check by email/phone — flag before saving; the client decides.
      const emailNorm = normEmail(assessment.extracted?.email);
      const phoneNorm = normPhone(assessment.extracted?.phone);
      const duplicate = await findDuplicate(emailNorm, phoneNorm);
      return { ok: true, assessment, provider, model: config.model, duplicate };
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
