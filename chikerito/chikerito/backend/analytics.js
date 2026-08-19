const { isCountable } = require("./routes/contributions");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!DATE_RE.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateOf(row) {
  return row.payment_date || row.created_at.slice(0, 10);
}

function contributionDate(row) {
  return row.created_at.slice(0, 10);
}

function inRange(date, from, to) {
  return (!from || date >= from) && (!to || date <= to);
}

function sum(rows, field = "amount") {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percentChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
}

function previousRange(from, to) {
  if (!from || !to) return null;
  const length = daysBetween(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

function groupMonthly(expenses) {
  const groups = new Map();
  expenses.forEach((expense) => {
    const month = dateOf(expense).slice(0, 7);
    groups.set(month, (groups.get(month) || 0) + expense.amount);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total: round(total) }));
}

function groupDaily(expenses) {
  const groups = new Map();
  expenses.forEach((expense) => {
    const date = dateOf(expense);
    groups.set(date, (groups.get(date) || 0) + expense.amount);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total: round(total) }));
}

function groupStatuses(expenses) {
  const groups = new Map();
  expenses.forEach((expense) => groups.set(expense.status, (groups.get(expense.status) || 0) + 1));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => ({ status, count }));
}

function groupVendors(expenses) {
  const groups = new Map();
  expenses.forEach((expense) => {
    const current = groups.get(expense.vendor) || { vendor: expense.vendor, total: 0, count: 0 };
    current.total += expense.amount;
    current.count += 1;
    groups.set(expense.vendor, current);
  });
  return [...groups.values()]
    .map((item) => ({ ...item, total: round(item.total) }))
    .sort((a, b) => b.total - a.total || a.vendor.localeCompare(b.vendor))
    .slice(0, 5);
}

function calculatePeriod(expenses, contributions) {
  const spent = round(sum(expenses));
  const raised = round(sum(contributions));
  const largestExpense = expenses.reduce((largest, row) => Math.max(largest, Number(row.amount) || 0), 0);
  const largestContribution = contributions.reduce((largest, row) => Math.max(largest, Number(row.amount) || 0), 0);
  return {
    spent,
    raised,
    net: round(raised - spent),
    expenseCount: expenses.length,
    contributionCount: contributions.length,
    averageExpense: expenses.length ? round(spent / expenses.length) : 0,
    largestExpense: round(largestExpense),
    largestContribution: round(largestContribution),
  };
}

function buildInsights(summary, categoryBreakdown, topVendors) {
  const insights = [];
  const overBudget = categoryBreakdown.filter((category) => category.variance < 0);
  if (overBudget.length) {
    insights.push({
      type: "warning",
      code: "categories_over_budget",
      message: `${overBudget.length} ${overBudget.length === 1 ? "category is" : "categories are"} over budget.`,
      categoryIds: overBudget.map((category) => category.id),
    });
  }
  if (summary.net < 0) {
    insights.push({ type: "danger", code: "negative_net", message: "Spending exceeds completed contributions in this period." });
  }
  if (summary.spent > 0 && topVendors[0] && topVendors[0].total / summary.spent >= 0.5) {
    insights.push({
      type: "info",
      code: "vendor_concentration",
      message: `${topVendors[0].vendor} represents ${round((topVendors[0].total / summary.spent) * 100, 1)}% of spending.`,
      vendor: topVendors[0].vendor,
    });
  }
  if (!summary.expenseCount && !summary.contributionCount) {
    insights.push({ type: "neutral", code: "no_activity", message: "No financial activity matches the selected period." });
  }
  return insights;
}

function buildAnalytics({ lifeSpace, categories, expenses, contributions, filters }) {
  const categoryId = filters.categoryId || null;
  const currentExpenses = expenses.filter((row) =>
    (!categoryId || row.category_id === categoryId) && inRange(dateOf(row), filters.from, filters.to)
  );
  const currentContributions = contributions.filter((row) =>
    isCountable(row)
    && (!categoryId || row.category_id === categoryId)
    && inRange(contributionDate(row), filters.from, filters.to)
  );
  const selectedCategories = categoryId ? categories.filter((row) => row.id === categoryId) : categories;
  const current = calculatePeriod(currentExpenses, currentContributions);
  const budget = round(sum(selectedCategories, "budget_amount"));

  const categoryBreakdown = selectedCategories.map((category) => {
    const categoryExpenses = currentExpenses.filter((row) => row.category_id === category.id);
    const categoryContributions = currentContributions.filter((row) => row.category_id === category.id);
    const spent = round(sum(categoryExpenses));
    return {
      id: category.id,
      name: category.name,
      budget: category.budget_amount,
      spent,
      raised: round(sum(categoryContributions)),
      variance: round(category.budget_amount - spent),
      utilization: category.budget_amount > 0 ? round((spent / category.budget_amount) * 100, 1) : null,
    };
  }).sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  let comparison = null;
  const range = filters.comparison === "previous" ? previousRange(filters.from, filters.to) : null;
  if (range) {
    const previousExpenses = expenses.filter((row) =>
      (!categoryId || row.category_id === categoryId) && inRange(dateOf(row), range.from, range.to)
    );
    const previousContributions = contributions.filter((row) =>
      isCountable(row)
      && (!categoryId || row.category_id === categoryId)
      && inRange(contributionDate(row), range.from, range.to)
    );
    const previous = calculatePeriod(previousExpenses, previousContributions);
    comparison = {
      range,
      previous,
      changes: {
        spent: percentChange(current.spent, previous.spent),
        raised: percentChange(current.raised, previous.raised),
        net: percentChange(current.net, previous.net),
        expenseCount: percentChange(current.expenseCount, previous.expenseCount),
      },
    };
  }

  const topVendors = groupVendors(currentExpenses);
  const durationDays = filters.from && filters.to ? daysBetween(filters.from, filters.to) : null;
  const summary = {
    ...current,
    budget,
    variance: round(budget - current.spent),
    durationDays,
    dailyAverageSpent: durationDays ? round(current.spent / durationDays) : null,
  };
  const uncategorizedSpent = round(sum(currentExpenses.filter((row) => !row.category_id)));
  return {
    filters: { from: filters.from || null, to: filters.to || null, categoryId, comparison: filters.comparison },
    currency: lifeSpace.currency,
    summary: { ...summary, uncategorizedSpent },
    comparison,
    categoryBreakdown,
    monthlyTrend: groupMonthly(currentExpenses),
    dailyTrend: groupDaily(currentExpenses),
    statusBreakdown: groupStatuses(currentExpenses),
    topVendors,
    insights: buildInsights(summary, categoryBreakdown, topVendors),
  };
}

module.exports = { validDate, previousRange, percentChange, buildInsights, buildAnalytics };
