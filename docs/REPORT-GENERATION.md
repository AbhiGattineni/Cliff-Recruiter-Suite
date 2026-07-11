# Report Generation

The report engine lives in `src/lib/report/` and runs **entirely in the browser**. It accepts
data from either the Ceipal API (JSON) or uploaded Excel exports and produces one flat row per
candidate submission, with job-level fields repeated across a job's rows.

## Pipeline
```
Ceipal API JSON  ─┐
                  ├─► parseSource.ts ─► JobRecord[] + SubmissionEvent[] ─► transform.ts ─► ReportResult
Uploaded .xlsx  ─┘        (columns.ts maps/normalises headers)                              │
                                                                                            ▼
                                                                        buildXlsx.ts ─► formatted .xlsx
```

| File | Responsibility |
|------|----------------|
| `columns.ts` | Header alias maps + `normalizeStatus`; tolerant matching (`normHeader`) |
| `parseSource.ts` | Raw rows/JSON → `JobRecord[]` / `SubmissionEvent[]` |
| `transform.ts` | The full report build (pivot, durations, counts, NA rows, sort, overdue rule) |
| `dates.ts` | EST-framed parsing, `fmtDuration` (`"Xd Yh Zm"`), `fmtTs` |
| `types.ts` | `JobRecord`, `SubmissionEvent`, `ReportRow`, and the canonical `COLUMNS` order |
| `columnMeta.ts` | Groups, per-column descriptions, and column presets (UI only) |
| `buildXlsx.ts` | ExcelJS workbook with styling + Report Info sheet |
| `readExcel.ts` | Workbook reader (exceljs; malformed-xlsx fallback via jszip + fast-xml-parser) |
| `pipeline.test.ts` | Vitest coverage on the real column shape (5 tests) |

## Columns (35 total)
Grouped in `columnMeta.ts`:
- **Job overview** — Job Code, Job Title, Client, Job Status, Job Created On, Job Age
- **Job detail** — Internal Screening Required, Recruitment Manager, Pay Rate/Salary,
  **Experience, Mandate Skills, Job Description, Comments**
- **Submission counts** — # Submitted Profiles + per-stage counts
- **Time to submit** — Time Taken – 1st / 2nd / 3rd Submission
- **Candidate pipeline** — Candidate, Recruiter, Submitted On, per-stage timestamps + transition
  durations, Note

`Experience / Mandate Skills / Job Description / Comments` are job-level and only populate if the
Ceipal job-duration report carries those columns (else `NA`). Add spellings to `JOB_FIELD_ALIASES`
in `columns.ts` if Ceipal's labels differ.

## Column picker
`components/ColumnPicker.tsx` lets the user choose which columns appear in the preview and export.
Presets in `columnMeta.ts`:
- **Management overview** — headline numbers only
- **Manager detail** — full job + requirement detail with counts and timings
- **Recruiter pipeline** — per-candidate detail with every stage timestamp
- **Everything** — all columns

Selection (`visibleCols`) drives the preview table and is passed to `buildWorkbook(result, { columns })`;
it is saved with the report configuration.

## Filters
- Global search across all columns.
- Multi-select dropdowns (`components/MultiSelect.tsx`): Client, Job Status, Job Title,
  Recruitment Manager, Recruiter (Submitted By).
- Date ranges: Submitted On, Job Created On.
- Filters apply to the preview, the pie charts, and the Excel export (`{...result, rows: filteredRows}`).

## Submission-time pie charts
`components/PieChart.tsx` (hand-rolled SVG, no chart library). Three pies for the 1st/2nd/3rd
submission, bucketed **<4h / 4–8h / 8–16h / 16–24h / 24–48h / 48h+**. Counted **once per job**
(deduped by Job Code, since time-taken is a job-level value). Durations parsed from `"Xd Yh Zm"`.

## Ceipal specifics
- Auth: `POST https://api.ceipal.com/v2/createAuthtoken/` with JSON `{email, password, apiKey}`
  (note camelCase **`apiKey`**) → `{access_token}`.
- Report: `GET https://atsbi.ceipal.com/api/report-details/get-report-data/<id>?response_type=1`
  with `Authorization: Bearer <token>`. Rows under `result`.
- **Paginated at 20/page**; `fetchReport` requests `&limit=100&page=N` until `has_next_page` is
  false, accumulating all rows. The app now **always fetches every record** (no cap).
- Ceipal supports **no server-side date filtering** and data is not date-sorted, so all filtering
  is client-side after the full fetch.
- Ceipal reports have a hard **70-column limit**; exceeding it returns `{success:0, message}` with
  HTTP 200, surfaced by `checkPayload()`.

## Overdue (red) rule
A 0-submission job is flagged red once it passes its office deadline: 6 PM EST on the creation day
if created by 2 PM, otherwise 6 PM the next day (`isOverdue` in `transform.ts`).
