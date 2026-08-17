// Server-side session tracking layered on top of the JWTs middleware/auth.js
// issues. The JWT itself stays a normal signed, stateless token — what makes
// a session revocable is that its payload carries a `sid` matching a row
// here, and requireAuth checks that row is still live on every request. The
// sid isn't independently bearer-capable (you still need the whole signed
// JWT to authenticate), so unlike password reset tokens it's stored as a
// plain id, not a hash — this mirrors how session ids work in traditional
// server-side session auth.
const { v4: uuid } = require("uuid");
const db = require("./db");

function createSession(userId, userAgent) {
  const now = new Date().toISOString();
  return db.table("sessions").insert({
    id: uuid(),
    user_id: userId,
    user_agent: userAgent || null,
    created_at: now,
    last_seen_at: now,
    revoked_at: null,
  });
}

function isActiveSession(session) {
  return !!session && !session.revoked_at;
}

function touchSession(id) {
  db.table("sessions").update(id, { last_seen_at: new Date().toISOString() });
}

function listActiveSessions(userId) {
  return db
    .table("sessions")
    .where((s) => s.user_id === userId && !s.revoked_at)
    .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));
}

function revokeSession(id) {
  return db.table("sessions").update(id, { revoked_at: new Date().toISOString() });
}

// Used after a password reset — every existing session for the account is
// invalidated, current one included, since the whole point is forcing
// re-authentication everywhere.
function revokeAllSessions(userId) {
  const sessions = db.table("sessions").where((s) => s.user_id === userId && !s.revoked_at);
  sessions.forEach((s) => revokeSession(s.id));
  return sessions.length;
}

function revokeAllOtherSessions(userId, currentSessionId) {
  const sessions = db.table("sessions").where((s) => s.user_id === userId && !s.revoked_at && s.id !== currentSessionId);
  sessions.forEach((s) => revokeSession(s.id));
  return sessions.length;
}

function sanitizeSession(session, currentSessionId) {
  return {
    id: session.id,
    userAgent: session.user_agent,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    current: session.id === currentSessionId,
  };
}

module.exports = {
  createSession,
  isActiveSession,
  touchSession,
  listActiveSessions,
  revokeSession,
  revokeAllSessions,
  revokeAllOtherSessions,
  sanitizeSession,
};
