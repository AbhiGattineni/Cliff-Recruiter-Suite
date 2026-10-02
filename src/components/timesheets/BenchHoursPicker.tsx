import { useEffect, useRef, useState } from "react";
import { BenchHours } from "../../lib/timesheets";
import { BenchOption, filterBenchOptions } from "../../lib/benchOptions";

// Pick the bench submissions worked on and split the day's hours across them.
//
// The same shape as JobHoursPicker, deliberately: a bench sales recruiter's
// day and a recruiter's day are the same kind of record, and the two pickers
// sit one above the other in the same form. What differs is what a row is —
// a submission names a person, a vendor and a title rather than a job code —
// so the columns differ and nothing else does.

export default function BenchHoursPicker({
  bench,
  options,
  loading,
  error,
  onChange,
}: {
  bench: BenchHours[];
  options: BenchOption[];
  loading?: boolean;
  error?: string | null;
  onChange: (next: BenchHours[]) => void;
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

  const chosen = new Set(bench.map((b) => b.subKey));
  const shown = filterBenchOptions(options, q).filter((o) => !chosen.has(o.subKey)).slice(0, 50);

  const add = (o: BenchOption) => {
    onChange([
      ...bench,
      {
        subKey: o.subKey,
        consultant: o.consultant,
        vendor: o.vendor,
        jobTitle: o.jobTitle,
        submittedOn: o.submittedOn,
        hours: 0,
      },
    ]);
    setQ("");
    setOpen(false);
  };
  const setHours = (key: string, v: string) =>
    onChange(bench.map((b) => (b.subKey === key ? { ...b, hours: v === "" ? 0 : Number(v) } : b)));
  const remove = (key: string) => onChange(bench.filter((b) => b.subKey !== key));

  return (
    <div className="field" style={{ marginBottom: "1rem" }}>
      <label>Bench submissions worked on</label>

      {bench.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: "0.6rem" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Consultant</th>
                <th>Vendor</th>
                <th>Role</th>
                <th style={{ width: 110 }}>Hours</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {bench.map((b) => (
                <tr key={b.subKey}>
                  <td style={{ fontWeight: 600 }}>{b.consultant || "—"}</td>
                  <td>{b.vendor || "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{b.jobTitle || "—"}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.25}
                      value={b.hours || ""}
                      placeholder="0"
                      onChange={(e) => setHours(b.subKey, e.target.value)}
                      style={{ width: "100%" }}
                      aria-label={`Hours on ${b.consultant || b.subKey}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ padding: "0.15rem 0.45rem" }}
                      onClick={() => remove(b.subKey)}
                      aria-label={`Remove ${b.consultant || b.subKey}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div ref={boxRef} style={{ position: "relative" }}>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setOpen((o) => !o);
            setQ("");
          }}
          disabled={loading}
        >
          {loading ? <span className="spinner dark" /> : "+"} Add a bench submission
        </button>

        {error && (
          <p className="muted" style={{ fontSize: "0.78rem", margin: "0.35rem 0 0" }}>
            Couldn&#39;t load the bench submissions — {error}
          </p>
        )}

        {open && (
          <div
            className="colf-panel"
            style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 420, maxWidth: "90vw" }}
          >
            <input
              className="ms-search"
              placeholder="Search consultant, vendor or role…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="ms-list" style={{ maxHeight: 260 }}>
              {shown.map((o) => (
                <button
                  key={o.subKey}
                  type="button"
                  className="ms-item"
                  style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer" }}
                  onClick={() => add(o)}
                >
                  <span>
                    <strong>{o.consultant || "(unnamed)"}</strong>
                    {o.vendor ? ` — ${o.vendor}` : ""}
                    <br />
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      {[o.jobTitle, o.submittedOn, o.status].filter(Boolean).join(" · ") || "no details"}
                    </span>
                  </span>
                </button>
              ))}
              {shown.length === 0 && (
                <div className="ms-empty">
                  {options.length === 0 ? "No bench submissions in the report." : "No matching submissions"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
