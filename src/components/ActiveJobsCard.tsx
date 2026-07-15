import { useQuery } from "@tanstack/react-query";
import { getActiveJobs } from "../lib/activeJobs";

const cleanLoc = (s: string) => s.replace(/^\[|\]$/g, "").trim();
const dateOnly = (s: string) => (s ? s.split(/\s+/)[0] : "—");

// Small live snapshot of the currently-open jobs (Ceipal "Active Jobs - All").
export default function ActiveJobsCard() {
  const q = useQuery({ queryKey: ["activeJobs"], queryFn: () => getActiveJobs() });
  const jobs = q.data ?? [];

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ marginBottom: 0, fontSize: "1.05rem" }}>
          Active jobs today{q.data ? ` (${jobs.length})` : ""}
        </h2>
        <button
          className="btn ghost"
          style={{ padding: "0.25rem 0.6rem" }}
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          title="Refresh open jobs"
        >
          {q.isFetching ? <span className="spinner dark" /> : "↻"}
        </button>
      </div>

      {q.isLoading ? (
        <div className="muted" style={{ padding: "0.6rem 0", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <span className="spinner dark" /> Loading open jobs…
        </div>
      ) : q.error ? (
        <p className="muted" style={{ marginBottom: 0 }}>Couldn&#39;t load active jobs.</p>
      ) : jobs.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>No active jobs right now.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: "0.6rem", maxHeight: "40vh" }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Req ID</th>
                <th>Job</th>
                <th>Client</th>
                <th>Location</th>
                <th style={{ textAlign: "right" }}>Positions</th>
                <th style={{ textAlign: "right" }}>Subs</th>
                <th style={{ textAlign: "right" }}>Interviews</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={j.jobCode || i}>
                  <td className="muted">{i + 1}</td>
                  <td>{j.jobCode || "—"}</td>
                  <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{j.jobTitle || "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{j.client || "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{cleanLoc(j.location) || "—"}</td>
                  <td style={{ textAlign: "right" }}>{j.positions || "—"}</td>
                  <td style={{ textAlign: "right" }}>{j.submissions}</td>
                  <td style={{ textAlign: "right" }}>{j.interviews}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{dateOnly(j.jobCreated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
