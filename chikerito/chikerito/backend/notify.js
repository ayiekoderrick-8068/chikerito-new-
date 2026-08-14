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

module.exports = { pushNotification };
