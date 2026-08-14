import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Link } from "react-router-dom";

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

  const { stats, categoryBreakdown, financialHealth, notifications, recentContributions } = data;
  const pieData = categoryBreakdown.filter((c) => c.spent > 0).map((c) => ({ name: c.name, value: c.spent }));

  return (
    <>
      <Topbar title="Mission Control" />
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card"><div className="label">Goal</div><div className="value">${stats.goal.toLocaleString()}</div></div>
          <div className="stat-card"><div className="label">Raised</div><div className="value">${stats.raised.toLocaleString()}</div></div>
          <div className="stat-card"><div className="label">Spent</div><div className="value">${stats.spent.toLocaleString()}</div></div>
          <div className="stat-card accent"><div className="label">Available Balance</div><div className="value">${stats.available.toLocaleString()}</div></div>
          <div className="stat-card"><div className="label">Remaining Goal</div><div className="value">${stats.remainingGoal.toLocaleString()}</div></div>
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
                  <Tooltip formatter={(v) => `$${v.toLocaleString()}`} />
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

        <div className="two-col" style={{ marginTop: 24 }}>
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
                      <td>${c.amount.toLocaleString()}</td>
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
                  <span>{n.type === "milestone_funded" ? "🏆" : n.type === "budget_warning" ? "⚠️" : n.type === "donation" ? "💛" : "🧾"}</span>
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
