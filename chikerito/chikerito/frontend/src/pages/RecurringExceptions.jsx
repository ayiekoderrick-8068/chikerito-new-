import { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import { can } from "../permissions.js";

function isoOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function exceptionPayload(form) {
  return {
    occurrenceDate: form.occurrenceDate,
    action: form.action,
    ...(form.action === "override" ? {
      overrideDate: form.overrideDate || null,
      overrideAmount: form.overrideAmount === "" ? null : Number(form.overrideAmount),
      overrideCategoryId: form.overrideCategoryId === "" ? null : form.overrideCategoryId,
      overrideVendor: form.overrideVendor.trim() || null,
    } : {}),
  };
}

function editorForm(occurrence, exception) {
  return {
    id: exception?.id || null,
    occurrenceDate: exception?.occurrenceDate || occurrence?.occurrenceDate || "",
    action: exception?.action || "override",
    overrideDate: exception?.overrideDate || "",
    overrideAmount: exception?.overrideAmount ?? "",
    overrideCategoryId: exception?.overrideCategoryId ?? "",
    overrideVendor: exception?.overrideVendor || "",
  };
}

function ExceptionEditor({ initial, categories, saving, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave(exceptionPayload(form));
    } catch (err) {
      setError(err.message);
    }
  }

  return <div className="modal-backdrop">
    <div className="modal occurrence-exception-editor" role="dialog" aria-modal="true" aria-labelledby="exception-editor-title">
      <h2 id="exception-editor-title">{form.id ? "Edit occurrence exception" : "Override occurrence"}</h2>
      <p className="muted">Scheduled occurrence: <strong>{form.occurrenceDate}</strong></p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="exception-action">Exception action</label><select id="exception-action" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })}><option value="override">Override details</option><option value="skip">Skip occurrence</option></select></div>
        {form.action === "override" && <div className="exception-fields">
          <div className="field"><label htmlFor="override-date">Override date</label><input id="override-date" type="date" value={form.overrideDate} onChange={(event) => setForm({ ...form, overrideDate: event.target.value })} /></div>
          <div className="field"><label htmlFor="override-amount">Override amount</label><input id="override-amount" type="number" min="0.01" step="0.01" value={form.overrideAmount} onChange={(event) => setForm({ ...form, overrideAmount: event.target.value })} /></div>
          <div className="field"><label htmlFor="override-category">Override category</label><select id="override-category" value={form.overrideCategoryId} onChange={(event) => setForm({ ...form, overrideCategoryId: event.target.value })}><option value="">Keep current / Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div className="field"><label htmlFor="override-vendor">Override vendor</label><input id="override-vendor" value={form.overrideVendor} onChange={(event) => setForm({ ...form, overrideVendor: event.target.value })} /></div>
        </div>}
        <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save exception"}</button></div>
      </form>
    </div>
  </div>;
}

export default function RecurringExceptions() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "expense:manage");
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [range, setRange] = useState({ from: isoOffset(0), to: isoOffset(180) });
  const [appliedRange, setAppliedRange] = useState({ from: isoOffset(0), to: isoOffset(180) });
  const [occurrences, setOccurrences] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [nextOccurrence, setNextOccurrence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);

  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedId) || null, [rules, selectedId]);
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);

  async function loadRules() {
    if (!currentId) return;
    setLoading(true);
    setError("");
    try {
      const [ruleResult, categoryResult] = await Promise.all([api.listRecurringExpenses(currentId), api.listCategories(currentId)]);
      setRules(ruleResult.recurringExpenses);
      setCategories(categoryResult.categories);
      setSelectedId((existing) => ruleResult.recurringExpenses.some((rule) => rule.id === existing) ? existing : ruleResult.recurringExpenses[0]?.id || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails() {
    if (!selectedId) {
      setOccurrences([]);
      setExceptions([]);
      return;
    }
    setDetailLoading(true);
    setError("");
    try {
      const [occurrenceResult, exceptionResult] = await Promise.all([
        api.listRecurringOccurrences(selectedId, { ...appliedRange, limit: 100 }),
        api.listRecurringExceptions(selectedId),
      ]);
      setOccurrences(occurrenceResult.occurrences);
      setNextOccurrence(occurrenceResult.nextOccurrence);
      setExceptions(exceptionResult.exceptions);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    setRules([]);
    setCategories([]);
    setSelectedId("");
    setOccurrences([]);
    setExceptions([]);
    setEditor(null);
    if (currentId) loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  useEffect(() => {
    loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, appliedRange.from, appliedRange.to]);

  async function saveException(payload) {
    setSaving(true);
    try {
      if (editor.id) await api.updateRecurringException(editor.id, payload);
      else await api.createRecurringException(selectedId, payload);
      setEditor(null);
      await loadDetails();
      await loadRules();
    } finally {
      setSaving(false);
    }
  }

  async function skipOccurrence(occurrence) {
    setError("");
    try {
      await api.createRecurringException(selectedId, { occurrenceDate: occurrence.occurrenceDate, action: "skip" });
      await loadDetails();
      await loadRules();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeException(exception) {
    setError("");
    try {
      await api.removeRecurringException(exception.id);
      await loadDetails();
      await loadRules();
    } catch (err) {
      setError(err.message);
    }
  }

  async function restoreException(exception) {
    setError("");
    try {
      await api.restoreRecurringException(exception.id);
      await loadDetails();
      await loadRules();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!currentId) return <><Topbar title="Occurrence Exceptions" /><div className="page-body"><div className="empty-state card">Create a Life Space first to manage recurring occurrences.</div></div></>;

  return <>
    <Topbar title="Occurrence Exceptions" />
    <main className="page-body recurring-exceptions-page">
      <div className="page-heading-row"><div><h2>Recurring occurrence preview</h2><p className="muted">Skip or override one occurrence without changing the rule or other generated expenses.</p></div></div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn btn-ghost btn-sm" onClick={() => selectedId ? loadDetails() : loadRules()}>Try again</button></div>}
      {loading ? <div className="empty-state card" role="status">Loading recurring rules...</div>
        : rules.length === 0 ? <div className="empty-state card"><h3>No recurring expenses yet</h3><p>Create a recurring expense before adding occurrence exceptions.</p></div>
        : <>
          <div className="card occurrence-toolbar">
            <div className="field"><label htmlFor="exception-rule">Recurring rule</label><select id="exception-rule" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.vendor} — {rule.frequency} ({rule.status})</option>)}</select></div>
            <div className="field"><label htmlFor="occurrence-from">From</label><input id="occurrence-from" type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></div>
            <div className="field"><label htmlFor="occurrence-to">To</label><input id="occurrence-to" type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></div>
            <button className="btn btn-secondary" onClick={() => setAppliedRange(range)}>Apply range</button>
          </div>
          {selectedRule && <p className="occurrence-rule-summary"><strong>{selectedRule.vendor}</strong> · {selectedRule.frequency} · Next effective occurrence: <strong>{nextOccurrence || "None"}</strong></p>}
          {detailLoading ? <div className="empty-state card" role="status">Loading occurrence preview...</div>
            : <div className="occurrence-grid">
              <section className="card occurrence-preview" aria-label="Occurrence preview">
                <h3>Upcoming occurrences</h3>
                {occurrences.length === 0 ? <div className="empty-state">No scheduled occurrences in this range.</div> : <div className="table-wrap"><table>
                  <thead><tr><th scope="col">Scheduled</th><th scope="col">Effective date</th><th scope="col">Vendor</th><th scope="col">Category</th><th scope="col">Amount</th><th scope="col">State</th>{canManage && <th scope="col">Actions</th>}</tr></thead>
                  <tbody>{occurrences.map((occurrence) => <tr key={occurrence.occurrenceDate}>
                    <td>{occurrence.occurrenceDate}</td><td>{occurrence.effectiveDate || "—"}</td><td>{occurrence.vendor || selectedRule.vendor}</td><td>{categoryNames.get(occurrence.categoryId) || "Uncategorized"}</td><td>{occurrence.skipped ? "—" : Number(occurrence.amount).toLocaleString()}</td><td><span className={`status-badge ${occurrence.state}`}>{occurrence.materialized ? "materialized" : occurrence.state}</span></td>
                    {canManage && <td><div className="row-actions">{occurrence.exception ? <button className="btn btn-ghost btn-sm" onClick={() => setEditor(editorForm(occurrence, occurrence.exception))}>Edit</button> : <><button className="btn btn-ghost btn-sm" onClick={() => skipOccurrence(occurrence)}>Skip</button><button className="btn btn-ghost btn-sm" onClick={() => setEditor(editorForm(occurrence))}>Override</button></>}</div></td>}
                  </tr>)}</tbody>
                </table></div>}
              </section>
              <section className="card exception-history" aria-label="Exception history">
                <h3>Exception history</h3>
                {exceptions.length === 0 ? <div className="empty-state">No exceptions for this rule.</div> : <ul>{exceptions.map((exception) => <li key={exception.id}>
                  <div><strong>{exception.occurrenceDate}</strong><span>{exception.action}{exception.overrideDate ? ` → ${exception.overrideDate}` : ""}</span><small>{exception.status}{exception.materialized ? " · materialized" : ""}</small></div>
                  {canManage && <div className="row-actions">{exception.status === "removed" ? <button className="btn btn-ghost btn-sm" onClick={() => restoreException(exception)}>Restore</button> : <><button className="btn btn-ghost btn-sm" onClick={() => setEditor(editorForm(null, exception))}>Edit</button><button className="btn btn-ghost btn-sm danger-text" onClick={() => removeException(exception)}>Remove</button></>}</div>}
                </li>)}</ul>}
              </section>
            </div>}
        </>}
    </main>
    {editor && <ExceptionEditor initial={editor} categories={categories} saving={saving} onSave={saveException} onCancel={() => setEditor(null)} />}
  </>;
}

export { ExceptionEditor, exceptionPayload, editorForm, isoOffset };
