// The submission SLA board: "two profiles per requirement, inside 24 hours".
//
// This page exists because deriving that number by hand took most of a two-hour
// review — client by client, counting first and second submissions off the
// screen, losing the tally and restarting. Everything here is computed from the
// same Ceipal submissions export the rest of the app already pulls, so opening
// it costs one cached fetch and no counting.

import { useEffect, useMemo, useState } from "react";
import { fetchCeipalReport, reportMeta } from "../lib/ceipal";
import { parseSubmissionsFromApi } from "../lib/report/parseSource";
import { SubmissionEvent } from "../lib/report/types";
import { friendlyError } from "../lib/errors";
import {
  buildRequirementSla,
  slaTotals,
  bucketMatrix,
  groupBy,
  byRecruiter,
  ownersIn,
  worstFirst,
  RequirementSla,
  SlaTotals,
  SLA_BUCKETS,
  SLA_TARGET_SUBMISSIONS,
  SLA_WINDOW_HOURS,
} from "../lib/submissionSla";
import { downloadAskResultCsv } from "../lib/askExport";
import Pagination, { usePagination } from "../components/Pagination";

type Tab = "sla" | "coverage";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

const pctPill = (v: number) => (v >= 90 ? "green" : v >= 60 ? "amber" : "red");
const fmtHours = (h: number | null) =>
  h == null ? "—" : h < 24 ? `${Math.round(h * 10) / 10}h` : `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;

/**
 * A number input that lets you finish typing.
 *
 * Clamping on every keystroke makes the field feel broken: clearing it to type
 * a new value snaps it straight back to the old one, so backspace appears to do
 * nothing. This keeps whatever is typed — including empty, and a lone "-" — and
 * only forces it into range when the field is left or Enter is pressed. A value
 * that is already valid commits as you type, so the numbers below still react
 * immediately.
 */
function NumberField({
  label,
  title,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title?: string;
  value: number;
  min: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const clamp = (n: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, Math.round(n)));

  return (
    <div className="field" style={{ margin: 0, minWidth: 140 }}>
      <label title={title}>{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = Number(raw);
          if (raw !== "" && Number.isFinite(n) && n === clamp(n)) onChange(n);
        }}
        onBlur={() => {
          const n = Number(draft);
          const next = draft === "" || !Number.isFinite(n) ? value : clamp(n);
          setDraft(String(next));
          if (next !== value) onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export default function Submissions() {
  const [events, setEvents] = useState<SubmissionEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sla");

  const [owner, setOwner] = useState(""); // "" = every account manager
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [target, setTarget] = useState(SLA_TARGET_SUBMISSIONS);
  const [windowHours, setWindowHours] = useState(SLA_WINDOW_HOURS);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCeipalReport("submissions", { refresh });
      const meta = reportMeta(json);
      setEvents(parseSubmissionsFromApi(json));
      setFetchInfo(
        `${meta.fetched} submission rows` +
          (meta.cachedAt
            ? ` · data as of ${new Date(meta.cachedAt).toLocaleString()} (cached)`
            : " · freshly pulled from Ceipal")
      );
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Requirements are filtered by when they were CREATED, not by when someone
  // submitted to them. Filtering on submission dates would silently drop the
  // requirements nobody touched, which are the ones worth looking at.
  const all = useMemo(
    () => (events ? buildRequirementSla(events, { target, windowHours }) : []),
    [events, target, windowHours]
  );

  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (owner && r.owner !== owner) return false;
        if (client && r.client !== client) return false;
        if (from || to) {
          const d = r.jobCreatedOn?.toFormat("yyyy-MM-dd");
          if (!d) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
        }
        return true;
      }),
    [all, owner, client, from, to]
  );

  const totals = useMemo(() => slaTotals(rows, target), [rows, target]);
  const buckets = useMemo(() => bucketMatrix(rows, target), [rows, target]);
  const byOwner = useMemo(() => groupBy(rows, (r) => r.owner, target), [rows, target]);
  const byClient = useMemo(() => groupBy(rows, (r) => r.client, target), [rows, target]);
  const recruiters = useMemo(() => byRecruiter(rows, target, windowHours), [rows, target, windowHours]);
  const owners = useMemo(() => ownersIn(all), [all]);
  const clients = useMemo(
    () => [...new Set(all.map((r) => r.client).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [all]
  );

  const exportRows = () => {
    const cols = [
      { key: "jobCode", label: "Req ID" },
      { key: "jobTitle", label: "Requirement" },
      { key: "client", label: "Client" },
      { key: "owner", label: "Account manager" },
      { key: "created", label: "Created" },
      { key: "ageDays", label: "Age (days)" },
      { key: "subs", label: "Submissions" },
      ...Array.from({ length: target }, (_, i) => ({
        key: `t${i}`,
        label: `Hours to ${ORDINALS[i] ?? `${i + 1}th`}`,
      })),
      { key: "inWindow", label: `In ${windowHours}h` },
      { key: "met", label: "Met" },
    ];
    const data = worstFirst(rows).map((r) => ({
      jobCode: r.jobCode,
      jobTitle: r.jobTitle,
      client: r.client,
      owner: r.owner || "(unassigned)",
      created: r.jobCreatedOn?.toFormat("yyyy-MM-dd") ?? "",
      ageDays: r.ageDays ?? "",
      subs: r.submissions.length,
      ...Object.fromEntries(
        Array.from({ length: target }, (_, i) => [`t${i}`, r.hoursToNth[i] == null ? "" : Math.round(r.hoursToNth[i]! * 10) / 10])
      ),
      inWindow: r.inWindow,
      met: r.met ? "Yes" : "No",
    }));
    downloadAskResultCsv(
      `Submission SLA ${owner || "all owners"} ${from || "start"} to ${to || "today"}`,
      cols as never,
      data as never
    );
  };

  if (loading) {
    return (
      <div className="center-load">
        <div className="spinner dark" />
      </div>
    );
  }

  return (
    <div>
      <h1>Submissions</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Are we sending {target} profiles per requirement within {windowHours} hours of it landing?
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label>Account manager</label>
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All ({owners.length})</option>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label>Client</label>
            <select value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">All ({clients.length})</option>
              {clients.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Requirement created from</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>to</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <NumberField
            label="Profiles / req"
            title="How many profiles each requirement should get"
            value={target}
            min={1}
            max={5}
            onChange={setTarget}
          />
          <NumberField
            label="Within (hours)"
            title="Wall clock from when the requirement was created"
            value={windowHours}
            min={1}
            max={720}
            onChange={setWindowHours}
          />
          <div style={{ flex: 1 }} />
          <button className="btn ghost" style={{ padding: "0.4rem 0.7rem" }} onClick={() => void load(true)}>
            Refresh from Ceipal
          </button>
          <button className="btn secondary" style={{ padding: "0.4rem 0.7rem" }} onClick={exportRows}>
            Export
          </button>
        </div>
        {fetchInfo && (
          <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.8rem" }}>{fetchInfo}</p>
        )}
      </div>

      <Headline totals={totals} target={target} windowHours={windowHours} />

      <div className="segmented" style={{ marginBottom: "1rem" }}>
        <button className={tab === "sla" ? "active" : ""} onClick={() => setTab("sla")}>
          SLA
        </button>
        <button className={tab === "coverage" ? "active" : ""} onClick={() => setTab("coverage")}>
          Coverage
        </button>
      </div>

      {tab === "sla" ? (
        <>
          <BucketTable buckets={buckets} target={target} windowHours={windowHours} requirements={totals.requirements} />
          <GroupTable title="By account manager" groups={byOwner} label="Account manager" />
          <RecruiterTable rows={recruiters} windowHours={windowHours} />
          <GroupTable title="By client" groups={byClient} label="Client" />
        </>
      ) : (
        <CoverageTable rows={rows} target={target} windowHours={windowHours} />
      )}
    </div>
  );
}

/** The one number the review was trying to reach, plus the context it needs. */
function Headline({
  totals,
  target,
  windowHours,
}: {
  totals: SlaTotals;
  target: number;
  windowHours: number;
}) {
  return (
    <div className="card">
      <div className="stat-grid">
        <div className="stat">
          <div className="num">
            <span className={`pill ${pctPill(totals.attainment)}`} style={{ fontSize: "1.3rem", padding: "0.2rem 0.7rem" }}>
              {totals.attainment}%
            </span>
          </div>
          <div className="lbl">
            Attainment — {totals.achieved} of {totals.expected} expected
          </div>
        </div>
        <div className="stat">
          <div className="num">{totals.requirements}</div>
          <div className="lbl">Requirements</div>
        </div>
        <div className="stat">
          <div className="num">{totals.met}</div>
          <div className="lbl">
            Got all {target} within {windowHours}h
          </div>
        </div>
        <div className="stat">
          <div className="num" style={totals.untouched ? { color: "var(--danger)" } : undefined}>
            {totals.untouched}
          </div>
          <div className="lbl">No submission at all</div>
        </div>
        <div className="stat">
          <div className="num">{totals.totalSubmissions}</div>
          <div className="lbl">Submissions in total</div>
        </div>
      </div>
      <p className="muted" style={{ margin: "0.9rem 0 0", fontSize: "0.85rem" }}>
        Attainment counts only the first {target} profiles per requirement, measured from when the
        requirement was created. Sending twenty profiles to one requirement cannot make up for sending
        none to another — which is why the total submissions figure sits beside it rather than instead of
        it.
      </p>
    </div>
  );
}

function BucketTable({
  buckets,
  target,
  windowHours,
  requirements,
}: {
  buckets: Record<string, number>[];
  target: number;
  windowHours: number;
  requirements: number;
}) {
  return (
    <div className="card">
      <h2>Time to submission</h2>
      <p className="sub">
        How long each requirement waited for its 1st, 2nd… profile. Anything past {windowHours}h is
        outside the target.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Submission</th>
              {SLA_BUCKETS.map((b) => (
                <th key={b.key} style={{ textAlign: "right" }}>{b.label}</th>
              ))}
              <th style={{ textAlign: "right" }}>Never</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((row, i) => {
              const counted = SLA_BUCKETS.reduce((n, b) => n + row[b.key], 0);
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{ORDINALS[i] ?? `${i + 1}th`}</td>
                  {SLA_BUCKETS.map((b) => (
                    <td
                      key={b.key}
                      style={{
                        textAlign: "right",
                        color: b.upTo > windowHours && row[b.key] > 0 ? "var(--danger)" : undefined,
                        fontWeight: row[b.key] > 0 ? 600 : 400,
                      }}
                    >
                      {row[b.key] || <span className="muted">—</span>}
                    </td>
                  ))}
                  <td className="muted" style={{ textAlign: "right" }}>
                    {/* Requirements that never got this far — the gap between
                        every requirement in range and the ones that have a
                        time recorded for this position. */}
                    {Math.max(0, requirements - counted) || "—"}
                  </td>
                </tr>
              );
            })}
            {target === 0 && (
              <tr>
                <td colSpan={SLA_BUCKETS.length + 2} className="muted">Set a target above zero.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupTable({
  title,
  groups,
  label,
}: {
  title: string;
  groups: { name: string; totals: SlaTotals }[];
  label: string;
}) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="sub">Worst attainment first.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{label}</th>
              <th style={{ textAlign: "right" }}>Reqs</th>
              <th style={{ textAlign: "right" }}>Expected</th>
              <th style={{ textAlign: "right" }}>In window</th>
              <th style={{ textAlign: "right" }}>Nothing sent</th>
              <th style={{ textAlign: "right" }}>Attainment</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.name}>
                <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{g.name}</td>
                <td style={{ textAlign: "right" }}>{g.totals.requirements}</td>
                <td style={{ textAlign: "right" }} className="muted">{g.totals.expected}</td>
                <td style={{ textAlign: "right" }}>{g.totals.achieved}</td>
                <td style={{ textAlign: "right" }} className={g.totals.untouched ? "" : "muted"}>
                  {g.totals.untouched || "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <span className={`pill ${pctPill(g.totals.attainment)}`}>{g.totals.attainment}%</span>
                </td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                  Nothing in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecruiterTable({ rows, windowHours }: { rows: { name: string; submissions: number; inWindow: number; rate: number; requirements: number }[]; windowHours: number }) {
  return (
    <div className="card">
      <h2>By recruiter</h2>
      <p className="sub">
        Counted per submission, and only the ones that could earn anything — a third profile on a
        requirement that already has two is neither credited nor held against anyone.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Recruiter</th>
              <th style={{ textAlign: "right" }}>Reqs worked</th>
              <th style={{ textAlign: "right" }}>Counted submissions</th>
              <th style={{ textAlign: "right" }}>Within {windowHours}h</th>
              <th style={{ textAlign: "right" }}>On time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{r.name}</td>
                <td style={{ textAlign: "right" }}>{r.requirements}</td>
                <td style={{ textAlign: "right" }}>{r.submissions}</td>
                <td style={{ textAlign: "right" }}>{r.inWindow}</td>
                <td style={{ textAlign: "right" }}>
                  <span className={`pill ${pctPill(r.rate)}`}>{r.rate}%</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                  No submissions in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every requirement, worst first — the chase list. */
function CoverageTable({
  rows,
  target,
  windowHours,
}: {
  rows: RequirementSla[];
  target: number;
  windowHours: number;
}) {
  const ordered = useMemo(() => worstFirst(rows), [rows]);
  const page = usePagination(ordered, 25, "submissionCoverage");

  return (
    <div className="card">
      <h2>Coverage</h2>
      <p className="sub">
        Every requirement in range, least covered first. This is the list the {windowHours}-hour number
        is made of.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Req ID</th>
              <th>Requirement</th>
              <th>Client</th>
              <th>Account manager</th>
              <th style={{ textAlign: "right" }}>Age</th>
              <th style={{ textAlign: "right" }}>Subs</th>
              {Array.from({ length: target }, (_, i) => (
                <th key={i} style={{ textAlign: "right" }}>{ORDINALS[i] ?? `${i + 1}th`}</th>
              ))}
              <th style={{ textAlign: "right" }}>In window</th>
            </tr>
          </thead>
          <tbody>
            {page.pageItems.map((r) => (
              <tr key={r.jobCode} className={r.submissions.length === 0 ? "day-missing" : undefined}>
                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{r.jobCode}</td>
                <td style={{ whiteSpace: "normal" }}>{r.jobTitle || <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: "normal" }}>{r.client || <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: "normal" }} className={r.owner ? "" : "muted"}>
                  {r.owner || "(unassigned)"}
                </td>
                <td style={{ textAlign: "right" }} className="muted">
                  {r.ageDays == null ? "—" : `${r.ageDays}d`}
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{r.submissions.length}</td>
                {Array.from({ length: target }, (_, i) => {
                  const h = r.hoursToNth[i];
                  const late = h != null && h > windowHours;
                  return (
                    <td
                      key={i}
                      style={{ textAlign: "right", color: late ? "var(--danger)" : undefined }}
                    >
                      {fmtHours(h)}
                    </td>
                  );
                })}
                <td style={{ textAlign: "right" }}>
                  <span className={`pill ${r.met ? "green" : r.inWindow > 0 ? "amber" : "red"}`}>
                    {r.inWindow}/{target}
                  </span>
                </td>
              </tr>
            ))}
            {ordered.length === 0 && (
              <tr>
                <td colSpan={7 + target} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                  No requirements in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
        pageSize={page.pageSize}
        onPage={page.setPage}
        onPageSize={page.setPageSize}
      />
    </div>
  );
}
