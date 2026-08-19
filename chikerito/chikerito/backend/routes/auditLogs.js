const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireCapability } = require("../middleware/authorize");

const router = express.Router();
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const ACTION_RE = /^[a-z_]+\.[a-z_]+$/;
const TYPE_RE = /^[a-z_]+$/;

function compareLogs(a, b) {
  const byTime = String(b.occurred_at).localeCompare(String(a.occurred_at));
  return byTime || String(b.id).localeCompare(String(a.id));
}

function encodeCursor(log) {
  return Buffer.from(JSON.stringify({ occurredAt: log.occurred_at, id: log.id })).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!cursor.occurredAt || !cursor.id || Number.isNaN(Date.parse(cursor.occurredAt))) return null;
    return cursor;
  } catch (_error) {
    return null;
  }
}

function isAfterCursor(log, cursor) {
  if (log.occurred_at < cursor.occurredAt) return true;
  return log.occurred_at === cursor.occurredAt && log.id < cursor.id;
}

router.get(
  "/lifespaces/:lifeSpaceId/audit-logs",
  requireAuth,
  requireCapability("audit:view", "lifeSpaceId"),
  (req, res) => {
    const { action, resourceType, actorId, from, to, cursor: rawCursor, limit: rawLimit } = req.query;
    if (action && !ACTION_RE.test(action)) return res.status(400).json({ error: "Invalid action filter" });
    if (resourceType && !TYPE_RE.test(resourceType)) return res.status(400).json({ error: "Invalid resourceType filter" });
    if (from && Number.isNaN(Date.parse(from))) return res.status(400).json({ error: "Invalid from date" });
    if (to && Number.isNaN(Date.parse(to))) return res.status(400).json({ error: "Invalid to date" });
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return res.status(400).json({ error: "Invalid audit cursor" });

    let logs = db.table("audit_logs").where((log) => log.life_space_id === req.params.lifeSpaceId);
    if (action) logs = logs.filter((log) => log.action === action);
    if (resourceType) logs = logs.filter((log) => log.resource_type === resourceType);
    if (actorId) logs = logs.filter((log) => log.actor_id === actorId);
    if (from) logs = logs.filter((log) => log.occurred_at >= new Date(from).toISOString());
    if (to) logs = logs.filter((log) => log.occurred_at <= new Date(to).toISOString());
    logs.sort(compareLogs);
    if (cursor) logs = logs.filter((log) => isAfterCursor(log, cursor));

    const limit = Math.max(1, Math.min(Number(rawLimit) || DEFAULT_LIMIT, MAX_LIMIT));
    const page = logs.slice(0, limit);
    const hasMore = logs.length > limit;
    res.json({
      auditLogs: page,
      page: {
        limit,
        hasMore,
        nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
      },
    });
  }
);

router.get(
  "/lifespaces/:lifeSpaceId/audit-logs/filter-options",
  requireAuth,
  requireCapability("audit:view", "lifeSpaceId"),
  (req, res) => {
    const logs = db.table("audit_logs").where((log) => log.life_space_id === req.params.lifeSpaceId);
    const unique = (values) => [...new Set(values.filter(Boolean))].sort();
    res.json({
      actions: unique(logs.map((log) => log.action)),
      resourceTypes: unique(logs.map((log) => log.resource_type)),
      actors: unique(logs.map((log) => log.actor_id)).map((id) => {
        const log = logs.find((entry) => entry.actor_id === id);
        return { id, name: log.actor_name };
      }),
    });
  }
);

module.exports = router;
module.exports.compareLogs = compareLogs;
module.exports.encodeCursor = encodeCursor;
module.exports.decodeCursor = decodeCursor;
