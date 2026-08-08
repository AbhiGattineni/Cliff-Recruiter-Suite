// Horizontal bar chart — hand-rolled, matching PieChart's plain-SVG style
// (no charting library). Used when a grouped result has more categories than
// a pie can read cleanly.

export interface BarSlice {
  label: string;
  value: number;
  color?: string;
}

export default function BarChart({ title, data }: { title: string; data: BarSlice[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: "0.6rem" }}>{title}</div>
      {data.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No data</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {data.map((d) => (
            <div key={d.label} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span
                style={{
                  width: 140, flexShrink: 0, fontSize: "0.8rem", color: "var(--muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                title={d.label}
              >
                {d.label}
              </span>
              <div style={{ flex: 1, background: "#eef1f5", borderRadius: 4, height: 16, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(d.value / max) * 100}%`, height: "100%",
                    background: d.color || "var(--brand)", borderRadius: 4, minWidth: d.value > 0 ? 3 : 0,
                  }}
                />
              </div>
              <span style={{ width: 52, textAlign: "right", fontSize: "0.8rem", fontWeight: 600, flexShrink: 0 }}>
                {d.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
