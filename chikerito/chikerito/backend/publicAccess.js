// Shared gate for the two unauthenticated endpoints (public report + public contribute).
// Enforces event visibility (private/public) and an optional passcode.
const bcrypt = require("bcryptjs");
const db = require("./db");

function findPublicLifeSpace(slug) {
  return db.table("life_spaces").where((s) => s.slug === slug)[0] || null;
}

function checkPublicAccess(lifeSpace, req) {
  if (!lifeSpace) return { ok: false, status: 404, body: { error: "Life space not found" } };
  if (lifeSpace.visibility !== "public") {
    return { ok: false, status: 403, body: { error: "This event is private.", private: true } };
  }
  if (lifeSpace.passcode_hash) {
    const supplied = req.query.passcode || req.headers["x-event-passcode"] || "";
    if (!supplied || !bcrypt.compareSync(String(supplied), lifeSpace.passcode_hash)) {
      return { ok: false, status: 401, body: { error: "This event requires a passcode.", passcodeRequired: true } };
    }
  }
  return { ok: true };
}

module.exports = { findPublicLifeSpace, checkPublicAccess };
