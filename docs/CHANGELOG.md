# Changelog

Chronological record of notable changes. Newest first.

## Report preview: "in our field" (amber) highlight
- New **amber** row highlight in the Report Generation preview + Excel for requirements that have
  submissions but **not a single profile has reached the client/vendor side** (still entirely in our
  internal pipeline: waiting / internal interview / selected/rejected internally / submitted-to-AM).
  Distinct from the existing **red** (0-submission overdue). Helps management spot reqs where we have
  profiles but haven't submitted any to the client/vendor.
- `isClientVendorStatus` (columns.ts) recognises the full client/vendor status set (submitted to
  client/vendor/end-client/VMS, client/vendor interview, selected/rejected/hold/disqualified by
  client/vendor/end-client, rejected-after-client-selection, BGV). Transform sets `ReportRow.internalOnly`
  + `ReportResult.internalOnlyCount` (shown as an "In our field (amber)" stat). 2 new tests.

## Active jobs snapshot on Recruiter Performance
- New **"Active jobs today"** card at the top of the Recruiter Performance page — a live snapshot
  of currently-open jobs from the Ceipal **"Active Jobs - All"** report (Req ID, title, client,
  location, positions, submissions, interviews, posted date).
- New `activeJobs` callable (report key/URL added to `ceipal.ts` + `functions/.env`); client
  `lib/activeJobs.ts` + `components/ActiveJobsCard.tsx`, fetched via React Query (cached, refresh
  button). Verified live: 9 active jobs.

## React Query, pagination, row numbers, per-model LLM usage
- **React Query** (`@tanstack/react-query`) with `staleTime` 5 min + `refetchOnWindowFocus:false`
  wraps the app (`main.tsx`); Firestore reads (resume reports, dashboard stats, LLM usage, report
  configs, LLM availability) go through `useQuery` so switching tabs no longer re-hits the API.
  Saving a resume invalidates the shared `llmUsageSummary` / `resumeReports` / `dashboardStats`
  caches so they refresh.
- **Pagination** — reusable `components/Pagination.tsx` (`usePagination` hook) applied to the Report
  preview (50/page), Resume Reports, Recruiter leaderboard, and Saved Reports (25/page). Report
  download still exports the whole set, not just the page.
- **Row numbers (S.No)** column on those tables (continuous across pages).
- **Per-model LLM usage** — `llmUsageSummary` now returns a `byModel` breakdown; a shared
  `components/LlmUsagePanel.tsx` shows "N resumes · model · tokens · est. cost" per model plus
  totals, on the **Dashboard** and **Resume Reports** pages.

## AI-detection: judge writing style, not factual specificity
- A real AI-rewritten resume scored **0%** on gpt-4o (it reasoned "specific tool names/schedules ⇒
  human"), while gpt-4o-mini flagged it 75%. Root cause: AI *rewrites* keep genuine specifics while
  polishing the prose. Reworked the prompt to judge **writing style** (uniform polished/templated
  prose, buzzwords, parallel rhythm) and to explicitly NOT treat concrete tools/numbers as a
  human signal. After the fix both gpt-4o and gpt-4o-mini score the same resume **85% (High)**.

## Stronger AI-generated-content detection (Resume Parsing)
- The old prompt capped flagged lines at 5 and returned only Low/Med/High — a fully AI-written
  resume showed "3 lines, Medium". Reworked the LLM prompt to score **every** bullet/sentence 0–100
  and flag **all** AI-reading lines (no cap), plus an overall **percentage** (`aiGeneratedPercent`).
- `aiGeneratedLines` is now `{ text, score }[]`; the UI/PDF/table show the percentage and per-line
  scores (with legacy string-only reports handled via `normalizeAiLines`/`aiPercentOf`).
- Verified: a fully AI-generated resume now returns 100% / High with all 10 bullets flagged (85–90%).

## Weekly recruiter activity in the modal (Ceipal usage reports)
- New **Weekly activity** section in the recruiter modal, scoped to the tab's selected date range.
- **Computed from existing submissions** (client-side): positions worked on, submissions, passed
  screening, failed/rejected screening (rule: Selected-or-later = passed, any Rejected = failed —
  `screeningOf`).
- **From 3 new Ceipal usage reports** (`recruiterActivity` callable): pipeline status updates
  (pipeline_logs), bulk emails (mail_merge), Dice/Monster credits (job_board). These reports are
  large (mail merge ~19k rows) so they are **pulled, counted per recruiter/date, and discarded —
  nothing is stored.** One pull warms all recruiters for the session (held in page memory); a
  "Load Ceipal counts" button triggers it (~25–30s) with a Reload option.
- **Coming soon** (need other integrations): advanced-search/internal-DB, LinkedIn reach-outs,
  phone in/outbound (Ext 108), daily-excel profiles.
- Report keys/URLs added to `ceipal.ts` `ReportKey` + `functions/.env`. Verified live: 18–24 Jun
  returns real per-recruiter counts.

## Ceipal data caching (fixes 504 timeouts / slow loads)
- **Why the 504:** `ceipalReport` did the full Ceipal pull (all pages) inside the request; when
  Ceipal was slow it exceeded the function timeout and Google's frontend returned 504.
- Rows are cached in Firestore (`ceipalCache/{report}` meta + chunked `chunks` sub-docs, 100
  rows/chunk, `ceipalCache.ts`).
- **On-request conditional refresh (no batch job):** each read does one cheap **probe** of Ceipal's
  current `record_count` (`probeTotal`, page 1 only) and compares it to the stored count. Unchanged →
  serve cache (~2s incl. probe, vs 20–45s full pull). Changed / empty / `{ refresh: true }` → full
  pull + re-cache. Probe failure or live-fetch error → serve stale cache so the app never breaks.
- UI: "Refresh from Ceipal" button on Report Generation and Recruiter Performance forces a fresh
  pull; the info line shows "data as of <time> (cached)". Client `fetchCeipalReport(report, { refresh })`.
- Limitation: `record_count` catches added/removed rows, not in-place status edits on existing rows —
  use "Refresh from Ceipal" to force-refresh those.

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
