const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
  requireResourceMember,
  requireResourceCapability,
} = require("../middleware/authorize");
const {
  scheduledDates,
  previewOccurrences,
  materializedOccurrence,
  nextOccurrenceWithExceptions,
} = require("../recurrence");

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isScheduled(rule, date) {
  if (!validDate(date) || date < rule.start_date || (rule.end_date && date > rule.end_date)) return false;
  return scheduledDates(rule, date, { from: date, limit: 5000 }).includes(date);
}

function categoryBelongs(categoryId, lifeSpaceId) {
  if (categoryId === null || categoryId === "") return true;
  const category = db.table("budget_categories").find(categoryId);
  return !!category && category.life_space_id === lifeSpaceId;
}

function validate(rule, input) {
  const errors = [];
  if (!isScheduled(rule, input.occurrenceDate)) errors.push("occurrenceDate must be a scheduled date for this recurring expense");
  if (!['skip', 'override'].includes(input.action)) errors.push("action must be skip or override");
  if (input.action === "skip") return errors;

  const hasOverride = [input.overrideDate, input.overrideAmount, input.overrideCategoryId, input.overrideVendor]
    .some((value) => value !== undefined && value !== null && value !== "");
  if (!hasOverride) errors.push("an override must change at least one field");
  if (input.overrideDate !== undefined && input.overrideDate !== null && input.overrideDate !== "" && !validDate(input.overrideDate)) {
    errors.push("overrideDate must be a valid YYYY-MM-DD date");
  }
  if (input.overrideAmount !== undefined && input.overrideAmount !== null && input.overrideAmount !== "") {
    if (!Number.isFinite(Number(input.overrideAmount)) || Number(input.overrideAmount) <= 0) {
      errors.push("overrideAmount must be a positive number");
    }
  }
  if (input.overrideVendor !== undefined && input.overrideVendor !== null && !String(input.overrideVendor).trim()) {
    errors.push("overrideVendor cannot be blank");
  }
  if (input.overrideCategoryId !== undefined && !categoryBelongs(input.overrideCategoryId, rule.life_space_id)) {
    errors.push("overrideCategoryId is not in this life space");
  }
  return errors;
}

function serialize(exception) {
  const materialized = materializedOccurrence(exception.recurring_expense_id, exception.occurrence_date);
  return {
    id: exception.id,
    recurringExpenseId: exception.recurring_expense_id,
    lifeSpaceId: exception.life_space_id,
    occurrenceDate: exception.occurrence_date,
    action: exception.action,
    overrideDate: exception.override_date,
    overrideAmount: exception.override_amount,
    overrideCategoryId: exception.override_category_id,
    overrideVendor: exception.override_vendor,
    status: exception.status,
    materialized: !!materialized,
    expenseId: materialized?.id || null,
    createdAt: exception.created_at,
    updatedAt: exception.updated_at,
  };
}

function rowValues(rule, input) {
  return {
    occurrence_date: input.occurrenceDate,
    action: input.action,
    override_date: input.action === "override" && input.overrideDate ? input.overrideDate : null,
    override_amount: input.action === "override" && input.overrideAmount !== undefined && input.overrideAmount !== ""
      ? Number(input.overrideAmount)
      : null,
    override_category_id: input.action === "override" && input.overrideCategoryId !== undefined
      ? input.overrideCategoryId || null
      : null,
    override_vendor: input.action === "override" && input.overrideVendor
      ? String(input.overrideVendor).trim()
      : null,
    life_space_id: rule.life_space_id,
  };
}

router.get(
  "/recurring-expenses/:id/occurrences",
  requireAuth,
  requireResourceMember("recurring_expenses"),
  (req, res) => {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to = req.query.to || undefined;
    if (!validDate(from) || (to && !validDate(to))) return res.status(400).json({ error: "from and to must be valid YYYY-MM-DD dates" });
    if (to && to < from) return res.status(400).json({ error: "to cannot be before from" });
    const occurrences = previewOccurrences(req.resource, { from, to, limit: req.query.limit })
      .map((occurrence) => ({ ...occurrence, exception: occurrence.exception ? serialize(occurrence.exception) : null }));
    res.json({
      occurrences,
      nextOccurrence: nextOccurrenceWithExceptions(req.resource),
      readOnly: true,
    });
  }
);

router.get(
  "/recurring-expenses/:id/exceptions",
  requireAuth,
  requireResourceMember("recurring_expenses"),
  (req, res) => {
    const exceptions = db.table("recurring_expense_exceptions")
      .where((exception) => exception.recurring_expense_id === req.resource.id)
      .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date) || a.id.localeCompare(b.id))
      .map(serialize);
    res.json({ exceptions });
  }
);

router.post(
  "/recurring-expenses/:id/exceptions",
  requireAuth,
  requireResourceCapability("recurring_expenses", "expense:manage"),
  (req, res) => {
    const errors = validate(req.resource, req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const duplicate = db.table("recurring_expense_exceptions").where((exception) =>
      exception.recurring_expense_id === req.resource.id && exception.occurrence_date === req.body.occurrenceDate
    )[0];
    if (duplicate) return res.status(409).json({ error: "An exception already exists for this occurrence; edit or restore it instead" });
    const now = new Date().toISOString();
    const exception = db.table("recurring_expense_exceptions").insert({
      id: uuid(),
      recurring_expense_id: req.resource.id,
      ...rowValues(req.resource, req.body),
      status: "active",
      created_at: now,
      updated_at: now,
    });
    res.status(201).json({ exception: serialize(exception) });
  }
);

router.patch(
  "/recurring-expense-exceptions/:id",
  requireAuth,
  requireResourceCapability("recurring_expense_exceptions", "expense:manage"),
  (req, res) => {
    const rule = db.table("recurring_expenses").find(req.resource.recurring_expense_id);
    if (!rule) return res.status(404).json({ error: "Recurring expense not found" });
    const merged = {
      occurrenceDate: req.resource.occurrence_date,
      action: req.body.action ?? req.resource.action,
      overrideDate: req.body.overrideDate !== undefined ? req.body.overrideDate : req.resource.override_date,
      overrideAmount: req.body.overrideAmount !== undefined ? req.body.overrideAmount : req.resource.override_amount,
      overrideCategoryId: req.body.overrideCategoryId !== undefined ? req.body.overrideCategoryId : req.resource.override_category_id,
      overrideVendor: req.body.overrideVendor !== undefined ? req.body.overrideVendor : req.resource.override_vendor,
    };
    const errors = validate(rule, merged);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const updated = db.table("recurring_expense_exceptions").update(req.resource.id, {
      ...rowValues(rule, merged),
      updated_at: new Date().toISOString(),
    });
    res.json({ exception: serialize(updated) });
  }
);

router.delete(
  "/recurring-expense-exceptions/:id",
  requireAuth,
  requireResourceCapability("recurring_expense_exceptions", "expense:manage"),
  (req, res) => {
    if (req.resource.status === "removed") return res.status(409).json({ error: "Exception is already removed" });
    db.table("recurring_expense_exceptions").update(req.resource.id, { status: "removed", updated_at: new Date().toISOString() });
    res.status(204).end();
  }
);

router.post(
  "/recurring-expense-exceptions/:id/restore",
  requireAuth,
  requireResourceCapability("recurring_expense_exceptions", "expense:manage"),
  (req, res) => {
    if (req.resource.status !== "removed") return res.status(409).json({ error: "Only a removed exception can be restored" });
    const updated = db.table("recurring_expense_exceptions").update(req.resource.id, { status: "active", updated_at: new Date().toISOString() });
    res.json({ exception: serialize(updated) });
  }
);

module.exports = { router, validDate, isScheduled, validate, serialize };
