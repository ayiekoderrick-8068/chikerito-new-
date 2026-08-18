const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember } = require("../middleware/authorize");
const { sanitizeLifeSpace } = require("../serialize");
const { runDueOccurrences, nextOccurrenceWithExceptions } = require("../recurrence");
const { isCountable } = require("./contributions");

const router = express.Router();

function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

router.get("/lifespaces/:id/dashboard", requireAuth, requireMember("id"), (req, res) => {
  const lifeSpace = req.lifeSpace;
  runDueOccurrences(lifeSpace.id);

  const allContributions = db.table("contributions").where((c) => c.life_space_id === lifeSpace.id);
  const contributions = allContributions.filter(isCountable);
  const expenses = db.table("expenses").where((e) => e.life_space_id === lifeSpace.id);
  const categories = db.table("budget_categories").where((c) => c.life_space_id === lifeSpace.id);
  const recurringRules = db.table("recurring_expenses").where((r) => r.life_space_id === lifeSpace.id);

  const raised = contributions.reduce((s, c) => s + c.amount, 0);
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const available = Math.max(raised - spent, 0);
  const remainingGoal = Math.max(lifeSpace.goal_amount - raised, 0);
  const progress = lifeSpace.goal_amount > 0 ? Math.min(Math.round((raised / lifeSpace.goal_amount) * 100), 100) : 0;

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  // A rule contributes its next due occurrence only. This keeps frequent rules
  // from crowding other vendors out of the widget and does not materialize a
  // preview as an expense.
  const allUpcoming = recurringRules
    .map((rule) => {
      const dueDate = nextOccurrenceWithExceptions(rule);
      return dueDate
        ? {
        recurringExpenseId: rule.id,
        vendor: rule.vendor,
        amount: rule.amount,
        categoryId: rule.category_id,
        category: categoryNames.get(rule.category_id) || null,
        dueDate,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) =>
      compareText(a.dueDate, b.dueDate)
      || compareText(a.vendor, b.vendor)
      || compareText(a.recurringExpenseId, b.recurringExpenseId)
    );
  const upcomingRecurringExpenses = allUpcoming.slice(0, 5);

  // Calculate projected spending per category (current + upcoming)
  const projectedSpending = {};
  categories.forEach((c) => {
    const currentSpent = expenses.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    const upcomingSpent = allUpcoming
      .filter((x) => x.categoryId === c.id)
      .reduce((s, x) => s + x.amount, 0);
    projectedSpending[c.id] = { current: currentSpent, upcoming: upcomingSpent, total: currentSpent + upcomingSpent };
  });

  const categoryBreakdown = categories.map((c) => {
    const catRaised = contributions.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    const catSpent = expenses.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
    const projected = projectedSpending[c.id];
    const projectedOver = c.budget_amount > 0 && projected && projected.total > c.budget_amount;
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      budget: c.budget_amount,
      raised: catRaised,
      spent: catSpent,
      remaining: Math.max(c.budget_amount - catSpent, 0),
      progress: c.budget_amount > 0 ? Math.min(Math.round((catRaised / c.budget_amount) * 100), 100) : 0,
      // Projection fields for financial health
      projectedSpent: projected?.total || 0,
      projectedRemaining: projected ? Math.max(c.budget_amount - projected.total, 0) : 0,
      projectedOver,
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

  // Financial health score (enhanced with projection)
  let score = 100;
  const overBudgetCategories = categoryBreakdown.filter((c) => c.budget > 0 && c.spent > c.budget);
  const projectedOverBudgetCategories = categoryBreakdown.filter(
    (c) => c.budget > 0 && c.spent <= c.budget && c.projectedOver
  );
  score -= overBudgetCategories.length * 15;
  score -= Math.max(projectedOverBudgetCategories.length * 10, 0); // Lighter penalty for projection
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

  // Build financial health response with projection
  const flags = [
    ...overBudgetCategories.map((c) => `${c.name} is over budget`),
  ];
  if (projectedOverBudgetCategories.length > 0) {
    flags.push(
      ...projectedOverBudgetCategories.map((c) => `${c.name} will likely exceed budget after upcoming expenses`)
    );
  }
  if (expensesMissingReceipts > 0) {
    flags.push(`${expensesMissingReceipts} expense(s) missing receipts`);
  }
  if (overdue > 0) {
    flags.push(`${overdue} overdue payment(s)`);
  }

  res.json({
    lifeSpace: sanitizeLifeSpace(lifeSpace, req.role),
    stats: { goal: lifeSpace.goal_amount, raised, spent, available, remainingGoal, progress },
    categoryBreakdown,
    monthlyTrend,
    upcomingRecurringExpenses,
    financialHealth: {
      score,
      rating: score >= 85 ? "Excellent" : score >= 65 ? "Good" : score >= 40 ? "Needs Attention" : "At Risk",
      flags,
      projectedOver: projectedOverBudgetCategories,
    },
    notifications,
    recentContributions: allContributions
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8),
  });
});

module.exports = router;
