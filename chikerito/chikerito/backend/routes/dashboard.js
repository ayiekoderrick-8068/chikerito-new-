const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/lifespaces/:id/dashboard", requireAuth, (req, res) => {
  const lifeSpace = db.table("life_spaces").find(req.params.id);
  if (!lifeSpace) return res.status(404).json({ error: "Life space not found" });

  const contributions = db.table("contributions").where((c) => c.life_space_id === lifeSpace.id);
  const expenses = db.table("expenses").where((e) => e.life_space_id === lifeSpace.id);
  const categories = db.table("budget_categories").where((c) => c.life_space_id === lifeSpace.id);

  const raised = contributions.reduce((s, c) => s + c.amount, 0);
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const available = Math.max(raised - spent, 0);
  const remainingGoal = Math.max(lifeSpace.goal_amount - raised, 0);
  const progress = lifeSpace.goal_amount > 0 ? Math.min(Math.round((raised / lifeSpace.goal_amount) * 100), 100) : 0;

  const categoryBreakdown = categories.map((c) => {
    const catRaised = contributions.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    const catSpent = expenses.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      budget: c.budget_amount,
      raised: catRaised,
      spent: catSpent,
      remaining: Math.max(c.budget_amount - catSpent, 0),
      progress: c.budget_amount > 0 ? Math.min(Math.round((catRaised / c.budget_amount) * 100), 100) : 0,
    };
  });

  // Monthly spend trend (last 6 months)
  const monthly = {};
  expenses.forEach((e) => {
    const key = (e.payment_date || e.created_at).slice(0, 7);
    monthly[key] = (monthly[key] || 0) + e.amount;
  });
  const monthlyTrend = Object.entries(monthly)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([month, total]) => ({ month, total }));

  // Financial health score
  let score = 100;
  const overBudgetCategories = categoryBreakdown.filter((c) => c.budget > 0 && c.spent > c.budget);
  score -= overBudgetCategories.length * 15;
  const expensesMissingReceipts = expenses.filter((e) => !e.receipt_url).length;
  score -= Math.min(expensesMissingReceipts * 3, 20);
  const overdue = expenses.filter((e) => e.status === "overdue").length;
  score -= overdue * 10;
  score = Math.max(Math.min(score, 100), 0);

  const notifications = db
    .table("notifications")
    .where((n) => n.life_space_id === lifeSpace.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  res.json({
    lifeSpace,
    stats: { goal: lifeSpace.goal_amount, raised, spent, available, remainingGoal, progress },
    categoryBreakdown,
    monthlyTrend,
    financialHealth: {
      score,
      rating: score >= 85 ? "Excellent" : score >= 65 ? "Good" : score >= 40 ? "Needs Attention" : "At Risk",
      flags: [
        ...overBudgetCategories.map((c) => `${c.name} is over budget`),
        ...(expensesMissingReceipts ? [`${expensesMissingReceipts} expense(s) missing receipts`] : []),
        ...(overdue ? [`${overdue} overdue payment(s)`] : []),
      ],
    },
    notifications,
    recentContributions: contributions
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8),
  });
});

module.exports = router;
