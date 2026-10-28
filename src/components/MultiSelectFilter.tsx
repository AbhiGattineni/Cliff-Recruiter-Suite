import { useEffect, useRef, useState } from "react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * A filter-bar dropdown: "Location ▾" button that opens a searchable checkbox
 * list. Same look as Client Tracker's column filters (ms-* classes), and the
 * panel is position:fixed so cards and table wrappers can't clip it.
 */
export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number }>({ left: 0, top: 0, maxH: 340 });

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = 280;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 240 && above > below;
    const maxH = Math.max(180, Math.min(380, up ? above : below));
    setPos(up ? { left, bottom: window.innerHeight - r.top + 4, maxH } : { left, top: r.bottom + 4, maxH });
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && panelRef.current?.contains(t)) return;
      place();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const active = selected.length > 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn ghost"
        onClick={() => { if (!open) place(); setOpen((o) => !o); }}
        disabled={options.length === 0}
        style={{
          padding: "0.4rem 0.75rem",
          ...(active ? { background: "var(--brand-light)", color: "var(--brand)", borderColor: "var(--brand)", fontWeight: 600 } : {}),
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
        {active && <span style={{ marginLeft: 6, fontSize: "0.72rem", fontWeight: 700 }}>({selected.length})</span>}
        <span style={{ marginLeft: 6, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            zIndex: 1000,
            width: 280,
            background: "var(--card-raised)",
            color: "var(--ink)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(16,24,40,0.14)",
            padding: "0.5rem",
            maxHeight: pos.maxH,
            display: "flex",
            flexDirection: "column",
            textAlign: "left",
          }}
        >
          <input className="ms-search" placeholder={`Search ${label.toLowerCase()}…`} value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(Array.from(new Set([...selected, ...shown.map((o) => o.value)])))}>
              Select {q ? "shown" : "all"}
            </button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o.value} className="ms-item">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.count != null && <span className="muted" style={{ fontSize: "0.75rem" }}>{o.count}</span>}
              </label>
            ))}
            {shown.length === 0 && <div className="ms-empty">No matches</div>}
          </div>
        </div>
      )}
    </>
  );
}
