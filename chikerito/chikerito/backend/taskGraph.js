const db = require("./db");

function compareTasks(a, b) {
  return (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31")
    || (a.created_at || "").localeCompare(b.created_at || "")
    || a.id.localeCompare(b.id);
}

function tasksForSpace(lifeSpaceId) {
  return db.table("tasks").where((task) => task.life_space_id === lifeSpaceId);
}

function dependencyRows(lifeSpaceId) {
  return db.table("task_dependencies").where((row) => row.life_space_id === lifeSpaceId);
}

function taskInSpace(id, lifeSpaceId) {
  const task = db.table("tasks").find(id);
  return task && task.life_space_id === lifeSpaceId ? task : null;
}

function childMap(tasks) {
  const map = new Map(tasks.map((task) => [task.id, []]));
  for (const task of tasks) {
    if (task.parent_task_id && map.has(task.parent_task_id)) map.get(task.parent_task_id).push(task);
  }
  for (const children of map.values()) children.sort(compareTasks);
  return map;
}

function descendantsOf(taskId, tasks) {
  const children = childMap(tasks);
  const descendants = [];
  const pending = [...(children.get(taskId) || [])];
  const seen = new Set();
  while (pending.length) {
    const task = pending.shift();
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    descendants.push(task);
    pending.push(...(children.get(task.id) || []));
  }
  return descendants;
}

function dependencyIdsFor(taskId, rows) {
  return rows.filter((row) => row.task_id === taskId).map((row) => row.dependency_task_id);
}

function dependencyPathExists(fromTaskId, targetTaskId, rows) {
  const pending = [fromTaskId];
  const seen = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (id === targetTaskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...dependencyIdsFor(id, rows));
  }
  return false;
}

function parentPathContains(startId, targetId, tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set();
  let currentId = startId;
  while (currentId) {
    if (currentId === targetId) return true;
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    currentId = byId.get(currentId)?.parent_task_id || null;
  }
  return false;
}

function validateParent(task, parentTaskId) {
  if (parentTaskId === null || parentTaskId === "") return { value: null };
  if (parentTaskId === task.id) return { error: "A task cannot be its own parent" };
  const parent = taskInSpace(parentTaskId, task.life_space_id);
  if (!parent) return { error: "Parent task must belong to this life space" };
  const tasks = tasksForSpace(task.life_space_id);
  if (parentPathContains(parent.id, task.id, tasks)) {
    return { error: "Parent relationship would create a cycle" };
  }
  return { value: parent.id };
}

function validateDependency(task, dependencyTaskId) {
  if (!dependencyTaskId) return { error: "dependencyTaskId is required" };
  if (dependencyTaskId === task.id) return { error: "A task cannot depend on itself" };
  const dependency = taskInSpace(dependencyTaskId, task.life_space_id);
  if (!dependency) return { error: "Dependency task must belong to this life space" };
  const rows = dependencyRows(task.life_space_id);
  if (rows.some((row) => row.task_id === task.id && row.dependency_task_id === dependency.id)) {
    return { error: "Dependency already exists", status: 409 };
  }
  if (dependencyPathExists(dependency.id, task.id, rows)) {
    return { error: "Dependency would create a cycle" };
  }
  return { dependency };
}

function validateDependencySet(task, dependencyTaskIds) {
  if (!Array.isArray(dependencyTaskIds)) return { error: "dependencyTaskIds must be an array" };
  const uniqueIds = new Set(dependencyTaskIds);
  if (uniqueIds.size !== dependencyTaskIds.length) return { error: "Duplicate dependencies are not allowed" };
  const existingRows = dependencyRows(task.life_space_id);
  const candidateRows = existingRows.filter((row) => row.task_id !== task.id);
  const dependencies = [];
  for (const id of [...uniqueIds].sort()) {
    if (id === task.id) return { error: "A task cannot depend on itself" };
    const dependency = taskInSpace(id, task.life_space_id);
    if (!dependency) return { error: "Dependency task must belong to this life space" };
    if (dependencyPathExists(dependency.id, task.id, candidateRows)) {
      return { error: "Dependency would create a cycle" };
    }
    dependencies.push(dependency);
  }
  return { dependencies };
}

function completionBlockers(task) {
  const tasks = tasksForSpace(task.life_space_id);
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const rows = dependencyRows(task.life_space_id);
  const dependencies = dependencyIdsFor(task.id, rows).map((id) => byId.get(id)).filter(Boolean);
  const incompleteDependencies = dependencies.filter((item) => !item.completed);
  const incompleteSubtasks = descendantsOf(task.id, tasks).filter((item) => !item.completed);
  return { incompleteDependencies, incompleteSubtasks };
}

function hierarchyDepth(task, byId) {
  let depth = 0;
  let current = task;
  const seen = new Set([task.id]);
  while (current.parent_task_id && byId.has(current.parent_task_id)) {
    if (seen.has(current.parent_task_id)) break;
    seen.add(current.parent_task_id);
    depth += 1;
    current = byId.get(current.parent_task_id);
  }
  return depth;
}

function decorateTasks(lifeSpaceId) {
  const tasks = tasksForSpace(lifeSpaceId);
  const rows = dependencyRows(lifeSpaceId);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.map((task) => {
    const dependencies = dependencyIdsFor(task.id, rows)
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort(compareTasks)
      .map((item) => ({ id: item.id, title: item.title, completed: !!item.completed }));
    const blockers = dependencies.filter((item) => !item.completed);
    const dependents = rows
      .filter((row) => row.dependency_task_id === task.id)
      .map((row) => byId.get(row.task_id))
      .filter(Boolean)
      .sort(compareTasks)
      .map((item) => ({ id: item.id, title: item.title, completed: !!item.completed }));
    const subtasks = descendantsOf(task.id, tasks);
    const completedSubtasks = subtasks.filter((item) => item.completed).length;
    return {
      ...task,
      parent_task_id: task.parent_task_id || null,
      depth: hierarchyDepth(task, byId),
      dependencies,
      dependency_ids: dependencies.map((item) => item.id),
      blocked: !task.completed && blockers.length > 0,
      blockers,
      dependents,
      unlocks_count: dependents.filter((item) => !item.completed).length,
      subtask_progress: {
        total: subtasks.length,
        completed: completedSubtasks,
        percent: subtasks.length ? Math.round((completedSubtasks / subtasks.length) * 100) : 0,
      },
    };
  }).sort(compareTasks);
}

function cleanupTaskRelationships(task) {
  const rows = db.table("task_dependencies").all();
  db.table("task_dependencies").replaceAll(rows.filter((row) => (
    row.task_id !== task.id && row.dependency_task_id !== task.id
  )));
  const tasks = db.table("tasks").all();
  db.table("tasks").replaceAll(tasks.map((item) => (
    item.parent_task_id === task.id ? { ...item, parent_task_id: null } : item
  )));
}

module.exports = {
  compareTasks,
  tasksForSpace,
  dependencyRows,
  taskInSpace,
  descendantsOf,
  dependencyPathExists,
  validateParent,
  validateDependency,
  validateDependencySet,
  completionBlockers,
  decorateTasks,
  cleanupTaskRelationships,
};
