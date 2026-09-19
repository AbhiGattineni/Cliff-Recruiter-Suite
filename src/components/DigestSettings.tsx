// Admin control for the daily meeting digest.
//
// The digest emails transcript summaries, which are admin/manager-only inside
// the app — an address on this list is a way around that, so the list is
// admin-managed and the page says as much rather than leaving it implied.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { errorDetail } from "../lib/errors";
import {
  getDigestSettings,
  saveDigestSettings,
  sendDigestNow,
  previewDigest,
  looksLikeEmail,
  MAX_RECIPIENTS,
  EMPTY_SETTINGS,
  DigestPreview,
} from "../lib/digestSettings";

/**
 * An eye, drawn rather than typed.
 *
 * The emoji version renders as an empty box on machines without an emoji font —
 * which includes at least one of ours, judging by the card headings — so the
 * icon that labels this button is inline SVG and cannot fail to appear.
 */
function EyeIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function DigestSettings() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ["digestSettings"], queryFn: getDigestSettings });

  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<DigestPreview | null>(null);

  // Seed the form once the stored value lands, and not on every render after.
  useEffect(() => {
    const s = q.data ?? EMPTY_SETTINGS;
    setEnabled(s.enabled);
    setRecipients(s.recipients);
  }, [q.data]);

  const persist = async (next: { enabled: boolean; recipients: string[] }) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveDigestSettings(next);
      setEnabled(next.enabled);
      setRecipients(next.recipients);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!looksLikeEmail(v)) {
      setError(new Error(`"${draft.trim()}" doesn't look like an email address.`));
      return;
    }
    if (recipients.some((r) => r.toLowerCase() === v)) {
      setDraft("");
      return;
    }
    setDraft("");
    void persist({ enabled, recipients: [...recipients, v] });
  };

  const remove = (email: string) =>
    void persist({ enabled, recipients: recipients.filter((r) => r !== email) });

  const look = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setPreview(await previewDigest(1));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Yesterday, and only to the person who pressed it — trying this out
      // should never mail the whole list.
      const r = await sendDigestNow(1);
      const via = r.provider === "emailjs" ? " via EmailJS" : r.provider === "smtp" ? " via SMTP" : "";
      setNotice(
        r.sent
          ? `Sent to you${via} — ${r.meetingCount} meeting${r.meetingCount === 1 ? "" : "s"} from yesterday.`
          : `Not sent: ${r.reason ?? "no reason given"}.`
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (profile?.role !== "admin") return null;

  return (
    <div className="card">
      <h2>📧 Daily meeting digest</h2>
      <div className="sub">
        A brief of the day&#39;s recorded meetings, plus the desk&#39;s numbers — open requirements,
        what each recruiter submitted, and how much of that landed within 3, 6 and 9 hours of a
        requirement being posted. Emailed at 10:30pm and again at 9am the next morning with the same
        content, for anyone who missed the late one. A day with no meetings still gets the activity
        table, so silence always means &ldquo;nothing was recorded&rdquo; rather than &ldquo;the job
        is broken&rdquo;.
      </div>

      {error != null && <ErrorBlock err={error} />}
      {notice && <div className="alert success">{notice}</div>}

      <div className="row" style={{ alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600 }}>Send the digest</div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            {enabled ? "Running on schedule." : "Off — nothing is sent."}
          </div>
        </div>
        <label className="switch" title="Turn the digest on or off" style={{ flex: "0 0 auto" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || q.isLoading}
            onChange={() => void persist({ enabled: !enabled, recipients })}
          />
          <span className="slider" />
        </label>
      </div>

      <label htmlFor="digest-email">Recipients</label>
      <div className="ask-bar" style={{ marginBottom: "0.6rem" }}>
        <input
          id="digest-email"
          type="email"
          value={draft}
          placeholder="name@cliff-services.com"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          disabled={busy || recipients.length >= MAX_RECIPIENTS}
        />
        <button
          className="btn"
          onClick={add}
          disabled={busy || !draft.trim() || recipients.length >= MAX_RECIPIENTS}
        >
          Add
        </button>
      </div>

      {recipients.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Nobody is on the list, so nothing will be sent.
        </p>
      ) : (
        <div className="chips">
          {recipients.map((r) => (
            <span key={r} className="chip matched">
              {r}
              <button
                className="ask-filter-x"
                onClick={() => remove(r)}
                disabled={busy}
                aria-label={`Remove ${r}`}
                title={`Remove ${r}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.9rem" }}>
        Anyone on this list receives summaries of what was said in meetings, whether or not they
        can open the Meetings tab. Add addresses accordingly.
      </p>

      <div className="btn-row" style={{ marginTop: "0.9rem" }}>
        <button
          className="btn"
          onClick={look}
          disabled={busy}
          title="Render yesterday's digest without sending it"
        >
          {busy ? <span className="spinner" /> : <EyeIcon />} Preview
        </button>
        <button className="btn secondary" onClick={test} disabled={busy}>
          {busy ? <span className="spinner dark" /> : null} Send me yesterday&#39;s digest
        </button>
      </div>

      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/**
 * The rendered email, shown as it will arrive.
 *
 * In an iframe with `srcDoc`, not injected into the page: the digest is a
 * standalone HTML document written for email clients, with its own absolute
 * colours and table layout. Dropped into the app it would inherit the portal's
 * styles and show you something the recipient will never see — which is the one
 * thing a preview must not do. The iframe is sandboxed with no permissions, so
 * the document cannot run anything either.
 */
function PreviewModal({ preview, onClose }: { preview: DigestPreview; onClose: () => void }) {
  const [tab, setTab] = useState<"html" | "text">("html");

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Digest preview"
      >
        <div className="modal-head">
          <div>
            <div className="modal-title">Digest preview</div>
            <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.15rem" }}>
              Subject: {preview.subject}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          <div className="btn-row" style={{ padding: "0.75rem 1.25rem 0" }}>
            <button
              className={`btn ${tab === "html" ? "" : "secondary"}`}
              onClick={() => setTab("html")}
            >
              Formatted
            </button>
            <button
              className={`btn ${tab === "text" ? "" : "secondary"}`}
              onClick={() => setTab("text")}
            >
              Plain text
            </button>
          </div>

          {tab === "html" ? (
            <iframe
              title="Digest preview"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;background:#ffffff">${preview.html}</body>`}
              style={{
                width: "100%",
                height: "62vh",
                border: "none",
                // White, because that is the canvas nearly every mail client
                // puts behind the message.
                background: "#ffffff",
              }}
            />
          ) : (
            <pre
              className="mono"
              style={{
                whiteSpace: "pre-wrap",
                padding: "1.25rem",
                margin: 0,
                fontSize: "0.82rem",
                maxHeight: "62vh",
                overflowY: "auto",
              }}
            >
              {preview.text}
            </pre>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ marginRight: "auto", fontSize: "0.82rem" }}>
            Yesterday&#39;s digest, built by the same code that sends it.
          </span>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
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
