import { useEffect, useState, useCallback } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { can } from "../permissions.js";
import { FALLBACK_CURRENCIES, conversionLabel, formatMoney, moneyView } from "../currency.js";

const STATUSES = ["", "paid", "pending", "overdue"];

function emptyForm(baseCurrency = "USD") {
  return { vendor: "", categoryId: "", amount: "", currency: baseCurrency, paymentDate: "", status: "paid", notes: "", hasReceipt: false };
}

export default function ExpenseTracker() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "expense:manage");
  const baseCurrency = current?.currency || "USD";

  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const buildFilters = useCallback(() => {
    const f = {};
    if (filterStatus) f.status = filterStatus;
    if (filterCategory) f.categoryId = filterCategory;
    if (filterFrom) f.from = filterFrom;
    if (filterTo) f.to = filterTo;
    return f;
  }, [filterStatus, filterCategory, filterFrom, filterTo]);

  async function load() {
    if (!currentId) return;
    setLoading(true);
    setLoadError("");
    try {
      const [{ expenses: list, hasMore: more }, { categories: cats }] = await Promise.all([
        api.listExpenses(currentId, buildFilters()),
        api.listCategories(currentId),
      ]);
      setExpenses(list);
      setHasMore(more);
      setCategories(cats);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!expenses.length) return;
    setLoadingMore(true);
    try {
      const oldest = expenses[expenses.length - 1];
      const { expenses: more, hasMore: stillMore } = await api.listExpenses(currentId, {
        ...buildFilters(),
        before: oldest.created_at,
      });
      setExpenses((prev) => [...prev, ...more]);
      setHasMore(stillMore);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, filterStatus, filterCategory, filterFrom, filterTo]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(baseCurrency));
    setFormError("");
    setShowModal(true);
  }

  function openEdit(expense) {
    const money = moneyView(expense, baseCurrency);
    setEditing(expense);
    setForm({
      vendor: expense.vendor,
      categoryId: expense.category_id || "",
      amount: expense.amount,
      currency: money.currency,
      paymentDate: expense.payment_date || "",
      status: expense.status,
      notes: expense.notes || "",
      hasReceipt: !!expense.receipt_url,
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.vendor.trim()) { setFormError("Vendor is required."); return; }
    if (!form.amount || Number(form.amount) <= 0) { setFormError("Amount must be a positive number."); return; }
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        vendor: form.vendor,
        categoryId: form.categoryId || null,
        amount: form.amount,
        currency: form.currency,
        paymentDate: form.paymentDate,
        status: form.status,
        notes: form.notes,
        receiptUrl: form.hasReceipt ? (editing?.receipt_url || "receipt-uploaded.pdf") : null,
      };
      if (editing) {
        await api.updateExpense(editing.id, payload);
      } else {
        await api.createExpense(currentId, payload);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this expense?")) return;
    try {
      await api.deleteExpense(id);
      await load();
    } catch (err) {
      setLoadError(err.message);
    }
  }

  function clearFilters() {
    setFilterStatus("");
    setFilterCategory("");
    setFilterFrom("");
    setFilterTo("");
  }

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || "Uncategorized";
  const hasActiveFilters = filterStatus || filterCategory || filterFrom || filterTo;

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
        {/* Filter bar */}
        <div className="card" style={{ marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, minWidth: 120 }}>
            <label style={{ fontSize: 12 }}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 140 }}>
            <label style={{ fontSize: 12 }}>Category</label>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              <option value="uncategorized">Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 12 }}>From</label>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 12 }}>To</label>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </div>
          {hasActiveFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ alignSelf: "flex-end" }}>Clear filters</button>
          )}
          {canManage && (
            <button className="btn btn-primary btn-sm" onClick={openCreate} style={{ marginLeft: "auto", alignSelf: "flex-end" }}>+ Record Expense</button>
          )}
        </div>

        {loadError && <div className="error-banner" style={{ marginBottom: 16 }}>{loadError}</div>}

        <div className="card">
          {loading ? (
            <p>Loading...</p>
          ) : expenses.length === 0 ? (
            <div className="empty-state">{hasActiveFilters ? "No expenses match the current filters." : "No expenses recorded yet."}</div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendor</th><th>Category</th><th>Amount</th><th>Payment Date</th><th>Status</th><th>Receipt</th>{canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{e.vendor}</td>
                      <td>{categoryName(e.category_id)}</td>
                      <td>
                        <strong>{formatMoney(moneyView(e, baseCurrency).originalAmount, moneyView(e, baseCurrency).currency, { showCode: moneyView(e, baseCurrency).currency !== baseCurrency })}</strong>
                        {conversionLabel(e, baseCurrency) && <small className="currency-conversion">≈ {conversionLabel(e, baseCurrency)}</small>}
                      </td>
                      <td>{e.payment_date}</td>
                      <td>
                        <span className={`badge ${e.status === "paid" ? "badge-success" : e.status === "overdue" ? "badge-danger" : "badge-warning"}`}>
                          {e.status}
                        </span>
                      </td>
                      <td>{e.receipt_url ? "✅" : "—"}</td>
                      {canManage && (
                        <td style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(e)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleDelete(e.id)}>✕</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <button className="btn btn-outline btn-sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit Expense" : "Record Expense"}</h2>
            {formError && <div className="error-banner">{formError}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="expense-vendor">Vendor</label>
                <input id="expense-vendor" required value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Elegant Events" />
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
                <label htmlFor="expense-amount">Amount ({form.currency})</label>
                <input id="expense-amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="expense-currency">Currency</label>
                <select id="expense-currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {FALLBACK_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>)}
                </select>
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
                <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Save Expense"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
