# Architecture

Cliff Recruiter Suite is a single-page React app backed by Firebase. All third-party secrets
(Ceipal password, LLM API keys, SMTP password) live **only** in Cloud Functions and are never
shipped to the browser.

```
Browser (React + Vite + TS)
  │
  │  Firebase Auth (email/password — currently OPEN/optional)
  │  Firestore (reads: reports, configs)
  │  httpsCallable ──────────────► Cloud Functions (us-central1)  [secrets held here]
  │                                    ├─ parseResume        → LLM (Ollama / OpenAI)
  │                                    ├─ ceipalReport       → Ceipal Custom Reports API
  │                                    ├─ saveResumeReport / listResumeReports
  │                                    ├─ saveReportConfig / listReportConfigs / deleteReportConfig
  │                                    ├─ logReportRun / dashboardStats
  │                                    └─ requestSignupOtp / verifySignupOtp (auth, on hold)
  │
  └─ The report transform + Excel build run in the BROWSER (ExcelJS), from either
     the Ceipal API JSON or an uploaded .xlsx.
```

## Why Cloud Functions
Ceipal and the LLM need secret credentials, and Ceipal blocks direct browser calls (CORS).
The functions are a thin, secure proxy: the browser calls a callable, the function attaches the
secret, calls the upstream API, and returns only the data.

## Folder map (frontend — `src/`)
| Path | Purpose |
|------|---------|
| `pages/` | Route screens: `Home`, `ResumeParsing`, `ResumeReports`, `ReportGeneration`, `SavedReports`, `RecruiterPerformance`, `Login`, `Signup` |
| `components/` | `Layout` (collapsible sidebar), `MultiSelect`, `ColumnPicker`, `PieChart`, `StageBar`, `Modal`, `AssessmentDetail`, `ProtectedRoute` |
| `lib/report/` | The report engine (see [REPORT-GENERATION.md](REPORT-GENERATION.md)) |
| `lib/` | `ceipal.ts`, `reportConfigs.ts`, `recruiterStats.ts`, `resumeReports.ts`, `resumeReportPdf.ts`, `dashboard.ts`, `errors.ts`, `auth.ts`, `resumeFile.ts` |
| `context/` | `AuthContext` |
| `firebase.ts` | Firebase app + Auth/Firestore/Functions init (reads `VITE_*` env) |

## Folder map (backend — `functions/src/`)
| File | Purpose |
|------|---------|
| `index.ts` | All callable definitions; `resolveLlm`, `findDuplicate`, `keyConfigured` helpers; `defineSecret` declarations |
| `llm.ts` | `assessResume(resumeText, jd, config)` — OpenAI-compatible chat completion; returns assessment + `aiGeneratedLines` |
| `ceipal.ts` | `fetchReport(report, password, maxRecords)` — auth + paginated fetch; `checkPayload` surfaces Ceipal error envelopes |

## Data model (Firestore)
| Collection | Written by | Holds |
|------------|-----------|-------|
| `resumeReports` | `parseResume` / `saveResumeReport` | One assessment each (incl. `emailNorm`/`phoneNorm` for dedupe) |
| `reportRuns` | `logReportRun` | One record per report generation (for dashboard stats) |
| `reportConfigs` | `saveReportConfig` | Saved report configurations (filters + visible columns) |
| `signupOtps` | `requestSignupOtp` | Hashed OTPs, 10-min TTL (auth flow, on hold) |

## Secret model
See [DEPLOYMENT.md](DEPLOYMENT.md#secrets). Non-secret config → `functions/.env`. Real secrets →
`firebase functions:secrets:set NAME`. Nothing secret is ever imported into `src/`.
