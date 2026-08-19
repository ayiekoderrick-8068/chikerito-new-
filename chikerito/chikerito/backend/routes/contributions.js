const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, requireResourceCapability } = require("../middleware/authorize");
const { pushNotification } = require("../notify");
const { findPublicLifeSpace, checkPublicAccess } = require("../publicAccess");
const { normalizeTransaction, monetaryFields, transactionView, baseAmount } = require("../currency");
const crypto = require("crypto");

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
router.post("/public/lifespaces/:slug/contribute", async (req, res, next) => {
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

  if (process.env.NODE_ENV === "production") {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Payments are not configured" });
    try {
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) return res.status(503).json({ error: "Payments are not configured" });
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", `${frontendUrl}/donate/${encodeURIComponent(lifeSpace.slug)}?payment=success`);
      params.set("cancel_url", `${frontendUrl}/donate/${encodeURIComponent(lifeSpace.slug)}?payment=cancelled`);
      params.set("line_items[0][quantity]", "1");
      params.set("line_items[0][price_data][currency]", normalized.currency.toLowerCase());
      params.set("line_items[0][price_data][unit_amount]", String(Math.round(normalized.originalAmount * 100)));
      params.set("line_items[0][price_data][product_data][name]", `Contribution to ${lifeSpace.title}`);
      params.set("metadata[life_space_id]", lifeSpace.id);
      params.set("metadata[category_id]", categoryId || "");
      params.set("metadata[contributor_name]", (contributorName || "Anonymous").slice(0, 120));
      params.set("metadata[message]", (message || "").slice(0, 500));
      params.set("metadata[base_currency]", normalized.baseCurrency);
      params.set("metadata[exchange_rate]", String(normalized.exchangeRate));
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const session = await response.json();
      if (!response.ok || !session.url) throw new Error(session.error?.message || "Payment provider rejected the request");
      return res.status(201).json({ checkoutUrl: session.url });
    } catch (error) {
      return next(Object.assign(new Error("Unable to start payment"), { status: 502, cause: error }));
    }
  }

  // Local/test mode uses a deterministic provider stand-in. Production can
  // only create completed contributions through the signed webhook below.
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

function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2)));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const actual = Buffer.from(parts.v1, "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

function stripeWebhook(req, res) {
  if (!verifyStripeSignature(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: "Invalid webhook signature" });
  }
  let event;
  try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ error: "Malformed webhook" }); }
  if (event.type !== "checkout.session.completed") return res.json({ received: true });
  if (db.table("contributions").where((row) => row.provider_event_id === event.id).length) return res.json({ received: true });
  const session = event.data?.object;
  const lifeSpace = db.table("life_spaces").find(session?.metadata?.life_space_id);
  if (!lifeSpace || session.payment_status !== "paid" || !Number.isInteger(session.amount_total) || session.amount_total <= 0) {
    return res.status(400).json({ error: "Invalid completed checkout" });
  }
  const currency = String(session.currency || "").toUpperCase();
  const normalized = normalizeTransaction({ amount: session.amount_total / 100, currency }, lifeSpace);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const categoryId = session.metadata.category_id || null;
  const category = categoryId ? db.table("budget_categories").find(categoryId) : null;
  if (categoryId && (!category || category.life_space_id !== lifeSpace.id)) return res.status(400).json({ error: "Invalid category" });
  const contribution = db.table("contributions").insert({
    id: uuid(), life_space_id: lifeSpace.id, category_id: categoryId,
    contributor_name: session.metadata.contributor_name || "Anonymous",
    amount: normalized.originalAmount, ...monetaryFields(normalized),
    message: session.metadata.message || "", payment_method: "stripe", status: "completed",
    notes: "", source: "stripe", provider_event_id: event.id, provider_payment_id: session.payment_intent,
    created_at: new Date().toISOString(),
  });
  pushNotification(lifeSpace.id, "donation", `${contribution.contributor_name} donated ${currency} ${normalized.originalAmount.toFixed(2)}`);
  return res.status(201).json({ received: true });
}

module.exports = { router, isCountable, stripeWebhook, verifyStripeSignature };
