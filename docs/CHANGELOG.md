# Changelog

Chronological record of notable changes. Newest first.

## LLM token/cost tracking + index reweight + modal explainer
- **Resume Parsing token & cost tracking**: `assessResume` now captures the LLM `usage` (prompt /
  completion / total tokens) and estimates cost from a per-model price table (`llm.ts`). The page
  shows per-resume tokens + est. cost, and a cumulative **"LLM usage to date"** banner (total
  tokens, est. cost, and an optional **balance** = `LLM_BUDGET_USD` − spend). New `llmUsageSummary`
  callable; usage is stored on each `resumeReports` doc. (Provider credit balance isn't exposed via
  API — the balance is budget-based.)
- **Performance Index reweighted**: the dominant metric (45%) is now **client/vendor submissions vs
  a target of 2 per assigned requirement** (`TARGET_PER_ASSIGNED`), then client rate (20%),
  interview+ (15%), volume (12%), coverage (8%).
- **Index explainer in the recruiter modal**: a collapsible per-recruiter breakdown table
  (metric · weight · achieved · points → index); the leaderboard shows the same explainer.

## Fix: Ceipal reports timing out ("deadline-exceeded")
- Raised the **client** callable timeout from the 70s SDK default to **300s** (`lib/ceipal.ts`) —
  this was the actual source of the `deadline-exceeded` error.
- Raised the `ceipalReport` **function** timeout 120s → **300s** and memory to **512MiB**.
- **Faster paging**: `functions/src/ceipal.ts` now fetches page 1 to learn the total, then pulls
  the remaining pages in parallel (concurrency 5), with a safe sequential `has_next_page` fallback
  when the reported total looks unreliable. Cuts a ~11-round-trip submissions fetch to ~3 batches.

## Recruiter Performance tab
- New **Recruiter Performance** tab (`/recruiters`, `pages/RecruiterPerformance.tsx`, nav 🏆) for
  management: per-recruiter requirements worked, profiles submitted, and a current-status stage
  bar (`components/StageBar.tsx`).
- **Recruiter dropdown** → focused per-recruiter card with a plain-English status summary,
  headline stats, pipeline bar, and a per-status breakdown table. "All recruiters" shows a
  ranked leaderboard (row click drills in).
- **Final-status model**: each profile is counted once by its latest status. **"Submitted"
  (to account manager) is a distinct state from "Client/Vendor Submission"** (AM forwarded to
  client/vendor) — earlier code wrongly merged them. Seven buckets classified by `classifyStatus`;
  unmapped raw statuses surface in an "Unmapped statuses" note for correction.
- **Performance Index (0–100)** composite (client/vendor rate + interview+ rate + volume +
  coverage) with a transparent in-page weights explainer; rank-by controls; medals for the top 3.
- Aggregation in `lib/recruiterStats.ts` (pure, 6 unit tests) — works off raw `SubmissionEvent`s,
  folding events into one current status per profile (latest by "Status Changed On").

## Report Generation — column control, charts, and Saved Reports
- **Column picker** (`components/ColumnPicker.tsx`, `lib/report/columnMeta.ts`): users choose which
  of the 35 columns appear in the preview and the Excel export. Five labelled groups with a
  per-column description, a "select all in group" toggle, and four role presets
  (**Management overview / Manager detail / Recruiter pipeline / Everything**). Selection is saved
  with the report configuration (`ReportConfigData.visibleCols`) and passed to `buildWorkbook`.
- **Four new report columns** (job-level, after Pay Rate/Salary): **Experience, Mandate Skills,
  Job Description, Comments**. Added to `JobRecord` (types.ts), `JOB_FIELD_ALIASES` (columns.ts),
  `toJobRecord` (parseSource.ts), `jobBase` (transform.ts), and Excel widths (buildXlsx.ts).
  Populate only if the Ceipal job-duration report carries those columns, else `NA`.
- **Always fetch all records** — removed the "Records to fetch" (200/500/…) dropdown, which
  returned an unhelpful random subset. `maxRecords` is now fixed to 0 (fetch everything).
- **Submission-time pie charts** (`components/PieChart.tsx`): 1st/2nd/3rd submission, bucketed
  <4h / 4–8h / 8–16h / 16–24h / 24–48h / 48h+, counted once per job (deduped by Job Code).
- **Preview shows all filtered rows** (removed the earlier 60-row cap).
- **Save / Download buttons** moved into the Filters card header.
- **Saved Reports tab** (`/saved-reports`, `pages/SavedReports.tsx`): dedicated table of saved
  report configurations (name, saved date, source, filter summary) with Open (loads via
  `/reports?config=<id>`) and Delete. The inline saved-configurations card remains on `/reports`.

## Report Generation — filters, multi-select, saved configs
- Filters card: global search + dropdowns (Client / Job Status / Job Title / Recruitment Manager /
  Recruiter) + Submitted-on & Job-created date ranges; applied to preview and export.
- Filters upgraded to **multi-select** (`components/MultiSelect.tsx`; `selFilters` is
  `Record<string,string[]>`).
- **Saved report configurations** — `saveReportConfig` / `listReportConfigs` / `deleteReportConfig`
  callables (Firestore `reportConfigs`), name + timestamp.
- Downloaded Excel gained a **Report Info** sheet (generated time, scope, filters, column count).
- Collapsible sidebar (☰), full-width content when collapsed.
- Ceipal fetch now **paginates** all pages (`&limit=100&page=N`); job-duration report reconfigured
  to 70 columns including Job Code (joins by code, with a title-join fallback).

## Dashboard & Resume Reports
- Dashboard live stat cards + fit breakdown (`dashboardStats`, `logReportRun`); removed the old
  "Getting set up" card.
- **Resume Reports tab** with table + per-row PDF download and a detail modal.
- **Duplicate detection** on resume save (email/phone), with View / Save-as-new / Don't-save.
- **AI-generated lines** flagged distinctly in the UI and PDF.
- **Multi-provider LLM** (Ollama + OpenAI) with a provider/model picker; unconfigured providers
  greyed out.

## Foundation
- React + Vite + TypeScript frontend; Firebase Auth + Cloud Functions backend.
- Resume Parsing (paste / .txt / .docx) and Report Generation (Ceipal API or Excel upload).
- Rebranded to **Cliff Services Inc.**; project isolated in its own folder.
- Self-service signup + OTP flow built (auth currently on hold — app is open).
