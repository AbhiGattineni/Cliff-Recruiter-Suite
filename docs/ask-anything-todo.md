# Ask Anything — handoff notes

Status: **feature complete and wired into the app; not yet deployed, and not
yet tested against real data by a signed-in admin.** Read this whole file
before touching the code — the architecture has a hard rule that's easy to
accidentally violate.

## What the user asked for

A management query tool on the dashboard: ask a plain-English question about
the app's data, get back text + a table + a pie/bar chart automatically.
Prebuilt prompt chips, editable filters/columns/dates, saveable, downloadable.
"A mini google for the application... the go-to place for all the tables in
this app."

## The one rule that must never be broken

**The LLM never sees a data row, and never states a number on its own
authority.** Two-stage pipeline:

1. `askPlan` (LLM) — question in, a small JSON **query plan** out (table,
   filters, groupBy, columns, chart). It picks *what to look at*, nothing
   more. It has no access to the data.
2. `askEngine.runPlan()` (plain TypeScript, zero LLM) — runs that plan
   against real data already loaded in the browser and computes the actual
   table rows, chart data, and totals. This is the only place a number is
   ever produced.
3. `askNarrative` (LLM, optional) — given ONLY the small aggregate JSON
   `runPlan()` already computed (never raw rows), phrases a 1–3 sentence
   summary in English/Telugu/Hindi. It can rephrase a number, it cannot
   invent one, because the numbers it's shown are the only numbers that exist
   in its context.

If a future change lets the LLM answer directly from raw rows, it will
hallucinate numbers on anything past a few hundred rows. Don't do that.

## Decisions already locked in with the user (do not re-litigate)

- **Page**: dedicated route (this doc assumes `/ask`), not crammed into Home.
  Home gets a small "Ask anything…" input that navigates to `/ask?q=...`.
- **Data scope**: all six tables from day one — submissions, requirements,
  recruiters, clients, resumes, timesheets. All six are already fully
  implemented and tested in `askEngine.ts` (catalog, row builders, generic
  filter/groupBy/aggregate).
- **Access**: admin/manager only. Already enforced **server-side** on all 5
  new Cloud Function actions (`requireProfile` + `requireRole(["admin",
  "manager"])`). The page itself still needs the same client-side check
  (see Timesheets.tsx / Preferences.tsx for the existing
  `profile?.role === "admin" || profile?.role === "manager"` pattern) —
  the nav *link* should stay visible to everyone, matching how this app
  already handles Timesheets (nav shown to all, content gated inside the
  page), not hidden nav.
- **Summary language**: English by default, switchable to Telugu/Hindi.
  Unlike the Performance Index guide (hardcoded per-language templates —
  fine there, only 5 fixed metrics), Ask Anything answers arbitrary
  questions, so templates aren't feasible. The summary is LLM-phrased per
  language via `askNarrative`, grounded on `AskResult.facts`. Reuses the
  `Lang` / `LANGS` types from `src/lib/indexGuide.ts` — don't reinvent them.

One choice I made without asking, flag it to the user when this ships:
**saved queries are team-shared** (any admin/manager sees every saved query,
`askList` has no per-user filter) — matches the "go-to place for everyone"
framing, but say so explicitly in case they'd rather it be private-per-user.

## What's done

| File | State |
|---|---|
| `src/lib/askCatalog.ts` | Done. The 6-table schema (columns, types, enums) shown to the LLM. Also `SUGGESTED_PROMPTS` for the chip row — placeholder wording, revisit once real usage exists. |
| `src/lib/askEngine.ts` | Done, 19 tests. `sanitizePlan()` (validates untrusted LLM output against the catalog, drops anything unknown rather than trusting it), row builders per table, generic filter/groupBy/aggregate, `runPlan()`. |
| `src/lib/askEngine.test.ts` | 19/19 passing. |
| `src/lib/ask.ts` | Client wrappers (`askPlan`, `askNarrative`, `saveAskQuery`, `listAskQueries`, `deleteAskQuery`) + raw dataset loaders (`loadSubmissions`, `loadJobs`, `loadResumes`, `loadTimesheets`) + `sourcesFor(table)` (which raw sources a table needs) + `rowsForPlan()`. |
| `src/lib/askExport.ts` | Generic CSV + Excel (ExcelJS) download for any `{columns, rows}` — not tied to the specialised report-generation exporter. |
| `src/components/BarChart.tsx` | Done. Hand-rolled horizontal bar chart matching `PieChart.tsx`'s style, for groupings too large for a pie. |
| `src/components/ask/AskCard.tsx` | Done, visually verified in the dev harness at 1280px and 400px. One result card: editable table/date/groupBy/columns/chart chips (edits re-run **without** calling `askPlan`), removable filter pills, language-switchable summary, chart, paginated table, save/CSV/Excel/dismiss. |
| `src/index.css` | Done — the `.ask-*` section, modelled on the `.guide-*` block (`.ask-summary` mirrors `.guide-your`). Includes the ≤768px rules that stack the chips one per row. |
| `src/pages/AskAnything.tsx` | Done. The feed page: role gate, per-source lazy loading, `ask` / re-run / saved-query paths, prompt chips, saved-query list, `?q=` launcher handling. |
| `src/components/Layout.tsx`, `src/App.tsx` | Nav entry (`🔎 Ask Anything`, visible to everyone) and the `/ask` route inside the protected layout group. |
| `src/pages/Home.tsx` | Dashboard launcher — an ask box that navigates to `/ask?q=…`. |
| `src/pages/DesignPreview.tsx` | `AskChromeDemo` (ask bar, prompt chips, saved list) and `AskDemo` (a live `AskCard` over 96 local rows). Demo rows are built inside `useMemo`, never at module level. |
| `scripts/check-bundle.mjs` | `"Ask Anything preview recruiter"` added to `FORBIDDEN`, so a leak of the new harness fails CI like the old one does. |
| `src/lib/ai.ts` | `AiAction` union extended with the 5 new action names. |
| `functions/src/llm.ts` | `planAskQuery()` and `narrateAskResult()` added, same shape as the existing `matchRolesToJd()`. |
| `functions/src/index.ts` | `AiAction` type extended; 5 new `case` branches (`askPlan`, `askNarrative`, `askSave`, `askList`, `askDelete`) added **inside the existing merged `ai` callable** — see "function count discipline" below. |

Verified: `npx tsc -b` clean, `npx vitest run` → **138/138 passing**,
`npx vite build` succeeds, `node scripts/check-bundle.mjs` clean, and the card
+ page chrome screenshotted at 1280px and 400px with no console errors and no
horizontal page overflow. **Not deployed to Firebase, and not yet exercised
against real data by a signed-in admin.**

Two behaviours decided while wiring the page up, worth knowing before changing them:

- **A re-run drops the old summary and re-narrates after a 700ms pause**
  (`NARRATE_DEBOUNCE_MS` in `AskAnything.tsx`). Editing a chip changes the
  numbers, so keeping the old sentence would leave a stale claim on screen —
  but a date field fires a change per keystroke, so an undebounced re-narrate
  would bill several LLM calls per edit. The table and chart update instantly
  either way; only the sentence waits. `askPlan` is still never re-called.
- **Each card carries a run token** (`runToken`), bumped on every run. A slow
  data load or narrative that resolves against an old token is dropped, so a
  burst of edits can't land an earlier answer on top of a later one.

## What's NOT done

1. **Manual test** once logged in as an admin/manager: ask a real question,
   edit a card's table/dates/groupBy/columns (the table and chart must
   redraw instantly, with **no `askPlan` call** — only a single debounced
   `askNarrative` should follow), remove a filter pill, save a query, re-run
   a saved query, switch the summary language both ways, download CSV and
   Excel. Watch the network tab: a burst of chip edits should cost at most
   one `ai` call.

2. **Deploy.** The `ai` Cloud Function is already live in production serving
   other working features (resume parsing, GitHub portfolio, etc.) —
   redeploying it is what ships these 5 new actions, so test thoroughly
   first. `firebase deploy --only functions:ai`, hosting separately via
   `firebase deploy --only hosting`.

   **This project's Cloud Run region has repeatedly hit "Quota exceeded for
   total allowable CPU per project per region"** during this session (see
   git log — that's *why* five separate functions got merged into this one
   `ai` callable in the first place). Deploy one function at a time; if it
   fails on quota, wait and retry rather than batching more functions into
   the same attempt.

3. Run `npx vitest run` and `node scripts/check-bundle.mjs` before every
   deploy — standing project discipline, see `.github/workflows/ci.yml`.

## Gotchas specific to this feature

- **`functions/` is a separate TypeScript project** (own `tsconfig.json`,
  own build, deployed independently) — it cannot `import` from `src/lib/`.
  The data catalog is therefore **duplicated**: the real one is
  `src/lib/askCatalog.ts`; the server's copy is the `ASK_CATALOG_PROMPT`
  string constant near the top of the "Ask Anything" section in
  `functions/src/llm.ts`. If you ever add/rename a table or column in the
  real catalog, you must hand-edit that string to match, or the LLM will be
  planning against a stale schema. Both files have a comment pointing at
  this.
- **Function-count discipline.** This session spent a lot of effort
  collapsing many small Cloud Functions into one merged `ai` callable
  specifically to survive the CPU quota. Do not add a new top-level
  `export const foo = onCall(...)` for anything related to this feature —
  add a new `case` inside the existing `ai` switch, following the pattern
  of the 5 already there.
- `AskCard.tsx`'s `usePagination(result?.rows ?? [], 10, undefined)` passes
  no `storageKey` **on purpose** — multiple cards render at once in the
  feed, and a shared persisted page-size key would make them fight over one
  preference. Don't "fix" this by adding a shared key.
- The "Measure" dropdown in `AskCard.tsx` only offers **sum** when a metric
  field is picked (`agg: "sum"` is hardcoded there); `askEngine.ts` already
  supports `"avg"` too, it's just not exposed in that UI yet — cheap
  follow-up if wanted.
- **The dev harness must stay out of the production bundle.** Sample data
  computed at *module* level in `DesignPreview.tsx` is a Rollup side effect
  that defeats tree-shaking and drags the whole harness into the shipped
  bundle — this has bitten twice. Build demo data lazily inside the
  component (`useMemo(() => …, [])`), as `demoAskRows` does, and run
  `node scripts/check-bundle.mjs` after every build. Any new harness section
  should add a string of its own to that script's `FORBIDDEN` list,
  otherwise a leak passes unnoticed.
- No Firestore rules changes are needed for the new `askQueries` collection
  — all reads/writes go through the Cloud Function's admin SDK
  (`askSave`/`askList`/`askDelete`), never touched directly by the client,
  so the existing catch-all deny-all rule already protects it.
