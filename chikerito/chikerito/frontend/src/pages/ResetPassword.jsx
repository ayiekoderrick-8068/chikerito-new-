import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
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
        <h1>Choose a new password</h1>

        {!token ? (
          <div className="error-banner">
            This reset link is missing its token. Request a new one from the{" "}
            <Link to="/forgot-password">forgot password</Link> page.
          </div>
        ) : done ? (
          <div className="success-banner">Your password has been reset. Redirecting to sign in...</div>
        ) : (
          <>
            {error && (
              <div className="error-banner">
                {error}
                {/expired|invalid/i.test(error) && (
                  <>
                    {" "}
                    Request a new link from the <Link to="/forgot-password">forgot password</Link> page.
                  </>
                )}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>New password</label>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
                {loading ? "Resetting..." : "Reset password"}
              </button>
            </form>
          </>
        )}

        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
