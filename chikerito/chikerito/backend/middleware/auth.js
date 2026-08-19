const jwt = require("jsonwebtoken");
const db = require("../db");
const { isActiveSession, touchSession } = require("../sessions");

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_OPTIONS = { expiresIn: "7d", algorithm: "HS256", issuer: "chikerito-api", audience: "chikerito-web" };

function signToken(user, sessionId) {
  return jwt.sign({ id: user.id, email: user.email, sid: sessionId }, SECRET, JWT_OPTIONS);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ["HS256"], issuer: JWT_OPTIONS.issuer, audience: JWT_OPTIONS.audience });
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
