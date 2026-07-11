import { useState, useEffect, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ensureConfigured, friendlyError } from "../lib/errors";
import { isPlaceholderConfig } from "../firebase";

export default function Login() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      ensureConfigured(); // fail fast with a clear message if Firebase isn't set up
      await signIn(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="logo">Cliff Recruiter Suite</div>
        <div className="tagline">Cliff Services Inc. — internal tools</div>

        {isPlaceholderConfig && (
          <div className="alert warn">
            Firebase isn&#39;t connected yet. Add your config to <span className="mono">.env</span> and
            reload before signing in.
          </div>
        )}
        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
          {busy ? <span className="spinner" /> : "Sign in"}
        </button>
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: "1.25rem", marginBottom: 0, textAlign: "center" }}>
          New here? <Link to="/signup">Create an account</Link>
        </p>
        <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.5rem", marginBottom: 0, textAlign: "center" }}>
          Registration is limited to @cliff-services.com email addresses.
        </p>
      </form>
    </div>
  );
}
