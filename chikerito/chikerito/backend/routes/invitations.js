const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireMember, requireCapability, roleFor, INVITABLE_ROLES } = require("../middleware/authorize");
const { pushNotification } = require("../notify");

const router = express.Router();

const INVITATION_TTL_DAYS = 7;

function isExpired(invitation) {
  return new Date(invitation.expires_at).getTime() < Date.now();
}

// The stored status only ever moves pending -> accepted/declined/revoked.
// "expired" is derived at read time rather than written, so nothing needs a
// background job — a still-"pending" row past its expiry just presents (and
// behaves, for accept/decline/duplicate-checks) as expired.
function presentInvitation(invitation) {
  const status = invitation.status === "pending" && isExpired(invitation) ? "expired" : invitation.status;
  return { ...invitation, status };
}

function isActivePending(invitation) {
  return invitation.status === "pending" && !isExpired(invitation);
}

router.post("/lifespaces/:id/invitations", requireAuth, requireCapability("team:manage", "id"), (req, res) => {
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });
  if (!role || !INVITABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${INVITABLE_ROLES.join(", ")}` });
  }
  const normalizedEmail = String(email).toLowerCase();

  const existingUser = db.table("users").where((u) => u.email.toLowerCase() === normalizedEmail)[0];
  if (existingUser && roleFor(req.lifeSpace, existingUser.id)) {
    return res.status(409).json({ error: "This person is already a member of this life space" });
  }

  const duplicate = db
    .table("invitations")
    .where((i) => i.life_space_id === req.params.id && i.email.toLowerCase() === normalizedEmail)
    .some(isActivePending);
  if (duplicate) {
    return res.status(409).json({ error: "An active invitation already exists for this email" });
  }

  const now = Date.now();
  const invitation = db.table("invitations").insert({
    id: uuid(),
    life_space_id: req.params.id,
    email: normalizedEmail,
    role,
    status: "pending",
    invited_by: req.user.id,
    invited_at: new Date(now).toISOString(),
    expires_at: new Date(now + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    responded_at: null,
  });
  res.status(201).json({ invitation: presentInvitation(invitation) });
});

// Any member can see who's been invited — mirrors GET /:id/team's visibility.
// Only currently-pending (non-expired) invitations are listed; resolved ones
// (accepted/declined/revoked/expired) are done and not team-management noise.
router.get("/lifespaces/:id/invitations", requireAuth, requireMember("id"), (req, res) => {
  const pending = db
    .table("invitations")
    .where((i) => i.life_space_id === req.params.id)
    .filter(isActivePending)
    .sort((a, b) => new Date(b.invited_at) - new Date(a.invited_at));
  res.json({ invitations: pending.map(presentInvitation) });
});

router.delete("/lifespaces/:id/invitations/:invitationId", requireAuth, requireCapability("team:manage", "id"), (req, res) => {
  const invitation = db.table("invitations").find(req.params.invitationId);
  if (!invitation || invitation.life_space_id !== req.params.id) {
    return res.status(404).json({ error: "Invitation not found" });
  }
  if (!isActivePending(invitation)) {
    return res.status(409).json({ error: "This invitation is no longer pending" });
  }
  db.table("invitations").update(invitation.id, { status: "revoked", responded_at: new Date().toISOString() });
  res.status(204).end();
});

// Invitations addressed to the authenticated user's own email — this is how
// someone without a current life space (or not yet a member of this one)
// discovers what they've been invited to.
router.get("/invitations/pending", requireAuth, (req, res) => {
  const email = req.user.email.toLowerCase();
  const pending = db
    .table("invitations")
    .where((i) => i.email.toLowerCase() === email)
    .filter(isActivePending)
    .sort((a, b) => new Date(b.invited_at) - new Date(a.invited_at));
  const withLifeSpace = pending.map((i) => {
    const lifeSpace = db.table("life_spaces").find(i.life_space_id);
    return { ...presentInvitation(i), lifeSpaceTitle: lifeSpace ? lifeSpace.title : "Unknown" };
  });
  res.json({ invitations: withLifeSpace });
});

router.post("/invitations/:id/accept", requireAuth, (req, res) => {
  const invitation = db.table("invitations").find(req.params.id);
  if (!invitation) return res.status(404).json({ error: "Invitation not found" });
  if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: "This invitation was not sent to your account" });
  }
  if (!isActivePending(invitation)) {
    return res.status(409).json({ error: presentInvitation(invitation).status === "expired" ? "This invitation has expired" : "This invitation is no longer pending" });
  }
  const acceptingLifeSpace = db.table("life_spaces").find(invitation.life_space_id);
  if (!acceptingLifeSpace) return res.status(404).json({ error: "Life space not found" });
  if (acceptingLifeSpace.status === "archived") {
    return res.status(409).json({ error: "This life space is archived and cannot accept new members", archived: true });
  }

  db.table("team_members").insert({
    id: uuid(),
    life_space_id: invitation.life_space_id,
    user_id: req.user.id,
    role: invitation.role,
    invited_at: invitation.invited_at,
  });
  const updated = db.table("invitations").update(invitation.id, { status: "accepted", responded_at: new Date().toISOString() });

  const lifeSpace = db.table("life_spaces").find(invitation.life_space_id);
  if (lifeSpace) {
    const joiningUser = db.table("users").find(req.user.id);
    const name = joiningUser ? `${joiningUser.first_name} ${joiningUser.last_name}` : req.user.email;
    pushNotification(lifeSpace.id, "team_joined", `${name} joined the team as ${invitation.role.replace("_", " ")}`);
  }

  res.json({ invitation: presentInvitation(updated) });
});

router.post("/invitations/:id/decline", requireAuth, (req, res) => {
  const invitation = db.table("invitations").find(req.params.id);
  if (!invitation) return res.status(404).json({ error: "Invitation not found" });
  if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: "This invitation was not sent to your account" });
  }
  if (!isActivePending(invitation)) {
    return res.status(409).json({ error: presentInvitation(invitation).status === "expired" ? "This invitation has expired" : "This invitation is no longer pending" });
  }
  const updated = db.table("invitations").update(invitation.id, { status: "declined", responded_at: new Date().toISOString() });
  res.json({ invitation: presentInvitation(updated) });
});

module.exports = router;
