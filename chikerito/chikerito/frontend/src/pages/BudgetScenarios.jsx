import { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { can } from "../permissions.js";

function defaultHorizon() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function emptyDraft() {
  return { name: "", description: "", horizonDate: defaultHorizon(), allocations: [] };
}

function money(value, currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function allocationMap(categories, allocations = []) {
  const existing = new Map(allocations.map((allocation) => [allocation.categoryId, allocation]));
  return categories.map((category) => {
    const allocation = existing.get(category.id) || {};
    return {
      categoryId: category.id,
      categoryName: category.name,
      currentBudget: category.budget_amount,
      budgetAmount: allocation.budgetAmount ?? "",
      projectedExpenses: allocation.projectedExpenses || "",
      projectedContributions: allocation.projectedContributions || "",
      note: allocation.note || "",
    };
  });
}

function payloadFromDraft(draft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    horizonDate: draft.horizonDate,
    allocations: draft.allocations
      .filter((allocation) =>
        allocation.budgetAmount !== ""
        || allocation.projectedExpenses !== ""
        || allocation.projectedContributions !== ""
        || allocation.note.trim()
      )
      .map((allocation) => ({
        categoryId: allocation.categoryId,
        budgetAmount: allocation.budgetAmount === "" ? null : Number(allocation.budgetAmount),
        projectedExpenses: Number(allocation.projectedExpenses || 0),
        projectedContributions: Number(allocation.projectedContributions || 0),
        note: allocation.note.trim(),
      })),
  };
}

function ScenarioForecast({ forecast }) {
  if (!forecast) return null;
  const { totals, comparison, categoryForecasts, recurringOccurrences, warnings, currency } = forecast;
  return (
    <section className="scenario-forecast" aria-label="Scenario forecast">
      <div className="scenario-stat-grid">
        <div className="stat-card"><div className="label">Scenario budget</div><div className="value">{money(totals.scenarioBudget, currency)}</div><small>{money(totals.budgetChange, currency)} vs current</small></div>
        <div className="stat-card accent"><div className="label">Forecast spending</div><div className="value">{money(totals.forecastSpent, currency)}</div><small>{money(totals.projectedRecurring, currency)} recurring</small></div>
        <div className="stat-card"><div className="label">Forecast raised</div><div className="value">{money(totals.forecastRaised, currency)}</div><small>{money(totals.projectedContributions, currency)} hypothetical</small></div>
        <div className={`stat-card ${totals.fundingGap > 0 ? "warning-card" : ""}`}><div className="label">Funding gap</div><div className="value">{money(totals.fundingGap, currency)}</div><small>Through {forecast.horizonDate}</small></div>
      </div>

      {warnings.length > 0 && <div className="scenario-warnings" role="alert" aria-label="Projected budget warnings">
        <strong>Projected warnings</strong>
        <ul>{warnings.map((warning, index) => <li key={`${warning.categoryId || "total"}-${index}`}>{warning.message}</li>)}</ul>
      </div>}

      <div className="card scenario-comparison">
        <h3>Current vs scenario</h3>
        <table>
          <thead><tr><th scope="col">Measure</th><th scope="col">Current</th><th scope="col">Scenario</th><th scope="col">Change</th></tr></thead>
          <tbody>
            {Object.entries(comparison).map(([key, values]) => <tr key={key}>
              <th scope="row">{key[0].toUpperCase() + key.slice(1)}</th>
              <td>{money(values.current, currency)}</td>
              <td>{money(values.scenario, currency)}</td>
              <td className={values.difference > 0 ? "scenario-positive" : values.difference < 0 ? "scenario-negative" : ""}>{money(values.difference, currency)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="card scenario-categories">
        <h3>Category forecast</h3>
        {categoryForecasts.length === 0 ? <p className="muted">No budget categories are available.</p> : <div className="table-wrap"><table>
          <thead><tr><th scope="col">Category</th><th scope="col">Budget</th><th scope="col">Spent now</th><th scope="col">Recurring</th><th scope="col">Other plans</th><th scope="col">Forecast</th><th scope="col">Status</th></tr></thead>
          <tbody>{categoryForecasts.map((category) => <tr key={category.categoryId}>
            <th scope="row">{category.name}</th>
            <td>{money(category.scenarioBudget, currency)}</td>
            <td>{money(category.currentSpent, currency)}</td>
            <td>{money(category.projectedRecurring, currency)}</td>
            <td>{money(category.projectedExpenses, currency)}</td>
            <td>{money(category.forecastSpent, currency)}</td>
            <td>{category.projectedOverBudget ? <span className="status-badge overdue">Over by {money(category.overBudgetBy, currency)}</span> : <span className="status-badge completed">Within budget</span>}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>

      <div className="card scenario-occurrences">
        <h3>Projected recurring expenses</h3>
        {recurringOccurrences.length === 0 ? <p className="muted">No active recurring expenses fall within this horizon.</p> : <ul>
          {recurringOccurrences.map((occurrence) => <li key={`${occurrence.recurringExpenseId}-${occurrence.dueDate}`}>
            <span>{occurrence.vendor}</span><strong>{money(occurrence.amount, currency)}</strong><time dateTime={occurrence.dueDate}>{occurrence.dueDate}</time>
          </li>)}
        </ul>}
      </div>
    </section>
  );
}

function ScenarioEditor({ categories, initial, saving, onCancel, onPreview, onSave }) {
  const [draft, setDraft] = useState(() => ({
    ...emptyDraft(),
    ...initial,
    allocations: allocationMap(categories, initial?.allocations),
  }));
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  function changeAllocation(categoryId, field, value) {
    setDraft((current) => ({
      ...current,
      allocations: current.allocations.map((allocation) => allocation.categoryId === categoryId ? { ...allocation, [field]: value } : allocation),
    }));
  }

  async function previewDraft() {
    setError("");
    setPreviewing(true);
    try {
      const result = await onPreview(payloadFromDraft(draft));
      setPreview(result.forecast);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave(payloadFromDraft(draft));
    } catch (err) {
      setError(err.message);
    }
  }

  return <div className="modal-backdrop">
    <div className="modal scenario-editor" role="dialog" aria-modal="true" aria-labelledby="scenario-editor-title">
      <h2 id="scenario-editor-title">{initial?.id ? "Edit budget scenario" : "Create budget scenario"}</h2>
      <p className="muted">Forecast ideas safely. Previewing and saving never changes real budgets, expenses, or contributions.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <div className="scenario-editor-basics">
          <div className="field"><label htmlFor="scenario-name">Scenario name</label><input id="scenario-name" required maxLength="120" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="field"><label htmlFor="scenario-horizon">Forecast through</label><input id="scenario-horizon" type="date" required value={draft.horizonDate} onChange={(event) => setDraft({ ...draft, horizonDate: event.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="scenario-description">Description</label><textarea id="scenario-description" maxLength="1000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>

        <fieldset className="scenario-allocation-editor">
          <legend>Category assumptions</legend>
          {draft.allocations.length === 0 ? <p className="muted">Create budget categories before adding category assumptions.</p> : draft.allocations.map((allocation) => <div className="scenario-allocation-row" key={allocation.categoryId}>
            <div><strong>{allocation.categoryName}</strong><small>Current budget {money(allocation.currentBudget)}</small></div>
            <label>Scenario budget<input aria-label={`${allocation.categoryName} scenario budget`} type="number" min="0" step="0.01" placeholder={String(allocation.currentBudget)} value={allocation.budgetAmount} onChange={(event) => changeAllocation(allocation.categoryId, "budgetAmount", event.target.value)} /></label>
            <label>Extra expenses<input aria-label={`${allocation.categoryName} projected expenses`} type="number" min="0" step="0.01" value={allocation.projectedExpenses} onChange={(event) => changeAllocation(allocation.categoryId, "projectedExpenses", event.target.value)} /></label>
            <label>Expected contributions<input aria-label={`${allocation.categoryName} projected contributions`} type="number" min="0" step="0.01" value={allocation.projectedContributions} onChange={(event) => changeAllocation(allocation.categoryId, "projectedContributions", event.target.value)} /></label>
            <label>Note<input aria-label={`${allocation.categoryName} note`} maxLength="255" value={allocation.note} onChange={(event) => changeAllocation(allocation.categoryId, "note", event.target.value)} /></label>
          </div>)}
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-secondary" disabled={previewing || saving} onClick={previewDraft}>{previewing ? "Previewing..." : "Preview safely"}</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save scenario"}</button>
        </div>
      </form>
      {preview && <div className="scenario-editor-preview"><h3>Draft preview</h3><ScenarioForecast forecast={preview} /></div>}
    </div>
  </div>;
}

export default function BudgetScenarios() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "scenario:manage");
  const [scenarios, setScenarios] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);

  const selected = useMemo(() => scenarios.find((scenario) => scenario.id === selectedId) || scenarios[0] || null, [scenarios, selectedId]);

  async function load() {
    if (!currentId) return;
    setLoading(true);
    setError("");
    try {
      const [scenarioResult, categoryResult] = await Promise.all([
        api.listBudgetScenarios(currentId),
        api.listCategories(currentId),
      ]);
      setScenarios(scenarioResult.scenarios);
      setCategories(categoryResult.categories);
      setSelectedId((existing) => scenarioResult.scenarios.some((scenario) => scenario.id === existing) ? existing : scenarioResult.scenarios[0]?.id || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setScenarios([]);
    setCategories([]);
    setSelectedId(null);
    setEditor(null);
    if (currentId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function saveScenario(payload) {
    setSaving(true);
    try {
      const result = editor?.id
        ? await api.updateBudgetScenario(editor.id, payload)
        : await api.createBudgetScenario(currentId, payload);
      setEditor(null);
      await load();
      setSelectedId(result.scenario.id);
    } finally {
      setSaving(false);
    }
  }

  async function deleteScenario(scenario) {
    if (!window.confirm(`Delete scenario "${scenario.name}"?`)) return;
    setError("");
    try {
      await api.deleteBudgetScenario(scenario.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!currentId) return <><Topbar title="Budget Scenarios" /><div className="page-body"><div className="empty-state card">Create a Life Space first to forecast budget scenarios.</div></div></>;

  return <>
    <Topbar title="Budget Scenarios" />
    <main className="page-body budget-scenarios-page">
      <div className="page-heading-row">
        <div><h2>What-if financial planning</h2><p className="muted">Compare hypothetical budgets without changing live financial records.</p></div>
        {canManage && <button className="btn btn-primary" onClick={() => setEditor(emptyDraft())}>+ New scenario</button>}
      </div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn btn-ghost btn-sm" onClick={load}>Try again</button></div>}
      {loading ? <div className="empty-state card" role="status">Loading budget scenarios...</div>
        : scenarios.length === 0 ? <div className="empty-state card"><h3>No budget scenarios yet</h3><p>Model a possible plan and compare it with your current finances.</p>{canManage && <button className="btn btn-primary btn-sm" onClick={() => setEditor(emptyDraft())}>Create first scenario</button>}</div>
        : <div className="scenario-layout">
          <aside className="scenario-list" aria-label="Budget scenarios">
            {scenarios.map((scenario) => <article key={scenario.id} className={`card scenario-list-card ${selected?.id === scenario.id ? "selected" : ""}`}>
              <button className="scenario-select" onClick={() => setSelectedId(scenario.id)} aria-pressed={selected?.id === scenario.id}>
                <strong>{scenario.name}</strong><span>Through {scenario.horizonDate}</span><small>{scenario.summary.warningCount} projected warning{scenario.summary.warningCount === 1 ? "" : "s"}</small>
              </button>
              {canManage && <div className="scenario-card-actions"><button className="btn btn-ghost btn-sm" onClick={() => setEditor(scenario)}>Edit</button><button className="btn btn-ghost btn-sm danger-text" onClick={() => deleteScenario(scenario)}>Delete</button></div>}
            </article>)}
          </aside>
          <div className="scenario-detail">
            <header><h2>{selected.name}</h2>{selected.description && <p>{selected.description}</p>}<p className="muted">Read-only forecast as of {selected.forecast.asOf}; real financial records are unchanged.</p></header>
            <ScenarioForecast forecast={selected.forecast} />
          </div>
        </div>}
    </main>
    {editor && <ScenarioEditor
      key={editor.id || "new"}
      categories={categories}
      initial={editor}
      saving={saving}
      onCancel={() => setEditor(null)}
      onPreview={(payload) => api.previewBudgetScenario(currentId, payload)}
      onSave={saveScenario}
    />}
  </>;
}

export { ScenarioForecast, ScenarioEditor, allocationMap, payloadFromDraft, money };
