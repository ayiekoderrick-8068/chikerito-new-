const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");
const { pushNotification } = require("../notify");
const { runDueOccurrences } = require("../recurrence");
const { normalizeTransaction, monetaryFields, transactionView, baseAmount } = require("../currency");

const router = express.Router();
const PAGE_SIZE = 20;

// GET /lifespaces/:id/expenses
// Query params (all optional, combinable):
//   status=paid|pending|overdue
//   categoryId=<uuid>  ("uncategorized" matches null category)
//   from=YYYY-MM-DD    (payment_date >= from)
//   to=YYYY-MM-DD      (payment_date <= to)
//   before=<ISO>       cursor: only rows with created_at < before
//   limit=<n>          default 20, max 100
router.get("/lifespaces/:lifeSpaceId/expenses", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  runDueOccurrences(req.params.lifeSpaceId);
  let expenses = db.table("expenses").where((e) => e.life_space_id === req.params.lifeSpaceId);

  const { status, categoryId, from, to, before, limit: limitParam } = req.query;
  if (status) expenses = expenses.filter((e) => e.status === status);
  if (categoryId) {
    expenses = categoryId === "uncategorized"
      ? expenses.filter((e) => !e.category_id)
      : expenses.filter((e) => e.category_id === categoryId);
  }
  if (from) expenses = expenses.filter((e) => (e.payment_date || e.created_at.slice(0, 10)) >= from);
  if (to)   expenses = expenses.filter((e) => (e.payment_date || e.created_at.slice(0, 10)) <= to);

  // Sort newest-created first — stable, deterministic cursor anchor.
  expenses = expenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (before) {
    const cursor = new Date(before).getTime();
    if (!Number.isNaN(cursor)) expenses = expenses.filter((e) => new Date(e.created_at).getTime() < cursor);
  }

  const limit = Math.max(1, Math.min(Number(limitParam) || PAGE_SIZE, 100));
  const page = expenses.slice(0, limit);
  const baseCurrency = req.lifeSpace.currency || "USD";
  res.json({
    expenses: page.map((expense) => ({ ...expense, money: transactionView(expense, baseCurrency) })),
    baseCurrency,
    hasMore: expenses.length > limit,
  });
});

router.post("/lifespaces/:lifeSpaceId/expenses", requireAuth, requireCapability("expense:manage", "lifeSpaceId"), (req, res) => {
  const { categoryId, vendor, amount, plannedAmount, currency, invoiceUrl, receiptUrl, paymentDate, status, notes } = req.body;
  if (!vendor || (!amount && !plannedAmount)) return res.status(400).json({ error: "vendor and amount (or plannedAmount) are required" });
  const lifeSpace = req.lifeSpace;
  if (categoryId) {
    const category = db.table("budget_categories").find(categoryId);
    if (!category || category.life_space_id !== lifeSpace.id) return res.status(400).json({ error: "categoryId must belong to this life space" });
  }
  const plannedInput = plannedAmount !== undefined ? plannedAmount : amount;
  const reference = normalizeTransaction({ amount: Number(amount) > 0 ? amount : plannedInput, currency }, lifeSpace);
  if (reference.error) return res.status(400).json({ error: reference.error });
  const actual = Number(amount) > 0 ? reference : { ...reference, originalAmount: 0, baseAmount: 0 };
  const planned = Number(plannedInput) > 0
    ? normalizeTransaction({ amount: plannedInput, currency: reference.currency }, lifeSpace, "plannedAmount")
    : { ...actual, originalAmount: 0, baseAmount: 0 };
  if (planned.error) return res.status(400).json({ error: planned.error });
  const expense = db.table("expenses").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    category_id: categoryId || null,
    vendor,
    planned_amount: planned.originalAmount,
    amount: actual.originalAmount,
    ...monetaryFields(actual),
    ...monetaryFields(planned, "planned"),
    invoice_url: invoiceUrl || null,
    receipt_url: receiptUrl || null,
    payment_date: paymentDate || new Date().toISOString().slice(0, 10),
    status: status || (Number(amount) ? "paid" : "pending"),
    notes: notes || "",
    created_at: new Date().toISOString(),
  });

  const category = categoryId ? db.table("budget_categories").find(categoryId) : null;
  if (category) {
    const expenses = db.table("expenses").where((e) => e.category_id === category.id);
    const spent = expenses.reduce((s, e) => s + baseAmount(e, lifeSpace.currency), 0);
    if (category.budget_amount > 0 && spent > category.budget_amount) {
      pushNotification(req.params.lifeSpaceId, "budget_warning", `${category.name} budget exceeded by $${(spent - category.budget_amount).toFixed(2)}`);
    }
  }
  pushNotification(req.params.lifeSpaceId, "expense_added", `Expense recorded: ${vendor} — ${actual.currency} ${actual.originalAmount.toFixed(2)}`);

  res.status(201).json({ expense: { ...expense, money: transactionView(expense, lifeSpace.currency) } });
});

router.patch("/expenses/:id", requireAuth, requireResourceCapability("expenses", "expense:manage"), (req, res) => {
  const allowed = ["vendor", "invoiceUrl", "receiptUrl", "paymentDate", "status", "notes", "categoryId"];
  const columnMap = { invoiceUrl: "invoice_url", receiptUrl: "receipt_url", paymentDate: "payment_date", categoryId: "category_id", plannedAmount: "planned_amount" };
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[columnMap[key] || key] = key === "amount" || key === "plannedAmount" ? Number(req.body[key]) : req.body[key];
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
  if (req.body.plannedAmount !== undefined) {
    const existing = transactionView(req.resource, lifeSpace.currency);
    const normalized = normalizeTransaction({
      amount: req.body.plannedAmount,
      currency: req.body.currency ?? existing.currency,
    }, lifeSpace, "plannedAmount");
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    patch.planned_amount = normalized.originalAmount;
    Object.assign(patch, monetaryFields(normalized, "planned"));
  }
  const updated = db.table("expenses").update(req.params.id, patch);
  res.json({ expense: { ...updated, money: transactionView(updated, lifeSpace.currency) } });
});

router.delete("/expenses/:id", requireAuth, requireResourceCapability("expenses", "expense:manage"), (req, res) => {
  db.table("expenses").remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
