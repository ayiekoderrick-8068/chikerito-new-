const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { signToken, requireAuth } = require("../middleware/auth");
const {
  createSession,
  listActiveSessions,
  revokeSession,
  revokeAllSessions,
  revokeAllOtherSessions,
  sanitizeSession,
} = require("../sessions");
const { notifyPasswordReset } = require("../notify");

const router = express.Router();

const RESET_TOKEN_TTL_MINUTES = 60;

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function isActivePendingReset(reset) {
  return reset.status === "pending" && new Date(reset.expires_at).getTime() > Date.now();
}

router.post("/register", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: "firstName, lastName, email, and password are required" });
  }
  const users = db.table("users");
  if (users.where((u) => u.email.toLowerCase() === email.toLowerCase()).length) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = users.insert({
    id: uuid(),
    first_name: firstName,
    last_name: lastName,
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  });
  const session = createSession(user.id, req.headers["user-agent"]);
  const token = signToken(user, session.id);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const users = db.table("users");
  const user = users.where((u) => u.email.toLowerCase() === (email || "").toLowerCase())[0];
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });
  const session = createSession(user.id, req.headers["user-agent"]);
  const token = signToken(user, session.id);
  res.json({ token, user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.table("users").find(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

// Always responds the same way whether or not the email is registered — the
// only difference visible from outside the process is timing/whether a
// password_resets row was written, neither of which this response exposes.
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const responseBody = { message: "If an account exists for that email, a password reset link has been sent." };
  const user = db.table("users").where((u) => u.email.toLowerCase() === String(email).toLowerCase())[0];
  if (!user) return res.json(responseBody);

  // Only one active reset request at a time — a fresh request supersedes any
  // earlier still-pending one instead of leaving multiple valid links live.
  db.table("password_resets")
    .where((r) => r.user_id === user.id)
    .filter(isActivePendingReset)
    .forEach((r) => db.table("password_resets").update(r.id, { status: "revoked" }));

  const rawToken = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.table("password_resets").insert({
    id: uuid(),
    user_id: user.id,
    token_hash: hashToken(rawToken),
    status: "pending",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
    used_at: null,
  });

  const resetUrl = `${req.headers.origin || ""}/reset-password?token=${rawToken}`;
  notifyPasswordReset(user, resetUrl);

  // No real email transport exists yet (see notify.js) — surface the token
  // directly outside production so the flow is actually usable/testable.
  if (process.env.NODE_ENV !== "production") {
    responseBody.resetToken = rawToken;
    responseBody.resetUrl = resetUrl;
  }
  res.json(responseBody);
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password are required" });
  if (password.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });

  const record = db.table("password_resets").where((r) => r.token_hash === hashToken(token))[0];
  if (!record || !isActivePendingReset(record)) {
    return res.status(400).json({ error: "This reset link is invalid or has expired" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.table("users").update(record.user_id, { password_hash: passwordHash });
  db.table("password_resets").update(record.id, { status: "used", used_at: new Date().toISOString() });
  revokeAllSessions(record.user_id);

  res.json({ message: "Your password has been reset. Please sign in again." });
});

router.get("/sessions", requireAuth, (req, res) => {
  const sessions = listActiveSessions(req.user.id);
  res.json({ sessions: sessions.map((s) => sanitizeSession(s, req.user.sid)) });
});

router.delete("/sessions/:id", requireAuth, (req, res) => {
  const session = db.table("sessions").find(req.params.id);
  // Someone else's session id looks identical to an unknown one from here —
  // no reason to distinguish the two.
  if (!session || session.user_id !== req.user.id || session.revoked_at) {
    return res.status(404).json({ error: "Session not found" });
  }
  revokeSession(session.id);
  res.status(204).end();
});

router.post("/sessions/revoke-others", requireAuth, (req, res) => {
  const revoked = revokeAllOtherSessions(req.user.id, req.user.sid);
  res.json({ revoked });
});

function publicUser(u) {
  return { id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email };
}

module.exports = router;
