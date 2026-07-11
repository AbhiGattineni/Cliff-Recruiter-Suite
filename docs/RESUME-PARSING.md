# Resume Parsing & Resume Reports

## Flow
1. User pastes resume text or uploads **.txt / .docx** (`lib/resumeFile.ts` — mammoth for .docx;
   PDF/.doc rejected) and pastes the job description.
2. User picks a **provider + model**. `llmAvailability` reports which providers have an API key
   configured; unconfigured providers are greyed out.
3. `parseResume` (Cloud Function) resolves the provider's base URL + key (`resolveLlm`), calls the
   LLM (`llm.ts` → OpenAI-compatible chat completions), and returns a structured assessment.

## Assessment shape
- `fitScore` (0–100), `rating` (Strong / Medium / Weak)
- `review` (short prose), `skillMatch`
- `aiGeneratedLikelihood` (Low / Medium / High) + `aiGeneratedLines` (verbatim resume phrases that
  read as AI-generated — highlighted in the UI and PDF)
- `candidateName`, `email`, `phone`

## Duplicate detection
`parseResume` does **not** auto-save. It normalises email/phone and calls `findDuplicate` against
Firestore (`emailNorm` / `phoneNorm`). If a match exists, the client shows a modal:
**View existing** (opens `/resume-reports?open=<id>`) · **Save as new** · **Don't save**.
Saving is done by the `saveResumeReport` callable (stores the normalised keys).

## Providers
| Provider | Base URL | Key (secret) |
|----------|----------|--------------|
| Ollama (Cloud) | `https://ollama.com/v1` | `LLM_API_KEY` |
| OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |

Both are OpenAI-compatible, so they share the same code path in `llm.ts`.

## Resume Reports tab (`/resume-reports`)
- `listResumeReports` returns all saved assessments, newest first.
- Table → row click opens the detail modal (shared `components/AssessmentDetail.tsx`).
- Per-row **Download PDF** via `lib/resumeReportPdf.ts` (jspdf); AI-flagged lines included.
- `?open=<id>` auto-opens a specific report (used by the duplicate "View existing" action).
