import { useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { fileToResizedDataUrl } from "../imageUtils.js";

const MILESTONE_TYPES = ["wedding", "graduation", "medical", "business", "baby_shower", "home", "travel", "birthday", "community", "custom"];

export default function LifeSpaces() {
  const { lifeSpaces, currentId, refresh, selectLifeSpace } = useLifeSpace();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", milestoneType: "wedding", goalAmount: 0, story: "", coverImage: "" });
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState("");

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
      setForm({ title: "", milestoneType: "wedding", goalAmount: 0, story: "", coverImage: "" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Topbar title="My Life Spaces" />
      <div className="page-body">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create Life Space</button>
        </div>

        {lifeSpaces.length === 0 ? (
          <div className="empty-state card">
            <h2>No Life Spaces yet</h2>
            <p>Create your first milestone workspace to get started.</p>
          </div>
        ) : (
          <div className="grid grid-3">
            {lifeSpaces.map((ls) => {
              const isActive = ls.id === currentId;
              return (
              <div className={`card ${isActive ? "card-active" : ""}`} key={ls.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span className="badge badge-neutral" style={{ marginBottom: 10 }}>{ls.milestone_type}</span>
                  {isActive && <span className="badge badge-success" style={{ marginBottom: 10 }}>✓ Active</span>}
                </div>
                <h3 style={{ margin: "0 0 8px" }}>{ls.title}</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 14, minHeight: 40 }}>{ls.story}</p>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>Goal: ${Number(ls.goal_amount).toLocaleString()}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-outline btn-sm" disabled={isActive} onClick={() => selectLifeSpace(ls.id)}>
                    {isActive ? "Active" : "Set Active"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(`${window.location.origin}/donate/${ls.slug}`);
                      alert("Public donation link copied to clipboard!");
                    }}
                  >
                    Copy Share Link
                  </button>
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
                <label>Goal amount (USD)</label>
                <input type="number" min="0" required value={form.goalAmount} onChange={(e) => setForm({ ...form, goalAmount: e.target.value })} />
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
    </>
  );
}
