import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  assessResume,
  saveResumeReport,
  getLlmAvailability,
  MODEL_CATALOG,
  ProviderId,
  ResumeAssessment,
  DuplicateInfo,
} from "../lib/resume";
import { friendlyError } from "../lib/errors";
import { extractResumeText, ACCEPTED_RESUME_TYPES } from "../lib/resumeFile";
import AssessmentDetail from "../components/AssessmentDetail";
import Modal from "../components/Modal";

const PROVIDER_ORDER: ProviderId[] = ["ollama", "openai"];

export default function ResumeParsing() {
  const navigate = useNavigate();
  const [resumeText, setResumeText] = useState("");
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResumeAssessment | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Model selection.
  const [provider, setProvider] = useState<ProviderId>("ollama");
  const [model, setModel] = useState<string>(MODEL_CATALOG.ollama.defaultModel);
  const [availability, setAvailability] = useState<Record<ProviderId, boolean> | null>(null);

  useEffect(() => {
    let active = true;
    getLlmAvailability()
      .then((a) => {
        if (!active) return;
        setAvailability(a);
        if (!a[provider]) {
          const firstAvail = PROVIDER_ORDER.find((p) => a[p]);
          if (firstAvail) {
            setProvider(firstAvail);
            setModel(MODEL_CATALOG[firstAvail].defaultModel);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAvailable = (p: ProviderId) => (availability ? availability[p] : true);

  const onModelChange = (value: string) => {
    const [p, m] = value.split("::") as [ProviderId, string];
    setProvider(p);
    setModel(m);
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    setExtracting(true);
    try {
      const text = await extractResumeText(f);
      setResumeText(text);
      setFileName(f.name);
    } catch (err: unknown) {
      setFileName(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const doSave = async (assessment: ResumeAssessment) => {
    try {
      const id = await saveResumeReport(assessment, provider, model, jd);
      setSavedId(id);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const run = async () => {
    setError(null);
    setResult(null);
    setSavedId(null);
    setDuplicate(null);
    if (resumeText.trim().length < 30) {
      setError("Please add the resume — paste the text or upload a .txt / .docx file.");
      return;
    }
    if (jd.trim().length < 20) {
      setError("Please paste the job description.");
      return;
    }
    setBusy(true);
    try {
      const { assessment, duplicate } = await assessResume(resumeText, jd, provider, model);
      setResult(assessment);
      if (duplicate) {
        // Flag first — ask the user what to do before saving.
        setDuplicate(duplicate);
      } else {
        await doSave(assessment);
      }
    } catch (err: unknown) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Resume Parsing</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Paste the resume text or upload a <strong>.txt</strong> or <strong>.docx</strong> file, add a
        job description, and get a fit assessment.
      </p>

      <div className="card">
        <div className="row">
          <div className="field">
            <label>Candidate resume (text or .docx)</label>
            <textarea
              value={resumeText}
              onChange={(e) => {
                setResumeText(e.target.value);
                setFileName(null);
              }}
              placeholder="Paste the resume text here, or upload a .txt / .docx file below…"
              style={{ minHeight: 240 }}
            />
            <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={extracting}>
                {extracting ? <span className="spinner dark" /> : "📎"} Upload .txt or .docx
              </button>
              {fileName && (
                <span className="muted" style={{ fontSize: "0.82rem" }}>
                  Loaded: {fileName}
                </span>
              )}
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_RESUME_TYPES}
                style={{ display: "none" }}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <div className="field">
            <label>Job description</label>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the job description here…"
              style={{ minHeight: 240 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0, maxWidth: 320, flex: "1 1 240px" }}>
            <label htmlFor="model">Model</label>
            <select id="model" value={`${provider}::${model}`} onChange={(e) => onModelChange(e.target.value)}>
              {PROVIDER_ORDER.map((pid) => {
                const entry = MODEL_CATALOG[pid];
                const avail = isAvailable(pid);
                return (
                  <optgroup key={pid} label={avail ? entry.label : `${entry.label} — no API key`}>
                    {entry.models.map((m) => (
                      <option key={m.id} value={`${pid}::${m.id}`} disabled={!avail}>
                        {m.label}
                        {avail ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
          <button className="btn" onClick={run} disabled={busy || !isAvailable(provider)}>
            {busy ? <span className="spinner" /> : "🔍"} Assess fit
          </button>
        </div>
        {availability && !isAvailable("openai") && (
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem", marginBottom: 0 }}>
            OpenAI models are greyed out because no OpenAI API key is configured. Add the
            <span className="mono"> OPENAI_API_KEY</span> secret to enable them.
          </p>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            <h2 style={{ marginBottom: 0 }}>{result.candidateName || "Candidate"}</h2>
            {savedId ? (
              <span className="pill green">✓ Saved to Resume Reports</span>
            ) : duplicate ? (
              <button className="btn secondary" onClick={() => setDuplicate({ ...duplicate })}>
                Duplicate found — choose an action
              </button>
            ) : (
              <button className="btn secondary" onClick={() => doSave(result)}>
                Save to reports
              </button>
            )}
          </div>
          <div style={{ marginTop: "1rem" }}>
            <AssessmentDetail a={result} />
          </div>
        </div>
      )}

      {/* Duplicate prompt */}
      <Modal
        open={!!duplicate}
        onClose={() => setDuplicate(null)}
        title="Possible duplicate candidate"
        footer={
          <>
            <button className="btn ghost" onClick={() => setDuplicate(null)}>
              Don&#39;t save
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                const id = duplicate?.id;
                setDuplicate(null);
                navigate(`/resume-reports${id ? `?open=${id}` : ""}`);
              }}
            >
              View existing
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (result) await doSave(result);
                setDuplicate(null);
              }}
            >
              Save as new anyway
            </button>
          </>
        }
      >
        {duplicate && (
          <div>
            <p>
              A candidate with the same <strong>{duplicate.matchedOn}</strong> already has a report:
            </p>
            <div className="card" style={{ background: "var(--brand-light)", marginBottom: 0 }}>
              <div style={{ fontWeight: 700 }}>{duplicate.candidateName || "Unknown"}</div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                {duplicate.email && <div>Email: {duplicate.email}</div>}
                {duplicate.phone && <div>Phone: {duplicate.phone}</div>}
                {duplicate.createdAt && <div>Assessed: {new Date(duplicate.createdAt).toLocaleString()}</div>}
              </div>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.75rem", marginBottom: 0 }}>
              The new assessment is shown behind this dialog but has <strong>not</strong> been saved yet.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
