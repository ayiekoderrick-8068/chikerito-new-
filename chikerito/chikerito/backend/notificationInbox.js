const { v4: uuid } = require("uuid");
const db = require("./db");

function stateFor(notificationId, userId) {
  return db.table("notification_user_states").where(
    (state) => state.notification_id === notificationId && state.user_id === userId
  )[0] || null;
}

function effectiveState(notification, userId) {
  const state = stateFor(notification.id, userId);
  return {
    read: state ? !!state.read : !!notification.read,
    dismissed: state ? !!state.dismissed : false,
    readAt: state?.read_at || null,
    dismissedAt: state?.dismissed_at || null,
  };
}

function serializeForUser(notification, userId) {
  const state = effectiveState(notification, userId);
  return {
    ...notification,
    read: state.read,
    dismissed: state.dismissed,
    read_at: state.readAt,
    dismissed_at: state.dismissedAt,
  };
}

function setUserState(notification, userId, patch, now = new Date().toISOString()) {
  const existing = stateFor(notification.id, userId);
  const current = effectiveState(notification, userId);
  const read = patch.read === undefined ? current.read : patch.read;
  const dismissed = patch.dismissed === undefined ? current.dismissed : patch.dismissed;
  const values = {
    notification_id: notification.id,
    life_space_id: notification.life_space_id,
    user_id: userId,
    read,
    dismissed,
    read_at: patch.read === true ? now : patch.read === false ? null : current.readAt,
    dismissed_at: patch.dismissed === true ? now : patch.dismissed === false ? null : current.dismissedAt,
    updated_at: now,
  };
  if (existing) return db.table("notification_user_states").update(existing.id, values);
  return db.table("notification_user_states").insert({ id: uuid(), ...values, created_at: now });
}

function compareNotifications(a, b) {
  const time = String(b.created_at).localeCompare(String(a.created_at));
  if (time) return time;
  return String(b.id).localeCompare(String(a.id));
}

function encodeCursor(notification) {
  return Buffer.from(JSON.stringify({ createdAt: notification.created_at, id: notification.id }), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") return null;
    if (Number.isNaN(new Date(decoded.createdAt).getTime())) return null;
    return decoded;
  } catch {
    return null;
  }
}

function isAfterCursor(notification, cursor) {
  if (notification.created_at < cursor.createdAt) return true;
  if (notification.created_at > cursor.createdAt) return false;
  return String(notification.id) < cursor.id;
}

function visibleForUser(lifeSpaceId, userId) {
  return db.table("notifications")
    .where((notification) => notification.life_space_id === lifeSpaceId)
    .map((notification) => serializeForUser(notification, userId))
    .filter((notification) => !notification.dismissed)
    .sort(compareNotifications);
}

function listForUser(lifeSpaceId, userId, { filter = "all", type, query, cursor, before } = {}) {
  let list = visibleForUser(lifeSpaceId, userId);

  if (filter === "unread") list = list.filter((notification) => !notification.read);
  if (filter === "read") list = list.filter((notification) => notification.read);
  if (type) list = list.filter((notification) => notification.type === type);
  if (query) {
    const needle = String(query).trim().toLowerCase();
    list = list.filter((notification) => notification.message.toLowerCase().includes(needle));
  }
  if (cursor) list = list.filter((notification) => isAfterCursor(notification, cursor));
  else if (before) list = list.filter((notification) => new Date(notification.created_at).getTime() < before);
  return list;
}

function summarizeForUser(lifeSpaceId, userId) {
  const visible = visibleForUser(lifeSpaceId, userId);
  const byType = {};
  let unread = 0;
  for (const notification of visible) {
    if (!notification.read) unread += 1;
    byType[notification.type] = (byType[notification.type] || 0) + 1;
  }
  return { total: visible.length, unread, read: visible.length - unread, byType };
}

function unreadCount(lifeSpaceId, userId) {
  return listForUser(lifeSpaceId, userId, { filter: "unread" }).length;
}

module.exports = {
  stateFor,
  effectiveState,
  serializeForUser,
  setUserState,
  compareNotifications,
  encodeCursor,
  decodeCursor,
  visibleForUser,
  listForUser,
  summarizeForUser,
  unreadCount,
};
