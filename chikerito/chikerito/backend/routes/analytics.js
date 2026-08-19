const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember } = require("../middleware/authorize");
const { runDueOccurrences } = require("../recurrence");
const { validDate, buildAnalytics } = require("../analytics");

const router = express.Router();

router.get("/lifespaces/:lifeSpaceId/analytics", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const { from, to, categoryId, comparison = "none" } = req.query;
  if (from && !validDate(from)) return res.status(400).json({ error: "from must be a valid YYYY-MM-DD date" });
  if (to && !validDate(to)) return res.status(400).json({ error: "to must be a valid YYYY-MM-DD date" });
  if (from && to && from > to) return res.status(400).json({ error: "from must be on or before to" });
  if (!['none', 'previous'].includes(comparison)) return res.status(400).json({ error: "comparison must be none or previous" });
  if (comparison === "previous" && (!from || !to)) {
    return res.status(400).json({ error: "previous comparison requires both from and to" });
  }

  const lifeSpaceId = req.params.lifeSpaceId;
  const categories = db.table("budget_categories").where((row) => row.life_space_id === lifeSpaceId);
  if (categoryId && !categories.some((row) => row.id === categoryId)) {
    return res.status(400).json({ error: "categoryId must belong to this life space" });
  }

  runDueOccurrences(lifeSpaceId);
  const analytics = buildAnalytics({
    lifeSpace: req.lifeSpace,
    categories,
    expenses: db.table("expenses").where((row) => row.life_space_id === lifeSpaceId),
    contributions: db.table("contributions").where((row) => row.life_space_id === lifeSpaceId),
    filters: { from, to, categoryId, comparison },
  });
  res.json({ analytics });
});

module.exports = router;
