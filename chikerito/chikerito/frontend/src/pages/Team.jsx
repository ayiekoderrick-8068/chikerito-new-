import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { can } from "../permissions.js";

const ROLES = ["finance_manager", "event_planner", "volunteer", "editor"];

function formatExpiry(iso) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "expires today";
  if (days === 1) return "expires in 1 day";
  return `expires in ${days} days`;
}

export default function Team() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "team:manage");
  const [team, setTeam] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ email: "", role: "volunteer" });
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [rowError, setRowError] = useState("");

  async function load() {
    if (!currentId) return;
    setLoading(true);
    setLoadError("");
    try {
      const [{ team }, { invitations }] = await Promise.all([
        api.listTeam(currentId),
        api.listInvitations(currentId),
      ]);
      setTeam(team);
      setInvitations(invitations);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
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
      await api.createInvitation(currentId, form);
      setForm({ email: "", role: "volunteer" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(invitationId) {
    if (!confirm("Revoke this invitation?")) return;
    setRowError("");
    try {
      await api.revokeInvitation(currentId, invitationId);
      await load();
    } catch (err) {
      setRowError(err.message);
    }
  }

  async function handleRoleChange(memberId, role) {
    setRowError("");
    try {
      await api.updateTeamMemberRole(currentId, memberId, role);
      await load();
    } catch (err) {
      setRowError(err.message);
    }
  }

  async function handleRemove(memberId) {
    if (!confirm("Remove this team member?")) return;
    setRowError("");
    try {
      await api.removeTeamMember(currentId, memberId);
      await load();
    } catch (err) {
      setRowError(err.message);
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
        {canManage && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginTop: 0 }}>Invite a Collaborator</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              They don't need an account yet — invite by email and assign a role: Finance Manager, Event Planner, Volunteer, or Editor. The invitation waits until they accept.
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
        )}

        {loadError && <div className="error-banner" style={{ marginBottom: 20 }}>{loadError}</div>}
        {rowError && <div className="error-banner" style={{ marginBottom: 20 }}>{rowError}</div>}

        {(canManage || invitations.length > 0) && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginTop: 0 }}>Pending Invitations</h3>
            {loading ? (
              <p>Loading...</p>
            ) : invitations.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No pending invitations.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Email</th><th>Role</th><th>Status</th>{canManage && <th></th>}</tr></thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.email}</td>
                      <td><span className="badge badge-neutral">{inv.role.replace("_", " ")}</span></td>
                      <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{formatExpiry(inv.expires_at)}</td>
                      {canManage && (
                        <td>
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleRevoke(inv.id)}>
                            Revoke
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Team Members</h3>
          {loading ? (
            <p>Loading...</p>
          ) : team.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No team members yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th>{canManage && <th></th>}</tr></thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>
                      {canManage && m.role !== "owner" ? (
                        <select value={m.role} onChange={(e) => handleRoleChange(m.id, e.target.value)}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r.replace("_", " ")}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="badge badge-neutral">{m.role.replace("_", " ")}</span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        {m.role !== "owner" && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleRemove(m.id)}>
                            Remove
                          </button>
                        )}
                      </td>
                    )}
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
