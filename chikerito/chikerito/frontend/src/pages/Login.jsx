import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "demo@chikerito.com", password: "chikerito123" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate("/app");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-visual" style={{ backgroundImage: "url(/images/landing/wedding.jpg)" }}>
        <div className="auth-visual-scrim" />
        <div className="auth-visual-content">
          <Link to="/" className="brand" style={{ display: "block", marginBottom: 40, color: "#fff" }}>
            Chikerito<span className="dot" style={{ color: "#d4b483" }}>.</span>
          </Link>
          <h2>The Operating System for Life's Biggest Moments</h2>
          <p>Plan, fund, manage, and celebrate every milestone — all in one beautiful workspace.</p>
          <div className="auth-visual-quote">
            <p>&ldquo;We could finally see exactly where every gift went — down to the last flower vendor.&rdquo;</p>
            <span>— Clinton &amp; Mary</span>
          </div>
        </div>
      </div>

      <div className="auth-shell">
        <div className="auth-card">
          <Link to="/" className="brand auth-mobile-brand" style={{ display: "none", marginBottom: 32, color: "#1b2a4a" }}>
            Chikerito<span className="dot" style={{ color: "#b08d57" }}>.</span>
          </Link>
          <h1>Welcome back</h1>
          <p className="sub">Sign in to your Mission Control dashboard.</p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
          <p className="auth-switch" style={{ marginTop: 4 }}>
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
          <p className="auth-switch">
            Don't have an account? <Link to="/register">Create one</Link>
          </p>
          <p className="auth-switch" style={{ marginTop: 4, fontSize: 12.5 }}>
            Demo login is pre-filled — just hit Sign In.
          </p>
        </div>
      </div>
    </div>
  );
}
