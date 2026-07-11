# Features

## 1. Resume Parsing (`/resume`)
- Paste resume text or upload **.txt / .docx** (PDF/.doc rejected). JD pasted alongside.
- LLM (Ollama or OpenAI) returns: **fit score**, rating (Strong/Medium/Weak), short review,
  skill match, and an **AI-generated-content signal** with the specific flagged lines.
- **Provider + model picker** — providers without a configured API key are greyed out
  (`llmAvailability` callable reports which are configured).
- **Duplicate detection** — before saving, the email/phone is checked against existing reports;
  if a match exists you're asked: View existing / Save as new / Don't save.
- Details render in a shared modal; AI-generated lines are highlighted.

## 2. Resume Reports (`/resume-reports`)
- Table of every saved assessment (date, candidate, fit, rating, AI-generated, model).
- Row click → detail modal. Per-row **Download PDF** (client-side, jspdf).

## 3. Report Generation (`/reports`)
See [REPORT-GENERATION.md](REPORT-GENERATION.md) for the full pipeline. Highlights:
- Pull **all** records live from the two Ceipal report APIs, or upload the `.xlsx` exports.
- Flat submissions report with status pivot, inter-status durations, stage counts,
  time-to-submit, job age, NA rows, and the red overdue rule.
- **Multi-select filters** (Client / Job Status / Job Title / Recruitment Manager / Recruiter),
  global search, and Submitted-on / Job-created date ranges.
- **Column picker** with role presets (Management overview / Manager detail / Recruiter pipeline
  / Everything) + per-column descriptions — drives both the preview and the Excel export.
- **Submission-time pie charts** (buckets <4h … 48h+) for the 1st/2nd/3rd submission, per job.
- **Save current** configuration (filters + columns) and reload it later.
- Formatted **.xlsx** download with a "Report Info" sheet recording scope, filters, and columns.

## 4. Saved Reports (`/saved-reports`)
- Dedicated tab listing saved report configurations (name, saved date, source, filter summary).
- **Open** loads the config on the Report Generation tab (`/reports?config=<id>`); **Delete** removes it.

## 5. Recruiter Performance (`/recruiters`)
Management view built from the live submissions data. **Each profile is counted once, by its
latest status** (the current/final state of its flow).

**Status model** — statuses are taken **verbatim from Ceipal**; each distinct status keeps its own
name (there is **no catch-all "Other" bucket**). The status list is built dynamically from the data.
An internal funnel classification (`funnelOf` in `lib/recruiterStats.ts`) is used only to colour and
order the statuses and to score the index — it never replaces a real status name. "Submitted" (to
the account manager) and "Client/Vendor Submission" (AM forwarded to client/vendor) are recognised
as distinct stages.

- **Submitted-on date range** — From/To filter that scopes every stat to profiles submitted in
  that period (a profile's event rows all share one SubmittedOn, so it filters cleanly per profile).
- **Leaderboard** — rank, recruiter, requirements, profiles, a current-status bar, client/vendor
  count + rate, and the Performance Index. Row click (or the recruiter dropdown) opens a **detail
  modal** — the leaderboard stays behind it.
- **Recruiter detail modal** (large) — headline stats, a **pie chart** of profiles by current
  status with a share table, and **submissions grouped by requirement**: each row shows Req ID,
  requirement, client, job-posted time, **first-submission time**, **time to first submission**, and
  this recruiter's submission count; clicking a row expands it to the candidates under that job
  (consultant, current status, submitted-on).
- **Assigned-but-no-submission requirements** — using the job-posting **"Assigned To"** column,
  requirements assigned to a recruiter with zero submissions appear as rows labelled **"No
  submissions"** (parsed from the job-duration report; `assignedTo` alias in `columns.ts`).
- **Performance Index (0–100)** — composite of client/vendor-submission rate, interview+ rate,
  volume, and requirement coverage; weights shown in an in-page explainer. Rank by index / client
  rate / interview+ rate / profiles / requirements. Top 3 get 🥇🥈🥉 (medal = true index standing).
- Logic in `lib/recruiterStats.ts` (pure, unit-tested); pipeline bar in `components/StageBar.tsx`.
  Reuses the Ceipal submissions report, aggregated client-side.

## 6. Dashboard (`/`)
- Live stat cards: resumes assessed, reports generated, distinct candidates, strong-fit count,
  average fit score, AI-High count, plus a fit-rating breakdown (`dashboardStats` callable).

## 7. Layout
- Collapsible sidebar (☰), state persisted in `localStorage.sidebarCollapsed`.
- Content is full-width when the sidebar is collapsed.

## Auth status
Authentication is currently **ON HOLD** — the app is open (`ProtectedRoute` is pass-through).
Login/Signup pages and the OTP flow exist and are wired for when auth is re-enabled
(registration is locked to `@cliff-services.com`).
