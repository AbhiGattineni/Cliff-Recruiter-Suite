import { useState, FormEvent, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ALLOWED_DOMAIN, isAllowedEmail, requestSignupOtp, verifySignupOtp } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { isPlaceholderConfig } from "../firebase";

type Step = "form" | "otp";

export default function Signup() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [otp, setOtp] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const emailOk = isAllowedEmail(email);

  const sendOtp = async (isResend = false) => {
    setError(null);
    setInfo(null);
    if (!emailOk) {
      setError(`Please use your @${ALLOWED_DOMAIN} email address.`);
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!isResend && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await requestSignupOtp(email, password, name);
      setStep("otp");
      setCooldown(60);
      setInfo(
        res.devOtp
          ? `Dev mode: your code is ${res.devOtp} (email sending not configured).`
          : `We sent a 6-digit code to ${email}. It is valid for 10 minutes.`
      );
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitForm = (e: FormEvent) => {
    e.preventDefault();
    void sendOtp(false);
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      await verifySignupOtp(email, otp);
      // Account is now enabled + verified — sign in with the chosen password.
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={step === "form" ? onSubmitForm : onVerify}>
        <div className="logo">Cliff Recruiter Suite</div>
        <div className="tagline">
          {step === "form" ? "Create your account" : "Verify your email"}
        </div>

        {isPlaceholderConfig && (
          <div className="alert warn">
            Firebase isn&#39;t connected yet, so signup can&#39;t send a code. Add your Firebase
            config and deploy the Cloud Functions first (see README).
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert info">{info}</div>}

        {step === "form" ? (
          <>
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${ALLOWED_DOMAIN}`}
                autoComplete="username"
                required
              />
              {email.length > 0 && !emailOk && (
                <div className="muted" style={{ fontSize: "0.78rem", marginTop: 4, color: "#9c0006" }}>
                  Only @{ALLOWED_DOMAIN} addresses are allowed.
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button
              className="btn"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={busy || !emailOk}
            >
              {busy ? <span className="spinner" /> : "Send verification code"}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="otp">6-digit code</label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="______"
                style={{ letterSpacing: "0.5rem", textAlign: "center", fontSize: "1.3rem" }}
                autoFocus
                required
              />
            </div>
            <button
              className="btn"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={busy}
            >
              {busy ? <span className="spinner" /> : "Verify & continue"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => sendOtp(true)}
                disabled={busy || cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setStep("form");
                  setOtp("");
                  setInfo(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Change details
              </button>
            </div>
          </>
        )}

        <p className="muted" style={{ fontSize: "0.82rem", marginTop: "1.25rem", marginBottom: 0, textAlign: "center" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
