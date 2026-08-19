const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");
const { pushNotification } = require("../notify");
const { findPublicLifeSpace, checkPublicAccess } = require("../publicAccess");
const { normalizeTransaction, monetaryFields, transactionView, baseAmount } = require("../currency");

const router = express.Router();

const VALID_STATUSES = ["pending", "completed", "failed", "refunded", "voided"];

// Statuses that count toward financial totals (raised, category raised, etc.)
const COUNTING_STATUSES = new Set(["completed"]);

// Transitions that are terminal — cannot be changed once reached
const TERMINAL_STATUSES = new Set(["refunded", "voided"]);

// Only these transitions are allowed from a given status
const ALLOWED_TRANSITIONS = {
  pending:   ["completed", "failed", "voided"],
  completed: ["refunded", "voided"],
  failed:    ["voided"],
  refunded:  [],
  voided:    [],
};

function isCountable(contribution) {
  return COUNTING_STATUSES.has(contribution.status);
}

// ---------------------------------------------------------------------------
// GET /lifespaces/:id/contributions — authenticated list
// ---------------------------------------------------------------------------
router.get("/lifespaces/:lifeSpaceId/contributions", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const contributions = db.table("contributions").where((c) => c.life_space_id === req.params.lifeSpaceId);
  const baseCurrency = req.lifeSpace.currency || "USD";
  res.json({
    contributions: contributions
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((contribution) => ({ ...contribution, money: transactionView(contribution, baseCurrency) })),
    baseCurrency,
  });
});

// ---------------------------------------------------------------------------
// POST /lifespaces/:id/contributions — authorized manual entry
// ---------------------------------------------------------------------------
router.post("/lifespaces/:lifeSpaceId/contributions", requireAuth, requireCapability("contribution:manage", "lifeSpaceId"), (req, res) => {
  const { contributorName, amount, currency, categoryId, message, paymentMethod, status, notes } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "A positive amount is required" });
  if (!contributorName || !contributorName.trim()) return res.status(400).json({ error: "contributorName is required" });
  const initialStatus = status || "completed";
  if (!VALID_STATUSES.includes(initialStatus)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  if (categoryId) {
    const category = db.table("budget_categories").find(categoryId);
    if (!category || category.life_space_id !== req.lifeSpace.id) return res.status(400).json({ error: "categoryId must belong to this life space" });
  }
  const normalized = normalizeTransaction({ amount, currency }, req.lifeSpace);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const contribution = db.table("contributions").insert({
    id: uuid(),
    life_space_id: req.params.lifeSpaceId,
    category_id: categoryId || null,
    contributor_name: contributorName.trim(),
    amount: normalized.originalAmount,
    ...monetaryFields(normalized),
    message: message || "",
    payment_method: paymentMethod || "manual",
    status: initialStatus,
    notes: notes || "",
    source: "manual",
    created_at: new Date().toISOString(),
  });

  if (isCountable(contribution)) {
    pushNotification(req.params.lifeSpaceId, "donation", `${contribution.contributor_name} donated ${normalized.currency} ${normalized.originalAmount.toFixed(2)}`);
    const category = categoryId ? db.table("budget_categories").find(categoryId) : null;
    if (category && category.budget_amount > 0) {
      const raised = db.table("contributions")
        .where((c) => c.category_id === category.id && isCountable(c))
        .reduce((s, c) => s + baseAmount(c, req.lifeSpace.currency), 0);
      if (raised >= category.budget_amount) {
        pushNotification(req.params.lifeSpaceId, "milestone_funded", `${category.name} is now fully funded!`);
      }
    }
  }

  res.status(201).json({ contribution: { ...contribution, money: transactionView(contribution, req.lifeSpace.currency) } });
});

// ---------------------------------------------------------------------------
// PATCH /contributions/:id — status update / refund / void
// ---------------------------------------------------------------------------
router.patch("/contributions/:id", requireAuth, requireResourceCapability("contributions", "contribution:manage"), (req, res) => {
  const contribution = req.resource;
  const { status, notes } = req.body;

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    if (TERMINAL_STATUSES.has(contribution.status)) {
      return res.status(409).json({ error: `Cannot change status: contribution is already ${contribution.status}` });
    }
    const allowed = ALLOWED_TRANSITIONS[contribution.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from ${contribution.status} to ${status}. Allowed: ${allowed.join(", ") || "none"}`,
      });
    }
  }

  const patch = {};
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;

  const updated = db.table("contributions").update(contribution.id, patch);
  
  // Check for milestone funding notifications when status changes to completed
  if (status === "completed" && updated.category_id) {
    const category = db.table("budget_categories").find(updated.category_id);
    if (category && category.budget_amount > 0) {
      const raised = db.table("contributions")
        .where((c) => c.category_id === category.id && isCountable(c))
        .reduce((s, c) => s + baseAmount(c, db.table("life_spaces").find(updated.life_space_id)?.currency), 0);
      if (raised >= category.budget_amount) {
        pushNotification(updated.life_space_id, "milestone_funded", `${category.name} is now fully funded!`);
      }
    }
  }
  
  res.json({ contribution: updated });
});

// ---------------------------------------------------------------------------
// Public — no auth required, used by the public donation page
// ---------------------------------------------------------------------------
router.post("/public/lifespaces/:slug/contribute", (req, res) => {
  const lifeSpace = findPublicLifeSpace(req.params.slug);
  const access = checkPublicAccess(lifeSpace, req);
  if (!access.ok) return res.status(access.status).json(access.body);
  const { contributorName, amount, currency, categoryId, message, paymentMethod } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "A positive amount is required" });
  if (categoryId) {
    const category = db.table("budget_categories").find(categoryId);
    if (!category || category.life_space_id !== lifeSpace.id) return res.status(400).json({ error: "categoryId must belong to this life space" });
  }
  const normalized = normalizeTransaction({ amount, currency }, lifeSpace);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const contribution = db.table("contributions").insert({
    id: uuid(),
    life_space_id: lifeSpace.id,
    category_id: categoryId || null,
    contributor_name: contributorName || "Anonymous",
    amount: normalized.originalAmount,
    ...monetaryFields(normalized),
    message: message || "",
    payment_method: paymentMethod || "card",
    status: "completed",
    notes: "",
    source: "public",
    created_at: new Date().toISOString(),
  });

  pushNotification(lifeSpace.id, "donation", `${contribution.contributor_name} donated ${normalized.currency} ${normalized.originalAmount.toFixed(2)}`);

  const category = categoryId ? db.table("budget_categories").find(categoryId) : null;
  if (category && category.budget_amount > 0) {
    const raised = db.table("contributions")
      .where((c) => c.category_id === category.id && isCountable(c))
      .reduce((s, c) => s + baseAmount(c, lifeSpace.currency), 0);
    if (raised >= category.budget_amount) {
      pushNotification(lifeSpace.id, "milestone_funded", `${category.name} is now fully funded!`);
    }
  }

  res.status(201).json({ contribution: { ...contribution, money: transactionView(contribution, lifeSpace.currency) } });
});

module.exports = { router, isCountable };
