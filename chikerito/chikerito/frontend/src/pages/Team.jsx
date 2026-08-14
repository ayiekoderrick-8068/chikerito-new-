import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";

const ROLES = ["finance_manager", "event_planner", "volunteer", "editor"];

export default function Team() {
  const { currentId } = useLifeSpace();
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: "", role: "volunteer" });
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);

  async function load() {
    if (!currentId) return;
    setLoading(true);
    const { team } = await api.listTeam(currentId);
    setTeam(team);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function handleInvite(e) {
    e.preventDefault();
    setError("");
    setInviting(true);
    try {
      await api.inviteTeam(currentId, form);
      setForm({ email: "", role: "volunteer" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  }

  if (!currentId) {
    return (
      <>
        <Topbar title="Team" />
        <div className="page-body"><div className="empty-state card">Create a Life Space to invite collaborators.</div></div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Team" />
      <div className="page-body">
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Invite a Collaborator</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            The person must already have a Chikerito account. Assign them a role: Finance Manager, Event Planner, Volunteer, or Editor.
          </p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={handleInvite} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" disabled={inviting}>{inviting ? "Inviting..." : "Invite"}</button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Team Members</h3>
          {loading ? (
            <p>Loading...</p>
          ) : team.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No team members yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td><span className="badge badge-neutral">{m.role.replace("_", " ")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
