import { StatusMeta } from "../lib/recruiterStats";

// Horizontal stacked bar showing a recruiter's submissions split by status.
export default function StageBar({
  counts,
  statuses,
  height = 18,
}: {
  counts: Record<string, number>;
  statuses: StatusMeta[];
  height?: number;
}) {
  const total = statuses.reduce((s, st) => s + (counts[st.label] ?? 0), 0);
  if (total === 0) {
    return <div style={{ height, background: "#eef1f5", borderRadius: 4 }} />;
  }
  return (
    <div
      style={{
        display: "flex",
        height,
        borderRadius: 4,
        overflow: "hidden",
        minWidth: 140,
        background: "#eef1f5",
      }}
    >
      {statuses.map((st) => {
        const n = counts[st.label] ?? 0;
        if (n === 0) return null;
        const pct = (n / total) * 100;
        return (
          <div
            key={st.key}
            title={`${st.label}: ${n} (${Math.round(pct)}%)`}
            style={{
              width: `${pct}%`,
              background: st.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: "0.68rem",
              fontWeight: 600,
            }}
          >
            {pct >= 10 ? n : ""}
          </div>
        );
      })}
    </div>
  );
}

// Legend for the status colours actually present in the data.
export function StageLegend({ statuses }: { statuses: StatusMeta[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", fontSize: "0.78rem" }}>
      {statuses.map((st) => (
        <span key={st.key} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ width: 11, height: 11, background: st.color, borderRadius: 2, display: "inline-block" }} />
          <span style={{ color: "var(--muted)" }}>{st.label}</span>
        </span>
      ))}
    </div>
  );
}
