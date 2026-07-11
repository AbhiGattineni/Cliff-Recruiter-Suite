import { COLUMN_GROUPS, COLUMN_PRESETS, orderColumns } from "../lib/report/columnMeta";

interface Props {
  all: string[]; // full COLUMNS list (canonical order)
  selected: string[]; // currently-visible columns (canonical order)
  onChange: (next: string[]) => void;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export default function ColumnPicker({ all, selected, onChange }: Props) {
  const sel = new Set(selected);

  const setCols = (cols: Iterable<string>) => onChange(orderColumns(cols));

  const toggle = (name: string) => {
    const next = new Set(sel);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCols(next);
  };

  const toggleGroup = (cols: string[], on: boolean) => {
    const next = new Set(sel);
    for (const c of cols) {
      if (on) next.add(c);
      else next.delete(c);
    }
    setCols(next);
  };

  const activePreset = COLUMN_PRESETS.find((p) => sameSet(p.columns, selected));

  return (
    <details className="colpick" open>
      <summary>
        <span className="colpick-title">Columns</span>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {selected.length} of {all.length} shown
          {activePreset ? ` · ${activePreset.label}` : ""}
        </span>
      </summary>

      <div className="colpick-body">
        <div className="colpick-presets">
          <span className="muted" style={{ fontSize: "0.82rem", alignSelf: "center" }}>Quick views:</span>
          {COLUMN_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`btn ${activePreset?.key === p.key ? "" : "secondary"}`}
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.85rem" }}
              title={p.blurb}
              onClick={() => setCols(p.columns)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
            onClick={() => setCols([])}
          >
            Clear
          </button>
        </div>

        <div className="colpick-groups">
          {COLUMN_GROUPS.map((g) => {
            const names = g.columns.map((c) => c.name);
            const chosen = names.filter((n) => sel.has(n)).length;
            const allOn = chosen === names.length;
            return (
              <fieldset key={g.group} className="colpick-group">
                <legend>
                  <label className="colpick-grouptoggle">
                    <input
                      type="checkbox"
                      checked={allOn}
                      ref={(el) => {
                        if (el) el.indeterminate = chosen > 0 && !allOn;
                      }}
                      onChange={() => toggleGroup(names, !allOn)}
                    />
                    <span>{g.group}</span>
                    <span className="muted" style={{ fontWeight: 400, fontSize: "0.78rem" }}>
                      ({chosen}/{names.length})
                    </span>
                  </label>
                </legend>
                <p className="muted colpick-blurb">{g.blurb}</p>
                {g.columns.map((c) => (
                  <label key={c.name} className="colpick-item">
                    <input type="checkbox" checked={sel.has(c.name)} onChange={() => toggle(c.name)} />
                    <span className="colpick-name">{c.name}</span>
                    <span className="muted colpick-desc">{c.desc}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      </div>
    </details>
  );
}
