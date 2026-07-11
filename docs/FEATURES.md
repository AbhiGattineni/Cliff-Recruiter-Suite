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

## 5. Dashboard (`/`)
- Live stat cards: resumes assessed, reports generated, distinct candidates, strong-fit count,
  average fit score, AI-High count, plus a fit-rating breakdown (`dashboardStats` callable).

## 6. Layout
- Collapsible sidebar (☰), state persisted in `localStorage.sidebarCollapsed`.
- Content is full-width when the sidebar is collapsed.

## Auth status
Authentication is currently **ON HOLD** — the app is open (`ProtectedRoute` is pass-through).
Login/Signup pages and the OTP flow exist and are wired for when auth is re-enabled
(registration is locked to `@cliff-services.com`).
