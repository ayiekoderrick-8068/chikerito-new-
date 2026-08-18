const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");

const PRIORITIES = ["low", "medium", "high"];

const router = express.Router();

router.get("/lifespaces/:lifeSpaceId/tasks", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const tasks = db.table("tasks").where((t) => t.life_space_id === req.params.lifeSpaceId);
  res.json({ tasks: tasks.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999")) });
});

router.post("/lifespaces/:lifeSpaceId/tasks", requireAuth, requireCapability("task:manage", "lifeSpaceId"), (req, res) => {
  const { title, category, dueDate, notes, priority } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(", ")}` });
  }
  const task = db.table("tasks").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    title,
    category: category || "General",
    due_date: dueDate || null,
    priority: priority || "medium",
    completed: false,
    notes: notes || "",
    created_at: new Date().toISOString(),
  });
  res.status(201).json({ task });
});

router.patch("/tasks/:id", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  const allowed = ["title", "category", "dueDate", "completed", "notes", "priority"];
  const columnMap = { dueDate: "due_date" };
  if (req.body.priority !== undefined && !PRIORITIES.includes(req.body.priority)) {
    return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(", ")}` });
  }
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[columnMap[key] || key] = req.body[key];
  }
  const updated = db.table("tasks").update(req.params.id, patch);
  res.json({ task: updated });
});

router.delete("/tasks/:id", requireAuth, requireResourceCapability("tasks", "task:manage"), (req, res) => {
  db.table("tasks").remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
