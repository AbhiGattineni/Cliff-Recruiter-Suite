# Ask Anything — handoff notes

Status: **backend + deterministic engine done and tested; UI page not built yet.**
This feature is paused mid-build for a session handoff. Read this whole file
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

## What's done (compiles, tested, NOT wired into the app yet)

| File | State |
|---|---|
| `src/lib/askCatalog.ts` | Done. The 6-table schema (columns, types, enums) shown to the LLM. Also `SUGGESTED_PROMPTS` for the chip row — placeholder wording, revisit once real usage exists. |
| `src/lib/askEngine.ts` | Done, 19 tests. `sanitizePlan()` (validates untrusted LLM output against the catalog, drops anything unknown rather than trusting it), row builders per table, generic filter/groupBy/aggregate, `runPlan()`. |
| `src/lib/askEngine.test.ts` | 19/19 passing. |
| `src/lib/ask.ts` | Client wrappers (`askPlan`, `askNarrative`, `saveAskQuery`, `listAskQueries`, `deleteAskQuery`) + raw dataset loaders (`loadSubmissions`, `loadJobs`, `loadResumes`, `loadTimesheets`) + `sourcesFor(table)` (which raw sources a table needs) + `rowsForPlan()`. |
| `src/lib/askExport.ts` | Generic CSV + Excel (ExcelJS) download for any `{columns, rows}` — not tied to the specialised report-generation exporter. |
| `src/components/BarChart.tsx` | Done. Hand-rolled horizontal bar chart matching `PieChart.tsx`'s style, for groupings too large for a pie. |
| `src/components/ask/AskCard.tsx` | Written, type-checks, **not visually verified — CSS classes it uses don't exist yet** (see below). One result card: editable table/date/groupBy/columns/chart chips (edits re-run **without** calling the LLM again), removable filter pills, language-switchable summary, chart, paginated table, save/CSV/Excel/dismiss. |
| `src/lib/ai.ts` | `AiAction` union extended with the 5 new action names. |
| `functions/src/llm.ts` | `planAskQuery()` and `narrateAskResult()` added, same shape as the existing `matchRolesToJd()`. |
| `functions/src/index.ts` | `AiAction` type extended; 5 new `case` branches (`askPlan`, `askNarrative`, `askSave`, `askList`, `askDelete`) added **inside the existing merged `ai` callable** — see "function count discipline" below. |

Verified this session: `npx tsc -b` clean, `npx vitest run` → **138/138
passing**, `npx vite build` succeeds. **Not deployed to Firebase.**

## What's NOT done — build in this order

1. **CSS** in `src/index.css`. `AskCard.tsx` references classes that don't
   exist yet: `.ask-card`, `.ask-q`, `.ask-chips`, `.ask-chip-field`,
   `.ask-filters`, `.ask-filter-x`, `.ask-summary`. Look at the `.guide-*`
   classes (added for `IndexGuide.tsx`) for the closest existing visual
   language — `.ask-summary` in particular should probably look like
   `.guide-your` (tinted box, `--brand-light` background).

2. **`src/pages/AskAnything.tsx`** — the orchestration page. `AskCard.tsx`'s
   props already define the contract it needs to satisfy:
   - Role-gate the whole page (see above).
   - Feed state: `items` (an array, newest first — `unshift`, not `push`),
     each holding `{ id, question, result: AskResult|null, loading, error,
     narratives: Partial<Record<Lang,string>>, narrativeLang }`.
   - `lastPlan` (the most recently run plan) — pass it as `priorPlan` to
     `askPlan()` so "now split by month" follow-ups work.
   - Load raw sources lazily via `useQueryClient().ensureQueryData(...)` per
     source (`["askRaw","submissions"]` etc.), driven by
     `sourcesFor(plan.table)` — **don't** eagerly load all four sources for
     every question, only what the chosen table needs. `staleTime` ~5min is
     reasonable since Ceipal data is itself cached server-side already.
   - `ask(question)`: new item → `askPlan()` → `sanitizePlan()` → load
     needed raw sources → `rowsForPlan()` → `runPlan()` → update item →
     kick off an English `askNarrative()` in the background → update
     `lastPlan`.
   - `rerun(itemId, editedPlan)` (called by `AskCard`'s `onRerun`): **the
     same pipeline minus the `askPlan()` call** — this is what makes editing
     a card's chips free and instant. Don't accidentally route edits back
     through the LLM.
   - `runSaved(saved)`: a new feed item built directly from
     `saved.plan` — same no-LLM instant path. This is what makes saved
     queries work as instant dashboards.
   - Prompt chips row from `SUGGESTED_PROMPTS` (askCatalog.ts), each calling
     `ask(promptText)`.
   - Saved-queries list/sidebar: `useQuery(["askQueries"], listAskQueries)`,
     click → `runSaved`, small delete button → `deleteAskQuery` + refetch.
   - Read `?q=` on mount (`useSearchParams`) for the Home-page launcher,
     auto-run it once, then clear the param.

3. **Nav entry** — add to the `NAV` array in `src/components/Layout.tsx`:
   `{ to: "/ask", icon: "🔎", label: "Ask Anything" }`. Visible to everyone
   (matches how Timesheets' nav entry works), page gates content itself.

4. **Route** — add `<Route path="/ask" element={<AskAnything />} />` in
   `src/App.tsx`, inside the **protected** layout group (next to
   `/timesheets`, `/recruiters`), not the public `/login` group.

5. **Home.tsx launcher** — a compact "Ask anything…" input + button that
   does `navigate('/ask?q=' + encodeURIComponent(text))`.

6. **Verify without logging in.** Claude cannot type a password into the
   login form — this bit repeatedly this session. The established
   workaround is `src/pages/DesignPreview.tsx`, a dev-only route gated on
   `import.meta.env.DEV` (see its registration in `App.tsx`). Add a mock
   `AskResult` there and render `<AskCard>` against it so the UI can
   actually be looked at.

   **Known trap, hit twice already**: sample/demo data computed at *module*
   level (outside the component function) is a Rollup side-effect that
   defeats tree-shaking and leaks the entire dev harness into the
   **production** bundle. Always compute demo data lazily inside the
   component (`useMemo(() => {...}, [])`), and run
   `node scripts/check-bundle.mjs` after every build, before every deploy,
   to confirm the harness stayed out.

7. **Manual test** once logged in as an admin/manager: ask a real question,
   edit a card's table/dates/groupBy/columns (confirm it does **not** hit
   the network/LLM — instant), remove a filter pill, save a query, re-run a
   saved query, switch the summary language both ways, download CSV and
   Excel.

8. **Deploy.** The `ai` Cloud Function is already live in production serving
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

9. Run `npx vitest run` and `node scripts/check-bundle.mjs` before every
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
- No Firestore rules changes are needed for the new `askQueries` collection
  — all reads/writes go through the Cloud Function's admin SDK
  (`askSave`/`askList`/`askDelete`), never touched directly by the client,
  so the existing catch-all deny-all rule already protects it.
