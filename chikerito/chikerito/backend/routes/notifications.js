const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireResourceMember } = require("../middleware/authorize");
const {
  serializeForUser, setUserState, encodeCursor, decodeCursor,
  listForUser, summarizeForUser, unreadCount,
} = require("../notificationInbox");

const router = express.Router();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const FILTERS = new Set(["all", "unread", "read"]);

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_LIMIT));
}

function listOptions(req, res) {
  const filter = req.query.filter || (req.query.unreadOnly === "true" ? "unread" : "all");
  if (!FILTERS.has(filter)) {
    res.status(400).json({ error: "filter must be one of: all, unread, read" });
    return null;
  }
  let cursor = null;
  if (req.query.cursor) {
    cursor = decodeCursor(req.query.cursor);
    if (!cursor) {
      res.status(400).json({ error: "cursor is invalid" });
      return null;
    }
  }
  let before = null;
  if (!cursor && req.query.before) {
    before = new Date(req.query.before).getTime();
    if (Number.isNaN(before)) {
      res.status(400).json({ error: "before must be a valid timestamp" });
      return null;
    }
  }
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length > 200) {
    res.status(400).json({ error: "q must be 200 characters or fewer" });
    return null;
  }
  return { filter, type: req.query.type || null, query: query || null, cursor, before };
}

router.get("/lifespaces/:lifeSpaceId/notifications", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const options = listOptions(req, res);
  if (!options) return;
  const list = listForUser(req.params.lifeSpaceId, req.user.id, options);
  const limit = parseLimit(req.query.limit);
  const notifications = list.slice(0, limit);
  const hasMore = list.length > limit;
  res.json({
    notifications,
    hasMore,
    nextCursor: hasMore && notifications.length ? encodeCursor(notifications[notifications.length - 1]) : null,
    filter: options.filter,
    total: list.length,
    pageSize: notifications.length,
    summary: summarizeForUser(req.params.lifeSpaceId, req.user.id),
  });
});

router.get("/lifespaces/:lifeSpaceId/notifications/unread-count", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  res.json({ count: unreadCount(req.params.lifeSpaceId, req.user.id) });
});

router.post("/lifespaces/:lifeSpaceId/notifications/mark-all-read", requireAuth, requireMember("lifeSpaceId"), (req, res) => {
  const unread = listForUser(req.params.lifeSpaceId, req.user.id, { filter: "unread" });
  const now = new Date().toISOString();
  unread.forEach((notification) => setUserState(notification, req.user.id, { read: true }, now));
  res.json({ updated: unread.length });
});

router.patch("/notifications/:id", requireAuth, requireResourceMember("notifications", "id"), (req, res) => {
  if (typeof req.body.read !== "boolean") return res.status(400).json({ error: "read must be a boolean" });
  setUserState(req.resource, req.user.id, { read: req.body.read });
  res.json({ notification: serializeForUser(req.resource, req.user.id) });
});

// Dismiss is personal: the shared row remains available to every other member.
router.delete("/notifications/:id", requireAuth, requireResourceMember("notifications", "id"), (req, res) => {
  if (serializeForUser(req.resource, req.user.id).dismissed) return res.status(404).json({ error: "Notification not found" });
  setUserState(req.resource, req.user.id, { dismissed: true });
  res.status(204).end();
});

router.post("/notifications/:id/restore", requireAuth, requireResourceMember("notifications", "id"), (req, res) => {
  setUserState(req.resource, req.user.id, { dismissed: false });
  res.json({ notification: serializeForUser(req.resource, req.user.id) });
});

module.exports = router;
