import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { can } from "../permissions.js";

export default function FinanceHub() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "category:manage");
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", budgetAmount: 500 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!currentId) return;
    setLoading(true);
    const { categories } = await api.listCategories(currentId);
    setCategories(categories);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.createCategory(currentId, form);
      setForm({ name: "", budgetAmount: 500 });
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this budget category?")) return;
    await api.deleteCategory(id);
    await load();
  }

  if (!currentId) {
    return (
      <>
        <Topbar title="Finance Hub" />
        <div className="page-body"><div className="empty-state card">Create a Life Space first to set up your budget.</div></div>
      </>
    );
  }

  const totals = categories.reduce(
    (acc, c) => ({ budget: acc.budget + c.budget_amount, raised: acc.raised + c.raised, spent: acc.spent + c.spent }),
    { budget: 0, raised: 0, spent: 0 }
  );

  return (
    <>
      <Topbar title="Finance Hub" />
      <div className="page-body">
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="stat-card"><div className="label">Total Budget</div><div className="value">${totals.budget.toLocaleString()}</div></div>
          <div className="stat-card"><div className="label">Total Raised</div><div className="value">${totals.raised.toLocaleString()}</div></div>
          <div className="stat-card accent"><div className="label">Total Spent</div><div className="value">${totals.spent.toLocaleString()}</div></div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 16px" }}>
          <h3 style={{ margin: 0, color: "var(--navy)" }}>Budget Categories</h3>
          {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Add Category</button>}
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : categories.length === 0 ? (
          <div className="empty-state card">No budget categories yet. Add your first one (e.g. Venue, Catering, Flowers).</div>
        ) : (
          <div className="grid grid-3">
            {categories.map((c) => (
              <div className="card category-card" key={c.id}>
                <div className="cat-head">
                  <span className="cat-name">{c.name}</span>
                  {canManage && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(c.id)} style={{ color: "var(--danger)" }}>✕</button>
                  )}
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${c.progress}%` }} /></div>
                <div className="cat-figures">
                  <span>Raised ${c.raised.toLocaleString()}</span>
                  <span>Budget ${c.budget_amount.toLocaleString()}</span>
                </div>
                <div className="cat-figures">
                  <span>Spent ${c.spent.toLocaleString()}</span>
                  <span>Remaining ${c.remainingBudget.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Budget Category</h2>
            {error && <div className="error-banner">{error}</div>}
            <form onSubmit={handleCreate}>
              <div className="field">
                <label>Category name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Photography" />
              </div>
              <div className="field">
                <label>Budget amount (USD)</label>
                <input type="number" min="0" required value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Add Category"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
