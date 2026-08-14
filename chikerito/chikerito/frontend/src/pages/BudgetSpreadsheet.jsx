import { useEffect, useMemo, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";

function EditableAmount({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  useEffect(() => {
    if (!editing) setVal(value);
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = Number(val) || 0;
    if (next !== Number(value)) onSave(next);
  }

  if (!editing) {
    return (
      <span className="editable-cell" onClick={() => setEditing(true)} title="Click to edit">
        ${Number(value).toLocaleString()}
      </span>
    );
  }
  return (
    <input
      type="number"
      min="0"
      autoFocus
      className="inline-edit-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function NewLineRow({ onAdd }) {
  const [vendor, setVendor] = useState("");
  const [planned, setPlanned] = useState("");
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!vendor.trim()) return;
    setSaving(true);
    try {
      await onAdd({ vendor: vendor.trim(), plannedAmount: Number(planned) || 0, amount: Number(actual) || 0 });
      setVendor("");
      setPlanned("");
      setActual("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="new-line-row">
      <td>
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <input placeholder="Add line item… e.g. Caterer deposit" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          <input type="number" min="0" placeholder="Planned" style={{ width: 90 }} value={planned} onChange={(e) => setPlanned(e.target.value)} />
          <input type="number" min="0" placeholder="Actual" style={{ width: 90 }} value={actual} onChange={(e) => setActual(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={saving || !vendor.trim()}>+ Add</button>
        </form>
      </td>
      <td colSpan={4}></td>
    </tr>
  );
}

export default function BudgetSpreadsheet() {
  const { currentId, current } = useLifeSpace();
  const [categories, setCategories] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", budgetAmount: 500 });
  const [saving, setSaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");

  async function load() {
    if (!currentId) return;
    setLoading(true);
    const [{ categories }, { expenses }] = await Promise.all([api.listCategories(currentId), api.listExpenses(currentId)]);
    setCategories(categories);
    setExpenses(expenses);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const lineItemsByCategory = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const key = e.category_id || "uncategorized";
      (map[key] = map[key] || []).push(e);
    });
    return map;
  }, [expenses]);

  const uncategorized = lineItemsByCategory.uncategorized || [];

  const grandTotals = useMemo(() => {
    return categories.reduce(
      (acc, c) => {
        const lines = lineItemsByCategory[c.id] || [];
        const planned = lines.reduce((s, e) => s + e.planned_amount, 0);
        return {
          budget: acc.budget + c.budget_amount,
          planned: acc.planned + planned,
          actual: acc.actual + c.spent,
          raised: acc.raised + c.raised,
        };
      },
      { budget: 0, planned: 0, actual: 0, raised: 0 }
    );
  }, [categories, lineItemsByCategory]);

  async function handleCreateCategory(e) {
    e.preventDefault();
    setCategoryError("");
    setSaving(true);
    try {
      await api.createCategory(currentId, form);
      setForm({ name: "", budgetAmount: 500 });
      setShowModal(false);
      await load();
    } catch (err) {
      setCategoryError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCategory(id) {
    if (!confirm("Delete this budget category?")) return;
    await api.deleteCategory(id);
    await load();
  }

  async function handleAddLine(categoryId, payload) {
    await api.createExpense(currentId, {
      ...payload,
      categoryId: categoryId === "uncategorized" ? null : categoryId,
      status: payload.amount > 0 ? "paid" : "pending",
    });
    await load();
  }

  async function handleLineUpdate(id, patch) {
    await api.updateExpense(id, patch);
    await load();
  }

  async function handleDeleteLine(id) {
    if (!confirm("Delete this line item?")) return;
    await api.deleteExpense(id);
    await load();
  }

  function exportCsv() {
    const rows = [["Category", "Line Item", "Planned", "Actual", "Variance", "Status"]];
    categories.forEach((c) => {
      const lines = lineItemsByCategory[c.id] || [];
      const planned = lines.reduce((s, e) => s + e.planned_amount, 0);
      rows.push([c.name, "(Category Budget / Raised)", c.budget_amount, c.spent, c.budget_amount - c.spent, `Raised $${c.raised}`]);
      lines.forEach((e) => rows.push([c.name, e.vendor, e.planned_amount, e.amount, e.planned_amount - e.amount, e.status]));
      rows.push([c.name, "Subtotal", planned, c.spent, c.budget_amount - c.spent, ""]);
    });
    if (uncategorized.length) {
      rows.push(["Uncategorized", "", "", "", "", ""]);
      uncategorized.forEach((e) => rows.push(["Uncategorized", e.vendor, e.planned_amount, e.amount, e.planned_amount - e.amount, e.status]));
    }
    rows.push(["TOTAL", "", grandTotals.planned, grandTotals.actual, grandTotals.budget - grandTotals.actual, `Raised $${grandTotals.raised}`]);

    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(current?.title || "budget").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-budget.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!currentId) {
    return (
      <>
        <Topbar title="Budget Spreadsheet" />
        <div className="page-body">
          <div className="empty-state card">Create a Life Space first to build a budget spreadsheet.</div>
        </div>
      </>
    );
  }

  function renderCategorySection(cat) {
    const lines = lineItemsByCategory[cat.id] || [];
    const planned = lines.reduce((s, e) => s + e.planned_amount, 0);
    const variance = cat.budget_amount - cat.spent;
    return (
      <div className="card budget-section" key={cat.id}>
        <div className="budget-section-head">
          <div>
            <span className="cat-name">{cat.name}</span>
            <span className="budget-pill">
              Budget: <EditableAmount value={cat.budget_amount} onSave={(v) => api.updateCategory(cat.id, { budgetAmount: v }).then(load)} />
            </span>
            <span className="budget-pill muted">Raised: ${cat.raised.toLocaleString()}</span>
            <span className="budget-pill muted">Planned: ${planned.toLocaleString()}</span>
            <span className={`budget-pill ${variance < 0 ? "negative" : "positive"}`}>
              {variance < 0 ? "Over by" : "Remaining"}: ${Math.abs(variance).toLocaleString()}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleDeleteCategory(cat.id)}>
            Delete category ✕
          </button>
        </div>

        <table className="table spreadsheet-table">
          <thead>
            <tr>
              <th>Line item</th>
              <th>Planned</th>
              <th>Actual</th>
              <th>Variance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((e) => {
              const lineVariance = e.planned_amount - e.amount;
              return (
                <tr key={e.id}>
                  <td>{e.vendor}</td>
                  <td>
                    <EditableAmount value={e.planned_amount} onSave={(v) => handleLineUpdate(e.id, { plannedAmount: v })} />
                  </td>
                  <td>
                    <EditableAmount value={e.amount} onSave={(v) => handleLineUpdate(e.id, { amount: v, status: v > 0 ? (e.status === "pending" ? "paid" : e.status) : e.status })} />
                  </td>
                  <td className={lineVariance < 0 ? "text-danger" : "text-muted"}>
                    {lineVariance < 0 ? "-" : ""}${Math.abs(lineVariance).toLocaleString()}
                  </td>
                  <td>
                    <select className="status-select" value={e.status} onChange={(ev) => handleLineUpdate(e.id, { status: ev.target.value })}>
                      <option value="pending">Pending</option>
                      <option value="paid">Paid</option>
                      <option value="overdue">Overdue</option>
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleDeleteLine(e.id)}>✕</button>
                  </td>
                </tr>
              );
            })}
            <NewLineRow onAdd={(payload) => handleAddLine(cat.id, payload)} />
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <Topbar title="Budget Spreadsheet" />
      <div className="page-body">
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="stat-card"><div className="label">Total Budgeted</div><div className="value">${grandTotals.budget.toLocaleString()}</div></div>
          <div className="stat-card"><div className="label">Total Raised (Income)</div><div className="value">${grandTotals.raised.toLocaleString()}</div></div>
          <div className="stat-card"><div className="label">Total Planned</div><div className="value">${grandTotals.planned.toLocaleString()}</div></div>
          <div className={`stat-card ${grandTotals.actual > grandTotals.budget ? "accent" : ""}`}><div className="label">Total Actual Spent</div><div className="value">${grandTotals.actual.toLocaleString()}</div></div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 16px" }}>
          <h3 style={{ margin: 0, color: "var(--navy)" }}>Plan vs. Actual, by Category</h3>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={exportCsv}>Export CSV</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Add Category</button>
          </div>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : categories.length === 0 ? (
          <div className="empty-state card">No budget categories yet. Add your first one to start planning.</div>
        ) : (
          categories.map(renderCategorySection)
        )}

        {uncategorized.length > 0 && (
          <div className="card budget-section">
            <div className="budget-section-head">
              <span className="cat-name">Uncategorized</span>
            </div>
            <table className="table spreadsheet-table">
              <thead>
                <tr><th>Line item</th><th>Planned</th><th>Actual</th><th>Variance</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {uncategorized.map((e) => {
                  const lineVariance = e.planned_amount - e.amount;
                  return (
                    <tr key={e.id}>
                      <td>{e.vendor}</td>
                      <td><EditableAmount value={e.planned_amount} onSave={(v) => handleLineUpdate(e.id, { plannedAmount: v })} /></td>
                      <td><EditableAmount value={e.amount} onSave={(v) => handleLineUpdate(e.id, { amount: v })} /></td>
                      <td className={lineVariance < 0 ? "text-danger" : "text-muted"}>{lineVariance < 0 ? "-" : ""}${Math.abs(lineVariance).toLocaleString()}</td>
                      <td>
                        <select className="status-select" value={e.status} onChange={(ev) => handleLineUpdate(e.id, { status: ev.target.value })}>
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                          <option value="overdue">Overdue</option>
                        </select>
                      </td>
                      <td><button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleDeleteLine(e.id)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Budget Category</h2>
            {categoryError && <div className="error-banner">{categoryError}</div>}
            <form onSubmit={handleCreateCategory}>
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
