import { useEffect, useRef, useState } from "react";
import { JobHours } from "../../lib/timesheets";
import { OpenJob, filterJobs } from "../../lib/openJobs";

// Pick the requirements worked on and split the day's hours across them.
// Any number of requirements can be added; the total is derived, never typed,
// so the day's total and the per-requirement split can't disagree.

export default function JobHoursPicker({
  jobs,
  options,
  loading,
  error,
  onChange,
  required,
}: {
  jobs: JobHours[];
  options: OpenJob[];
  loading?: boolean;
  error?: string | null;
  onChange: (next: JobHours[]) => void;
  /** At least one requirement must be added before the form can be saved. */
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const chosen = new Set(jobs.map((j) => j.jobCode));
  const shown = filterJobs(options, q).filter((o) => !chosen.has(o.jobCode)).slice(0, 50);
  const total = jobs.reduce((s, j) => s + (Number(j.hours) || 0), 0);

  const add = (o: OpenJob) => {
    onChange([...jobs, { jobCode: o.jobCode, jobTitle: o.jobTitle, client: o.client, hours: 0 }]);
    setQ("");
    setOpen(false);
  };
  const setHours = (code: string, v: string) =>
    onChange(jobs.map((j) => (j.jobCode === code ? { ...j, hours: v === "" ? 0 : Number(v) } : j)));
  const remove = (code: string) => onChange(jobs.filter((j) => j.jobCode !== code));

  return (
    <div className="field" style={{ marginBottom: "1rem" }}>
      <label>
        Requirements worked on {required && <span style={{ color: "var(--danger)" }}>*</span>}
      </label>

      {jobs.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: "0.6rem" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Req ID</th>
                <th>Requirement</th>
                <th>Client</th>
                <th style={{ width: 110, textAlign: "right" }}>Hours</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.jobCode}>
                  <td style={{ fontWeight: 600 }}>{j.jobCode}</td>
                  <td style={{ whiteSpace: "normal" }}>{j.jobTitle || "—"}</td>
                  <td style={{ whiteSpace: "normal" }} className="muted">{j.client || "—"}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={j.hours || ""}
                      placeholder="0"
                      onChange={(e) => setHours(j.jobCode, e.target.value)}
                      style={{ textAlign: "right" }}
                      aria-label={`Hours on ${j.jobCode}`}
                    />
                  </td>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ padding: "0.25rem 0.5rem" }}
                      onClick={() => remove(j.jobCode)}
                      aria-label={`Remove ${j.jobCode}`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: "right", fontWeight: 700, paddingRight: "0.9rem" }}>
                  {Math.round(total * 100) / 100}h
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="ms" ref={boxRef}>
        <button
          type="button"
          className="ms-btn"
          onClick={() => setOpen((v) => !v)}
          disabled={loading || !!error}
        >
          <span className="ms-summary">
            {loading
              ? "Loading requirements…"
              : error
                ? "Requirements unavailable"
                : jobs.length
                  ? "+ Add another requirement"
                  : "+ Add a requirement"}
          </span>
          <span className="ms-caret">▾</span>
        </button>
        {open && (
          <div className="ms-panel">
            <input
              className="ms-search"
              placeholder="Search by req ID, title or client…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="ms-list">
              {shown.map((o) => (
                <button
                  key={o.jobCode}
                  type="button"
                  className="ms-item"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => add(o)}
                >
                  <span>
                    <strong>{o.jobCode}</strong> — {o.jobTitle || "Untitled"}
                    <span className="muted"> · {o.client || "no client"}</span>
                    {o.status.toLowerCase() !== "active" && (
                      <span className="pill amber" style={{ marginLeft: "0.4rem", fontSize: "0.66rem" }}>
                        {o.status}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {shown.length === 0 && (
                <div className="ms-empty">
                  {options.length === 0 ? "No open requirements found." : "No matches."}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <p style={{ fontSize: "0.8rem", margin: "0.35rem 0 0", color: "var(--danger)" }}>
          Couldn&#39;t load requirements — {error} Reload the page to try again — a requirement is required to save.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0" }}>
          Active and On Hold requirements. Add at least one and split your hours between them
          {required && " — required to save"}.
        </p>
      )}
      {required && jobs.length === 0 && !error && (
        <p style={{ fontSize: "0.8rem", margin: "0.3rem 0 0", color: "var(--danger)" }}>
          Add at least one requirement before saving.
        </p>
      )}
    </div>
  );
}
