const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { pushNotification } = require("../notify");
const { findPublicLifeSpace, checkPublicAccess } = require("../publicAccess");

const router = express.Router();

router.get("/lifespaces/:lifeSpaceId/contributions", requireAuth, (req, res) => {
  const contributions = db.table("contributions").where((c) => c.life_space_id === req.params.lifeSpaceId);
  res.json({ contributions: contributions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
});

// Public — no auth required, used by the public donation page
router.post("/public/lifespaces/:slug/contribute", (req, res) => {
  const lifeSpace = findPublicLifeSpace(req.params.slug);
  const access = checkPublicAccess(lifeSpace, req);
  if (!access.ok) return res.status(access.status).json(access.body);
  const { contributorName, amount, categoryId, message, paymentMethod } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "A positive amount is required" });

  const contribution = db.table("contributions").insert({
    id: uuid(),
    life_space_id: lifeSpace.id,
    category_id: categoryId || null,
    contributor_name: contributorName || "Anonymous",
    amount: Number(amount),
    message: message || "",
    payment_method: paymentMethod || "card",
    status: "completed",
    created_at: new Date().toISOString(),
  });

  pushNotification(lifeSpace.id, "donation", `${contribution.contributor_name} donated $${contribution.amount.toFixed(2)}`);

  const category = categoryId ? db.table("budget_categories").find(categoryId) : null;
  if (category && category.budget_amount > 0) {
    const raised = db.table("contributions").where((c) => c.category_id === category.id).reduce((s, c) => s + c.amount, 0);
    if (raised >= category.budget_amount) {
      pushNotification(lifeSpace.id, "milestone_funded", `${category.name} is now fully funded!`);
    }
  }

  res.status(201).json({ contribution });
});

module.exports = router;
