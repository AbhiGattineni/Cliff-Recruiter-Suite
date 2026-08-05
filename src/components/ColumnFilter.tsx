import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Excel-style filter control that lives inside a table header cell.
//
// The panel is position:fixed and placed from the button's bounding rect,
// because the table sits in an `overflow-x: auto` wrapper that would otherwise
// clip an absolutely-positioned dropdown.

const PANEL_W = 250;

export default function ColumnFilter({
  column,
  options,
  selected,
  onChange,
}: {
  column: string;
  /** Distinct values available for this column (already cross-filtered). */
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const active = selected.length > 0;

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const left = Math.max(8, Math.min(b.right - PANEL_W, window.innerWidth - PANEL_W - 8));
    setPos({ top: b.bottom + 4, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Reposition rather than drift when the table or page scrolls.
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const shown = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`colf-btn${active ? " active" : ""}`}
        title={active ? `${column}: ${selected.length} selected` : `Filter ${column}`}
        aria-label={`Filter ${column}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setQ("");
        }}
      >
        {active ? <span className="colf-count">{selected.length}</span> : "▾"}
      </button>

      {open && pos && (
        <div className="colf-panel" ref={panelRef} style={{ top: pos.top, left: pos.left, width: PANEL_W }}>
          <div className="colf-head">{column}</div>
          <input
            className="ms-search"
            placeholder="Search values…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(shown)}>
              {q ? "Select shown" : "Select all"}
            </button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="ms-list" style={{ maxHeight: 230 }}>
            {shown.map((o) => (
              <label key={o} className="ms-item">
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                <span>{o}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="ms-empty">No matching values</div>}
          </div>
          <div className="colf-foot muted">
            {options.length} value{options.length === 1 ? "" : "s"}
            {active ? ` · ${selected.length} ticked` : " · showing all"}
          </div>
        </div>
      )}
    </>
  );
}
