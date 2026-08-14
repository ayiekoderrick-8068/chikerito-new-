const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/lifespaces/:lifeSpaceId/tasks", requireAuth, (req, res) => {
  const tasks = db.table("tasks").where((t) => t.life_space_id === req.params.lifeSpaceId);
  res.json({ tasks: tasks.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999")) });
});

router.post("/lifespaces/:lifeSpaceId/tasks", requireAuth, (req, res) => {
  const { title, category, dueDate, notes } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const task = db.table("tasks").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    title,
    category: category || "General",
    due_date: dueDate || null,
    completed: false,
    notes: notes || "",
    created_at: new Date().toISOString(),
  });
  res.status(201).json({ task });
});

router.patch("/tasks/:id", requireAuth, (req, res) => {
  const allowed = ["title", "category", "dueDate", "completed", "notes"];
  const columnMap = { dueDate: "due_date" };
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[columnMap[key] || key] = req.body[key];
  }
  const updated = db.table("tasks").update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Task not found" });
  res.json({ task: updated });
});

router.delete("/tasks/:id", requireAuth, (req, res) => {
  db.table("tasks").remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
