import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function Analytics() {
  const { currentId } = useLifeSpace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    api.getDashboard(currentId).then(setData).finally(() => setLoading(false));
  }, [currentId]);

  if (!currentId) {
    return (
      <>
        <Topbar title="Analytics" />
        <div className="page-body"><div className="empty-state card">Create a Life Space to see analytics.</div></div>
      </>
    );
  }

  if (loading || !data) {
    return (
      <>
        <Topbar title="Analytics" />
        <div className="page-body">Loading...</div>
      </>
    );
  }

  const { categoryBreakdown, monthlyTrend } = data;
  const budgetVsActual = categoryBreakdown.map((c) => ({ name: c.name, Budget: c.budget, Spent: c.spent }));

  return (
    <>
      <Topbar title="Analytics" />
      <div className="page-body">
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Budget vs. Actual Spending</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={budgetVsActual}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis />
              <Tooltip formatter={(v) => `$${v.toLocaleString()}`} />
              <Legend />
              <Bar dataKey="Budget" fill="#d4b483" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Spent" fill="#1f4fa3" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Monthly Expense Trend</h3>
          {monthlyTrend.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No expense history yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => `$${v.toLocaleString()}`} />
                <Line type="monotone" dataKey="total" stroke="#b08d57" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}
