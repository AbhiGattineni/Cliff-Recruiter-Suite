export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export default function PieChart({
  title,
  data,
  showLegend = true,
}: {
  title: string;
  data: PieSlice[];
  showLegend?: boolean;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const size = 150;
  const r = 62;
  const cx = size / 2;
  const cy = size / 2;
  const active = data.filter((d) => d.value > 0);

  let angle = -90;
  const slices = active.map((d) => {
    const frac = d.value / total;
    const start = angle;
    const end = angle + frac * 360;
    angle = end;
    return { ...d, start, end };
  });

  const arc = (start: number, end: number) => {
    const large = end - start > 180 ? 1 : 0;
    const s = polar(cx, cy, r, start);
    const e = polar(cx, cy, r, end);
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
  };

  return (
    <div style={{ minWidth: 210 }}>
      <div style={{ fontWeight: 600, textAlign: "center", marginBottom: "0.4rem" }}>{title}</div>
      {total === 0 ? (
        <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
          No data
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {slices.length === 1 ? (
              <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
            ) : (
              slices.map((s, i) => <path key={i} d={arc(s.start, s.end)} fill={s.color} stroke="#fff" strokeWidth={1} />)
            )}
          </svg>
          {showLegend && (
            <div style={{ fontSize: "0.8rem" }}>
              {data.map((d) => (
                <div key={d.label} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: 2 }}>
                  <span style={{ width: 10, height: 10, background: d.color, borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ color: "var(--muted)" }}>{d.label}</span>
                  <span style={{ fontWeight: 600, marginLeft: "auto" }}>{d.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
