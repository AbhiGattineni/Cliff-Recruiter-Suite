import { useState, FormEvent, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ALLOWED_DOMAIN, isAllowedEmail } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { isPlaceholderConfig } from "../firebase";
import AuthShell from "../components/AuthShell";

export default function Signup() {
  const { signUp, user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const emailOk = isAllowedEmail(email);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!emailOk) {
      setError(`Please use your @${ALLOWED_DOMAIN} email address.`);
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password, name);
      // createUser signs the user in automatically → onAuthStateChanged
      // updates the context and the effect above redirects to "/".
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your Cliff account">
      <form onSubmit={onSubmit}>
        {isPlaceholderConfig && (
          <div className="alert warn">
            Firebase isn&#39;t connected yet, so signup won&#39;t work. Add your Firebase
            config first (see README).
          </div>
        )}
        {error && <div className="alert error">{error}</div>}

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
            <div className="muted" style={{ fontSize: "0.78rem", marginTop: 4, color: "var(--danger)" }}>
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
          {busy ? <span className="spinner" /> : "Create account"}
        </button>

        <p className="login-foot">
          Self-registration is for @{ALLOWED_DOMAIN} addresses only. Consultants on assignment
          are invited by their recruiter and don&#39;t sign up here.
        </p>
        <p className="login-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
