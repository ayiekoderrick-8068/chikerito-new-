const express = require("express");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, hasCapability, roleFor, INVITABLE_ROLES } = require("../middleware/authorize");
const { sanitizeLifeSpace } = require("../serialize");

const router = express.Router();

function slugify(title) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

// List life spaces the current user owns or is a team member of, each
// tagged with the caller's role so the frontend can gate actions per space.
router.get("/", requireAuth, (req, res) => {
  const mine = db
    .table("life_spaces")
    .all()
    .map((space) => ({ space, role: roleFor(space, req.user.id) }))
    .filter((x) => x.role);
  res.json({ lifeSpaces: mine.map(({ space, role }) => sanitizeLifeSpace(space, role)) });
});

router.post("/", requireAuth, (req, res) => {
  const { title, milestoneType, story, goalAmount, currency, theme, coverImage } = req.body;
  if (!title || !milestoneType) {
    return res.status(400).json({ error: "title and milestoneType are required" });
  }
  const lifeSpace = db.table("life_spaces").insert({
    id: uuid(),
    owner_id: req.user.id,
    title,
    milestone_type: milestoneType,
    story: story || "",
    goal_amount: Number(goalAmount) || 0,
    currency: currency || "USD",
    theme: theme || "classic",
    visibility: "private", // safe by default — owner opts in to making it public
    show_budget_public: false,
    allow_indexing: false,
    passcode_hash: null,
    cover_image: coverImage || null,
    slug: slugify(title),
    status: "active",
    created_at: new Date().toISOString(),
  });
  db.table("team_members").insert({
    id: uuid(),
    life_space_id: lifeSpace.id,
    user_id: req.user.id,
    role: "owner",
    invited_at: new Date().toISOString(),
  });
  res.status(201).json({ lifeSpace: sanitizeLifeSpace(lifeSpace, "owner") });
});

router.get("/:id", requireAuth, requireMember("id"), (req, res) => {
  res.json({ lifeSpace: sanitizeLifeSpace(req.lifeSpace, req.role) });
});

// Sensitive fields (visibility, showBudgetPublic, allowIndexing, passcode)
// require the stricter owner-only capability; everything else only requires
// lifespace:edit_settings. A request touching both is held to the stricter
// bar for the whole request rather than partially applying.
router.patch("/:id", requireAuth, requireMember("id"), (req, res) => {
  const sensitiveKeys = ["visibility", "showBudgetPublic", "allowIndexing", "passcode"];
  const touchesSensitive = sensitiveKeys.some((key) => req.body[key] !== undefined);
  const neededCapability = touchesSensitive ? "lifespace:edit_visibility" : "lifespace:edit_settings";
  if (!hasCapability(req.role, neededCapability)) {
    return res.status(403).json({ error: "Your role does not allow this action" });
  }

  const allowed = ["title", "story", "goalAmount", "theme", "visibility", "showBudgetPublic", "allowIndexing", "coverImage", "status"];
  const columnMap = { goalAmount: "goal_amount", showBudgetPublic: "show_budget_public", allowIndexing: "allow_indexing", coverImage: "cover_image" };
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[columnMap[key] || key] = key === "goalAmount" ? Number(req.body[key]) : req.body[key];
    }
  }
  // passcode is handled separately: a non-empty string sets/replaces it, an explicit empty string clears it
  if (req.body.passcode !== undefined) {
    patch.passcode_hash = req.body.passcode ? bcrypt.hashSync(String(req.body.passcode), 10) : null;
  }
  const updated = db.table("life_spaces").update(req.params.id, patch);
  res.json({ lifeSpace: sanitizeLifeSpace(updated, req.role) });
});

router.delete("/:id", requireAuth, requireCapability("lifespace:delete", "id"), (req, res) => {
  db.table("life_spaces").remove(req.params.id);
  res.status(204).end();
});

// Team
router.get("/:id/team", requireAuth, requireMember("id"), (req, res) => {
  const members = db.table("team_members").where((m) => m.life_space_id === req.params.id);
  const users = db.table("users").all();
  const withNames = members.map((m) => {
    const u = users.find((u) => u.id === m.user_id);
    return { ...m, name: u ? `${u.first_name} ${u.last_name}` : "Unknown", email: u ? u.email : "" };
  });
  res.json({ team: withNames });
});

router.post("/:id/team", requireAuth, requireCapability("team:manage", "id"), (req, res) => {
  const { email, role } = req.body;
  if (role !== undefined && !INVITABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${INVITABLE_ROLES.join(", ")}` });
  }
  const user = db.table("users").where((u) => u.email.toLowerCase() === (email || "").toLowerCase())[0];
  if (!user) return res.status(404).json({ error: "No user found with that email" });
  const member = db.table("team_members").insert({
    id: uuid(),
    life_space_id: req.params.id,
    user_id: user.id,
    role: role || "volunteer",
    invited_at: new Date().toISOString(),
  });
  res.status(201).json({ member });
});

router.patch("/:id/team/:memberId", requireAuth, requireCapability("team:manage", "id"), (req, res) => {
  const { role } = req.body;
  if (!role || !INVITABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${INVITABLE_ROLES.join(", ")}` });
  }
  const member = db.table("team_members").find(req.params.memberId);
  if (!member || member.life_space_id !== req.params.id) {
    return res.status(404).json({ error: "Team member not found" });
  }
  if (member.user_id === req.lifeSpace.owner_id) {
    return res.status(403).json({ error: "The life space owner's role cannot be changed" });
  }
  const updated = db.table("team_members").update(member.id, { role });
  res.json({ member: updated });
});

router.delete("/:id/team/:memberId", requireAuth, requireCapability("team:manage", "id"), (req, res) => {
  const member = db.table("team_members").find(req.params.memberId);
  if (!member || member.life_space_id !== req.params.id) {
    return res.status(404).json({ error: "Team member not found" });
  }
  if (member.user_id === req.lifeSpace.owner_id) {
    return res.status(403).json({ error: "The life space owner cannot be removed" });
  }
  db.table("team_members").remove(member.id);
  res.status(204).end();
});

module.exports = router;
