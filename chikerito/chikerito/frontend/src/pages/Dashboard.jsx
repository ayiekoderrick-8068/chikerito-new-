import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Link } from "react-router-dom";
import { conversionLabel, formatMoney, moneyView } from "../currency.js";

const COLORS = ["#1f4fa3", "#b08d57", "#4472c4", "#d4b483", "#2f9e63", "#c97a2b", "#8e6fb0", "#5a9bd5"];

export default function Dashboard() {
  const { currentId, current, loading: lsLoading } = useLifeSpace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    setError("");
    api.getDashboard(currentId).then(setData).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [currentId]);

  if (lsLoading) return null;

  if (!currentId) {
    return (
      <div className="main-area">
        <Topbar title="Mission Control" />
        <div className="page-body">
          <div className="empty-state card">
            <h2>Create your first Life Space</h2>
            <p>Set up a milestone to unlock your Mission Control dashboard.</p>
            <Link to="/app/life-spaces" className="btn btn-primary" style={{ marginTop: 16 }}>+ Create Life Space</Link>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <>
        <Topbar title="Mission Control" />
        <div className="page-body"><div className="empty-state card error-banner">{error}</div></div>
      </>
    );
  }

  if (loading || !data) {
    return (
      <>
        <Topbar title="Mission Control" />
        <div className="page-body">Loading dashboard...</div>
      </>
    );
  }

  const { stats, categoryBreakdown, financialHealth, upcomingRecurringExpenses, notifications, recentContributions } = data;
  const baseCurrency = stats.currency || current?.currency || "USD";
  const pieData = categoryBreakdown.filter((c) => c.spent > 0).map((c) => ({ name: c.name, value: c.spent }));

  return (
    <>
      <Topbar title="Mission Control" />
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card"><div className="label">Goal</div><div className="value">{formatMoney(stats.goal, baseCurrency)}</div></div>
          <div className="stat-card"><div className="label">Raised</div><div className="value">{formatMoney(stats.raised, baseCurrency)}</div></div>
          <div className="stat-card"><div className="label">Spent</div><div className="value">{formatMoney(stats.spent, baseCurrency)}</div></div>
          <div className="stat-card accent"><div className="label">Available Balance</div><div className="value">{formatMoney(stats.available, baseCurrency)}</div></div>
          <div className="stat-card"><div className="label">Remaining Goal</div><div className="value">{formatMoney(stats.remainingGoal, baseCurrency)}</div></div>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Overall Progress</strong>
            <span>{stats.progress}% of goal</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${stats.progress}%` }} /></div>
        </div>

        <div className="two-col">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Spending by Category</h3>
            {pieData.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No expenses recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {pieData.map((entry, i) => (
                      <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatMoney(v, baseCurrency)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Financial Health</h3>
            <div style={{ fontSize: 40, fontFamily: "'Playfair Display', serif", color: "var(--navy)", fontWeight: 700 }}>
              {financialHealth.score}/100
            </div>
            <span className={`badge ${financialHealth.score >= 85 ? "badge-success" : financialHealth.score >= 65 ? "badge-warning" : "badge-danger"}`}>
              {financialHealth.rating}
            </span>
            <ul style={{ marginTop: 16, paddingLeft: 18, fontSize: 13.5, color: "var(--text-muted)" }}>
              {financialHealth.flags.length === 0 ? (
                <li>✓ Everything looks healthy</li>
              ) : (
                financialHealth.flags.map((f) => <li key={f}>⚠ {f}</li>)
              )}
            </ul>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Upcoming Recurring Expenses</h3>
          {upcomingRecurringExpenses && upcomingRecurringExpenses.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No upcoming recurring expenses scheduled.</p>
          ) : !upcomingRecurringExpenses ? (
            <p style={{ color: "var(--text-muted)" }}>Loading...</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Due Date</th><th>Vendor</th><th>Category</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {upcomingRecurringExpenses.map((r, i) => {
                  const category = categoryBreakdown.find((c) => c.id === r.categoryId);
                  return (
                    <tr key={`${r.recurringExpenseId}-${i}`}>
                      <td>{new Date(`${r.dueDate}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC" })}</td>
                      <td>{r.vendor}</td>
                      <td>{r.category || category?.name || "—"}</td>
                      <td>
                        {formatMoney(moneyView(r, baseCurrency).originalAmount, moneyView(r, baseCurrency).currency, { showCode: moneyView(r, baseCurrency).currency !== baseCurrency })}
                        {conversionLabel(r, baseCurrency) && <small className="currency-conversion">≈ {conversionLabel(r, baseCurrency)}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {financialHealth?.projectedOver?.length > 0 && (
            <div style={{ marginTop: 12, padding: "12px", backgroundColor: "#fff3cd", borderRadius: "6px", fontSize: 13 }}>
              <strong>Budget Alert:</strong> {financialHealth.projectedOver.map((c) => c.name).join(", ")} will likely exceed budget after upcoming expenses.
            </div>
          )}
        </div>

        <div className="two-col" style={{ marginTop: 0 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Recent Contributions</h3>
            {recentContributions.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No contributions yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Contributor</th><th>Amount</th><th>Message</th></tr>
                </thead>
                <tbody>
                  {recentContributions.map((c) => (
                    <tr key={c.id}>
                      <td>{c.contributor_name}</td>
                      <td>
                        {formatMoney(moneyView(c, baseCurrency).originalAmount, moneyView(c, baseCurrency).currency, { showCode: moneyView(c, baseCurrency).currency !== baseCurrency })}
                        {conversionLabel(c, baseCurrency) && <small className="currency-conversion">≈ {conversionLabel(c, baseCurrency)}</small>}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>{c.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Notifications</h3>
            {notifications.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div className="notif-item" key={n.id}>
                  <span>{n.type === "milestone_funded" ? "🏆" : n.type === "budget_warning" ? "⚠️" : n.type === "donation" ? "💛" : n.type === "team_joined" ? "🤝" : "🧾"}</span>
                  <span>{n.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
