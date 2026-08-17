const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");
const { pushNotification } = require("../notify");

const router = express.Router();

router.get("/lifespaces/:lifeSpaceId/expenses", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const expenses = db.table("expenses").where((e) => e.life_space_id === req.params.lifeSpaceId);
  res.json({ expenses: expenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
});

router.post("/lifespaces/:lifeSpaceId/expenses", requireAuth, requireCapability("expense:manage", "lifeSpaceId"), (req, res) => {
  const { categoryId, vendor, amount, plannedAmount, invoiceUrl, receiptUrl, paymentDate, status, notes } = req.body;
  if (!vendor || (!amount && !plannedAmount)) return res.status(400).json({ error: "vendor and amount (or plannedAmount) are required" });
  const expense = db.table("expenses").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    category_id: categoryId || null,
    vendor,
    planned_amount: plannedAmount !== undefined ? Number(plannedAmount) : Number(amount) || 0,
    amount: Number(amount) || 0,
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
    const spent = expenses.reduce((s, e) => s + e.amount, 0);
    if (category.budget_amount > 0 && spent > category.budget_amount) {
      pushNotification(req.params.lifeSpaceId, "budget_warning", `${category.name} budget exceeded by $${(spent - category.budget_amount).toFixed(2)}`);
    }
  }
  pushNotification(req.params.lifeSpaceId, "expense_added", `Expense recorded: ${vendor} — $${Number(amount).toFixed(2)}`);

  res.status(201).json({ expense });
});

router.patch("/expenses/:id", requireAuth, requireResourceCapability("expenses", "expense:manage"), (req, res) => {
  const allowed = ["vendor", "amount", "plannedAmount", "invoiceUrl", "receiptUrl", "paymentDate", "status", "notes", "categoryId"];
  const columnMap = { invoiceUrl: "invoice_url", receiptUrl: "receipt_url", paymentDate: "payment_date", categoryId: "category_id", plannedAmount: "planned_amount" };
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[columnMap[key] || key] = key === "amount" || key === "plannedAmount" ? Number(req.body[key]) : req.body[key];
    }
  }
  const updated = db.table("expenses").update(req.params.id, patch);
  res.json({ expense: updated });
});

router.delete("/expenses/:id", requireAuth, requireResourceCapability("expenses", "expense:manage"), (req, res) => {
  db.table("expenses").remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
