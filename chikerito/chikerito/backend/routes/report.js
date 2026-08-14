const express = require("express");
const db = require("../db");
const { findPublicLifeSpace, checkPublicAccess } = require("../publicAccess");

const router = express.Router();

// Public — no auth required, powers the shareable /report/:slug page
router.get("/public/lifespaces/:slug/report", (req, res) => {
  const lifeSpace = findPublicLifeSpace(req.params.slug);
  const access = checkPublicAccess(lifeSpace, req);
  if (!access.ok) return res.status(access.status).json(access.body);

  const contributions = db.table("contributions").where((c) => c.life_space_id === lifeSpace.id);
  const categories = db.table("budget_categories").where((c) => c.life_space_id === lifeSpace.id);

  const raised = contributions.reduce((s, c) => s + c.amount, 0);
  const remainingGoal = Math.max(lifeSpace.goal_amount - raised, 0);
  const progress = lifeSpace.goal_amount > 0 ? Math.min(Math.round((raised / lifeSpace.goal_amount) * 100), 100) : 0;

  // Budget/expense detail is sensitive financial info — only include it if the owner opted in.
  let categoryBreakdown = [];
  if (lifeSpace.show_budget_public) {
    const expenses = db.table("expenses").where((e) => e.life_space_id === lifeSpace.id);
    categoryBreakdown = categories.map((c) => {
      const catRaised = contributions.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
      const catSpent = expenses.filter((x) => x.category_id === c.id).reduce((s, x) => s + x.amount, 0);
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        budget: c.budget_amount,
        raised: catRaised,
        spent: catSpent,
        remaining: Math.max(c.budget_amount - catSpent, 0),
        progress: c.budget_amount > 0 ? Math.min(Math.round((catRaised / c.budget_amount) * 100), 100) : 0,
      };
    });
  }

  res.json({
    lifeSpace: {
      title: lifeSpace.title,
      milestoneType: lifeSpace.milestone_type,
      story: lifeSpace.story,
      goalAmount: lifeSpace.goal_amount,
      currency: lifeSpace.currency,
      slug: lifeSpace.slug,
      coverImage: lifeSpace.cover_image || null,
      allowIndexing: !!lifeSpace.allow_indexing,
    },
    stats: { goal: lifeSpace.goal_amount, raised, remainingGoal, progress, contributorCount: contributions.length },
    categoryBreakdown,
    budgetVisible: !!lifeSpace.show_budget_public,
  });
});

module.exports = router;
