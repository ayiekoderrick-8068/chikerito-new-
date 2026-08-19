const db = require("./db");
const { addInterval } = require("./recurrence");
const { baseAmount } = require("./currency");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sum(rows, field = "amount") {
  return money(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateScenarioInput(lifeSpaceId, input, { partial = false, asOf = todayStr() } = {}) {
  const errors = [];
  if (!partial || input.name !== undefined) {
    if (!String(input.name || "").trim()) errors.push("name is required");
    else if (String(input.name).trim().length > 120) errors.push("name must be 120 characters or fewer");
  }
  if (!partial || input.horizonDate !== undefined) {
    if (!isValidDate(input.horizonDate)) errors.push("horizonDate must be a valid YYYY-MM-DD date");
    else if (input.horizonDate < asOf) errors.push("horizonDate cannot be before today");
  }
  if (input.description !== undefined && String(input.description).length > 1000) {
    errors.push("description must be 1000 characters or fewer");
  }
  if (input.allocations !== undefined) {
    if (!Array.isArray(input.allocations)) return [...errors, "allocations must be an array"];
    const categoryIds = new Set();
    for (const [index, allocation] of input.allocations.entries()) {
      if (!allocation || typeof allocation !== "object") {
        errors.push(`allocations[${index}] must be an object`);
        continue;
      }
      const category = db.table("budget_categories").find(allocation.categoryId);
      if (!category || category.life_space_id !== lifeSpaceId) {
        errors.push(`allocations[${index}].categoryId is not in this life space`);
      } else if (categoryIds.has(category.id)) {
        errors.push(`allocations contains duplicate category ${category.id}`);
      } else {
        categoryIds.add(category.id);
      }
      for (const field of ["budgetAmount", "projectedExpenses", "projectedContributions"]) {
        if (allocation[field] === undefined || allocation[field] === null || allocation[field] === "") continue;
        const value = Number(allocation[field]);
        if (!Number.isFinite(value) || value < 0) errors.push(`allocations[${index}].${field} must be a non-negative number`);
      }
      if (allocation.note !== undefined && String(allocation.note).length > 255) {
        errors.push(`allocations[${index}].note must be 255 characters or fewer`);
      }
    }
  }
  return errors;
}

function futureOccurrences(rule, asOf, horizonDate, baseCurrency = "USD") {
  if (rule.status !== "active" || horizonDate <= asOf) return [];
  let cursor = rule.last_generated_date
    ? addInterval(rule.last_generated_date, rule.frequency)
    : rule.start_date;
  const occurrences = [];
  let safety = 0;
  while (cursor <= asOf && safety < 1000) {
    cursor = addInterval(cursor, rule.frequency);
    safety += 1;
  }
  while (cursor <= horizonDate && safety < 1000) {
    if (rule.end_date && cursor > rule.end_date) break;
    occurrences.push({
      recurringExpenseId: rule.id,
      categoryId: rule.category_id || null,
      vendor: rule.vendor,
      amount: money(baseAmount(rule, baseCurrency)),
      dueDate: cursor,
    });
    cursor = addInterval(cursor, rule.frequency);
    safety += 1;
  }
  return occurrences;
}

function normalizedAllocation(allocation) {
  return {
    categoryId: allocation.categoryId || allocation.category_id,
    budgetAmount: allocation.budgetAmount ?? allocation.budget_amount ?? null,
    projectedExpenses: money(allocation.projectedExpenses ?? allocation.projected_expenses ?? 0),
    projectedContributions: money(allocation.projectedContributions ?? allocation.projected_contributions ?? 0),
    note: allocation.note || "",
  };
}

function buildForecast(lifeSpaceId, draft, { asOf = todayStr() } = {}) {
  const lifeSpace = db.table("life_spaces").find(lifeSpaceId);
  const categories = db.table("budget_categories")
    .where((category) => category.life_space_id === lifeSpaceId)
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
  const expenses = db.table("expenses").where((expense) => expense.life_space_id === lifeSpaceId);
  const contributions = db.table("contributions")
    .where((contribution) => contribution.life_space_id === lifeSpaceId && contribution.status === "completed");
  const recurringRules = db.table("recurring_expenses")
    .where((rule) => rule.life_space_id === lifeSpaceId)
    .sort((a, b) => compareText(a.id, b.id));
  const allocations = (draft.allocations || []).map(normalizedAllocation);
  const allocationByCategory = new Map(allocations.map((allocation) => [allocation.categoryId, allocation]));

  const recurringOccurrences = recurringRules
    .flatMap((rule) => futureOccurrences(rule, asOf, draft.horizonDate, lifeSpace.currency))
    .sort((a, b) => compareText(a.dueDate, b.dueDate) || compareText(a.vendor, b.vendor) || compareText(a.recurringExpenseId, b.recurringExpenseId));

  const categoryForecasts = categories.map((category) => {
    const allocation = allocationByCategory.get(category.id) || normalizedAllocation({ categoryId: category.id });
    const currentSpent = money(expenses.filter((expense) => expense.category_id === category.id)
      .reduce((total, row) => total + baseAmount(row, lifeSpace.currency), 0));
    const currentRaised = money(contributions.filter((contribution) => contribution.category_id === category.id)
      .reduce((total, row) => total + baseAmount(row, lifeSpace.currency), 0));
    const projectedRecurring = sum(recurringOccurrences.filter((occurrence) => occurrence.categoryId === category.id));
    const scenarioBudget = allocation.budgetAmount === null ? money(category.budget_amount) : money(allocation.budgetAmount);
    const forecastSpent = money(currentSpent + projectedRecurring + allocation.projectedExpenses);
    const forecastRaised = money(currentRaised + allocation.projectedContributions);
    return {
      categoryId: category.id,
      name: category.name,
      icon: category.icon,
      currentBudget: money(category.budget_amount),
      scenarioBudget,
      budgetAdjustment: money(scenarioBudget - Number(category.budget_amount)),
      currentSpent,
      projectedRecurring,
      projectedExpenses: allocation.projectedExpenses,
      forecastSpent,
      currentRaised,
      projectedContributions: allocation.projectedContributions,
      forecastRaised,
      remainingBudget: money(Math.max(scenarioBudget - forecastSpent, 0)),
      overBudgetBy: money(Math.max(forecastSpent - scenarioBudget, 0)),
      projectedOverBudget: scenarioBudget > 0 && forecastSpent > scenarioBudget,
      note: allocation.note,
    };
  });

  const currentBudget = sum(categories, "budget_amount");
  const scenarioBudget = sum(categoryForecasts, "scenarioBudget");
  const currentSpent = money(expenses.reduce((total, row) => total + baseAmount(row, lifeSpace.currency), 0));
  const currentRaised = money(contributions.reduce((total, row) => total + baseAmount(row, lifeSpace.currency), 0));
  const projectedRecurring = sum(recurringOccurrences);
  const projectedExpenses = sum(allocations, "projectedExpenses");
  const projectedContributions = sum(allocations, "projectedContributions");
  const forecastSpent = money(currentSpent + projectedRecurring + projectedExpenses);
  const forecastRaised = money(currentRaised + projectedContributions);
  const warnings = categoryForecasts
    .filter((category) => category.projectedOverBudget)
    .map((category) => ({
      categoryId: category.categoryId,
      category: category.name,
      overBy: category.overBudgetBy,
      message: `${category.name} is projected to exceed its scenario budget by ${category.overBudgetBy.toFixed(2)}`,
    }));
  if (scenarioBudget > 0 && forecastSpent > scenarioBudget) {
    warnings.push({
      categoryId: null,
      category: null,
      overBy: money(forecastSpent - scenarioBudget),
      message: `Total forecast spending exceeds the scenario budget by ${money(forecastSpent - scenarioBudget).toFixed(2)}`,
    });
  }

  return {
    asOf,
    horizonDate: draft.horizonDate,
    currency: lifeSpace.currency,
    totals: {
      currentBudget,
      scenarioBudget,
      budgetChange: money(scenarioBudget - currentBudget),
      currentSpent,
      projectedRecurring,
      projectedExpenses,
      forecastSpent,
      spendingChange: money(forecastSpent - currentSpent),
      currentRaised,
      projectedContributions,
      forecastRaised,
      fundingGap: money(Math.max(forecastSpent - forecastRaised, 0)),
      projectedAvailable: money(Math.max(forecastRaised - forecastSpent, 0)),
    },
    categoryForecasts,
    recurringOccurrences,
    warnings,
    comparison: {
      budget: { current: currentBudget, scenario: scenarioBudget, difference: money(scenarioBudget - currentBudget) },
      spent: { current: currentSpent, scenario: forecastSpent, difference: money(forecastSpent - currentSpent) },
      raised: { current: currentRaised, scenario: forecastRaised, difference: money(forecastRaised - currentRaised) },
    },
  };
}

module.exports = {
  todayStr,
  money,
  isValidDate,
  validateScenarioInput,
  futureOccurrences,
  normalizedAllocation,
  buildForecast,
};
