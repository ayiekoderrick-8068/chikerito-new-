import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [devLink, setDevLink] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setSubmitted(true);
      // No real email transport exists yet (see backend/notify.js) — the
      // reset link is only ever returned here outside production, purely so
      // this flow is testable end to end without a real inbox.
      if (res.resetUrl) setDevLink(res.resetUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand" style={{ display: "block", marginBottom: 32, color: "#1b2a4a" }}>
          Chikerito<span className="dot" style={{ color: "#b08d57" }}>.</span>
        </Link>
        <h1>Reset your password</h1>
        <p className="sub">We'll send a link to reset your password.</p>
        {error && <div className="error-banner">{error}</div>}

        {submitted ? (
          <div>
            <div className="success-banner">If an account exists for that email, a password reset link has been sent.</div>
            {devLink && (
              <div className="card" style={{ marginTop: 16, fontSize: 13 }}>
                <strong>Dev mode:</strong> no email service is configured yet, so here's the link directly —{" "}
                <Link to={devLink.replace(window.location.origin, "")}>{devLink}</Link>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
