import { useEffect, useMemo, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { can } from "../permissions.js";

const CATEGORY_SUGGESTIONS = [
  "Venue", "Photography", "Cake", "Dress", "Decor", "Music",
  "Transportation", "Accommodation", "Guests", "Honeymoon", "Catering", "General",
];

const PRIORITIES = ["low", "medium", "high"];

const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_CLASS = { low: "priority-low", medium: "priority-medium", high: "priority-high" };

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

function emptyForm() {
  return { title: "", category: "General", dueDate: "", notes: "", priority: "medium" };
}

function TaskRow({ task, onToggle, onDelete, onEdit, canManage }) {
  const overdue = !task.completed && task.due_date && task.due_date < todayStr();
  return (
    <li className={`task-row ${task.completed ? "completed" : ""}`}>
      <label className="task-checkbox-label">
        <input type="checkbox" checked={task.completed} disabled={!canManage} onChange={() => canManage && onToggle(task)} />
        <span className="task-title">{task.title}</span>
      </label>
      <span className="category-badge">{task.category}</span>
      <span className={`priority-badge ${PRIORITY_CLASS[task.priority] || PRIORITY_CLASS.medium}`}>
        {PRIORITY_LABEL[task.priority] || "Medium"}
      </span>
      {task.due_date && <span className={`relative-date ${overdue ? "overdue" : ""}`}>{relativeLabel(task.due_date)}</span>}
      {canManage && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(task)}>Edit</button>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => onDelete(task.id)}>✕</button>
        </>
      )}
    </li>
  );
}

export default function Planning() {
  const { currentId, current } = useLifeSpace();
  const canManage = can(current?.role, "task:manage");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggleError, setToggleError] = useState("");
  const [view, setView] = useState("timeline");

  // create modal
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm());

  // edit modal
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

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
    const next = !task.completed;
    // Optimistic update
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)));
    setToggleError("");
    try {
      await api.updateTask(task.id, { completed: next });
    } catch (err) {
      // Roll back on failure
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)));
      setToggleError(`Could not update "${task.title}": ${err.message}`);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this task?")) return;
    await api.deleteTask(id);
    await load();
  }

  function openEdit(task) {
    setEditingTask(task);
    setEditForm({
      title: task.title,
      category: task.category,
      dueDate: task.due_date || "",
      notes: task.notes || "",
      priority: task.priority || "medium",
    });
    setEditError("");
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editForm.title.trim()) { setEditError("Title is required."); return; }
    setEditSaving(true);
    setEditError("");
    try {
      await api.updateTask(editingTask.id, {
        title: editForm.title,
        category: editForm.category,
        dueDate: editForm.dueDate || null,
        notes: editForm.notes,
        priority: editForm.priority,
      });
      setEditingTask(null);
      await load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createTask(currentId, createForm);
      setCreateForm({ title: "", category: createForm.category, dueDate: "", notes: "", priority: "medium" });
      setShowCreate(false);
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

        {toggleError && <div className="error-banner" style={{ margin: "12px 0" }}>{toggleError}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 16px" }}>
          <div className="view-toggle">
            <button className={`btn btn-sm ${view === "timeline" ? "btn-primary" : "btn-outline"}`} onClick={() => setView("timeline")}>Timeline</button>
            <button className={`btn btn-sm ${view === "checklist" ? "btn-primary" : "btn-outline"}`} onClick={() => setView("checklist")} style={{ marginLeft: 8 }}>Checklist</button>
          </div>
          {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Add Task</button>}
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
                  {items.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} onEdit={openEdit} canManage={canManage} />)}
                </ul>
              </div>
            ))}
            {timelineGroups.noDate.length > 0 && (
              <div className="card timeline-month">
                <h3>No due date</h3>
                <ul className="task-list">
                  {timelineGroups.noDate.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} onEdit={openEdit} canManage={canManage} />)}
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
                  {items.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onDelete={handleDelete} onEdit={openEdit} canManage={canManage} />)}
                </ul>
              </div>
            );
          })
        )}
      </div>

      {/* Edit modal */}
      {editingTask && (
        <div className="modal-backdrop" onClick={() => setEditingTask(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Task</h2>
            {editError && <div className="error-banner">{editError}</div>}
            <form onSubmit={handleEditSubmit}>
              <div className="field">
                <label htmlFor="edit-title">Task</label>
                <input id="edit-title" required value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="e.g. Book venue" />
              </div>
              <div className="field">
                <label htmlFor="edit-category">Category</label>
                <input id="edit-category" list="edit-category-suggestions" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
                <datalist id="edit-category-suggestions">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="edit-priority">Priority</label>
                <select id="edit-priority" value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="edit-dueDate">Due date</label>
                <input id="edit-dueDate" type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="edit-notes">Notes</label>
                <textarea id="edit-notes" rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEditingTask(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={editSaving}>{editSaving ? "Saving..." : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Task</h2>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label htmlFor="create-title">Task</label>
                <input id="create-title" required value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="e.g. Book venue" />
              </div>
              <div className="field">
                <label htmlFor="create-category">Category</label>
                <input id="create-category" list="category-suggestions" value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} />
                <datalist id="category-suggestions">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="create-priority">Priority</label>
                <select id="create-priority" value={createForm.priority} onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="create-dueDate">Due date</label>
                <input id="create-dueDate" type="date" value={createForm.dueDate} onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="create-notes">Notes</label>
                <textarea id="create-notes" rows={2} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Add Task"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
