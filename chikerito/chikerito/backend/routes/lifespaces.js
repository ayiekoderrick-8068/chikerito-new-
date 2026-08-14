const express = require("express");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Never send the passcode hash to the client; expose only whether one is set.
function sanitize(lifeSpace) {
  const { passcode_hash, ...rest } = lifeSpace;
  return { ...rest, hasPasscode: !!passcode_hash };
}

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

// List life spaces the current user owns or is a team member of
router.get("/", requireAuth, (req, res) => {
  const memberships = db.table("team_members").where((m) => m.user_id === req.user.id);
  const memberSpaceIds = new Set(memberships.map((m) => m.life_space_id));
  const spaces = db.table("life_spaces").where(
    (s) => s.owner_id === req.user.id || memberSpaceIds.has(s.id)
  );
  res.json({ lifeSpaces: spaces.map(sanitize) });
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
  res.status(201).json({ lifeSpace: sanitize(lifeSpace) });
});

router.get("/:id", requireAuth, (req, res) => {
  const lifeSpace = db.table("life_spaces").find(req.params.id);
  if (!lifeSpace) return res.status(404).json({ error: "Life space not found" });
  res.json({ lifeSpace: sanitize(lifeSpace) });
});

router.patch("/:id", requireAuth, (req, res) => {
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
  if (!updated) return res.status(404).json({ error: "Life space not found" });
  res.json({ lifeSpace: sanitize(updated) });
});

router.delete("/:id", requireAuth, (req, res) => {
  db.table("life_spaces").remove(req.params.id);
  res.status(204).end();
});

// Team
router.get("/:id/team", requireAuth, (req, res) => {
  const members = db.table("team_members").where((m) => m.life_space_id === req.params.id);
  const users = db.table("users").all();
  const withNames = members.map((m) => {
    const u = users.find((u) => u.id === m.user_id);
    return { ...m, name: u ? `${u.first_name} ${u.last_name}` : "Unknown", email: u ? u.email : "" };
  });
  res.json({ team: withNames });
});

router.post("/:id/team", requireAuth, (req, res) => {
  const { email, role } = req.body;
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

module.exports = router;
