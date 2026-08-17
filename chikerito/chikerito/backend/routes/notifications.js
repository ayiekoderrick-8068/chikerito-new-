const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireResourceMember } = require("../middleware/authorize");

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function sortNewestFirst(list) {
  return list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// List notifications for a life space, newest first. Supports ?unreadOnly=true
// and cursor pagination via ?before=<ISO timestamp>&limit=<n>.
router.get("/lifespaces/:lifeSpaceId/notifications", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  let list = sortNewestFirst(
    db.table("notifications").where((n) => n.life_space_id === req.params.lifeSpaceId)
  );
  if (req.query.unreadOnly === "true") list = list.filter((n) => !n.read);
  if (req.query.before) {
    const cursor = new Date(req.query.before).getTime();
    if (!Number.isNaN(cursor)) list = list.filter((n) => new Date(n.created_at).getTime() < cursor);
  }
  const limit = Math.max(1, Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
  const page = list.slice(0, limit);
  res.json({ notifications: page, hasMore: list.length > limit });
});

router.get("/lifespaces/:lifeSpaceId/notifications/unread-count", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const count = db.table("notifications").count((n) => n.life_space_id === req.params.lifeSpaceId && !n.read);
  res.json({ count });
});

// Any member may mark all as read — this isn't a role-gated management
// action, it's a personal-ish acknowledgment (shared across the team, since
// the data model has no per-user read state — see notifications.test.js).
router.post("/lifespaces/:lifeSpaceId/notifications/mark-all-read", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const unread = db.table("notifications").where((n) => n.life_space_id === req.params.lifeSpaceId && !n.read);
  unread.forEach((n) => db.table("notifications").update(n.id, { read: true }));
  res.json({ updated: unread.length });
});

router.patch("/notifications/:id", requireAuth, requireResourceMember("notifications", "id"), (req, res) => {
  if (typeof req.body.read !== "boolean") {
    return res.status(400).json({ error: "read must be a boolean" });
  }
  const updated = db.table("notifications").update(req.params.id, { read: req.body.read });
  res.json({ notification: updated });
});

router.delete("/notifications/:id", requireAuth, requireResourceMember("notifications", "id"), (req, res) => {
  db.table("notifications").remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
