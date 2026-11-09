// Preferences → "Notification email": the mailbox for leave and Work Board emails.
//
// Separate from the meeting digest's EmailJS account on purpose — that one has a
// small allowance, and ticket emails would use it up. Stored in
// appSettings/notifyEmail, which firestore.rules lets only admins read or write.
// The Cloud Function reads it at send time, so changes apply without a redeploy.

import { useEffect, useState, type CSSProperties } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";

type Provider = "smtp" | "emailjs";

interface Settings {
  enabled: boolean;
  provider: Provider;
  smtp: { host: string; port: number; user: string; password: string; from: string; fromName: string };
  emailjs: { serviceId: string; templateId: string; publicKey: string; privateKey: string };
  events: { leaveRequested: boolean; leaveDecided: boolean; ticketAssigned: boolean; ticketUpdated: boolean };
  portalUrl: string;
}

const EMPTY: Settings = {
  enabled: false,
  provider: "emailjs",
  smtp: { host: "smtp.office365.com", port: 587, user: "", password: "", from: "", fromName: "Cliff Recruiter Suite" },
  emailjs: { serviceId: "", templateId: "", publicKey: "", privateKey: "" },
  events: { leaveRequested: true, leaveDecided: true, ticketAssigned: true, ticketUpdated: true },
  portalUrl: "https://portal.cliffservices.com",
};


const EVENTS: { key: keyof Settings["events"]; label: string; who: string }[] = [
  { key: "leaveRequested", label: "Leave requested", who: "Emails the admins and managers who can approve it" },
  { key: "leaveDecided", label: "Leave approved / rejected", who: "Emails the employee who asked" },
  { key: "ticketAssigned", label: "Ticket assigned", who: "Emails the person it's assigned to" },
  { key: "ticketUpdated", label: "Ticket updates & comments", who: "Emails the assignee and reporter (not whoever made the change)" },
];

const REF = doc(db, "appSettings", "notifyEmail");

export default function NotificationEmailSettings() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [s, setS] = useState<Settings>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    getDoc(REF)
      .then((snap) => {
        const d = (snap.data() ?? {}) as Partial<Settings>;
        setS({
          enabled: d.enabled === true,
          provider: "emailjs",
          smtp: { ...EMPTY.smtp, ...(d.smtp ?? {}) },
          emailjs: { ...EMPTY.emailjs, ...(d.emailjs ?? {}) },
          events: { ...EMPTY.events, ...(d.events ?? {}) },
          portalUrl: d.portalUrl || EMPTY.portalUrl,
        });
      })
      .catch((e) => setMsg({ kind: "error", text: friendlyError(e) }))
      .finally(() => setLoaded(true));
  }, [isAdmin]);

  if (!isAdmin) return null;

  const setEj = (k: keyof Settings["emailjs"], v: string) => setS((x) => ({ ...x, emailjs: { ...x.emailjs, [k]: v } }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await setDoc(REF, {
        ...s,
        provider: "emailjs",
        smtp: { ...s.smtp, host: s.smtp.host.trim(), user: s.smtp.user.trim(), from: s.smtp.from.trim(), port: Number(s.smtp.port) || 587 },
        updatedAt: serverTimestamp(),
        updatedBy: profile?.email ?? "",
      });
      setMsg({ kind: "ok", text: "Saved. Changes apply to the next email — no redeploy needed." });
    } catch (e) {
      setMsg({ kind: "error", text: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      await save();
      const call = httpsCallable<{ action: string }, { ok: boolean; to: string[] }>(functions, "timesheetOps");
      const res = await call({ action: "notifyTest" });
      setMsg({ kind: "ok", text: `Test email sent to ${res.data.to.join(", ")}. Check the inbox (and spam).` });
    } catch (e) {
      setMsg({ kind: "error", text: friendlyError(e) });
    } finally {
      setTesting(false);
    }
  };

  const field = (label: string, input: JSX.Element, hint?: string) => (
    <div className="field" style={{ margin: 0 }}>
      <label>{label}</label>
      {input}
      {hint && <span className="muted" style={{ fontSize: "0.78rem" }}>{hint}</span>}
    </div>
  );
  const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: "1.1rem", maxWidth: 760 };
  const bigInput: CSSProperties = { width: "100%", padding: "0.85rem 1rem", fontSize: "1.05rem", minHeight: 52, boxSizing: "border-box" };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 600 }}>Notification email — leave &amp; Work Board</div>
          <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
            A separate mailbox for leave requests and ticket updates, so they don&#39;t use up the daily meeting
            digest&#39;s email allowance. The digest keeps its own settings below.
          </div>
        </div>
        <label className="switch" title="Turn notification emails on or off">
          <input type="checkbox" checked={s.enabled} disabled={!loaded} onChange={(e) => setS((x) => ({ ...x, enabled: e.target.checked }))} />
          <span className="slider" />
        </label>
      </div>

      {!loaded ? (
        <div className="center-load" style={{ minHeight: 80 }}><div className="spinner dark" /></div>
      ) : (
        <>
          {(
            <>
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0 0 0.8rem" }}>
                Use a different EmailJS account from the digest&#39;s. The template needs <code>{"{{to_email}}"}</code> in
                its To field, <code>{"{{subject}}"}</code> as the subject and <code>{"{{{message_html}}}"}</code> as the body.
              </p>
              <div style={grid2}>
                {field("Service ID", <input style={bigInput} value={s.emailjs.serviceId} onChange={(e) => setEj("serviceId", e.target.value)} />)}
                {field("Template ID", <input style={bigInput} value={s.emailjs.templateId} onChange={(e) => setEj("templateId", e.target.value)} />)}
                {field("Public key", <input style={bigInput} value={s.emailjs.publicKey} onChange={(e) => setEj("publicKey", e.target.value)} />)}
                {field("Private key", <input style={bigInput} type={showSecret ? "text" : "password"} value={s.emailjs.privateKey} autoComplete="new-password" onChange={(e) => setEj("privateKey", e.target.value)} />)}
              </div>
            </>
          )}

          <div style={{ marginTop: "1.1rem", fontWeight: 600, fontSize: "0.9rem" }}>Send an email when…</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.5rem" }}>
            {EVENTS.map((ev) => (
              <label key={ev.key} style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={s.events[ev.key]}
                  onChange={(e) => setS((x) => ({ ...x, events: { ...x.events, [ev.key]: e.target.checked } }))}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong style={{ fontWeight: 600 }}>{ev.label}</strong>
                  <span className="muted" style={{ fontSize: "0.82rem" }}> — {ev.who}</span>
                </span>
              </label>
            ))}
          </div>

          {msg && (
            <div
              className={msg.kind === "error" ? "alert error" : "alert"}
              style={{ marginTop: "0.9rem", ...(msg.kind === "ok" ? { background: "#e7f6ec", border: "1px solid #bfe3cb", color: "#1b5e34" } : {}) }}
            >
              {msg.text}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={save} disabled={saving || testing}>{saving && !testing ? <span className="spinner" /> : "Save"}</button>
            <button className="btn secondary" onClick={test} disabled={saving || testing}>{testing ? <span className="spinner dark" /> : "✉"} Save &amp; send test email</button>
          </div>
        </>
      )}
    </div>
  );
}