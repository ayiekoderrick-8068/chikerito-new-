import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { fileToResizedDataUrl } from "../imageUtils.js";
import { FALLBACK_CURRENCIES, formatMoney } from "../currency.js";

const MILESTONE_TYPES = ["wedding", "graduation", "medical", "business", "baby_shower", "home", "travel", "birthday", "community", "custom"];

function archivedLabel(value) {
  if (!value) return "Archive date unavailable";
  return `Archived ${new Date(value).toLocaleDateString()}`;
}

export default function LifeSpaces() {
  const { lifeSpaces, currentId, refresh, selectLifeSpace } = useLifeSpace();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", milestoneType: "wedding", goalAmount: 0, currency: "USD", story: "", coverImage: "" });
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState("");
  const [managedSpaces, setManagedSpaces] = useState(null);
  const [managedSummary, setManagedSummary] = useState(null);
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [lifecycleLoading, setLifecycleLoading] = useState(true);
  const [lifecycleError, setLifecycleError] = useState("");
  const [actingId, setActingId] = useState(null);
  const [deletion, setDeletion] = useState(null);
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");

  const [invitations, setInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [invitationsError, setInvitationsError] = useState("");
  const [respondingId, setRespondingId] = useState(null);

  async function loadInvitations() {
    setInvitationsLoading(true);
    setInvitationsError("");
    try {
      const { invitations } = await api.listPendingInvitationsForMe();
      setInvitations(invitations);
    } catch (err) {
      setInvitationsError(err.message);
    } finally {
      setInvitationsLoading(false);
    }
  }

  useEffect(() => {
    loadInvitations();
    loadLifeSpaces();
  }, []);

  async function loadLifeSpaces() {
    setLifecycleLoading(true);
    setLifecycleError("");
    try {
      const result = await api.listLifeSpaces({ status: "all" });
      if (result?.lifeSpaces) {
        setManagedSpaces(result.lifeSpaces);
        setManagedSummary(result.summary || null);
      }
    } catch (err) {
      setLifecycleError(err.message);
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function reloadSpaces() {
    await refresh();
    await loadLifeSpaces();
  }

  function openArchive(lifeSpace) {
    setArchiveReason("");
    setArchiveTarget(lifeSpace);
  }

  async function confirmArchive() {
    setActingId(archiveTarget.id);
    setLifecycleError("");
    try {
      await api.archiveLifeSpace(archiveTarget.id, { reason: archiveReason.trim() });
      setArchiveTarget(null);
      await reloadSpaces();
    } catch (err) {
      setLifecycleError(err.message);
    } finally {
      setActingId(null);
    }
  }

  async function handleLeave(lifeSpace) {
    if (!confirm(`Leave "${lifeSpace.title}"? You will lose access unless invited again.`)) return;
    setActingId(lifeSpace.id);
    setLifecycleError("");
    try {
      await api.leaveLifeSpace(lifeSpace.id);
      await reloadSpaces();
    } catch (err) {
      setLifecycleError(err.message);
    } finally {
      setActingId(null);
    }
  }

  async function handleRestore(lifeSpace) {
    setActingId(lifeSpace.id);
    setLifecycleError("");
    try {
      await api.restoreLifeSpace(lifeSpace.id);
      await reloadSpaces();
      selectLifeSpace(lifeSpace.id);
    } catch (err) {
      setLifecycleError(err.message);
    } finally {
      setActingId(null);
    }
  }

  async function openDeletion(lifeSpace) {
    setActingId(lifeSpace.id);
    setLifecycleError("");
    try {
      const { impact } = await api.getLifeSpaceDeletionImpact(lifeSpace.id);
      setConfirmationTitle("");
      setDeletion({ lifeSpace, impact });
    } catch (err) {
      setLifecycleError(err.message);
    } finally {
      setActingId(null);
    }
  }

  async function confirmDeletion() {
    const { lifeSpace, impact } = deletion;
    setActingId(lifeSpace.id);
    setLifecycleError("");
    try {
      await api.deleteLifeSpace(lifeSpace.id, impact.requiresConfirmation
        ? { confirmDelete: true, confirmationTitle }
        : {});
      setDeletion(null);
      await reloadSpaces();
    } catch (err) {
      setLifecycleError(err.message);
    } finally {
      setActingId(null);
    }
  }

  async function handleAccept(invitation) {
    setRespondingId(invitation.id);
    try {
      await api.acceptInvitation(invitation.id);
      await refresh();
      selectLifeSpace(invitation.life_space_id);
      await loadInvitations();
    } catch (err) {
      setInvitationsError(err.message);
    } finally {
      setRespondingId(null);
    }
  }

  async function handleDecline(invitation) {
    setRespondingId(invitation.id);
    try {
      await api.declineInvitation(invitation.id);
      await loadInvitations();
    } catch (err) {
      setInvitationsError(err.message);
    } finally {
      setRespondingId(null);
    }
  }

  async function handleCoverChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageError("");
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setForm((f) => ({ ...f, coverImage: dataUrl }));
    } catch (err) {
      setImageError(err.message);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { lifeSpace } = await api.createLifeSpace(form);
      await refresh();
      selectLifeSpace(lifeSpace.id);
      setShowModal(false);
      setForm({ title: "", milestoneType: "wedding", goalAmount: 0, currency: "USD", story: "", coverImage: "" });
      await loadLifeSpaces();
    } finally {
      setSaving(false);
    }
  }

  const spaces = managedSpaces || lifeSpaces;
  const visibleSpaces = spaces.filter((space) => spaceFilter === "all" || space.status === spaceFilter);
  const archivedCount = spaces.filter((space) => space.status === "archived").length;
  const summary = managedSummary || {
    total: spaces.length,
    active: spaces.filter((space) => space.status !== "archived").length,
    archived: archivedCount,
    owned: spaces.filter((space) => space.role === "owner").length,
    shared: spaces.filter((space) => space.role && space.role !== "owner").length,
  };

  return (
    <>
      <Topbar title="My Life Spaces" />
      <div className="page-body">
        {(invitationsError || lifecycleError) && <div className="error-banner" role="alert" style={{ marginBottom: 20 }}>
          {invitationsError || lifecycleError}
          {lifecycleError && <button className="btn btn-ghost btn-sm" onClick={loadLifeSpaces}>Try again</button>}
        </div>}

        {!invitationsLoading && invitations.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginTop: 0 }}>Pending Invitations</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {invitations.map((inv) => (
                <li key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span>
                    You're invited to <strong>{inv.lifeSpaceTitle}</strong> as {inv.role.replace("_", " ")}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={respondingId === inv.id}
                      onClick={() => handleAccept(inv)}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={respondingId === inv.id}
                      onClick={() => handleDecline(inv)}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="life-space-toolbar">
          <div className="view-toggle" role="group" aria-label="Life space status filter">
            {[["all", `All (${spaces.length})`], ["active", "Active"], ["archived", `Archived (${archivedCount})`]].map(([value, label]) => (
              <button key={value} className={`btn btn-sm ${spaceFilter === value ? "btn-primary" : "btn-outline"}`} onClick={() => setSpaceFilter(value)}>{label}</button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create Life Space</button>
        </div>

        {spaces.length > 0 && <section className="life-space-summary card" aria-label="Life space lifecycle summary">
          <span><strong>{summary.active}</strong> active</span>
          <span><strong>{summary.archived}</strong> archived</span>
          <span><strong>{summary.owned}</strong> owned</span>
          <span><strong>{summary.shared}</strong> shared with you</span>
        </section>}

        {lifecycleLoading && managedSpaces === null && lifeSpaces.length === 0 ? <div className="empty-state card" role="status">Loading life spaces...</div>
        : visibleSpaces.length === 0 ? (
          <div className="empty-state card">
            <h2>{spaceFilter === "archived" ? "No archived Life Spaces" : "No Life Spaces yet"}</h2>
            <p>{spaceFilter === "archived" ? "Archived spaces will appear here and can be restored." : "Create your first milestone workspace to get started."}</p>
          </div>
        ) : (
          <div className="grid grid-3">
            {visibleSpaces.map((ls) => {
              const isActive = ls.id === currentId;
              const isArchived = ls.status === "archived";
              const isOwner = ls.role === "owner";
              return (
              <div className={`card life-space-card ${isActive ? "card-active" : ""} ${isArchived ? "life-space-archived" : ""}`} key={ls.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span className="badge badge-neutral" style={{ marginBottom: 10 }}>{ls.milestone_type}</span>
                  {isArchived ? <span className="badge badge-neutral" style={{ marginBottom: 10 }}>Archived</span>
                    : isActive && <span className="badge badge-success" style={{ marginBottom: 10 }}>✓ Active</span>}
                </div>
                <h3 style={{ margin: "0 0 8px" }}>{ls.title}</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 14, minHeight: 40 }}>{ls.story}</p>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>Goal: {formatMoney(ls.goal_amount, ls.currency || "USD", { showCode: true })}</div>
                {isArchived && <div className="archived-meta">
                  <span>{archivedLabel(ls.archived_at)}</span>
                  {ls.archive_reason && <span title={ls.archive_reason}>Reason: {ls.archive_reason}</span>}
                </div>}
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>Goal: {formatMoney(ls.goal_amount, ls.currency || "USD", { showCode: true })}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-outline btn-sm" disabled={isActive || isArchived} onClick={() => selectLifeSpace(ls.id)}>
                    {isActive ? "Active" : "Set Active"}
                  </button>
                  {!isArchived && <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(`${window.location.origin}/donate/${ls.slug}`);
                      alert("Public donation link copied to clipboard!");
                    }}
                  >
                    Copy Share Link
                  </button>}
                </div>
                <div className="life-space-lifecycle-actions">
                  {isOwner ? <>
                  {isArchived ? <>
                    <button className="btn btn-outline btn-sm" disabled={actingId === ls.id} onClick={() => handleRestore(ls)}>Restore</button>
                    <button className="btn btn-ghost btn-sm danger-text" disabled={actingId === ls.id} onClick={() => openDeletion(ls)}>Delete permanently</button>
                  </> : <button className="btn btn-ghost btn-sm" disabled={actingId === ls.id} onClick={() => openArchive(ls)}>Archive</button>}
                  </> : <button className="btn btn-ghost btn-sm danger-text" disabled={actingId === ls.id} onClick={() => handleLeave(ls)}>Leave Life Space</button>}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Your Life Space</h2>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label>Fundraiser title</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Clinton & Mary's Wedding Fund" />
              </div>
              <div className="field">
                <label>Milestone type</label>
                <select value={form.milestoneType} onChange={(e) => setForm({ ...form, milestoneType: e.target.value })}>
                  {MILESTONE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace("_", " ")}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Goal amount ({form.currency})</label>
                <input type="number" min="0" required value={form.goalAmount} onChange={(e) => setForm({ ...form, goalAmount: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="new-space-currency">Base currency</label>
                <select id="new-space-currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {FALLBACK_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Your story</label>
                <textarea rows={3} value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} />
              </div>
              <div className="field">
                <label>Cover photo (optional)</label>
                <input type="file" accept="image/*" onChange={handleCoverChange} />
                {imageError && <div className="error-banner" style={{ marginTop: 8 }}>{imageError}</div>}
                {form.coverImage && (
                  <img src={form.coverImage} alt="Cover preview" style={{ marginTop: 10, width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 10 }} />
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? "Creating..." : "Create Life Space"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletion && (
        <div className="modal-backdrop" onClick={() => setDeletion(null)}>
          <div className="modal deletion-confirmation" role="dialog" aria-modal="true" aria-labelledby="delete-life-space-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-life-space-title">Delete Life Space permanently</h2>
            <p>This permanently removes <strong>{deletion.lifeSpace.title}</strong> and its tenant-owned records. This cannot be undone.</p>
            <dl className="deletion-impact">
              {Object.entries(deletion.impact.counts).filter(([, count]) => count > 0).map(([table, count]) => <div key={table}><dt>{table.replaceAll("_", " ")}</dt><dd>{count}</dd></div>)}
            </dl>
            {deletion.impact.requiresConfirmation && <div className="field">
              <label htmlFor="deletion-title-confirmation">Type <strong>{deletion.lifeSpace.title}</strong> to confirm</label>
              <input id="deletion-title-confirmation" value={confirmationTitle} onChange={(e) => setConfirmationTitle(e.target.value)} autoComplete="off" />
            </div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeletion(null)}>Cancel</button>
              <button className="btn btn-primary danger-button" disabled={actingId === deletion.lifeSpace.id || (deletion.impact.requiresConfirmation && confirmationTitle !== deletion.lifeSpace.title)} onClick={confirmDeletion}>
                {actingId === deletion.lifeSpace.id ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="modal-backdrop" onClick={() => setArchiveTarget(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="archive-life-space-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="archive-life-space-title">Archive Life Space</h2>
            <p>Members will keep read-only access to <strong>{archiveTarget.title}</strong>. Pending invitations will be revoked.</p>
            <div className="field">
              <label htmlFor="archive-reason">Reason (optional)</label>
              <textarea id="archive-reason" maxLength={500} rows={3} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
              <small className="text-muted">{archiveReason.length}/500 characters</small>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setArchiveTarget(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={actingId === archiveTarget.id} onClick={confirmArchive}>{actingId === archiveTarget.id ? "Archiving..." : "Archive Life Space"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
