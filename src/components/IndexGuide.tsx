import { useState } from "react";
import { RecruiterStat, INDEX_WEIGHTS } from "../lib/recruiterStats";
import { GUIDE, LANGS, Lang, readLang, writeLang } from "../lib/indexGuide";

// Plain-language guide to the Performance Index, readable in English, Telugu or
// Hindi. Recruiters are ranked by this number, so the rules are explained in
// the language they actually read, with their own figures filled in.

const WEIGHT_OF: Record<string, number> = {
  clientPerAssigned: INDEX_WEIGHTS.clientPerAssigned,
  clientRate: INDEX_WEIGHTS.clientRate,
  progressRate: INDEX_WEIGHTS.progressRate,
  volume: INDEX_WEIGHTS.volume,
  coverage: INDEX_WEIGHTS.coverage,
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function IndexGuide({ stat }: { stat?: RecruiterStat }) {
  const [lang, setLang] = useState<Lang>(readLang);
  const t = GUIDE[lang];
  const pick = (l: Lang) => {
    setLang(l);
    writeLang(l);
  };

  return (
    <details className="colpick guide" style={{ marginTop: "1rem" }}>
      <summary>
        <span className="colpick-title" style={{ fontSize: "0.95rem" }}>
          {t.title}
          {stat ? ` — ${stat.index}/100` : ""}
        </span>
      </summary>

      <div className="colpick-body">
        <div className="guide-langs" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`guide-lang${l.code === lang ? " active" : ""}`}
              aria-pressed={l.code === lang}
              onClick={() => pick(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>

        <p className="guide-intro">{t.intro}</p>

        {stat && (
          <p className="guide-your">
            {t.yourLine(stat.clientCount, stat.clientTarget, t.basis(stat.targetBaseCount, stat.targetBasis))}
          </p>
        )}

        <ol className="guide-list">
          {t.metrics.map((m, i) => {
            const weight = WEIGHT_OF[m.key] ?? 0;
            const got = stat ? stat.indexParts[m.key] : null;
            return (
              <li className="guide-item" key={m.key}>
                <div className="guide-item-head">
                  <span className="guide-num">{i + 1}</span>
                  <span className="guide-name">{m.name}</span>
                  <span className="pill grey">{t.outOf(Math.round(weight * 100))}</span>
                  {got != null && (
                    <span className={`pill ${got >= 0.6 ? "green" : got >= 0.3 ? "amber" : "red"}`}>
                      {pct(got)} · {Math.round(weight * got * 100)}
                    </span>
                  )}
                </div>
                <p className="guide-plain">{m.plain}</p>
                <p className="guide-eg">{m.example}</p>
              </li>
            );
          })}
        </ol>

        <p className="guide-note">{t.relativeNote}</p>

        <h4 className="guide-h">{t.bandsTitle}</h4>
        <div className="guide-bands">
          {t.bands.map((b) => (
            <span key={b.label} className={`pill ${b.tone}`}>
              {b.label} — {b.range}
            </span>
          ))}
        </div>

        <p className="guide-note">{t.rangeNote}</p>
        <p className="guide-note">{t.clientNote}</p>

        {stat && (
          <>
            <h4 className="guide-h">{t.tableTitle}</h4>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.col.metric}</th>
                    <th style={{ textAlign: "right" }}>{t.col.weight}</th>
                    <th style={{ textAlign: "right" }}>{t.col.achieved}</th>
                    <th style={{ textAlign: "right" }}>{t.col.points}</th>
                  </tr>
                </thead>
                <tbody>
                  {t.metrics.map((m) => {
                    const weight = WEIGHT_OF[m.key] ?? 0;
                    const v = stat.indexParts[m.key];
                    return (
                      <tr key={m.key}>
                        <td style={{ whiteSpace: "normal" }}>{m.name}</td>
                        <td style={{ textAlign: "right" }}>{pct(weight)}</td>
                        <td style={{ textAlign: "right" }}>{pct(v)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{Math.round(weight * v * 100)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>{t.col.total}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{stat.index}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
