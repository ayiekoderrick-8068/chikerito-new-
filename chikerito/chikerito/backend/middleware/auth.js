const jwt = require("jsonwebtoken");
const db = require("../db");
const { isActiveSession, touchSession } = require("../sessions");

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signToken(user, sessionId) {
  return jwt.sign({ id: user.id, email: user.email, sid: sessionId }, SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  const session = db.table("sessions").find(payload.sid);
  if (!isActiveSession(session)) {
    return res.status(401).json({ error: "This session has been signed out" });
  }
  touchSession(session.id);
  req.user = payload;
  next();
}

module.exports = { signToken, requireAuth, SECRET };
