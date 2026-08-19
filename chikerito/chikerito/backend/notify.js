const { v4: uuid } = require("uuid");
const db = require("./db");

function pushNotification(lifeSpaceId, type, message) {
  return db.table("notifications").insert({
    id: uuid(),
    life_space_id: lifeSpaceId,
    type,
    message,
    read: false,
    created_at: new Date().toISOString(),
  });
}

// Password reset has no life_space_id — it's an account-level event, not a
// life-space one — so it can't go through pushNotification()/the
// notifications table without misusing that schema. There's no real email
// transport anywhere in this app yet, so this is a dev-mode stand-in
// (console output) rather than an actual send; swap the body for a real
// mail provider call when one exists. Kept in this file, alongside
// pushNotification, since both are "tell someone something happened."
async function notifyPasswordReset(user, resetUrl) {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.EMAIL_DELIVERY_URL || !process.env.EMAIL_DELIVERY_TOKEN) {
    throw Object.assign(new Error("Password recovery email is not configured"), { status: 503 });
  }
  const response = await fetch(process.env.EMAIL_DELIVERY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.EMAIL_DELIVERY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: user.email,
      template: "password-reset",
      variables: { firstName: user.first_name, resetUrl },
    }),
  });
  if (!response.ok) throw Object.assign(new Error("Password recovery email could not be sent"), { status: 502 });
}

module.exports = { pushNotification, notifyPasswordReset };
