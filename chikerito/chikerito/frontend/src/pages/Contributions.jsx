import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { FALLBACK_CURRENCIES, conversionLabel, formatMoney, moneyView } from "../currency.js";

const STATUS_COLORS = {
  pending: "#ffa500",
  completed: "#28a745",
  failed: "#dc3545",
  refunded: "#6c757d",
  voided: "#6c757d",
};

const STATUS_TRANSITIONS = {
  pending: ["completed", "failed", "voided"],
  completed: ["refunded", "voided"],
  failed: ["voided"],
  refunded: [],
  voided: [],
};

export default function Contributions() {
  const { currentId, current } = useLifeSpace();
  const baseCurrency = current?.currency || "USD";
  const [contributions, setContributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    contributorName: "",
    amount: "",
    currency: "USD",
    exchangeRate: "",
    categoryId: "",
    message: "",
    paymentMethod: "manual",
    status: "completed",
    notes: "",
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [categories, setCategories] = useState([]);
  const [updateModal, setUpdateModal] = useState({ show: false, contribution: null, newStatus: null });
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");

  // Load contributions
  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    setError("");
    api
      .listContributions(currentId)
      .then(({ contributions }) => setContributions(contributions))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [currentId]);

  // Load categories for the form
  useEffect(() => {
    if (!currentId) return;
    api
      .listCategories(currentId)
      .then(({ categories }) => setCategories(categories))
      .catch(() => {
        /* ignore errors */
      });
  }, [currentId]);

  if (!currentId) {
    return (
      <>
        <Topbar title="Contributions" />
        <div className="page-body"><div className="empty-state card">Create a Life Space to start receiving contributions.</div></div>
      </>
    );
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateContribution = async (e) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    setFormLoading(true);

    try {
      const payload = {
        contributorName: formData.contributorName || "Anonymous",
        amount: parseFloat(formData.amount),
        currency: formData.currency,
        exchangeRate: formData.currency === baseCurrency ? 1 : Number(formData.exchangeRate),
        categoryId: formData.categoryId || null,
        message: formData.message,
        paymentMethod: formData.paymentMethod,
        status: formData.status,
        notes: formData.notes,
      };

      const { contribution } = await api.createContribution(currentId, payload);
      setContributions((prev) => [contribution, ...prev]);
      setFormSuccess("Contribution created successfully!");
      setFormData({
        contributorName: "",
        amount: "",
        currency: baseCurrency,
        exchangeRate: "",
        categoryId: "",
        message: "",
        paymentMethod: "manual",
        status: "completed",
        notes: "",
      });
      setTimeout(() => {
        setShowForm(false);
        setFormSuccess("");
      }, 2000);
    } catch (err) {
      setFormError(err.message || "Failed to create contribution");
    } finally {
      setFormLoading(false);
    }
  };

  const handleStatusUpdate = async (contribution, newStatus) => {
    setUpdateModal({ show: true, contribution, newStatus });
  };

  const confirmStatusUpdate = async () => {
    if (!updateModal.contribution || !updateModal.newStatus) return;

    setUpdating(true);
    setUpdateError("");

    try {
      const { contribution } = await api.updateContribution(updateModal.contribution.id, {
        status: updateModal.newStatus,
      });
      setContributions((prev) => prev.map((c) => (c.id === contribution.id ? contribution : c)));
      setUpdateModal({ show: false, contribution: null, newStatus: null });
    } catch (err) {
      setUpdateError(err.message || "Failed to update contribution");
    } finally {
      setUpdating(false);
    }
  };

  const getStatusBadge = (status) => (
    <span
      className="badge"
      style={{
        backgroundColor: STATUS_COLORS[status],
        color: "white",
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: "500",
      }}
    >
      {status}
    </span>
  );

  const filtered = contributions.filter((c) => c.contributor_name.toLowerCase().includes(search.toLowerCase()));
  const shareLink = current ? `${window.location.origin}/donate/${current.slug}` : "";

  return (
    <>
      <Topbar title="Contributions" />
      <div className="page-body">
        {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="card" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <strong>Public donation link:</strong>{" "}
            <code style={{ background: "#f2efe8", padding: "4px 8px", borderRadius: 6 }}>{shareLink}</code>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                navigator.clipboard?.writeText(shareLink);
                alert("Copied!");
              }}
            >
              Copy Link
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => {
              if (!showForm) setFormData((value) => ({ ...value, currency: baseCurrency, exchangeRate: "" }));
              setShowForm(!showForm);
            }}>
              {showForm ? "Cancel" : "+ Add Manually"}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="card" style={{ marginBottom: 20, padding: "20px", backgroundColor: "#f9f9f9" }}>
            <h3 style={{ marginTop: 0 }}>Create Manual Contribution</h3>
            {formError && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{formError}</div>}
            {formSuccess && <div className="alert alert-success" style={{ marginBottom: 12 }}>{formSuccess}</div>}
            <form onSubmit={handleCreateContribution}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label>Contributor Name</label>
                  <input
                    type="text"
                    name="contributorName"
                    value={formData.contributorName}
                    onChange={handleFormChange}
                    placeholder="John Doe"
                  />
                </div>
                <div className="field">
                  <label>Amount *</label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleFormChange}
                    placeholder="100"
                    step="0.01"
                    min="0.01"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="contribution-currency">Currency</label>
                  <select id="contribution-currency" name="currency" value={formData.currency} onChange={handleFormChange}>
                    {FALLBACK_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>)}
                  </select>
                </div>
                {formData.currency !== baseCurrency && <div className="field">
                  <label htmlFor="contribution-exchange-rate">Exchange rate ({baseCurrency} per {formData.currency})</label>
                  <input id="contribution-exchange-rate" type="number" name="exchangeRate" min="0.000001" step="any" required value={formData.exchangeRate} onChange={handleFormChange} />
                  <small className="currency-help">The recorded rate will not change later.</small>
                </div>}
                <div className="field">
                  <label>Category</label>
                  <select name="categoryId" value={formData.categoryId} onChange={handleFormChange}>
                    <option value="">-- None --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Payment Method</label>
                  <select name="paymentMethod" value={formData.paymentMethod} onChange={handleFormChange}>
                    <option value="manual">Manual Entry</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select name="status" value={formData.status} onChange={handleFormChange}>
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div className="field">
                  <label>Message</label>
                  <input
                    type="text"
                    name="message"
                    value={formData.message}
                    onChange={handleFormChange}
                    placeholder="Optional message"
                  />
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleFormChange}
                  placeholder="Internal notes (not shown to donor)"
                  rows="2"
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={formLoading}>
                {formLoading ? "Creating..." : "Create Contribution"}
              </button>
            </form>
          </div>
        )}

        <div className="field" style={{ maxWidth: 280, marginBottom: 16 }}>
          <input placeholder="Search by contributor..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="card">
          {loading ? (
            <p>Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="empty-state">No contributions yet. Share your donation link or add contributions manually to get started.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Contributor</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Message</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>{c.contributor_name}</td>
                    <td>
                      {formatMoney(moneyView(c, baseCurrency).originalAmount, moneyView(c, baseCurrency).currency, { showCode: moneyView(c, baseCurrency).currency !== baseCurrency })}
                      {conversionLabel(c, baseCurrency) && <small className="currency-conversion">≈ {conversionLabel(c, baseCurrency)}</small>}
                    </td>
                    <td>{c.payment_method}</td>
                    <td>{getStatusBadge(c.status)}</td>
                    <td style={{ color: "var(--text-muted)" }}>{c.message}</td>
                    <td>
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            handleStatusUpdate(c, e.target.value);
                            e.target.value = "";
                          }
                        }}
                        style={{ fontSize: "12px", padding: "4px 6px" }}
                      >
                        <option value="">Update Status</option>
                        {STATUS_TRANSITIONS[c.status]?.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Status Update Confirmation Modal */}
      {updateModal.show && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !updating && setUpdateModal({ show: false, contribution: null, newStatus: null })}
        >
          <div
            className="card"
            style={{
              padding: "24px",
              maxWidth: "400px",
              backgroundColor: "white",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Update Contribution Status</h3>
            {updateError && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{updateError}</div>}
            <p>
              Change status from <strong>{updateModal.contribution?.status}</strong> to{" "}
              <strong>{updateModal.newStatus}</strong>?
            </p>
            {updateModal.newStatus === "refunded" && (
              <div className="alert alert-info" style={{ marginBottom: 12 }}>
                This contribution will be marked as refunded and will not count toward financial totals.
              </div>
            )}
            {updateModal.newStatus === "voided" && (
              <div className="alert alert-info" style={{ marginBottom: 12 }}>
                This contribution will be marked as voided and will not count toward financial totals.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn btn-outline"
                onClick={() => setUpdateModal({ show: false, contribution: null, newStatus: null })}
                disabled={updating}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmStatusUpdate} disabled={updating}>
                {updating ? "Updating..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
