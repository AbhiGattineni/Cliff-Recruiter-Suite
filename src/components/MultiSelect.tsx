import { useEffect, useRef, useState } from "react";

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const shown = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const summary =
    selected.length === 0 ? "All" : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div className="ms field" style={{ margin: 0 }} ref={ref}>
      <label>{label}</label>
      <button type="button" className={`ms-btn ${selected.length ? "active" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="ms-summary">{summary}</span>
        <span className="ms-caret">▾</span>
      </button>
      {open && (
        <div className="ms-panel">
          <input
            className="ms-search"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(options)}>Select all</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o} className="ms-item">
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                <span>{o}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="ms-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
