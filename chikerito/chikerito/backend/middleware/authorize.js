// Shared life-space authorization: who is a member of a life space, what
// role they hold, and what that role permits. Every route that reads or
// writes a life-space-scoped resource should resolve access through here
// instead of re-implementing its own membership/ownership check.
const db = require("../db");

const ROLES = ["owner", "finance_manager", "event_planner", "volunteer", "editor"];

// Never assignable by an invite/role-change request — only life-space
// creation grants the owner role, so this is the entire privilege-escalation
// surface: keep "owner" out of it.
const INVITABLE_ROLES = ROLES.filter((r) => r !== "owner");

// Every one of the 5 roles can always VIEW life-space-scoped resources
// (enforced by requireMember, not listed here). CAPABILITIES only covers the
// elevated, write-capable actions.
const CAPABILITIES = {
  "lifespace:edit_settings": ["owner", "finance_manager", "event_planner", "editor"],
  "lifespace:edit_visibility": ["owner"],
  "lifespace:delete": ["owner"],
  "category:manage": ["owner", "finance_manager"],
  "expense:manage": ["owner", "finance_manager"],
  "contribution:manage": ["owner", "finance_manager"],
  "task:manage": ["owner", "event_planner"],
  "team:manage": ["owner"],
};

// The true owner is tracked by life_spaces.owner_id (set once at creation);
// team_members additionally carries an "owner" row for that same user so
// team listings are complete. owner_id is the authoritative source here.
function roleFor(lifeSpace, userId) {
  if (!lifeSpace) return null;
  if (lifeSpace.owner_id === userId) return "owner";
  const member = db
    .table("team_members")
    .where((m) => m.life_space_id === lifeSpace.id && m.user_id === userId)[0];
  return member ? member.role : null;
}

function hasCapability(role, capability) {
  return !!role && (CAPABILITIES[capability] || []).includes(role);
}

// Resolves the life space named by req.params[paramName], attaches
// req.lifeSpace and req.role. 404 if the life space doesn't exist at all;
// 403 if it exists but the caller holds no role on it (any of the 5 roles
// qualifies — this is the view-access gate).
function requireMember(paramName = "lifeSpaceId") {
  return (req, res, next) => {
    const lifeSpace = db.table("life_spaces").find(req.params[paramName]);
    if (!lifeSpace) return res.status(404).json({ error: "Life space not found" });
    const role = roleFor(lifeSpace, req.user.id);
    if (!role) return res.status(403).json({ error: "You do not have access to this life space" });
    req.lifeSpace = lifeSpace;
    req.role = role;
    next();
  };
}

// Same resolution as requireMember, plus a specific capability check.
function requireCapability(capability, paramName = "lifeSpaceId") {
  return (req, res, next) => {
    const lifeSpace = db.table("life_spaces").find(req.params[paramName]);
    if (!lifeSpace) return res.status(404).json({ error: "Life space not found" });
    const role = roleFor(lifeSpace, req.user.id);
    if (!role) return res.status(403).json({ error: "You do not have access to this life space" });
    if (!hasCapability(role, capability)) {
      return res.status(403).json({ error: "Your role does not allow this action" });
    }
    req.lifeSpace = lifeSpace;
    req.role = role;
    next();
  };
}

// For routes keyed by a child resource id rather than a life-space id
// (e.g. PATCH /expenses/:id): loads the resource from `table`, resolves its
// parent life space via resource.life_space_id, then applies the same
// membership + capability check. Attaches req.resource alongside
// req.lifeSpace/req.role so the handler doesn't need a second lookup.
function requireResourceCapability(table, capability, idParam = "id") {
  return (req, res, next) => {
    const resource = db.table(table).find(req.params[idParam]);
    if (!resource) return res.status(404).json({ error: "Not found" });
    const lifeSpace = db.table("life_spaces").find(resource.life_space_id);
    if (!lifeSpace) return res.status(404).json({ error: "Not found" });
    const role = roleFor(lifeSpace, req.user.id);
    if (!role) return res.status(403).json({ error: "You do not have access to this life space" });
    if (!hasCapability(role, capability)) {
      return res.status(403).json({ error: "Your role does not allow this action" });
    }
    req.resource = resource;
    req.lifeSpace = lifeSpace;
    req.role = role;
    next();
  };
}

// Same resolution as requireResourceCapability, but for actions any member
// may take regardless of role (e.g. marking a notification read/dismissing
// it) — no capability check, just membership.
function requireResourceMember(table, idParam = "id") {
  return (req, res, next) => {
    const resource = db.table(table).find(req.params[idParam]);
    if (!resource) return res.status(404).json({ error: "Not found" });
    const lifeSpace = db.table("life_spaces").find(resource.life_space_id);
    if (!lifeSpace) return res.status(404).json({ error: "Not found" });
    const role = roleFor(lifeSpace, req.user.id);
    if (!role) return res.status(403).json({ error: "You do not have access to this life space" });
    req.resource = resource;
    req.lifeSpace = lifeSpace;
    req.role = role;
    next();
  };
}

module.exports = {
  ROLES,
  INVITABLE_ROLES,
  CAPABILITIES,
  roleFor,
  hasCapability,
  requireMember,
  requireCapability,
  requireResourceCapability,
  requireResourceMember,
};
