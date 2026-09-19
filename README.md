# Cliff Services — Portal

[![CI](https://github.com/AbhiGattineni/Cliff-Recruiter-Suite/actions/workflows/ci.yml/badge.svg)](https://github.com/AbhiGattineni/Cliff-Recruiter-Suite/actions/workflows/ci.yml)

Live at **https://portal.cliffservices.com** — the signed-in half of
[www.cliffservices.com](https://www.cliffservices.com), which is a separate repo on separate
hosting. One address serves everyone; the **role on the account** decides what is behind it:

| Role | Sees |
|------|------|
| `admin` / `manager` / `employee` | The recruiter suite (below), by role |
| `consultant` | `/portal` only — their own timesheet, filed against their assignment |

That split is enforced in `firestore.rules`, not just in the UI. See **[docs/PORTAL.md](docs/PORTAL.md)**
for why it is one hostname rather than `recruiters.` and `consultants.`, who gets an account and
how, and the four manual DNS/auth steps the custom domain needs.

Internal web app for **Cliff Services Inc.** with two tools:

1. **Resume Parsing** — paste a resume + a job description, get a fit score, rating, short
   review, skill match, and an AI-generated-content signal (LLM-backed).
2. **Report Generation** — build the flat Ceipal submissions report. Pull live from the two
   Ceipal report APIs, or upload the exports. Preview on screen, then download a formatted
   `.xlsx`.

**Stack:** React + Vite + TypeScript (frontend), Firebase Auth + Cloud Functions (backend).
Secrets (Ceipal password, LLM token) live only in Cloud Functions — never in the browser.

---

## Architecture at a glance

```
Browser (React)
   │  Firebase Auth (email/password)
   │  httpsCallable ─────────────► Cloud Functions (secrets held here)
   │                                   ├─ ceipalReport → Ceipal Custom Reports API
   │                                   └─ parseResume  → LLM (Ollama, OpenAI-compatible API)
   │
   └─ Report transform + Excel build run in the browser (ExcelJS), from either
      the API JSON or an uploaded .xlsx.
```

Why Cloud Functions: Ceipal and the LLM require secret credentials and Ceipal blocks direct
browser calls (CORS). The functions are a thin, secure proxy.

---

## Prerequisites

- Node.js 20+
- A Firebase project on the **Blaze (pay-as-you-go)** plan (required for Cloud Functions with
  outbound network). It has a generous free tier.
- Firebase CLI: `npm install -g firebase-tools`

---

## 1. Frontend setup

```bash
npm install
cp .env.example .env      # then fill in your Firebase web config
npm run dev               # http://localhost:5173
```

Get the Firebase web config from **Firebase console → Project settings → Your apps → Web app**.
Paste the values into `.env`. (These identify the project and are safe in the browser.)

## 2. Cloud Functions setup

```bash
cd functions
npm install
cp .env.example .env      # non-secret config for the local emulator
```

Set the real **secrets** (for deployed functions):

```bash
firebase functions:secrets:set CEIPAL_PASSWORD     # your Ceipal login password
firebase functions:secrets:set LLM_API_KEY         # your Ollama Cloud API key
```

Non-secret config (Ceipal email, apiKey, report URLs, model) is read from environment. For
deployment you can set these in `functions/.env` or via your CI. Defaults for the two report
endpoints and the Ceipal email are already filled from the API documentation.

## 3. User accounts — self-service signup with OTP

Users register themselves from the **Create an account** link on the login screen:

1. They enter name, a `@cliff-services.com` email, and a password.
2. A **6-digit OTP** is emailed to them (valid 10 minutes).
3. They enter the code; the account is then enabled and they are signed in.

Registration is **locked to the `@cliff-services.com` domain** — enforced in the browser for
UX and, authoritatively, in the `requestSignupOtp` Cloud Function (so it cannot be bypassed).
Accounts are created **disabled** and are only enabled once the OTP is verified.

To send OTP emails you must configure SMTP (step 2 above): set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_FROM` in `functions/.env` and the `SMTP_PASS` secret. Works with Google
Workspace SMTP, SendGrid, Mailgun, etc.

> **Local testing without SMTP:** set `OTP_DEV_MODE=true` in `functions/.env`. The code is then
> returned in the API response (and shown on screen) instead of emailed. Never enable in production.

You can still pre-create or disable accounts manually in **Firebase console → Authentication → Users**.

To change the allowed domain, set `ALLOWED_EMAIL_DOMAIN` in `functions/.env` and `ALLOWED_DOMAIN`
in `src/lib/auth.ts`.

## 4. Run locally with emulators (optional)

```bash
# set VITE_USE_EMULATORS=true in .env, then:
firebase emulators:start
npm run dev
```

## 5. Deploy

```bash
npm run build                       # builds the frontend into dist/
firebase deploy                     # hosting + functions + rules
# or selectively:
firebase deploy --only functions
firebase deploy --only hosting
```

---

## Where the placeholders are

Everything you must fill in is marked `PLACEHOLDER_...`:

| What | Where |
|------|-------|
| Firebase web config | `.env` (copy from `.env.example`) |
| Firebase project id | `.firebaserc` |
| Ceipal email / apiKey / URLs | `functions/.env` (defaults pre-filled from the docs) |
| Ceipal password | secret `CEIPAL_PASSWORD` |
| LLM (Ollama) API key | secret `LLM_API_KEY` |
| LLM base URL / model | `functions/.env` → `LLM_BASE_URL` (default `https://ollama.com/v1`), `LLM_MODEL` (default `gpt-oss:120b`) |
| SMTP host / port / user / from | `functions/.env` (`SMTP_*`) |
| SMTP password | secret `SMTP_PASS` |
| Allowed signup domain | `functions/.env` → `ALLOWED_EMAIL_DOMAIN` (default `cliff-services.com`) |
| Fireflies API key | secret `FIREFLIES_API_KEY` (Meetings tab + daily digest) |
| EmailJS service / template / public / private key | Firestore `appSettings/emailjs`, edited in the portal under **Preferences → Email sending (EmailJS)** |

### What the digest contains

Two halves, and the second does not depend on the first:

1. **The meeting brief** — an LLM summary of every Fireflies transcript recorded
   that day: overview, themes, decisions, action items, risks.
2. **Recruiter activity** — open requirements, submissions made that day and how
   many were on a still-open requirement, and the speed ladder: how many
   requirements got their first profile within 3, 6 and 9 hours of being posted,
   broken down per recruiter.

The activity half reads the same Ceipal `submissions` and `active_jobs` reports
the dashboard uses, through the same Firestore cache, so it costs a cheap
record-count probe rather than a full pull on most runs. A Ceipal outage costs
that section, not the email.

Two counting rules match the rest of the app and are worth knowing before acting
on a number: a profile **rejected internally** is not a submission (it never
reached a client), and only a requirement's **first** profile counts towards the
3/6/9-hour ladder — a profile sent on day four is not a nine-hour response.
Requirements with no posting time in Ceipal are excluded from the percentages
rather than counted as slow, and the mail says how many.

Colour bands (`BAND_GOOD` / `BAND_OK` in `functions/src/recruiterStats.ts`) are
green from 70%, amber from 40%, red below. They are a starting position, not an
agreed service level — change the two constants once the team sets one.

### How the meeting digest sends

Two providers, and the digest uses whichever is configured, preferring EmailJS:

- **EmailJS** — the one to use. Its four values live in Firestore, not in
  `functions/.env` and not in Secret Manager, so an admin sets and rotates them
  from Preferences with no deploy in the loop. That matters here: the GitHub
  Actions deploy never writes a `functions/.env`, so anything put there only
  exists on a developer's laptop. Two things are easy to miss in the EmailJS
  dashboard and both fail silently until a send is attempted — the **private**
  key is required (a Cloud Function is not a browser), and *Account → Security →
  Allow EmailJS API for non-browser applications* must be on. The template needs
  `To Email` = `{{to_email}}`, `Subject` = `{{subject}}`, and `{{{message_html}}}`
  in the body — three braces, or EmailJS escapes the HTML and the mail arrives
  full of visible tags.
- **SMTP** — the fallback, unchanged: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_FROM` in `functions/.env` plus the `SMTP_PASS` secret.

EmailJS bills per request and the digest sends one request per recipient, twice a
day: about 60 a month for one recipient, 120 for two. Check that against the plan
before adding a long recipient list.

---

## Report Generation — how the logic maps to the spec

The transform lives in `src/lib/report/` and implements the full specification:

- `dates.ts` — EST-framed timestamp parsing, `Xd Yh Zm` durations.
- `columns.ts` — tolerant header mapping + submission-status normalisation.
- `readExcel.ts` — SheetJS reader with a **raw-XML fallback** for Ceipal's malformed
  stylesheets (reads `xl/worksheets/sheet1.xml` + `xl/sharedStrings.xml`).
- `parseSource.ts` — Excel rows / API JSON → canonical records.
- `transform.ts` — status pivot, inter-status durations, job-level stage counts, time-taken,
  job age, NA rows, numeric-descending sort by Job Code, and the red overdue rule
  (6 PM EST close, 2 PM cutoff).
- `buildXlsx.ts` — ExcelJS styled workbook (blue header, frozen row 1, peach NA rows, red
  overdue rows), returned as a downloadable file.

The exact 31-column output order is defined once in `src/lib/report/types.ts` (`COLUMNS`).

### Notes / things to verify against real data

- **Ceipal auth request fields** (`email`, `password`, `api_key`) follow Ceipal's documented
  `createAuthtoken`. If your tenant expects different field names, adjust `functions/src/ceipal.ts`.
- **API JSON shape** is normalised by fuzzy key matching in `parseSource.ts`. Once you have a
  real API response, confirm the column keys map correctly (add aliases in `columns.ts` if needed).
- Resume input accepts pasted text, `.txt`, and `.docx` (extracted via `mammoth` in the browser —
  see `src/lib/resumeFile.ts`). PDF and legacy `.doc` are rejected with a clear message; PDF
  support could be added later (e.g. pdf.js).

---

## Project layout

```
.
├─ src/
│  ├─ pages/           Login, Home, ResumeParsing, ReportGeneration
│  ├─ components/       Layout, ProtectedRoute
│  ├─ context/         AuthContext
│  ├─ lib/
│  │  ├─ ceipal.ts, resume.ts        callable wrappers
│  │  └─ report/       the report pipeline (see above)
│  └─ firebase.ts
├─ functions/
│  └─ src/             index.ts, ceipal.ts, llm.ts
├─ firebase.json, firestore.rules, storage.rules, .firebaserc
├─ docs/               feature & change documentation (see below)
└─ .env.example
```

---

## Documentation

Detailed docs live in [`docs/`](docs/):

| Doc | Covers |
|-----|--------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, folder map, data model, secret model |
| [FEATURES.md](docs/FEATURES.md) | Full feature list across all tabs |
| [REPORT-GENERATION.md](docs/REPORT-GENERATION.md) | Report engine, columns, filters, column picker, pie charts, Ceipal specifics |
| [RESUME-PARSING.md](docs/RESUME-PARSING.md) | Resume assessment, providers, duplicate detection, PDF |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Setup, secrets, build, and Firebase deploy commands |
| [CHANGELOG.md](docs/CHANGELOG.md) | Chronological record of notable changes |
| [FUTURE-FEATURES.md](docs/FUTURE-FEATURES.md) | Scoped-but-not-built ideas (e.g. candidate online-profile web-search check) |
| [PORTAL.md](docs/PORTAL.md) | The portal hostname, role-based access, and keeping the look in step with the public site |

## Secrets & git safety

Real credentials are **never** committed. `.env` (frontend) and `functions/.env` (backend
non-secret config) are gitignored; commit only the `.env.example` templates. Actual secrets
(Ceipal password, LLM keys, SMTP password) live in Cloud Functions via
`firebase functions:secrets:set` — see [DEPLOYMENT.md](docs/DEPLOYMENT.md#secrets).
