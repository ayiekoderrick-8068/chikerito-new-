const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");
const {
  decorateTasks,
  validateParent,
  validateDependency,
  validateDependencySet,
  completionBlockers,
  cleanupTaskRelationships,
} = require("../taskGraph");

const PRIORITIES = ["low", "medium", "high"];
const router = express.Router();

function priorityError(priority) {
  return priority !== undefined && !PRIORITIES.includes(priority)
    ? `priority must be one of: ${PRIORITIES.join(", ")}`
    : null;
}

function taskResponse(lifeSpaceId, id) {
  return decorateTasks(lifeSpaceId).find((task) => task.id === id);
}

router.get("/lifespaces/:lifeSpaceId/tasks", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  res.json({ tasks: decorateTasks(req.params.lifeSpaceId) });
});

router.post("/lifespaces/:lifeSpaceId/tasks", requireAuth, requireCapability("task:manage", "lifeSpaceId"), (req, res) => {
  const { title, category, dueDate, notes, priority, parentTaskId } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "title is required" });
  const invalidPriority = priorityError(priority);
  if (invalidPriority) return res.status(400).json({ error: invalidPriority });

  const task = {
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    title: String(title).trim(),
    category: category || "General",
    due_date: dueDate || null,
    priority: priority || "medium",
    completed: false,
    notes: notes || "",
    parent_task_id: null,
    created_at: new Date().toISOString(),
  };
  if (parentTaskId !== undefined) {
    const validation = validateParent(task, parentTaskId);
    if (validation.error) return res.status(400).json({ error: validation.error });
    task.parent_task_id = validation.value;
  }
  db.table("tasks").insert(task);
  res.status(201).json({ task: taskResponse(task.life_space_id, task.id) });
});

router.patch("/tasks/:id", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  const invalidPriority = priorityError(req.body.priority);
  if (invalidPriority) return res.status(400).json({ error: invalidPriority });
  if (req.body.title !== undefined && !String(req.body.title).trim()) {
    return res.status(400).json({ error: "title is required" });
  }
  if (req.body.completed !== undefined && typeof req.body.completed !== "boolean") {
    return res.status(400).json({ error: "completed must be a boolean" });
  }

  const patch = {};
  const allowed = ["title", "category", "dueDate", "completed", "notes", "priority"];
  const columnMap = { dueDate: "due_date" };
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[columnMap[key] || key] = key === "title" ? String(req.body[key]).trim() : req.body[key];
  }
  if (req.body.parentTaskId !== undefined) {
    const validation = validateParent(req.resource, req.body.parentTaskId);
    if (validation.error) return res.status(400).json({ error: validation.error });
    patch.parent_task_id = validation.value;
  }
  if (patch.completed === true && !req.resource.completed) {
    const { incompleteDependencies, incompleteSubtasks } = completionBlockers(req.resource);
    if (incompleteDependencies.length) {
      return res.status(409).json({
        error: "Complete all dependencies before completing this task",
        blockers: incompleteDependencies.map((task) => ({ id: task.id, title: task.title })),
      });
    }
    if (incompleteSubtasks.length) {
      return res.status(409).json({
        error: "Complete all subtasks before completing this task",
        blockers: incompleteSubtasks.map((task) => ({ id: task.id, title: task.title })),
      });
    }
  }
  db.table("tasks").update(req.params.id, patch);
  res.json({ task: taskResponse(req.resource.life_space_id, req.params.id) });
});

router.post("/tasks/:id/dependencies", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  const validation = validateDependency(req.resource, req.body.dependencyTaskId);
  if (validation.error) return res.status(validation.status || 400).json({ error: validation.error });
  const dependency = db.table("task_dependencies").insert({
    id: uuid(),
    life_space_id: req.resource.life_space_id,
    task_id: req.resource.id,
    dependency_task_id: validation.dependency.id,
    created_at: new Date().toISOString(),
  });
  res.status(201).json({ dependency, task: taskResponse(req.resource.life_space_id, req.resource.id) });
});

router.put("/tasks/:id/dependencies", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  const validation = validateDependencySet(req.resource, req.body.dependencyTaskIds);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const otherRows = db.table("task_dependencies").all().filter((row) => row.task_id !== req.resource.id);
  const now = new Date().toISOString();
  const replacementRows = validation.dependencies.map((dependency) => ({
    id: uuid(),
    life_space_id: req.resource.life_space_id,
    task_id: req.resource.id,
    dependency_task_id: dependency.id,
    created_at: now,
  }));
  db.table("task_dependencies").replaceAll([...otherRows, ...replacementRows]);
  res.json({ task: taskResponse(req.resource.life_space_id, req.resource.id) });
});

router.delete("/tasks/:id/dependencies/:dependencyTaskId", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  const rows = db.table("task_dependencies").all();
  const found = rows.find((row) => (
    row.task_id === req.resource.id
      && row.dependency_task_id === req.params.dependencyTaskId
      && row.life_space_id === req.resource.life_space_id
  ));
  if (!found) return res.status(404).json({ error: "Dependency not found" });
  db.table("task_dependencies").remove(found.id);
  res.status(204).end();
});

router.delete("/tasks/:id", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  cleanupTaskRelationships(req.resource);
  db.table("tasks").remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
