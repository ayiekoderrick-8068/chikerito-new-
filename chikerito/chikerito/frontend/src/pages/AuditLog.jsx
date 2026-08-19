import { useCallback, useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { api } from "../api";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { can } from "../permissions.js";

const EMPTY_FILTERS = { action: "", resourceType: "", actorId: "", from: "", to: "" };

function humanize(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function eventDescription(log) {
  const label = log.metadata?.label;
  const base = humanize(log.action);
  return label ? `${base}: ${label}` : base;
}

function Metadata({ metadata }) {
  const fields = metadata?.changed_fields || [];
  const details = [];
  if (fields.length) details.push(`Fields: ${fields.map(humanize).join(", ")}`);
  if (metadata?.status) details.push(`Status: ${humanize(metadata.status)}`);
  if (metadata?.role) details.push(`Role: ${humanize(metadata.role)}`);
  if (!details.length) return null;
  return <p className="audit-metadata">{details.join(" · ")}</p>;
}

export default function AuditLog() {
  const { currentId, current } = useLifeSpace();
  const allowed = can(current?.role, "audit:view");
  const [logs, setLogs] = useState([]);
  const [options, setOptions] = useState({ actions: [], resourceTypes: [], actors: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState({ hasMore: false, nextCursor: null });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const activeFilterCount = useMemo(
    () => Object.values(applied).filter(Boolean).length,
    [applied]
  );

  const load = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!currentId || !allowed) return;
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const response = await api.listAuditLogs(currentId, {
        ...applied,
        cursor,
        limit: 25,
      });
      setLogs((existing) => append ? [...existing, ...response.auditLogs] : response.auditLogs);
      setPage(response.page);
    } catch (err) {
      setError(err.message || "Unable to load activity");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [allowed, applied, currentId]);

  useEffect(() => {
    setLogs([]);
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    if (!currentId || !allowed) return;
    api.getAuditFilterOptions(currentId)
      .then(setOptions)
      .catch(() => setOptions({ actions: [], resourceTypes: [], actors: [] }));
  }, [allowed, currentId]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(event) {
    event.preventDefault();
    setApplied({ ...filters });
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  if (!currentId) {
    return (
      <>
        <Topbar title="Activity Log" />
        <div className="page-body"><div className="empty-state card">Create a Life Space to view its activity.</div></div>
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <Topbar title="Activity Log" />
        <div className="page-body">
          <div className="empty-state card" role="status">
            Activity history is available to owners and finance managers.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Activity Log" />
      <div className="page-body audit-page">
        <div className="audit-intro">
          <div>
            <h2>Life Space activity</h2>
            <p>Review important changes, who made them, and when they happened.</p>
          </div>
          {activeFilterCount > 0 && <span className="badge badge-neutral">{activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}</span>}
        </div>

        <form className="card audit-filters" onSubmit={applyFilters} aria-label="Audit log filters">
          <div className="field">
            <label htmlFor="audit-action">Action</label>
            <select id="audit-action" value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
              <option value="">All actions</option>
              {options.actions.map((action) => <option value={action} key={action}>{humanize(action)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-resource">Resource</label>
            <select id="audit-resource" value={filters.resourceType} onChange={(event) => setFilters({ ...filters, resourceType: event.target.value })}>
              <option value="">All resources</option>
              {options.resourceTypes.map((type) => <option value={type} key={type}>{humanize(type)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-actor">Actor</label>
            <select id="audit-actor" value={filters.actorId} onChange={(event) => setFilters({ ...filters, actorId: event.target.value })}>
              <option value="">All actors</option>
              {options.actors.map((actor) => <option value={actor.id} key={actor.id}>{actor.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-from">From</label>
            <input id="audit-from" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="audit-to">To</label>
            <input id="audit-to" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
          </div>
          <div className="audit-filter-actions">
            <button className="btn btn-primary" type="submit">Apply filters</button>
            <button className="btn btn-ghost" type="button" onClick={clearFilters}>Clear</button>
          </div>
        </form>

        {error && (
          <div className="error-banner audit-error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => load()}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="card audit-state" role="status">Loading activity…</div>
        ) : logs.length === 0 && !error ? (
          <div className="card empty-state audit-state">
            <h3>{activeFilterCount ? "No matching activity" : "No activity yet"}</h3>
            <p>{activeFilterCount ? "Try clearing one or more filters." : "Important changes will appear here as your team works."}</p>
            {activeFilterCount > 0 && <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : (
          <section className="card audit-card" aria-label="Activity history">
            <ol className="audit-list">
              {logs.map((log) => (
                <li className="audit-event" key={log.id}>
                  <div className="audit-marker" aria-hidden="true" />
                  <div className="audit-event-body">
                    <div className="audit-event-heading">
                      <strong>{eventDescription(log)}</strong>
                      <time dateTime={log.occurred_at}>{formatTime(log.occurred_at)}</time>
                    </div>
                    <p className="audit-actor">By {log.actor_name} · {humanize(log.resource_type)}</p>
                    <Metadata metadata={log.metadata} />
                  </div>
                </li>
              ))}
            </ol>
            {page.hasMore && (
              <div className="audit-more">
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={loadingMore}
                  onClick={() => load({ append: true, cursor: page.nextCursor })}
                >
                  {loadingMore ? "Loading more…" : "Load more"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}

export { EMPTY_FILTERS, eventDescription, formatTime, humanize };
