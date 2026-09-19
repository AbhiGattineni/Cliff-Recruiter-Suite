// Where the digest's email account is connected.
//
// Sits above the digest settings because it is the prerequisite: a recipient
// list with no way to send is a list that does nothing. The card says what it
// needs and in what shape, because EmailJS's own dashboard gives no hint that
// a server-side caller needs the private key and the non-browser switch, and
// both are silent failures until something tries to send.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { errorDetail } from "../lib/errors";
import {
  getEmailJsSettings,
  saveEmailJsSettings,
  emailJsConfigured,
  EmailJsSettings as Settings,
  EMPTY_EMAILJS,
} from "../lib/emailjsSettings";

const FIELDS: Array<{
  key: keyof Settings;
  label: string;
  hint: string;
  placeholder: string;
  secret?: boolean;
}> = [
  {
    key: "serviceId",
    label: "Service ID",
    hint: "EmailJS → Email Services, under the service name.",
    placeholder: "service_xxxxxxx",
  },
  {
    key: "templateId",
    label: "Template ID",
    hint: "EmailJS → Email Templates. The template must send to {{to_email}}.",
    placeholder: "template_xxxxxxx",
  },
  {
    key: "publicKey",
    label: "Public key",
    hint: "EmailJS → Account → General.",
    placeholder: "Your public key",
  },
  {
    key: "privateKey",
    label: "Private key",
    hint: "EmailJS → Account → General. Required because the sender is a server, not a browser.",
    placeholder: "Your private key",
    secret: true,
  },
];

export default function EmailJsSettings() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ["emailjsSettings"], queryFn: getEmailJsSettings });

  const [form, setForm] = useState<Settings>(EMPTY_EMAILJS);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Seed once the stored value lands, and not on every render after — a form
  // that resets itself mid-edit is how a half-typed key gets saved.
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  const set = (key: keyof Settings, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveEmailJsSettings(form);
      await q.refetch();
      setNotice("Saved. Use “Send me yesterday's digest now” below to try it.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (profile?.role !== "admin") return null;

  const stored = q.data ?? EMPTY_EMAILJS;
  const connected = emailJsConfigured(stored);
  const dirty = (Object.keys(form) as (keyof Settings)[]).some((k) => form[k] !== stored[k]);

  return (
    <div className="card">
      <h2>✉️ Email sending (EmailJS)</h2>
      <div className="sub">
        The account the meeting digest sends through. Changes take effect on the next send — there
        is no deploy to wait for.
      </div>

      {error != null && <ErrorBlock err={error} />}
      {notice && <div className="alert success">{notice}</div>}

      <div className="btn-row" style={{ marginBottom: "0.9rem" }}>
        <span className={`chip ${connected ? "matched" : ""}`}>
          {connected ? "Connected" : "Not connected"}
        </span>
        {!connected && (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            All four values are needed before anything can be sent.
          </span>
        )}
      </div>

      {FIELDS.map((f) => (
        <div key={f.key} style={{ marginBottom: "0.75rem" }}>
          <label htmlFor={`emailjs-${f.key}`}>{f.label}</label>
          <input
            id={`emailjs-${f.key}`}
            type={f.secret && !reveal ? "password" : "text"}
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={form[f.key]}
            placeholder={f.placeholder}
            disabled={busy || q.isLoading}
            onChange={(e) => set(f.key, e.target.value)}
          />
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.15rem" }}>
            {f.hint}
          </div>
        </div>
      ))}

      <label className="btn-row" style={{ gap: "0.4rem", marginBottom: "0.9rem", cursor: "pointer" }}>
        <input type="checkbox" checked={reveal} onChange={() => setReveal((v) => !v)} />
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Show the private key
        </span>
      </label>

      <button className="btn" onClick={save} disabled={busy || !dirty}>
        {busy ? <span className="spinner dark" /> : null} Save
      </button>

      <details style={{ marginTop: "1rem" }}>
        <summary className="muted" style={{ fontSize: "0.85rem", cursor: "pointer" }}>
          Setting this up in EmailJS
        </summary>
        <ol className="muted" style={{ fontSize: "0.82rem", lineHeight: 1.6, paddingLeft: "1.1rem" }}>
          <li>
            <strong>Account → Security:</strong> turn on{" "}
            <em>Allow EmailJS API for non-browser applications</em>. Without it every send is
            refused, because this one comes from a scheduled job rather than a browser.
          </li>
          <li>
            <strong>Email Templates → Create:</strong> set <span className="mono">To Email</span> to{" "}
            <span className="mono">{"{{to_email}}"}</span> and <span className="mono">Subject</span>{" "}
            to <span className="mono">{"{{subject}}"}</span>.
          </li>
          <li>
            In the template body, switch to the code/HTML view and put{" "}
            <span className="mono">{"{{{message_html}}}"}</span> — three braces, which is what tells
            EmailJS to insert it as HTML rather than escaping the tags. A plain-text{" "}
            <span className="mono">{"{{message}}"}</span> also works if you prefer it.
          </li>
          <li>Copy the four values above out of the dashboard and save.</li>
        </ol>
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          The digest sends one request per recipient, twice a day — roughly 60 requests a month for
          one recipient, 120 for two. Worth checking against your EmailJS plan&#39;s monthly
          allowance before adding a long recipient list.
        </p>
      </details>
    </div>
  );
}

function ErrorBlock({ err }: { err: unknown }) {
  const d = errorDetail(err);
  return (
    <div className="alert error">
      <div>{d.message}</div>
      {(d.code || d.raw) && (
        <details className="err-detail">
          <summary>Technical details</summary>
          {d.code && (
            <div>
              <span className="mono">{d.code}</span>
            </div>
          )}
          {d.raw && <pre className="mono">{d.raw}</pre>}
        </details>
      )}
    </div>
  );
}
