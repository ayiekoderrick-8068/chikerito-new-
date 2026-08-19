const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");
const { FREQUENCIES, nextOccurrenceWithExceptions, runDueOccurrences } = require("../recurrence");
const { normalizeTransaction, monetaryFields, transactionView } = require("../currency");

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(value) {
  return typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function validateCreateOrUpdate(body, { partial = false } = {}) {
  const { vendor, amount, frequency, startDate, endDate } = body;

  if (!partial || vendor !== undefined) {
    if (!vendor || !String(vendor).trim()) return "vendor is required";
  }
  if (!partial || amount !== undefined) {
    if (amount === undefined || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return "amount must be a positive number";
    }
  }
  if (!partial || frequency !== undefined) {
    if (!FREQUENCIES.includes(frequency)) return `frequency must be one of: ${FREQUENCIES.join(", ")}`;
  }
  if (!partial || startDate !== undefined) {
    if (!isValidDateStr(startDate)) return "startDate must be a valid YYYY-MM-DD date";
  }
  if (endDate !== undefined && endDate !== null && endDate !== "") {
    if (!isValidDateStr(endDate)) return "endDate must be a valid YYYY-MM-DD date";
  }
  return null;
}

function serialize(recurring, baseCurrency = "USD") {
  return { ...recurring, nextOccurrence: nextOccurrenceWithExceptions(recurring), money: transactionView(recurring, baseCurrency) };
}

router.get("/lifespaces/:lifeSpaceId/recurring-expenses", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  runDueOccurrences(req.params.lifeSpaceId);
  const rules = db
    .table("recurring_expenses")
    .where((r) => r.life_space_id === req.params.lifeSpaceId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ recurringExpenses: rules.map((rule) => serialize(rule, req.lifeSpace.currency)), baseCurrency: req.lifeSpace.currency || "USD" });
});

router.post("/lifespaces/:lifeSpaceId/recurring-expenses", requireAuth, requireCapability("expense:manage", "lifeSpaceId"), (req, res) => {
  const error = validateCreateOrUpdate(req.body);
  if (error) return res.status(400).json({ error });

  const { categoryId, vendor, amount, currency, frequency, startDate, endDate } = req.body;
  if (categoryId) {
    const category = db.table("budget_categories").find(categoryId);
    if (!category || category.life_space_id !== req.lifeSpace.id) return res.status(400).json({ error: "categoryId must belong to this life space" });
  }
  const normalized = normalizeTransaction({ amount, currency }, req.lifeSpace);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const rule = db.table("recurring_expenses").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    category_id: categoryId || null,
    vendor,
    amount: normalized.originalAmount,
    ...monetaryFields(normalized),
    frequency,
    start_date: startDate,
    end_date: endDate || null,
    status: "active",
    last_generated_date: null,
    created_at: new Date().toISOString(),
  });

  runDueOccurrences(req.params.lifeSpaceId);
  const fresh = db.table("recurring_expenses").find(rule.id);
  res.status(201).json({ recurringExpense: serialize(fresh, req.lifeSpace.currency) });
});

router.patch(
  "/recurring-expenses/:id",
  requireAuth,
  requireResourceCapability("recurring_expenses", "expense:manage"),
  (req, res) => {
    const error = validateCreateOrUpdate(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

    const allowed = ["vendor", "categoryId", "frequency", "startDate", "endDate"];
    const columnMap = { categoryId: "category_id", startDate: "start_date", endDate: "end_date" };
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        patch[columnMap[key] || key] = key === "amount" ? Number(req.body[key]) : req.body[key];
      }
    }
    const lifeSpace = db.table("life_spaces").find(req.resource.life_space_id);
    if (req.body.categoryId) {
      const category = db.table("budget_categories").find(req.body.categoryId);
      if (!category || category.life_space_id !== lifeSpace.id) return res.status(400).json({ error: "categoryId must belong to this life space" });
    }
    if (["amount", "currency"].some((key) => req.body[key] !== undefined)) {
      const existing = transactionView(req.resource, lifeSpace.currency);
      const normalized = normalizeTransaction({
        amount: req.body.amount ?? existing.originalAmount,
        currency: req.body.currency ?? existing.currency,
      }, lifeSpace);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      patch.amount = normalized.originalAmount;
      Object.assign(patch, monetaryFields(normalized));
    }
    const updated = db.table("recurring_expenses").update(req.params.id, patch);
    res.json({ recurringExpense: serialize(updated, lifeSpace.currency) });
  }
);

router.post(
  "/recurring-expenses/:id/pause",
  requireAuth,
  requireResourceCapability("recurring_expenses", "expense:manage"),
  (req, res) => {
    if (req.resource.status !== "active") {
      return res.status(409).json({ error: "Only an active recurring expense can be paused" });
    }
    const updated = db.table("recurring_expenses").update(req.params.id, { status: "paused" });
    const lifeSpace = db.table("life_spaces").find(updated.life_space_id);
    res.json({ recurringExpense: serialize(updated, lifeSpace?.currency) });
  }
);

// Resuming never backfills whatever was missed while paused — the next
// occurrence is computed forward from the resume date, not the pause date.
router.post(
  "/recurring-expenses/:id/resume",
  requireAuth,
  requireResourceCapability("recurring_expenses", "expense:manage"),
  (req, res) => {
    if (req.resource.status !== "paused") {
      return res.status(409).json({ error: "Only a paused recurring expense can be resumed" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const updated = db.table("recurring_expenses").update(req.params.id, {
      status: "active",
      last_generated_date: today,
    });
    const lifeSpace = db.table("life_spaces").find(updated.life_space_id);
    res.json({ recurringExpense: serialize(updated, lifeSpace?.currency) });
  }
);

// Stops the rule (soft delete) — never touches expenses rows already
// generated from it, which remain ordinary, independent expense records.
router.delete(
  "/recurring-expenses/:id",
  requireAuth,
  requireResourceCapability("recurring_expenses", "expense:manage"),
  (req, res) => {
    db.table("recurring_expenses").update(req.params.id, { status: "stopped" });
    res.status(204).end();
  }
);

module.exports = router;
