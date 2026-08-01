import { useState, useEffect, useMemo } from "react";
import { scoreLinkedin, verdictClass, LinkedinSignals } from "../lib/linkedinScore";
import { lookupLinkedin, LinkedinCheck as StoredCheck } from "../lib/linkedin";
import { friendlyError } from "../lib/errors";

// Editable credibility check for a candidate's LinkedIn profile.
// The recruiter enters what they can see on the profile (or a configured data
// provider auto-fills it) and the verdict updates live.

const NUM_FIELDS: Array<{ key: keyof LinkedinSignals; label: string; hint: string }> = [
  { key: "accountAgeMonths", label: "Account age (months)", hint: "How long the profile has existed" },
  { key: "connections", label: "Connections", hint: "500+ shows as “500+”" },
  { key: "recommendations", label: "Recommendations received", hint: "From the Recommendations section" },
  { key: "positionsCount", label: "Work history entries", hint: "Number of roles listed" },
  { key: "endorsements", label: "Skill endorsements", hint: "Total across skills" },
];

const BOOL_FIELDS: Array<{ key: keyof LinkedinSignals; label: string }> = [
  { key: "hasPhoto", label: "Has a profile photo" },
  { key: "hasAbout", label: "Headline & About filled in" },
  { key: "recentActivity", label: "Posted/commented in the last 6 months" },
];

/** Read-only rendering of a saved check (Resume Reports modal). */
export function LinkedinVerdict({ check }: { check: StoredCheck }) {
  const a = check.assessment;
  const statusClass = (s: string) => (s === "good" ? "green" : s === "weak" ? "amber" : s === "bad" ? "red" : "grey");
  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        <span className={`pill ${verdictClass(a.verdict)}`}>
          {a.verdict}
          {a.known > 0 ? ` · ${a.score}/100` : ""}
        </span>
        {check.profileUrl && (
          <a href={check.profileUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.85rem" }}>
            Open profile ↗
          </a>
        )}
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {check.source === "provider" ? "auto-filled" : "checked by recruiter"}
          {check.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleDateString()}` : ""}
        </span>
      </div>
      {a.redFlags?.length > 0 && (
        <div className="alert error" style={{ marginBottom: "0.6rem" }}>
          {a.redFlags.map((f, i) => (
            <div key={i}>⚠ {f}</div>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Signal</th><th>Status</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {a.signals.map((s) => (
              <tr key={String(s.key)}>
                <td>{s.label}</td>
                <td><span className={`pill ${statusClass(s.status)}`}>{s.status}</span></td>
                <td className="muted" style={{ whiteSpace: "normal" }}>{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem", marginBottom: 0 }}>{a.note}</p>
    </div>
  );
}

export default function LinkedinCheck({
  profileUrl,
  resumeYears,
  initial,
  onChange,
}: {
  profileUrl: string;
  resumeYears?: number | null;
  initial?: StoredCheck | null;
  onChange?: (check: StoredCheck) => void;
}) {
  const [signals, setSignals] = useState<LinkedinSignals>(initial?.signals ?? {});
  const [source, setSource] = useState<"manual" | "provider">(initial?.source ?? "manual");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assessment = useMemo(() => scoreLinkedin(signals, resumeYears), [signals, resumeYears]);

  // Push the current check upward so the page can persist it.
  useEffect(() => {
    if (!onChange) return;
    onChange({ profileUrl, signals, assessment, source, checkedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, profileUrl, source]);

  const setNum = (key: keyof LinkedinSignals, v: string) => {
    setSignals((s) => ({ ...s, [key]: v === "" ? null : Number(v) }));
    setSource("manual");
  };
  const cycleBool = (key: keyof LinkedinSignals) => {
    // unknown → yes → no → unknown
    setSignals((s) => {
      const cur = s[key];
      const next = cur === null || cur === undefined ? true : cur === true ? false : null;
      return { ...s, [key]: next };
    });
    setSource("manual");
  };

  const autoFill = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await lookupLinkedin(profileUrl);
      if (!r.configured) {
        setNotice(r.message ?? "No LinkedIn data provider is configured — enter the signals manually.");
      } else if (r.signals) {
        setSignals(r.signals);
        setSource("provider");
        setNotice("Signals auto-filled from the configured data provider.");
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const boolLabel = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "Unknown");
  const boolClass = (v: unknown) => (v === true ? "green" : v === false ? "red" : "grey");
  const statusClass = (s: string) => (s === "good" ? "green" : s === "weak" ? "amber" : s === "bad" ? "red" : "grey");

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        <span className={`pill ${verdictClass(assessment.verdict)}`}>
          {assessment.verdict}
          {assessment.known > 0 ? ` · ${assessment.score}/100` : ""}
        </span>
        <a href={profileUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.85rem" }}>
          Open profile ↗
        </a>
        <button className="btn ghost" onClick={autoFill} disabled={busy} style={{ padding: "0.3rem 0.6rem" }}>
          {busy ? <span className="spinner dark" /> : "⤓"} Try auto-fill
        </button>
        {source === "provider" && <span className="pill grey">auto-filled</span>}
      </div>

      {notice && <div className="alert">{notice}</div>}
      {error && <div className="alert error">{error}</div>}

      {assessment.redFlags.length > 0 && (
        <div className="alert error" style={{ marginBottom: "0.75rem" }}>
          {assessment.redFlags.map((f, i) => (
            <div key={i}>⚠ {f}</div>
          ))}
        </div>
      )}

      <div className="row">
        {NUM_FIELDS.map((f) => (
          <div className="field" key={String(f.key)} style={{ marginBottom: "0.6rem", minWidth: 150 }}>
            <label>{f.label}</label>
            <input
              type="number"
              min={0}
              value={signals[f.key] === null || signals[f.key] === undefined ? "" : String(signals[f.key])}
              onChange={(e) => setNum(f.key, e.target.value)}
              placeholder="—"
            />
            <span className="muted" style={{ fontSize: "0.74rem" }}>{f.hint}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.4rem 0 0.9rem" }}>
        {BOOL_FIELDS.map((f) => (
          <button
            key={String(f.key)}
            className="btn ghost"
            onClick={() => cycleBool(f.key)}
            style={{ padding: "0.35rem 0.7rem", fontSize: "0.85rem" }}
          >
            {f.label}: <span className={`pill ${boolClass(signals[f.key])}`}>{boolLabel(signals[f.key])}</span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {assessment.signals.map((s) => (
              <tr key={String(s.key)}>
                <td>{s.label}</td>
                <td>
                  <span className={`pill ${statusClass(s.status)}`}>{s.status}</span>
                </td>
                <td className="muted" style={{ whiteSpace: "normal" }}>{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem", marginBottom: 0 }}>
        {assessment.note} LinkedIn has no public API for third-party profiles, so these are read off the
        profile by a person unless a data provider is configured.
      </p>
    </div>
  );
}
