import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { getActiveJobs } from "../lib/activeJobs";
import { JobSubmission } from "../lib/recruiterStats";
import { isClientVendorStatus } from "../lib/report/columns";

const cleanLoc = (s: string) => s.replace(/^\[|\]$/g, "").trim();
const dateOnly = (s: string) => (s ? s.split(/\s+/)[0] : "—");
const fmtDt = (d: DateTime | null) => (d ? d.toFormat("MM/dd/yyyy hh:mm a") : "—");

// Live snapshot of currently-open jobs (Ceipal "Active Jobs - All"). Each job row
// expands to the submissions for that job — reusing the submissions already loaded
// on the page (subsByJob), so no extra fetch.
export default function ActiveJobsCard({ subsByJob }: { subsByJob: Map<string, JobSubmission[]> }) {
  const q = useQuery({ queryKey: ["activeJobs"], queryFn: () => getActiveJobs() });
  const jobs = q.data ?? [];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (code: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

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
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
            Click a job to see its submissions. <span style={{ background: "#ffc7ce", color: "#9c0006", padding: "0 4px", borderRadius: 3 }}>Red</span> = no submissions,{" "}
            <span style={{ background: "#ffe8b3", color: "#7a5600", padding: "0 4px", borderRadius: 3 }}>amber</span> = has submissions but none sent to client/vendor.
          </p>
          <div className="table-wrap" style={{ maxHeight: "48vh" }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Req ID</th>
                  <th>Job</th>
                  <th>Client</th>
                  <th>Location</th>
                  <th style={{ textAlign: "right" }}>Positions</th>
                  <th style={{ textAlign: "right" }}>Submissions</th>
                  <th style={{ textAlign: "right" }}>Interviews</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => {
                  const details = subsByJob.get(j.jobCode) ?? [];
                  const open = expanded.has(j.jobCode || String(i));
                  const key = j.jobCode || String(i);
                  // Same rule as the Report preview: red = no submissions, amber =
                  // has submissions but none reached the client/vendor side.
                  let cls = "";
                  if (j.submissions === 0) {
                    cls = "red";
                  } else {
                    const clientVendor =
                      details.length > 0
                        ? details.some((d) => isClientVendorStatus(d.status))
                        : j.clientSub > 0 || j.interviews > 0 || j.placements > 0;
                    if (!clientVendor) cls = "internal-only";
                  }
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => toggle(key)} style={{ cursor: "pointer" }} className={cls}>
                        <td style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</td>
                        <td>{j.jobCode || "—"}</td>
                        <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{j.jobTitle || "—"}</td>
                        <td style={{ whiteSpace: "normal" }}>{j.client || "—"}</td>
                        <td style={{ whiteSpace: "normal" }}>{cleanLoc(j.location) || "—"}</td>
                        <td style={{ textAlign: "right" }}>{j.positions || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{j.submissions}</td>
                        <td style={{ textAlign: "right" }}>{j.interviews}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{dateOnly(j.jobCreated)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td></td>
                          <td colSpan={8} style={{ background: "#f8fafc", padding: "0.5rem 0.75rem" }}>
                            {details.length > 0 ? (
                              <table className="data" style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th>Consultant</th>
                                    <th>Recruiter</th>
                                    <th>Current status</th>
                                    <th>Submitted on</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {details.map((s, k) => (
                                    <tr key={k}>
                                      <td style={{ whiteSpace: "normal", fontWeight: 600 }}>{s.consultant || "—"}</td>
                                      <td style={{ whiteSpace: "normal" }}>{s.recruiter || "—"}</td>
                                      <td style={{ whiteSpace: "normal" }}>{s.status}</td>
                                      <td style={{ whiteSpace: "nowrap" }}>{fmtDt(s.submittedOn)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <span className="muted" style={{ fontSize: "0.85rem" }}>
                                {subsByJob.size === 0
                                  ? "Submission details load with the leaderboard below…"
                                  : "No submission details in the loaded data for this job."}
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
