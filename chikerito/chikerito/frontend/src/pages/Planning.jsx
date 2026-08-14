import { useEffect, useMemo, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";

const CATEGORY_SUGGESTIONS = [
  "Venue", "Photography", "Cake", "Dress", "Decor", "Music",
  "Transportation", "Accommodation", "Guests", "Honeymoon", "Catering", "General",
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function relativeLabel(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((d - now) / 86400000);
  if (diffDays === 0) return "Today";
  const abs = Math.abs(diffDays);
  const months = Math.round(abs / 30);
  if (diffDays > 0) return abs < 30 ? `In ${abs} day${abs > 1 ? "s" : ""}` : `In ${months} month${months > 1 ? "s" : ""}`;
  return abs < 30 ? `${abs} day${abs > 1 ? "s" : ""} overdue` : `${months} month${months > 1 ? "s" : ""} overdue`;
}

function TaskRow({ task, onToggle, onDelete }) {
  const overdue = !task.completed && task.due_date && task.due_date < todayStr();
  return (
    <li className={`task-row ${task.completed ? "completed" : ""}`}>
      <label className="task-checkbox-label">
        <input type="checkbox" checked={task.completed} onChange={() => onToggle(task)} />
        <span className="task-title">{task.title}</span>
      </label>
      <span className="category-badge">{task.category}</span>
      {task.due_date && <span className={`relative-date ${overdue ? "overdue" : ""}`}>{relativeLabel(task.due_date)}</span>}
      <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => onDelete(task.id)}>✕</button>
    </li>
  );
}

export default function Planning() {
  const { currentId } = useLifeSpace();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("timeline");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", category: "General", dueDate: "", notes: "" });

  async function load() {
    if (!currentId) return;
    setLoading(true);
    const { tasks } = await api.listTasks(currentId);
    setTasks(tasks);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function handleToggle(task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)));
    await api.updateTask(task.id, { completed: !task.completed });
  }

  async function handleDelete(id) {
    if (!confirm("Delete this task?")) return;
    await api.deleteTask(id);
    await load();
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createTask(currentId, form);
      setForm({ title: "", category: form.category, dueDate: "", notes: "" });
      setShowModal(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.completed).length;
    const overdue = tasks.filter((t) => !t.completed && t.due_date && t.due_date < todayStr()).length;
    return { total, done, overdue };
  }, [tasks]);

  const timelineGroups = useMemo(() => {
    const dated = tasks.filter((t) => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const noDate = tasks.filter((t) => !t.due_date);
    const groups = {};
    dated.forEach((t) => {
      const key = t.due_date.slice(0, 7);
      (groups[key] = groups[key] || []).push(t);
    });
    return { groups: Object.entries(groups), noDate };
  }, [tasks]);

  const checklistGroups = useMemo(() => {
    const groups = {};
    tasks.forEach((t) => (groups[t.category] = groups[t.category] || []).push(t));
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  if (!currentId) {
    return (
      <>
        <Topbar title="Event Planning" />
        <div className="page-body"><div className="empty-state card">Create a Life Space first to build a timeline and checklist.</div></div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Event Planning" />
      <div className="page-body">
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="stat-card"><div className="label">Tasks Complete</div><div className="value">{stats.done}/{stats.total}</div></div>
          <div className={`stat-card ${stats.overdue > 0 ? "accent" : ""}`}><div className="label">Overdue</div><div className="value">{stats.overdue}</div></div>
          <div className="stat-card"><div className="label">Progress</div><div className="value">{stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%</div></div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 16px" }}>
          <div className="view-toggle">
            <button className={`btn btn-sm ${view === "timeline" ? "btn-primary" : "btn-outline"}`} onClick={() => setView("timeline")}>Timeline</button>
            <button className={`btn btn-sm ${view === "checklist" ? "btn-primary" : "btn-outline"}`} onClick={() => setView("checklist")} style={{ marginLeft: 8 }}>Checklist</button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Add Task</button>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : tasks.length === 0 ? (
          <div className="empty-state card">No tasks yet. Add your first one — e.g. "Book venue".</div>
        ) : view === "timeline" ? (
          <>
            {timelineGroups.groups.map(([month, items]) => (
              <div className="card timeline-month" key={month}>
                <h3>{monthLabel(items[0].due_date)}</h3>
                <ul className="task-list">
                  {items.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} />)}
                </ul>
              </div>
            ))}
            {timelineGroups.noDate.length > 0 && (
              <div className="card timeline-month">
                <h3>No due date</h3>
                <ul className="task-list">
                  {timelineGroups.noDate.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} />)}
                </ul>
              </div>
            )}
          </>
        ) : (
          checklistGroups.map(([category, items]) => {
            const done = items.filter((t) => t.completed).length;
            return (
              <div className="card checklist-category" key={category}>
                <div className="cat-header">
                  <span className="cat-name">{category}</span>
                  <span className="text-muted">{done}/{items.length}</span>
                </div>
                <div className="progress-track"><div className="progress-fill blue" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
                <ul className="task-list">
                  {items.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} />)}
                </ul>
              </div>
            );
          })
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Task</h2>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label>Task</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Book venue" />
              </div>
              <div className="field">
                <label>Category</label>
                <input list="category-suggestions" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                <datalist id="category-suggestions">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field">
                <label>Due date</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Add Task"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
