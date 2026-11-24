// Diagnostic tab for the Ceipal Custom Reports API.
//
// The Ceipal call runs inside the Cloud Function, never in the browser, so the
// credentials stay server-side. What comes back is Ceipal's own status code and
// error text rather than a swallowed "request failed", because the useful part
// of a 403 here is which leg failed: the token mint, or the report read.

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

interface Diagnosis {
  authOk: boolean;
  authStatus: number;
  tokenField: string | null;
  tokenPrefix: string | null;
  reportStatus: number | null;
  reportBody: string | null;
  recordCount: number | null;
  rowsReturned: number | null;
  error: string | null;
}

const PRESETS: { label: string; url: string }[] = [
  {
    label: "Applicant Details (new)",
    url: "https://atsbi.ceipal.com/api/report-details/get-report-data/tG4cJi83OfpS86NcNP06s-NmkyVqrN0q9JyLZN4tYhk?response_type=1",
  },
  {
    label: "Submissions (known working)",
    url: "https://atsbi.ceipal.com/api/report-details/get-report-data/0_NbuPU5KbRzHtd6lrlnIR3w2uHRuz_sCkm0EWi1T_s?response_type=1",
  },
];

/** Plain-language reading of the result, so the next step is obvious. */
function verdict(d: Diagnosis): { tone: "green" | "amber" | "red"; title: string; detail: string } {
  if (!d.authOk) {
    return {
      tone: "red",
      title: "Authentication failed",
      detail:
        "The token could not be minted, so the email, password or apiKey in the function's config is wrong. " +
        "This is not a problem with the report.",
    };
  }
  if (d.reportStatus === 200 && (d.rowsReturned ?? 0) > 0) {
    return {
      tone: "green",
      title: "Working",
      detail: `Token minted and the report returned data. Ceipal reports ${d.recordCount ?? 0} rows available.`,
    };
  }
  if (d.reportStatus === 200) {
    return {
      tone: "amber",
      title: "Reachable but empty",
      detail:
        "The token worked and the report responded, but no rows came back. Either the report genuinely has " +
        "no data, or it is not sharing rows with this API user.",
    };
  }
  if (d.reportStatus === 403) {
    return {
      tone: "red",
      title: "Token is valid, the report is refusing it",
      detail:
        "Authentication succeeded, so the credentials are fine. A 403 on the report means this report is not " +
        "shared with the API user in Ceipal. Fix it in Ceipal's report settings, not in code.",
    };
  }
  if (d.reportStatus === 404) {
    return {
      tone: "red",
      title: "Report not found",
      detail: "The report id in the URL is wrong, or the report was deleted in Ceipal.",
    };
  }
  return {
    tone: "red",
    title: `Report returned ${d.reportStatus}`,
    detail: "See the raw response below for Ceipal's own message.",
  };
}

export default function CeipalApiTest() {
  const [url, setUrl] = useState(PRESETS[0].url);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setFailure(null);
    setElapsed(null);
    const started = Date.now();
    try {
      const callable = httpsCallable<
        { action: string; url: string },
        { ok: boolean; data: Diagnosis }
      >(functions, "ceipalData", { timeout: 120_000 });
      const res = await callable({ action: "diagnose", url: url.trim() });
      setResult(res.data.data);
    } catch (e) {
      setFailure((e as Error).message || "The call failed before reaching Ceipal.");
    } finally {
      setElapsed(Date.now() - started);
      setBusy(false);
    }
  }

  const v = result ? verdict(result) : null;
  const alertClass =
    v?.tone === "green" ? "alert success" : v?.tone === "amber" ? "alert warn" : "alert error";

  return (
    <div>
      <h1>Ceipal API test</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Mints a fresh token, then reads one row from the report. Credentials stay inside the Cloud
        Function. Use this to tell an authentication problem apart from a report-sharing problem.
      </p>

      <div className="card">
        <div className="btn-row" style={{ marginBottom: "0.9rem" }}>
          {PRESETS.map((p) => (
            <button
              key={p.url}
              type="button"
              className={url === p.url ? "btn secondary" : "btn ghost"}
              onClick={() => setUrl(p.url)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="ceipal-url">Report URL</label>
          <textarea
            id="ceipal-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            rows={3}
            spellCheck={false}
            className="mono"
            style={{ width: "100%", fontSize: "0.82rem" }}
          />
        </div>

        <div className="btn-row">
          <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
            {busy ? "Testing…" : "Run test"}
          </button>
          {busy && <span className="muted">Ceipal can take up to 40 seconds to answer.</span>}
        </div>
      </div>

      {failure && (
        <div className="alert error">
          <strong>The function call itself failed.</strong> {failure}
          <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", opacity: 0.85 }}>
            This is the browser not reaching the Cloud Function, so it says nothing about Ceipal.
            Check that <span className="mono">ceipalData</span> is deployed and that
            <span className="mono"> VITE_FUNCTIONS_REGION</span> matches where it lives.
          </div>
        </div>
      )}

      {result && v && (
        <>
          <div className={alertClass}>
            <strong>{v.title}.</strong> {v.detail}
          </div>

          <div className="card">
            <h2>What happened</h2>
            <div className="row">
              <div>
                <p className="muted" style={{ marginBottom: "0.4rem" }}>
                  Step 1, mint token
                </p>
                <table className="mono" style={{ fontSize: "0.82rem" }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>HTTP</td>
                      <td>{result.authStatus || "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>Token field</td>
                      <td>{result.tokenField ?? "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>Token starts</td>
                      <td>{result.tokenPrefix ? `${result.tokenPrefix}…` : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <p className="muted" style={{ marginBottom: "0.4rem" }}>
                  Step 2, read report
                </p>
                <table className="mono" style={{ fontSize: "0.82rem" }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>HTTP</td>
                      <td>{result.reportStatus ?? "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>Rows returned</td>
                      <td>{result.rowsReturned ?? "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>Rows available</td>
                      <td>{result.recordCount ?? "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingRight: "1rem" }}>Round trip</td>
                      <td>{elapsed ? `${(elapsed / 1000).toFixed(1)}s` : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {result.error && (
              <>
                <p className="muted" style={{ margin: "1rem 0 0.3rem" }}>
                  Error
                </p>
                <p className="mono" style={{ fontSize: "0.82rem", wordBreak: "break-word" }}>
                  {result.error}
                </p>
              </>
            )}

            {result.reportBody && (
              <>
                <p className="muted" style={{ margin: "1rem 0 0.3rem" }}>
                  Raw response from Ceipal, first 600 characters
                </p>
                <pre
                  className="mono"
                  style={{
                    fontSize: "0.78rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                  }}
                >
                  {result.reportBody}
                </pre>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
