// The three headline verdicts — resume fit, GitHub portfolio, LinkedIn
// credibility — side by side, so the whole picture reads in one glance instead
// of being scattered down the page.

export interface Verdict {
  label: string;
  /** 0-100, or null when the check hasn't run (renders as "—"). */
  score: number | null;
  note: string;
  tone: "green" | "amber" | "red" | "grey";
}

const TONE: Record<Verdict["tone"], { bar: string; text: string }> = {
  green: { bar: "#1e7e34", text: "#1e7e34" },
  amber: { bar: "#a9700a", text: "#a9700a" },
  red: { bar: "#9c0006", text: "#9c0006" },
  grey: { bar: "#94a3b8", text: "#6b7280" },
};

/** Map a 0-100 score to a tone using the app's usual thresholds. */
export function toneForScore(score: number): Verdict["tone"] {
  if (score >= 70) return "green";
  if (score >= 45) return "amber";
  return "red";
}

export default function VerdictBand({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <div className="verdict-band">
      {verdicts.map((v, i) => {
        const t = TONE[v.tone];
        const has = v.score != null && Number.isFinite(v.score);
        return (
          <div
            className={`verdict-tile rise${has ? "" : " na"}`}
            key={v.label}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="verdict-lbl">{v.label}</div>
            <div className="verdict-num" style={{ color: has ? t.text : undefined }}>
              {has ? Math.round(v.score as number) : "—"}
              {has && <small> /100</small>}
            </div>
            <div className="verdict-meter">
              <div
                className="verdict-fill"
                style={{ width: has ? `${Math.max(0, Math.min(100, v.score as number))}%` : "0%", background: t.bar }}
              />
            </div>
            <div className="verdict-note" style={{ color: t.text }}>{v.note}</div>
          </div>
        );
      })}
    </div>
  );
}
