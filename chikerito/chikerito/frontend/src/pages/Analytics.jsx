import { useEffect, useMemo, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { formatMoney, changeLabel, downloadAnalyticsCsv } from "../analyticsUtils.js";
import { analyticsPreset, rangeLabel } from "../analyticsPresets.js";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const EMPTY_FILTERS = { from: "", to: "", categoryId: "", comparison: "none" };

function MetricCard({ label, value, change, tone = "" }) {
  return <div className={`stat-card ${tone}`}><div className="label">{label}</div><div className="value">{value}</div>{change !== undefined && <div className="analytics-change">{changeLabel(change)}</div>}</div>;
}

function Filters({ filters, categories, busy, onChange, onApply, onClear }) {
  const invalidRange = filters.from && filters.to && filters.from > filters.to;
  const incompleteComparison = filters.comparison === "previous" && (!filters.from || !filters.to);
  return (
    <form className="card analytics-filters" onSubmit={(event) => { event.preventDefault(); onApply(); }}>
      <div className="analytics-presets" aria-label="Quick date ranges">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...filters, ...analyticsPreset("this-month") })}>This month</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...filters, ...analyticsPreset("last-30-days") })}>Last 30 days</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...filters, ...analyticsPreset("year-to-date") })}>Year to date</button>
      </div>
      <div className="field"><label htmlFor="analytics-from">From</label><input id="analytics-from" aria-label="From" type="date" value={filters.from} onChange={(event) => onChange({ ...filters, from: event.target.value })} /></div>
      <div className="field"><label htmlFor="analytics-to">To</label><input id="analytics-to" aria-label="To" type="date" value={filters.to} onChange={(event) => onChange({ ...filters, to: event.target.value })} /></div>
      <div className="field"><label htmlFor="analytics-category">Category</label><select id="analytics-category" aria-label="Category" value={filters.categoryId} onChange={(event) => onChange({ ...filters, categoryId: event.target.value })}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
      <div className="field"><label htmlFor="analytics-comparison">Comparison</label><select id="analytics-comparison" aria-label="Comparison" value={filters.comparison} onChange={(event) => onChange({ ...filters, comparison: event.target.value })}><option value="none">No comparison</option><option value="previous">Previous period</option></select></div>
      <div className="analytics-filter-actions"><button className="btn btn-primary" disabled={busy || invalidRange || incompleteComparison}>Apply filters</button><button type="button" className="btn btn-ghost" onClick={onClear} disabled={busy}>Clear</button></div>
      {invalidRange && <div className="error-banner analytics-filter-error">From date must be on or before To date.</div>}
      {incompleteComparison && <div className="analytics-filter-error">Choose both dates to compare with the previous period.</div>}
    </form>
  );
}

export default function Analytics() {
  const { currentId, current } = useLifeSpace();
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [requestKey, setRequestKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }, [currentId]);
  useEffect(() => {
    if (!currentId) return undefined;
    let active = true;
    setLoading(true); setError("");
    Promise.all([api.getAnalytics(currentId, applied), api.listCategories(currentId)])
      .then(([analyticsResult, categoryResult]) => { if (active) { setData(analyticsResult.analytics); setCategories(categoryResult.categories); } })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentId, applied, requestKey]);

  const money = useMemo(() => (value) => formatMoney(value, data?.currency || current?.currency || "USD"), [data?.currency, current?.currency]);
  if (!currentId) return <><Topbar title="Analytics" /><div className="page-body"><div className="empty-state card">Create a Life Space to see analytics.</div></div></>;

  return <><Topbar title="Analytics" /><div className="page-body">
    <div className="analytics-heading"><div><h2>Financial Analytics</h2><p>Explore spending, fundraising, and budget performance.</p>{data && <span className="analytics-range-label">{rangeLabel(data.filters)}</span>}</div><button className="btn btn-outline" disabled={!data || loading} onClick={() => downloadAnalyticsCsv(data, current?.title)}>Export CSV</button></div>
    <Filters filters={draft} categories={categories} busy={loading} onChange={setDraft} onApply={() => setApplied({ ...draft })} onClear={() => { setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }} />
    {error ? <div className="empty-state card error-banner"><h3>Analytics could not be loaded</h3><p>{error}</p><button className="btn btn-outline" onClick={() => setRequestKey((value) => value + 1)}>Try again</button></div>
      : loading || !data ? <div className="card analytics-loading" role="status">Loading analytics…</div>
      : <>
        <div className="stat-grid analytics-stat-grid">
          <MetricCard label="Spent" value={money(data.summary.spent)} change={data.comparison?.changes.spent} />
          <MetricCard label="Raised" value={money(data.summary.raised)} change={data.comparison?.changes.raised} />
          <MetricCard label="Net" value={money(data.summary.net)} change={data.comparison?.changes.net} tone={data.summary.net >= 0 ? "accent" : ""} />
          <MetricCard label="Budget remaining" value={money(data.summary.variance)} /><MetricCard label="Average expense" value={money(data.summary.averageExpense)} />
        </div>
        <section className="card analytics-period-summary" aria-label="Period activity summary">
          <div><span>Expenses</span><strong>{data.summary.expenseCount}</strong></div>
          <div><span>Contributions</span><strong>{data.summary.contributionCount}</strong></div>
          <div><span>Largest expense</span><strong>{money(data.summary.largestExpense)}</strong></div>
          <div><span>Largest contribution</span><strong>{money(data.summary.largestContribution)}</strong></div>
          <div><span>Uncategorized spend</span><strong>{money(data.summary.uncategorizedSpent)}</strong></div>
          {data.summary.durationDays !== null && data.summary.durationDays !== undefined &&
            <div><span>Days in period</span><strong>{data.summary.durationDays}</strong></div>}
          {data.summary.dailyAverageSpent !== null && <div><span>Daily average</span><strong>{money(data.summary.dailyAverageSpent)}</strong></div>}
        </section>
        {data.insights?.length > 0 && <section className="card analytics-insights" aria-label="Analytics insights"><h3>Insights</h3><ul>{data.insights.map((insight) => <li key={insight.code} className={`analytics-insight analytics-insight-${insight.type}`}>{insight.message}</li>)}</ul></section>}
        {data.summary.expenseCount === 0 && data.summary.contributionCount === 0 ? <div className="empty-state card"><h3>No activity in this period</h3><p>Adjust filters or record financial activity to populate analytics.</p></div> :
          <div className="two-col analytics-charts">
            <div className="card"><h3>Budget vs. actual</h3>{data.categoryBreakdown.length === 0 ? <p>No category data.</p> : <ResponsiveContainer width="100%" height={300}><BarChart data={data.categoryBreakdown}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip formatter={money} /><Legend /><Bar dataKey="budget" name="Budget" fill="#d4b483" /><Bar dataKey="spent" name="Spent" fill="#1f4fa3" /></BarChart></ResponsiveContainer>}</div>
            <div className="card"><h3>Monthly expense trend</h3>{data.monthlyTrend.length === 0 ? <p>No expense history in this period.</p> : <ResponsiveContainer width="100%" height={300}><LineChart data={data.monthlyTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={money} /><Line type="monotone" dataKey="total" name="Spent" stroke="#b08d57" strokeWidth={3} /></LineChart></ResponsiveContainer>}</div>
          </div>}
        <div className="two-col analytics-tables">
          <div className="card"><h3>Category performance</h3>{data.categoryBreakdown.length === 0 ? <p>No categories match these filters.</p> : <table className="table"><thead><tr><th>Category</th><th>Spent</th><th>Variance</th><th>Used</th></tr></thead><tbody>{data.categoryBreakdown.map((row) => <tr key={row.id}><td>{row.name}</td><td>{money(row.spent)}</td><td>{money(row.variance)}</td><td>{row.utilization === null ? "—" : `${row.utilization}%`}</td></tr>)}</tbody></table>}</div>
          <div className="card"><h3>Top vendors</h3>{data.topVendors.length === 0 ? <p>No vendors match these filters.</p> : <table className="table"><thead><tr><th>Vendor</th><th>Spent</th><th>Transactions</th></tr></thead><tbody>{data.topVendors.map((row) => <tr key={row.vendor}><td>{row.vendor}</td><td>{money(row.total)}</td><td>{row.count}</td></tr>)}</tbody></table>}</div>
        </div>
        <div className="card analytics-status"><h3>Expense status</h3>{data.statusBreakdown.length === 0 ? <p>No expense statuses in this period.</p> : <div className="analytics-status-list">{data.statusBreakdown.map((row) => <div key={row.status}><span className="badge badge-neutral">{row.status}</span><strong>{row.count}</strong></div>)}</div>}</div>
      </>}
  </div></>;
}
