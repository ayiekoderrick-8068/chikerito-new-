import { useEffect, useState } from "react";
import { api } from "../api";

function describeDevice(userAgent) {
  if (!userAgent) return "Unknown device";
  if (/mobile/i.test(userAgent)) return "Mobile device";
  if (/chrome/i.test(userAgent)) return "Chrome";
  if (/firefox/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Browser";
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SecuritySettings() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { sessions } = await api.listSessions();
      setSessions(sessions);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRevoke(id) {
    setActionError("");
    try {
      await api.revokeSession(id);
      await load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleRevokeOthers() {
    if (!confirm("Sign out every other session? You'll stay signed in here.")) return;
    setActionError("");
    try {
      await api.revokeOtherSessions();
      await load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  const otherSessionCount = sessions.filter((s) => !s.current).length;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0 }}>Security</h3>
        {otherSessionCount > 0 && (
          <button className="btn btn-outline btn-sm" onClick={handleRevokeOthers}>
            Sign out other sessions
          </button>
        )}
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Devices and browsers currently signed in to your account.</p>
      {error && <div className="error-banner">{error}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}
      {loading ? (
        <p>Loading...</p>
      ) : sessions.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No active sessions.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map((s) => (
            <li key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div>
                  {describeDevice(s.userAgent)} {s.current && <span className="badge badge-success">This device</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Active {relativeTime(s.lastSeenAt)}</div>
              </div>
              {!s.current && (
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleRevoke(s.id)}>
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
