const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/lifespaces/:lifeSpaceId/categories", requireAuth, (req, res) => {
  const categories = db.table("budget_categories").where((c) => c.life_space_id === req.params.lifeSpaceId);
  res.json({ categories: withComputed(categories, req.params.lifeSpaceId) });
});

router.post("/lifespaces/:lifeSpaceId/categories", requireAuth, (req, res) => {
  const { name, icon, budgetAmount } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const category = db.table("budget_categories").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    name,
    icon: icon || "sparkles",
    budget_amount: Number(budgetAmount) || 0,
    created_at: new Date().toISOString(),
  });
  res.status(201).json({ category: withComputed([category], req.params.lifeSpaceId)[0] });
});

router.patch("/categories/:id", requireAuth, (req, res) => {
  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.icon !== undefined) patch.icon = req.body.icon;
  if (req.body.budgetAmount !== undefined) patch.budget_amount = Number(req.body.budgetAmount);
  const updated = db.table("budget_categories").update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Category not found" });
  res.json({ category: withComputed([updated], updated.life_space_id)[0] });
});

router.delete("/categories/:id", requireAuth, (req, res) => {
  db.table("budget_categories").remove(req.params.id);
  res.status(204).end();
});

function withComputed(categories, lifeSpaceId) {
  const contributions = db.table("contributions").where((c) => c.life_space_id === lifeSpaceId);
  const expenses = db.table("expenses").where((e) => e.life_space_id === lifeSpaceId);
  return categories.map((c) => {
    const raised = contributions.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    const spent = expenses.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    return {
      ...c,
      raised,
      spent,
      remainingBudget: Math.max(c.budget_amount - spent, 0),
      available: Math.max(raised - spent, 0),
      progress: c.budget_amount > 0 ? Math.min(Math.round((raised / c.budget_amount) * 100), 100) : 0,
    };
  });
}

module.exports = router;
