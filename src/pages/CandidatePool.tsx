import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCandidatePool, matchCandidatesToJd, keywordMatchRoles, PoolCandidate } from "../lib/candidatePool";
import { getLlmUsageSummary } from "../lib/resume";
import { getUseAI } from "../lib/preferences";
import { friendlyError } from "../lib/errors";
import LlmUsagePanel from "../components/LlmUsagePanel";
import Pagination, { usePagination } from "../components/Pagination";
import MultiSelectFilter, { FilterOption } from "../components/MultiSelectFilter";

const dateOnly = (s: string) => (s ? s.split(/\s+/)[0] : "—");

// ---- Filter helpers -------------------------------------------------------

const BLANK = "__blank__";
const BLANK_LABEL = "— Not set";

/** "Irving,Texas", "irving ,  texas" and "Irving, Texas" are the same place. */
const normLocation = (s: string) => s.trim().replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ");
const keyOf = (s: string) => (s.trim() ? s.trim().toLowerCase() : BLANK);
const digits = (s: string) => s.replace(/\D/g, "");

/** Ceipal dates arrive as "MM/DD/YYYY ..." — fall back to whatever Date can read. Returns local-midnight ms. */
function parseDay(s: string): number | null {
  const t = (s || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : new Date(new Date(d).toDateString()).getTime();
}
const fromInput = (v: string) => (v ? parseDay(v) : null);
const toInputDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Distinct values of one field, with counts, sorted by most common. */
function facet(rows: PoolCandidate[], pick: (c: PoolCandidate) => string[], labelOf: (raw: string) => string = (x) => x): FilterOption[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const c of rows) {
    for (const raw of new Set(pick(c).map((v) => v ?? ""))) {
      const k = keyOf(raw);
      const cur = m.get(k);
      if (cur) cur.count++;
      else m.set(k, { label: k === BLANK ? BLANK_LABEL : labelOf(raw.trim()), count: 1 });
    }
  }
  return [...m.entries()]
    .map(([value, v]) => ({ value, label: v.label, count: v.count }))
    .sort((a, b) => (a.value === BLANK ? 1 : b.value === BLANK ? -1 : b.count - a.count || a.label.localeCompare(b.label)));
}

type Filters = {
  search: string;
  locations: string[];
  roles: string[];
  clients: string[];
  statuses: string[];
  recruiters: string[];
  from: string; // yyyy-mm-dd
  to: string;
  minSubs: string;
};
const EMPTY: Filters = { search: "", locations: [], roles: [], clients: [], statuses: [], recruiters: [], from: "", to: "", minSubs: "" };
const STORE_KEY = "candidatePool.filters";

function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

// ---------------------------------------------------------------------------

export default function CandidatePool() {
  const qc = useQueryClient();
  // Refresh means "go past the cache to Ceipal". It rides a ref rather than the
  // query key so a refresh reuses the same cache entry, and the table keeps
  // showing the rows it has while the live pull runs.
  const forceLive = useRef(false);
  const poolQ = useQuery({
    queryKey: ["candidatePool"],
    queryFn: () => {
      const live = forceLive.current;
      forceLive.current = false;
      return getCandidatePool(live);
    },
  });
  const pool = poolQ.data;
  const usageQ = useQuery({ queryKey: ["llmUsageSummary"], queryFn: () => getLlmUsageSummary() });
  const candidates = pool?.candidates ?? [];

  const [jd, setJd] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchInfo, setMatchInfo] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchRoles, setMatchRoles] = useState<Set<string> | null>(null); // null = show all

  // Filters survive moving to another page and back within the session.
  const [f, setF] = useState<Filters>(loadFilters);
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((cur) => ({ ...cur, [k]: v }));
  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch { /* storage off — fine */ }
  }, [f]);

  const distinctRoles = useMemo(
    () => Array.from(new Set(candidates.flatMap((c) => c.roles).filter(Boolean))),
    [candidates]
  );

  // Step 1: the JD match (unchanged behaviour).
  const jdMatched = useMemo<PoolCandidate[]>(() => {
    if (!matchRoles) return candidates;
    return candidates.filter((c) => c.roles.some((r) => matchRoles.has(r)));
  }, [candidates, matchRoles]);

  // Dropdown options come from the JD-matched set, so they never offer a value
  // that can only produce an empty table.
  const options = useMemo(
    () => ({
      locations: facet(jdMatched, (c) => [normLocation(c.location || "")]),
      roles: facet(jdMatched, (c) => (c.roles.length ? c.roles : [c.latestRole || ""])),
      clients: facet(jdMatched, (c) => [c.latestClient || ""]),
      statuses: facet(jdMatched, (c) => [c.status || ""]),
      recruiters: facet(jdMatched, (c) => [c.latestRecruiter || ""]),
    }),
    [jdMatched]
  );

  // Step 2: the filter bar.
  const filtered = useMemo<PoolCandidate[]>(() => {
    const q = f.search.trim().toLowerCase();
    const qDigits = digits(q);
    const locs = new Set(f.locations);
    const roles = new Set(f.roles);
    const clients = new Set(f.clients);
    const statuses = new Set(f.statuses);
    const recs = new Set(f.recruiters);
    const from = fromInput(f.from);
    const to = fromInput(f.to);
    const minSubs = f.minSubs ? Number(f.minSubs) : 0;

    return jdMatched.filter((c) => {
      if (q) {
        const text = `${c.name} ${c.email} ${c.latestRole} ${c.roles.join(" ")}`.toLowerCase();
        const phoneHit = qDigits.length >= 3 && digits(c.mobile || "").includes(qDigits);
        if (!text.includes(q) && !phoneHit) return false;
      }
      if (locs.size && !locs.has(keyOf(normLocation(c.location || "")))) return false;
      if (roles.size) {
        const rs = c.roles.length ? c.roles : [c.latestRole || ""];
        if (!rs.some((r) => roles.has(keyOf(r)))) return false;
      }
      if (clients.size && !clients.has(keyOf(c.latestClient || ""))) return false;
      if (statuses.size && !statuses.has(keyOf(c.status || ""))) return false;
      if (recs.size && !recs.has(keyOf(c.latestRecruiter || ""))) return false;
      if (from != null || to != null) {
        const d = parseDay(c.latestSubmittedOn);
        if (d == null) return false;
        if (from != null && d < from) return false;
        if (to != null && d > to) return false;
      }
      if (minSubs > 0 && (c.count ?? 0) < minSubs) return false;
      return true;
    });
  }, [jdMatched, f]);

  const { page, setPage, pageCount, pageItems, pageSize, setPageSize, total, startIndex } = usePagination(filtered, 25, "candidatePool");

  // Back to page 1 when the filters change — but not on first load, so a page
  // remembered by usePagination survives navigating away and back.
  const filterSig = JSON.stringify(f);
  const lastSig = useRef(filterSig);
  useEffect(() => {
    if (lastSig.current === filterSig) return;
    lastSig.current = filterSig;
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig]);

  const filterCount =
    (f.search.trim() ? 1 : 0) +
    [f.locations, f.roles, f.clients, f.statuses, f.recruiters].filter((a) => a.length > 0).length +
    (f.from || f.to ? 1 : 0) +
    (f.minSubs ? 1 : 0);

  const quickRange = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    setF((cur) => ({ ...cur, from: toInputDate(d), to: "" }));
  };
  const quickActive = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return f.from === toInputDate(d) && !f.to;
  };

  // Removable chips for whatever is currently applied.
  const chips: { label: string; clear: () => void }[] = [];
  const labelFor = (opts: FilterOption[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const listChip = (name: string, key: "locations" | "roles" | "clients" | "statuses" | "recruiters", opts: FilterOption[]) => {
    const vals = f[key];
    if (!vals.length) return;
    const text = vals.length <= 2 ? vals.map((v) => labelFor(opts, v)).join(", ") : `${vals.length} selected`;
    chips.push({ label: `${name}: ${text}`, clear: () => setFilter(key, []) });
  };
  if (f.search.trim()) chips.push({ label: `Search: "${f.search.trim()}"`, clear: () => setFilter("search", "") });
  listChip("Location", "locations", options.locations);
  listChip("Role", "roles", options.roles);
  listChip("Client", "clients", options.clients);
  listChip("Status", "statuses", options.statuses);
  listChip("Recruiter", "recruiters", options.recruiters);
  if (f.from || f.to) chips.push({ label: `Submitted: ${f.from || "any"} → ${f.to || "today"}`, clear: () => setF((c) => ({ ...c, from: "", to: "" })) });
  if (f.minSubs) chips.push({ label: `Subs ≥ ${f.minSubs}`, clear: () => setFilter("minSubs", "") });

  const runMatch = async () => {
    if (jd.trim().length < 15) {
      setMatchError("Paste a job description (a sentence or two) to filter the pool.");
      return;
    }
    setMatchError(null);
    setMatching(true);
    try {
      const useAI = getUseAI();
      let relevant: string[];
      if (useAI) {
        try {
          relevant = await matchCandidatesToJd(jd, distinctRoles);
          qc.invalidateQueries({ queryKey: ["llmUsageSummary"] });
          setMatchInfo(`AI matched ${relevant.length} of ${distinctRoles.length} roles to this JD.`);
        } catch (e) {
          // AI failed — fall back to keyword matching.
          relevant = keywordMatchRoles(jd, distinctRoles);
          setMatchInfo(`AI unavailable (${friendlyError(e)}) — used keyword matching: ${relevant.length} roles.`);
        }
      } else {
        relevant = keywordMatchRoles(jd, distinctRoles);
        setMatchInfo(`Keyword match (AI off): ${relevant.length} of ${distinctRoles.length} roles.`);
      }
      setMatchRoles(new Set(relevant));
      setPage(0);
    } catch (e) {
      setMatchError(friendlyError(e));
    } finally {
      setMatching(false);
    }
  };

  const clearMatch = () => {
    setMatchRoles(null);
    setMatchInfo(null);
    setMatchError(null);
    setJd("");
  };

  const countText = (() => {
    const base = matchRoles ? `${jdMatched.length} JD matches` : `${candidates.length} candidates`;
    return filterCount > 0 || matchRoles
      ? `Showing ${filtered.length} of ${base}${matchRoles ? ` (pool: ${candidates.length})` : ""}.`
      : `${candidates.length} candidates in the pool.`;
  })();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1>Candidate Pool</h1>
          <p className="muted" style={{ marginTop: "-0.25rem" }}>
            Candidates already sourced and submitted (vetted). Paste a job description to surface the
            ones whose past role matches — reach out to them before sourcing fresh.
          </p>
        </div>
        <button
          className="btn secondary"
          onClick={() => { forceLive.current = true; poolQ.refetch(); }}
          disabled={poolQ.isFetching}
        >
          {poolQ.isFetching ? <span className="spinner dark" /> : "⟳"} Refresh
        </button>
      </div>

      {/* JD match */}
      <div className="card">
        <div className="field" style={{ margin: 0 }}>
          <label>Match by job description</label>
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the job description here… (e.g. a Backend Developer JD will surface people submitted to Java Developer roles)"
            style={{ minHeight: 90 }}
          />
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.6rem" }}>
          <button className="btn" onClick={runMatch} disabled={matching || candidates.length === 0}>
            {matching ? <span className="spinner" /> : "🔎"} Find matching candidates
          </button>
          {matchRoles && (
            <button className="btn ghost" onClick={clearMatch}>Clear — show all</button>
          )}
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {getUseAI() ? "AI matching on" : "Keyword matching (AI off in Preferences)"}
          </span>
        </div>
        {matchError && <div className="alert error" style={{ marginTop: "0.6rem" }}>{matchError}</div>}
        {matchInfo && !matchError && <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>{matchInfo}</p>}
      </div>

      {/* Filters */}
      <div className="card">
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="ms-search"
            style={{ flex: "1 1 260px", margin: 0, padding: "0.5rem 0.7rem" }}
            placeholder="🔍  Search name, email, phone or role…"
            value={f.search}
            onChange={(e) => setFilter("search", e.target.value)}
          />
          <MultiSelectFilter label="Location" options={options.locations} selected={f.locations} onChange={(v) => setFilter("locations", v)} />
          <MultiSelectFilter label="Role" options={options.roles} selected={f.roles} onChange={(v) => setFilter("roles", v)} />
          <MultiSelectFilter label="Client" options={options.clients} selected={f.clients} onChange={(v) => setFilter("clients", v)} />
          <MultiSelectFilter label="Status" options={options.statuses} selected={f.statuses} onChange={(v) => setFilter("statuses", v)} />
          <MultiSelectFilter label="Recruiter" options={options.recruiters} selected={f.recruiters} onChange={(v) => setFilter("recruiters", v)} />
        </div>

        <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "flex-end", marginTop: "0.75rem" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Last submitted from</label>
            <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setFilter("from", e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>to</label>
            <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setFilter("to", e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: "0.35rem", paddingBottom: 2 }}>
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                className="btn ghost"
                style={{
                  padding: "0.35rem 0.6rem",
                  fontSize: "0.82rem",
                  ...(quickActive(d) ? { background: "var(--brand-light)", color: "var(--brand)", borderColor: "var(--brand)" } : {}),
                }}
                onClick={() => quickRange(d)}
              >
                Last {d}d
              </button>
            ))}
          </div>
          <div className="field" style={{ margin: 0, width: 130 }}>
            <label>Min. submissions</label>
            <select value={f.minSubs} onChange={(e) => setFilter("minSubs", e.target.value)}>
              <option value="">Any</option>
              {[2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          {filterCount > 0 && (
            <button className="btn ghost" style={{ padding: "0.4rem 0.75rem" }} onClick={() => setF(EMPTY)}>
              Clear all filters ({filterCount})
            </button>
          )}
        </div>

        {chips.length > 0 && (
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
            {chips.map((c) => (
              <span key={c.label} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--brand-light)", color: "var(--brand)" }}>
                {c.label}
                <button
                  type="button"
                  onClick={c.clear}
                  aria-label={`Remove ${c.label}`}
                  style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, fontSize: "0.95rem", lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {poolQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "30vh" }}><div className="spinner dark" /></div>
        ) : poolQ.error ? (
          <div className="alert error">
            <strong>Couldn&#39;t load the candidate pool.</strong>
            <p style={{ margin: "0.4rem 0 0" }}>{friendlyError(poolQ.error)}</p>
          </div>
        ) : (
          <>
            {pool?.stale && (
              <div className="alert error" style={{ marginBottom: "0.6rem" }}>
                <strong>Ceipal didn&#39;t answer — showing the last good pull{pool.fetchedAt ? ` from ${new Date(pool.fetchedAt).toLocaleString()}` : ""}.</strong>
                {pool.problem && <p style={{ margin: "0.4rem 0 0" }}>{pool.problem}</p>}
              </div>
            )}
            <p className="sub">{countText}</p>
            <div className="table-wrap" style={{ maxHeight: "62vh" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Candidate</th>
                    <th>Email</th>
                    <th>Mobile</th>
                    <th>Location</th>
                    <th>Latest role</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Subs</th>
                    <th>Last submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((c, i) => (
                    <tr key={(c.email || c.mobile || c.name) + i}>
                      <td className="muted">{startIndex + i + 1}</td>
                      <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{c.name || "—"}</td>
                      <td style={{ whiteSpace: "normal" }}>{c.email || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{c.mobile || "—"}</td>
                      <td style={{ whiteSpace: "normal" }}>{c.location || "—"}</td>
                      <td style={{ whiteSpace: "normal" }} title={c.roles.join(" · ")}>{c.latestRole || "—"}</td>
                      <td style={{ whiteSpace: "normal" }}>{c.latestClient || "—"}</td>
                      <td style={{ whiteSpace: "normal" }}>{c.status || "—"}</td>
                      <td style={{ textAlign: "right" }}>{c.count}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{dateOnly(c.latestSubmittedOn)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                        {filterCount > 0 ? (
                          <>
                            No candidates match these filters.{" "}
                            <button className="btn ghost" style={{ padding: "0.2rem 0.6rem", marginLeft: 6 }} onClick={() => setF(EMPTY)}>
                              Clear filters
                            </button>
                          </>
                        ) : matchRoles ? "No candidates match this job description." : "No candidates in the pool."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
          </>
        )}
      </div>

      <LlmUsagePanel summary={usageQ.data} />
    </div>
  );
}