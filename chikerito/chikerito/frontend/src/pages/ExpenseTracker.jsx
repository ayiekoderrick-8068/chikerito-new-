import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";

export default function ExpenseTracker() {
  const { currentId } = useLifeSpace();
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vendor: "", categoryId: "", amount: "", paymentDate: "", status: "paid", notes: "", hasReceipt: false });

  async function load() {
    if (!currentId) return;
    setLoading(true);
    const [{ expenses }, { categories }] = await Promise.all([api.listExpenses(currentId), api.listCategories(currentId)]);
    setExpenses(expenses);
    setCategories(categories);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createExpense(currentId, {
        vendor: form.vendor,
        categoryId: form.categoryId || null,
        amount: form.amount,
        paymentDate: form.paymentDate,
        status: form.status,
        notes: form.notes,
        receiptUrl: form.hasReceipt ? "receipt-uploaded.pdf" : null,
      });
      setForm({ vendor: "", categoryId: "", amount: "", paymentDate: "", status: "paid", notes: "", hasReceipt: false });
      setShowModal(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this expense?")) return;
    await api.deleteExpense(id);
    await load();
  }

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || "Uncategorized";

  if (!currentId) {
    return (
      <>
        <Topbar title="Expense Tracker" />
        <div className="page-body"><div className="empty-state card">Create a Life Space first to start tracking expenses.</div></div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Expense Tracker" />
      <div className="page-body">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Record Expense</button>
        </div>

        <div className="card">
          {loading ? (
            <p>Loading...</p>
          ) : expenses.length === 0 ? (
            <div className="empty-state">No expenses recorded yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th><th>Category</th><th>Amount</th><th>Payment Date</th><th>Status</th><th>Receipt</th><th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.vendor}</td>
                    <td>{categoryName(e.category_id)}</td>
                    <td>${e.amount.toLocaleString()}</td>
                    <td>{e.payment_date}</td>
                    <td>
                      <span className={`badge ${e.status === "paid" ? "badge-success" : e.status === "overdue" ? "badge-danger" : "badge-warning"}`}>
                        {e.status}
                      </span>
                    </td>
                    <td>{e.receipt_url ? "✅" : "—"}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleDelete(e.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Record Expense</h2>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label>Vendor</label>
                <input required value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Elegant Events" />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount (USD)</label>
                <input type="number" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="field">
                <label>Payment date</label>
                <input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
              </div>
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
              <div className="field">
                <label><input type="checkbox" checked={form.hasReceipt} onChange={(e) => setForm({ ...form, hasReceipt: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Receipt uploaded</label>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Expense"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
