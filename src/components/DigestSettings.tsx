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
  looksLikeEmail,
  MAX_RECIPIENTS,
  EMPTY_SETTINGS,
} from "../lib/digestSettings";

export default function DigestSettings() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ["digestSettings"], queryFn: getDigestSettings });

  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Yesterday, and only to the person who pressed it — trying this out
      // should never mail the whole list.
      const r = await sendDigestNow(1);
      setNotice(
        r.sent
          ? `Sent to you — ${r.meetingCount} meeting${r.meetingCount === 1 ? "" : "s"} from yesterday.`
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
        A brief of the day&#39;s recorded meetings, emailed at 10:30pm and again at 9am the next
        morning with the same content, for anyone who missed the late one. A day with no meetings
        gets a short note, so silence always means &ldquo;nothing was recorded&rdquo; rather than
        &ldquo;the job is broken&rdquo;.
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

      <button className="btn secondary" onClick={test} disabled={busy}>
        {busy ? <span className="spinner dark" /> : null} Send me yesterday&#39;s digest now
      </button>
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
