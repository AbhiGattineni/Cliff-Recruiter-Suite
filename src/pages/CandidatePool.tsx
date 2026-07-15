import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCandidatePool, matchCandidatesToJd, keywordMatchRoles, PoolCandidate } from "../lib/candidatePool";
import { getLlmUsageSummary } from "../lib/resume";
import { getUseAI } from "../lib/preferences";
import { friendlyError } from "../lib/errors";
import LlmUsagePanel from "../components/LlmUsagePanel";
import Pagination, { usePagination } from "../components/Pagination";

const dateOnly = (s: string) => (s ? s.split(/\s+/)[0] : "—");

export default function CandidatePool() {
  const qc = useQueryClient();
  const poolQ = useQuery({ queryKey: ["candidatePool"], queryFn: () => getCandidatePool() });
  const usageQ = useQuery({ queryKey: ["llmUsageSummary"], queryFn: () => getLlmUsageSummary() });
  const candidates = poolQ.data ?? [];

  const [jd, setJd] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchInfo, setMatchInfo] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchRoles, setMatchRoles] = useState<Set<string> | null>(null); // null = show all

  const distinctRoles = useMemo(
    () => Array.from(new Set(candidates.flatMap((c) => c.roles).filter(Boolean))),
    [candidates]
  );

  const filtered = useMemo<PoolCandidate[]>(() => {
    if (!matchRoles) return candidates;
    return candidates.filter((c) => c.roles.some((r) => matchRoles.has(r)));
  }, [candidates, matchRoles]);

  const { page, setPage, pageCount, pageItems, pageSize, total, startIndex } = usePagination(filtered, 25);

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
        <button className="btn secondary" onClick={() => poolQ.refetch()} disabled={poolQ.isFetching}>
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

      <div className="card">
        {poolQ.isLoading ? (
          <div className="center-load" style={{ minHeight: "30vh" }}><div className="spinner dark" /></div>
        ) : poolQ.error ? (
          <p className="muted">Couldn&#39;t load the candidate pool.</p>
        ) : (
          <>
            <p className="sub">
              {matchRoles ? `Showing ${filtered.length} matching of ${candidates.length}` : `${candidates.length} candidates`} in the pool.
            </p>
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
                        {matchRoles ? "No candidates match this job description." : "No candidates in the pool."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} />
          </>
        )}
      </div>

      <LlmUsagePanel summary={usageQ.data} />
    </div>
  );
}
