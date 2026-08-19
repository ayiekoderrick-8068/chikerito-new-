import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { can } from "../permissions.js";
import { FALLBACK_CURRENCIES, conversionLabel, formatMoney, moneyView } from "../currency.js";

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];
const FREQUENCY_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(baseCurrency = "USD") {
  return { vendor: "", amount: "", currency: baseCurrency, categoryId: "", frequency: "monthly", startDate: todayStr(), endDate: "" };
}

export default function RecurringExpenses() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "expense:manage");
  const baseCurrency = current?.currency || "USD";
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState("");

  async function load() {
    if (!currentId) return;
    setLoading(true);
    setLoadError("");
    try {
      const [{ recurringExpenses }, { categories }] = await Promise.all([
        api.listRecurringExpenses(currentId),
        api.listCategories(currentId),
      ]);
      setRules(recurringExpenses);
      setCategories(categories);
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

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(baseCurrency));
    setFormError("");
    setShowModal(true);
  }

  function openEdit(rule) {
    const money = moneyView(rule, baseCurrency);
    setEditing(rule);
    setForm({
      vendor: rule.vendor,
      amount: rule.amount,
      currency: money.currency,
      categoryId: rule.category_id || "",
      frequency: rule.frequency,
      startDate: rule.start_date,
      endDate: rule.end_date || "",
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        vendor: form.vendor,
        amount: form.amount,
        currency: form.currency,
        categoryId: form.categoryId || null,
        frequency: form.frequency,
        startDate: form.startDate,
        endDate: form.endDate || null,
      };
      if (editing) {
        // start/end/frequency are set once at creation — editing only touches the rest.
        await api.updateRecurringExpense(editing.id, { vendor: payload.vendor, amount: payload.amount, currency: payload.currency, categoryId: payload.categoryId, frequency: payload.frequency });
      } else {
        await api.createRecurringExpense(currentId, payload);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePause(rule) {
    setRowError("");
    try {
      await api.pauseRecurringExpense(rule.id);
      await load();
    } catch (err) {
      setRowError(err.message);
    }
  }

  async function handleResume(rule) {
    setRowError("");
    try {
      await api.resumeRecurringExpense(rule.id);
      await load();
    } catch (err) {
      setRowError(err.message);
    }
  }

  async function handleStop(rule) {
    if (!confirm(`Stop the recurring expense "${rule.vendor}"? Past generated expenses are kept.`)) return;
    setRowError("");
    try {
      await api.deleteRecurringExpense(rule.id);
      await load();
    } catch (err) {
      setRowError(err.message);
    }
  }

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || "Uncategorized";

  if (!currentId) {
    return (
      <>
        <Topbar title="Recurring Expenses" />
        <div className="page-body"><div className="empty-state card">Create a Life Space first to set up recurring expenses.</div></div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Recurring Expenses" />
      <div className="page-body">
        {canManage && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add Recurring Expense</button>
          </div>
        )}

        {loadError && <div className="error-banner" style={{ marginBottom: 16 }}>{loadError}</div>}
        {rowError && <div className="error-banner" style={{ marginBottom: 16 }}>{rowError}</div>}

        <div className="card">
          {loading ? (
            <p>Loading...</p>
          ) : rules.length === 0 ? (
            <div className="empty-state">No recurring expenses set up yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th><th>Category</th><th>Amount</th><th>Frequency</th><th>Status</th><th>Next occurrence</th>{canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.vendor}</td>
                    <td>{categoryName(r.category_id)}</td>
                    <td>
                      {formatMoney(moneyView(r, baseCurrency).originalAmount, moneyView(r, baseCurrency).currency, { showCode: moneyView(r, baseCurrency).currency !== baseCurrency })}
                      {conversionLabel(r, baseCurrency) && <small className="currency-conversion">≈ {conversionLabel(r, baseCurrency)}</small>}
                    </td>
                    <td>{FREQUENCY_LABEL[r.frequency] || r.frequency}</td>
                    <td>
                      <span className={`badge ${r.status === "active" ? "badge-success" : r.status === "paused" ? "badge-warning" : "badge-neutral"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>{r.nextOccurrence || "—"}</td>
                    {canManage && (
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {r.status !== "stopped" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>Edit</button>
                        )}
                        {r.status === "active" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => handlePause(r)}>Pause</button>
                        )}
                        {r.status === "paused" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => handleResume(r)}>Resume</button>
                        )}
                        {r.status !== "stopped" && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleStop(r)}>Stop</button>
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

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit Recurring Expense" : "Add Recurring Expense"}</h2>
            {formError && <div className="error-banner">{formError}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="recurring-vendor">Vendor</label>
                <input id="recurring-vendor" required value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Storage Unit" />
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
                <label htmlFor="recurring-amount">Amount ({form.currency})</label>
                <input id="recurring-amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="recurring-currency">Currency</label>
                <select id="recurring-currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {FALLBACK_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Frequency</label>
                <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Start date</label>
                <input type="date" required disabled={!!editing} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                {editing && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>The start date can't be changed after creation.</div>}
              </div>
              <div className="field">
                <label>End date (optional)</label>
                <input type="date" disabled={!!editing} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Recurring Expense"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
