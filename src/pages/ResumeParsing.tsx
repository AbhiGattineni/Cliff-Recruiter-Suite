import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assessResume,
  saveResumeReport,
  getLlmAvailability,
  getLlmUsageSummary,
  MODEL_CATALOG,
  ProviderId,
  ResumeAssessment,
  DuplicateInfo,
  TokenUsage,
  ReportExtras,
} from "../lib/resume";
import { extractProfileLinks, normalizeGithubUrl, normalizeLinkedinUrl } from "../lib/links";
import { countResumeLines } from "../lib/resumeLines";
import {
  searchGithubUsers,
  assessGithubPortfolio,
  updateResumeReport,
  GithubProfile,
  PortfolioResult,
} from "../lib/github";
import { friendlyError } from "../lib/errors";
import { extractResumeText, ACCEPTED_RESUME_TYPES } from "../lib/resumeFile";
import { LinkedinCheck as StoredLinkedinCheck } from "../lib/linkedin";
import { verdictClass } from "../lib/linkedinScore";
import AssessmentDetail from "../components/AssessmentDetail";
import PortfolioDetail from "../components/PortfolioDetail";
import LinkedinCheck from "../components/LinkedinCheck";
import Section from "../components/Section";
import VerdictBand, { toneForScore } from "../components/VerdictBand";
import MissingLinksNote from "../components/MissingLinksNote";
import Modal from "../components/Modal";

const PROVIDER_ORDER: ProviderId[] = ["ollama", "openai"];

const fmtCost = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const fmtNum = (n: number) => n.toLocaleString();

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
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedIdRef = useRef<string | null>(null);

  // Profile links + GitHub portfolio.
  const [githubUrl, setGithubUrl] = useState(""); // the link the portfolio was assessed against
  const [ghInput, setGhInput] = useState(""); // editable field (overwrite is applied on demand)
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [liInput, setLiInput] = useState("");
  const [pf, setPf] = useState<PortfolioResult | null>(null);
  const [pfBusy, setPfBusy] = useState(false);
  const [pfError, setPfError] = useState<string | null>(null);
  const [ghModalOpen, setGhModalOpen] = useState(false);
  const [ghSearching, setGhSearching] = useState(false);
  const [ghMatches, setGhMatches] = useState<GithubProfile[] | null>(null);
  const [ghManual, setGhManual] = useState("");
  const [liManual, setLiManual] = useState("");
  // Set when the recruiter explicitly skips a link they were asked for, so the
  // report can say it was never supplied rather than silently showing nothing.
  const [missingLinks, setMissingLinks] = useState<{ github: boolean; linkedin: boolean } | null>(null);
  const [liCheck, setLiCheck] = useState<StoredLinkedinCheck | null>(null);
  const liSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const qc = useQueryClient();
  const summaryQ = useQuery({ queryKey: ["llmUsageSummary"], queryFn: () => getLlmUsageSummary() });
  const summary = summaryQ.data ?? null;

  // Model selection.
  const [provider, setProvider] = useState<ProviderId>("ollama");
  const [model, setModel] = useState<string>(MODEL_CATALOG.ollama.defaultModel);
  const availabilityQ = useQuery({ queryKey: ["llmAvailability"], queryFn: () => getLlmAvailability() });
  const availability = availabilityQ.data ?? null;

  // Auto-pick the first configured provider once availability loads.
  useEffect(() => {
    if (availability && !availability[provider]) {
      const firstAvail = PROVIDER_ORDER.find((p) => availability[p]);
      if (firstAvail) {
        setProvider(firstAvail);
        setModel(MODEL_CATALOG[firstAvail].defaultModel);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);

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

  const doSave = async (assessment: ResumeAssessment, u: TokenUsage | null, extras?: ReportExtras) => {
    try {
      const id = await saveResumeReport(assessment, provider, model, jd, u, extras);
      setSavedId(id);
      savedIdRef.current = id;
      // Refresh anything that reflects the new report.
      qc.invalidateQueries({ queryKey: ["llmUsageSummary"] });
      qc.invalidateQueries({ queryKey: ["resumeReports"] });
      qc.invalidateQueries({ queryKey: ["dashboardStats"] });
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  /** Fetch + assess the GitHub portfolio for a profile URL, then persist it. */
  const runPortfolio = async (gh: string) => {
    setPfBusy(true);
    setPfError(null);
    setPf(null);
    setGithubUrl(gh);
    setGhInput(gh);
    try {
      const r = await assessGithubPortfolio(gh, jd, provider, model);
      setPf(r);
      if (savedIdRef.current) {
        await updateResumeReport(savedIdRef.current, {
          githubUrl: gh,
          portfolio: r.portfolio,
          githubProfile: r.profile,
        });
        qc.invalidateQueries({ queryKey: ["resumeReports"] });
      }
      qc.invalidateQueries({ queryKey: ["llmUsageSummary"] });
    } catch (err) {
      setPfError(friendlyError(err));
    } finally {
      setPfBusy(false);
    }
  };

  /**
   * Ask the recruiter for the profile links the resume didn't carry. When
   * GitHub is missing we also search for likely profiles so they can confirm
   * one rather than hunt for it.
   */
  const askForLinks = async (assessment: ResumeAssessment, needGithub: boolean) => {
    setGhModalOpen(true);
    setGhManual("");
    setLiManual("");
    if (!needGithub) return;
    setGhSearching(true);
    setGhMatches(null);
    try {
      const matches = await searchGithubUsers(
        assessment.candidateName ?? "",
        String(assessment.extracted?.email ?? "")
      );
      setGhMatches(matches);
    } catch {
      setGhMatches([]);
    } finally {
      setGhSearching(false);
    }
  };

  /** Persist which links the recruiter left blank. */
  const recordMissing = (flags: { github: boolean; linkedin: boolean }) => {
    setMissingLinks(flags);
    if (savedIdRef.current) {
      updateResumeReport(savedIdRef.current, { missingLinks: flags })
        .then(() => qc.invalidateQueries({ queryKey: ["resumeReports"] }))
        .catch(() => { /* non-fatal — the flag is still shown on screen */ });
    }
  };

  /** "Save & continue" — take whatever was typed, then flag what's still absent. */
  const submitLinks = () => {
    const gh = normalizeGithubUrl(ghManual) || githubUrl;
    const li = normalizeLinkedinUrl(liManual) || liManual.trim() || linkedinUrl;
    if (li) { setLinkedinUrl(li); setLiInput(li); }
    setGhModalOpen(false);
    recordMissing({ github: !gh, linkedin: !li });
    if (gh && gh !== githubUrl) void runPortfolio(gh);
    else if (gh) { setGithubUrl(gh); setGhInput(gh); }
    if (savedIdRef.current) {
      updateResumeReport(savedIdRef.current, { githubUrl: gh, linkedinUrl: li }).catch(() => {});
    }
  };

  /** Recruiter confirmed a profile (from search or pasted) — attach + assess. */
  const useGithub = (input: string) => {
    const url = normalizeGithubUrl(input);
    if (!url) {
      setPfError("That doesn't look like a GitHub profile URL or username.");
      return;
    }
    setGhModalOpen(false);
    void runPortfolio(url);
  };

  /** LinkedIn check edits are frequent (typing) — debounce the persist. */
  const onLinkedinCheck = (check: StoredLinkedinCheck) => {
    setLiCheck(check);
    if (liSaveTimer.current) clearTimeout(liSaveTimer.current);
    liSaveTimer.current = setTimeout(() => {
      if (!savedIdRef.current) return;
      updateResumeReport(savedIdRef.current, { linkedinCheck: check })
        .then(() => qc.invalidateQueries({ queryKey: ["resumeReports"] }))
        .catch(() => {
          /* transient — the check is still in page state and saves on the next edit */
        });
    }, 1200);
  };

  useEffect(() => () => {
    if (liSaveTimer.current) clearTimeout(liSaveTimer.current);
  }, []);

  const saveLinkedin = async () => {
    const url = normalizeLinkedinUrl(liInput) || liInput.trim();
    setLinkedinUrl(url);
    setLiInput(url);
    if (savedIdRef.current) {
      try {
        await updateResumeReport(savedIdRef.current, { linkedinUrl: url });
        qc.invalidateQueries({ queryKey: ["resumeReports"] });
      } catch (err) {
        setError(friendlyError(err));
      }
    }
  };

  const run = async () => {
    setError(null);
    setResult(null);
    setSavedId(null);
    savedIdRef.current = null;
    setDuplicate(null);
    setUsage(null);
    setPf(null);
    setPfError(null);
    setPfBusy(false);
    setGithubUrl("");
    setGhInput("");
    setLinkedinUrl("");
    setLiInput("");
    setLiCheck(null);
    setGhMatches(null);
    setGhModalOpen(false);
    setMissingLinks(null);
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
      const { assessment, usage, duplicate } = await assessResume(resumeText, jd, provider, model);
      // Count the scoreable lines now, while we still have the resume text —
      // it gives the AI signal a real denominator instead of the model's guess.
      const lines = countResumeLines(resumeText);
      setTotalLines(lines);
      setResult({ ...assessment, totalLines: lines });
      setUsage(usage);

      // Profile links: regex over the raw text first (verbatim), LLM extraction as fallback.
      const links = extractProfileLinks(resumeText);
      const gh = links.github || normalizeGithubUrl(assessment.extracted?.githubUrl);
      const li = links.linkedin || normalizeLinkedinUrl(assessment.extracted?.linkedinUrl);
      setGithubUrl(gh);
      setGhInput(gh);
      setLinkedinUrl(li);
      setLiInput(li);

      if (duplicate) {
        // Flag first — ask the user what to do before saving.
        setDuplicate(duplicate);
      } else {
        await doSave({ ...assessment, totalLines: lines }, usage, {
          githubUrl: gh,
          linkedinUrl: li,
          totalLines: lines,
        });
      }

      if (gh) void runPortfolio(gh); // assess in the background while the fit result is shown
      // Ask for whatever the resume didn't carry. GitHub also gets a profile
      // search so the recruiter confirms a match rather than hunting for one.
      if (!gh || !li) void askForLinks(assessment, !gh);
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
        job description, and get a fit assessment — including the candidate&#39;s GitHub portfolio.
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

      {summary && summary.count > 0 && (
        <div className="card">
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>LLM usage to date</strong>
            <span className="muted">{fmtNum(summary.count)} resumes assessed</span>
            <span className="muted">{fmtNum(summary.totalTokens)} tokens used</span>
            <span className="muted">Est. cost {fmtCost(summary.totalCost)}</span>
            {summary.balance != null ? (
              <span className="muted">
                Balance <strong>{fmtCost(summary.balance)}</strong> of {fmtCost(summary.budget)} budget
              </span>
            ) : (
              <span className="muted" style={{ fontStyle: "italic" }}>
                Provider credit balance isn&#39;t exposed via API — set an LLM_BUDGET_USD to track a balance.
              </span>
            )}
          </div>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {result && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <h2 style={{ marginBottom: 0 }}>{result.candidateName || "Candidate"}</h2>
              <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
                {[
                  result.extracted?.currentTitle,
                  result.extracted?.totalExperienceYears != null
                    ? `${result.extracted.totalExperienceYears} yrs`
                    : null,
                  result.extracted?.location,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {savedId ? (
              <span className="pill green">✓ Saved to Resume Reports</span>
            ) : duplicate ? (
              <button className="btn secondary" onClick={() => setDuplicate({ ...duplicate })}>
                Duplicate found — choose an action
              </button>
            ) : (
              <button
                className="btn secondary"
                onClick={() =>
                  doSave(result, usage, {
                    githubUrl,
                    linkedinUrl,
                    portfolio: pf?.portfolio,
                    githubProfile: pf?.profile,
                    linkedinCheck: liCheck,
                    missingLinks,
                    totalLines: totalLines ?? undefined,
                  })
                }
              >
                Save to reports
              </button>
            )}
          </div>
          {usage && (
            <div
              style={{
                marginTop: "0.75rem", padding: "0.6rem 0.8rem", background: "var(--brand-light)",
                borderRadius: 8, fontSize: "0.85rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "baseline",
              }}
            >
              <strong>This resume</strong>
              <span className="muted">
                Tokens: {fmtNum(usage.promptTokens)} in + {fmtNum(usage.completionTokens)} out ={" "}
                <strong>{fmtNum(usage.totalTokens)}</strong>
              </span>
              <span className="muted">
                {usage.priced ? `Est. cost ${fmtCost(usage.cost)}` : "Cost not priced for this model"}
              </span>
              <span className="muted">{provider} / {model}</span>
            </div>
          )}
          {/* ---- Profile links — kept at the top, with the candidate's identity ---- */}
          <div className="row" style={{ marginTop: "1rem" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>
                GitHub profile{" "}
                {pfBusy ? (
                  <span className="spinner dark" style={{ verticalAlign: "middle" }} />
                ) : pf ? (
                  <span
                    className={`pill ${
                      pf.portfolio.rating === "Strong" ? "green" : pf.portfolio.rating === "Weak" ? "red" : "amber"
                    }`}
                  >
                    {pf.portfolio.portfolioScore}/100 · {pf.portfolio.rating}
                  </span>
                ) : null}
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  value={ghInput}
                  onChange={(e) => setGhInput(e.target.value)}
                  placeholder="https://github.com/username"
                  style={{ flex: 1 }}
                />
                {ghInput.trim() && normalizeGithubUrl(ghInput) !== githubUrl ? (
                  <button className="btn secondary" onClick={() => useGithub(ghInput)} disabled={pfBusy}>
                    {githubUrl ? "Overwrite & re-assess" : "Assess portfolio"}
                  </button>
                ) : githubUrl ? (
                  <button className="btn ghost" onClick={() => runPortfolio(githubUrl)} disabled={pfBusy}>
                    ⟳ Re-assess
                  </button>
                ) : (
                  <button className="btn secondary" onClick={() => askForLinks(result, true)} disabled={pfBusy}>
                    🔎 Find on GitHub
                  </button>
                )}
              </div>
              {githubUrl && (
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="muted"
                  style={{ fontSize: "0.78rem" }}
                >
                  Open profile ↗
                </a>
              )}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>
                LinkedIn profile{" "}
                {liCheck?.assessment && liCheck.assessment.known > 0 && (
                  <span className={`pill ${verdictClass(liCheck.assessment.verdict)}`}>
                    {liCheck.assessment.verdict}
                  </span>
                )}
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  value={liInput}
                  onChange={(e) => setLiInput(e.target.value)}
                  placeholder="https://linkedin.com/in/username"
                  style={{ flex: 1 }}
                />
                {liInput.trim() !== linkedinUrl && (
                  <button className="btn secondary" onClick={saveLinkedin}>
                    Save link
                  </button>
                )}
                {linkedinUrl && liInput.trim() === linkedinUrl && (
                  <a className="btn ghost" href={linkedinUrl} target="_blank" rel="noreferrer">
                    Open ↗
                  </a>
                )}
              </div>
              {!linkedinUrl && (
                <p className="muted" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0" }}>
                  No LinkedIn found on the resume — ask the candidate and paste it here.
                </p>
              )}
            </div>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>
            GitHub is assessed automatically; LinkedIn is stored as a link and checked against the signals you
            enter (it has no public API for profile data). Full detail for both is below the fit assessment.
          </p>

          <div style={{ marginTop: "0.9rem" }}>
            <MissingLinksNote missing={missingLinks} />
          </div>

          {/* ---- Headline verdicts ---- */}
          <div style={{ marginTop: "1rem" }}>
            <VerdictBand
              verdicts={[
                {
                  label: "Resume fit",
                  score: Number(result.fitScore) || 0,
                  note: result.rating,
                  tone: result.rating === "Strong" ? "green" : result.rating === "Weak" ? "red" : "amber",
                },
                {
                  label: "GitHub portfolio",
                  score: pf ? pf.portfolio.portfolioScore : null,
                  note: pfBusy
                    ? "Assessing…"
                    : pf
                      ? `${pf.portfolio.rating} · ${pf.portfolio.activityLevel.toLowerCase()}`
                      : githubUrl ? "Not assessed" : "No profile",
                  tone: pf ? toneForScore(pf.portfolio.portfolioScore) : "grey",
                },
                {
                  label: "LinkedIn",
                  score: liCheck?.assessment && liCheck.assessment.known > 0 ? liCheck.assessment.score : null,
                  note:
                    liCheck?.assessment && liCheck.assessment.known > 0
                      ? liCheck.assessment.verdict
                      : linkedinUrl ? "Not checked" : "No profile",
                  tone:
                    liCheck?.assessment && liCheck.assessment.known > 0
                      ? (verdictClass(liCheck.assessment.verdict) as "green" | "amber" | "red" | "grey")
                      : "grey",
                },
              ]}
            />
          </div>

          <div style={{ marginTop: "1rem" }}>
            <AssessmentDetail a={result} />

            {/* ---- GitHub portfolio assessment ---- */}
            <Section
              title="GitHub portfolio vs JD"
              icon="💻"
              index={3}
              defaultOpen
              summary={
                pfBusy ? (
                  <span className="pill grey">Assessing…</span>
                ) : pf ? (
                  <span className={`pill ${toneForScore(pf.portfolio.portfolioScore)}`}>
                    {pf.portfolio.relevantRepos.length} relevant repos
                  </span>
                ) : (
                  <span className="pill grey">None</span>
                )
              }
            >
              {pfBusy ? (
                <div>
                  <p className="muted" style={{ marginTop: 0, fontSize: "0.88rem" }}>
                    Fetching repositories and assessing them against the job description…
                  </p>
                  <div className="skel" style={{ width: "92%" }} />
                  <div className="skel" style={{ width: "78%" }} />
                  <div className="skel" style={{ width: "85%" }} />
                  <div className="skel" style={{ width: "60%", marginBottom: 0 }} />
                </div>
              ) : pfError ? (
                <div className="alert error" style={{ marginBottom: 0 }}>
                  {pfError}{" "}
                  {githubUrl && (
                    <button className="btn ghost" style={{ marginLeft: "0.5rem" }} onClick={() => runPortfolio(githubUrl)}>
                      Retry
                    </button>
                  )}
                </div>
              ) : pf ? (
                <PortfolioDetail portfolio={pf.portfolio} profile={pf.profile} githubUrl={githubUrl} />
              ) : (
                <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
                  No GitHub profile attached yet — use <strong>Find on GitHub</strong> or paste a profile URL above.
                </p>
              )}
            </Section>

            {/* ---- LinkedIn credibility check ---- */}
            <Section
              title="LinkedIn profile check"
              icon="🔗"
              index={4}
              summary={
                liCheck?.assessment && liCheck.assessment.known > 0 ? (
                  <span className={`pill ${verdictClass(liCheck.assessment.verdict)}`}>
                    {liCheck.assessment.verdict}
                  </span>
                ) : (
                  <span className="pill grey">{linkedinUrl ? "Not checked" : "No profile"}</span>
                )
              }
            >
              {linkedinUrl ? (
                <LinkedinCheck
                  key={linkedinUrl}
                  profileUrl={linkedinUrl}
                  resumeYears={Number(result.extracted?.totalExperienceYears) || null}
                  initial={liCheck}
                  onChange={onLinkedinCheck}
                />
              ) : (
                <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
                  Add a LinkedIn URL above to run the credibility check (account age, connections,
                  recommendations, work history). A profile created in the last few months with none of these
                  is flagged <strong>High risk</strong>.
                </p>
              )}
            </Section>
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
                if (result) {
                  await doSave(result, usage, {
                    githubUrl,
                    linkedinUrl,
                    portfolio: pf?.portfolio,
                    githubProfile: pf?.profile,
                    linkedinCheck: liCheck,
                    missingLinks,
                    totalLines: totalLines ?? undefined,
                  });
                }
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

      {/* Ask for the profile links the resume didn't carry */}
      <Modal
        wide
        open={ghModalOpen}
        onClose={() => setGhModalOpen(false)}
        title="Add the candidate's profile links"
        footer={
          <>
            <button
              className="btn ghost"
              onClick={() => {
                setGhModalOpen(false);
                recordMissing({ github: !githubUrl, linkedin: !linkedinUrl });
              }}
            >
              Not provided — continue
            </button>
            <button className="btn" onClick={submitLinks}>
              Save &amp; continue
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          The resume didn&#39;t include{" "}
          <strong>
            {!githubUrl && !linkedinUrl ? "a GitHub or LinkedIn link" : !githubUrl ? "a GitHub link" : "a LinkedIn link"}
          </strong>
          . Add {!githubUrl && !linkedinUrl ? "them" : "it"} below if you have {!githubUrl && !linkedinUrl ? "them" : "it"} —
          otherwise choose <em>Not provided</em> and the report will record that {!githubUrl && !linkedinUrl ? "they were" : "it was"} never
          supplied.
        </p>

        {!linkedinUrl && (
          <div className="field">
            <label>LinkedIn profile</label>
            <input
              value={liManual}
              onChange={(e) => setLiManual(e.target.value)}
              placeholder="https://linkedin.com/in/username"
            />
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Stored as a link for your own review, and used for the credibility check.
            </span>
          </div>
        )}

        {!githubUrl && (
        <>
        <p style={{ marginBottom: "0.4rem", fontWeight: 600 }}>GitHub profile</p>
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          {ghSearching
            ? "Searching GitHub for likely profiles…"
            : ghMatches && ghMatches.length > 0
              ? "Pick the right profile below, or paste one — a wrong match would assess someone else's code."
              : "No likely matches were found — paste the profile URL if you have it."}
        </p>
        {ghSearching && (
          <p className="muted" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="spinner dark" /> Searching…
          </p>
        )}
        {!ghSearching &&
          (ghMatches ?? []).map((m2) => (
            <div
              key={m2.login}
              style={{
                display: "flex", gap: "0.75rem", alignItems: "center",
                padding: "0.55rem 0", borderBottom: "1px solid var(--brand-light)",
              }}
            >
              {m2.avatarUrl && (
                <img src={m2.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: "50%", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <strong>{m2.name || m2.login}</strong>{" "}
                  <a href={m2.url} target="_blank" rel="noreferrer">@{m2.login} ↗</a>
                </div>
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  {[m2.bio, m2.location, `${m2.publicRepos} repos`, `${m2.followers} followers`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button className="btn secondary" onClick={() => useGithub(m2.url)}>
                Use this profile
              </button>
            </div>
          ))}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
          <input
            value={ghManual}
            onChange={(e) => setGhManual(e.target.value)}
            placeholder="Paste GitHub URL or username…"
            style={{ flex: 1 }}
          />
          <button className="btn secondary" onClick={() => useGithub(ghManual)} disabled={!ghManual.trim()}>
            Use this URL
          </button>
        </div>
        </>
        )}
      </Modal>
    </div>
  );
}
