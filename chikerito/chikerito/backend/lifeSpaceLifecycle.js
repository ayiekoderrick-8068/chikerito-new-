const db = require("./db");

const CASCADE_TABLES = [
  "team_members",
  "invitations",
  "budget_categories",
  "contributions",
  "expenses",
  "recurring_expenses",
  "tasks",
  "notifications",
];

function isArchived(lifeSpace) {
  return lifeSpace?.status === "archived";
}

function archiveConflict(lifeSpace) {
  return isArchived(lifeSpace)
    ? { error: "This life space is archived and read-only", archived: true }
    : null;
}

function deletionImpact(lifeSpaceId) {
  const counts = {};
  for (const table of CASCADE_TABLES) {
    counts[table] = db.table(table).count((row) => row.life_space_id === lifeSpaceId);
  }
  const dependentRecords = Object.entries(counts).reduce((total, [table, count]) => (
    total + (["team_members", "invitations", "notifications"].includes(table) ? 0 : count)
  ), 0);
  return {
    counts,
    dependentRecords,
    requiresArchive: dependentRecords > 0,
    requiresConfirmation: dependentRecords > 0,
  };
}

function revokePendingInvitations(lifeSpaceId, timestamp) {
  const invitations = db.table("invitations").all();
  db.table("invitations").replaceAll(invitations.map((invitation) => (
    invitation.life_space_id === lifeSpaceId && invitation.status === "pending"
      ? { ...invitation, status: "revoked", responded_at: timestamp }
      : invitation
  )));
}

function archiveLifeSpace(lifeSpace, actorId, timestamp = new Date().toISOString(), reason = "") {
  if (isArchived(lifeSpace)) return lifeSpace;
  revokePendingInvitations(lifeSpace.id, timestamp);
  return db.table("life_spaces").update(lifeSpace.id, {
    status: "archived",
    archived_at: timestamp,
    archived_by: actorId,
    archive_reason: reason,
  });
}

function restoreLifeSpace(lifeSpace, actorId, timestamp = new Date().toISOString()) {
  if (!isArchived(lifeSpace)) return lifeSpace;
  return db.table("life_spaces").update(lifeSpace.id, {
    status: "active",
    archived_at: null,
    archived_by: null,
    restored_at: timestamp,
    restored_by: actorId,
  });
}

function cascadeDeleteLifeSpace(lifeSpaceId) {
  const removed = {};
  for (const table of CASCADE_TABLES) {
    const rows = db.table(table).all();
    const kept = rows.filter((row) => row.life_space_id !== lifeSpaceId);
    removed[table] = rows.length - kept.length;
    db.table(table).replaceAll(kept);
  }
  db.table("life_spaces").remove(lifeSpaceId);
  return removed;
}

function lifecycleStatusFilter(value) {
  if (value === undefined || value === "") return { value: "active" };
  if (["active", "archived", "all"].includes(value)) return { value };
  return { error: "status must be one of: active, archived, all" };
}

function compareLifeSpaces(a, b) {
  const first = a.space || a;
  const second = b.space || b;
  const aRank = isArchived(first) ? 1 : 0;
  const bRank = isArchived(second) ? 1 : 0;
  return aRank - bRank
    || first.title.localeCompare(second.title)
    || (first.created_at || "").localeCompare(second.created_at || "")
    || first.id.localeCompare(second.id);
}

function lifecycleSummary(entries) {
  return entries.reduce((summary, entry) => {
    const space = entry.space || entry;
    const role = entry.role || space.role;
    if (isArchived(space)) summary.archived += 1;
    else summary.active += 1;
    if (role === "owner") summary.owned += 1;
    else summary.shared += 1;
    return summary;
  }, { active: 0, archived: 0, owned: 0, shared: 0, total: entries.length });
}

module.exports = {
  CASCADE_TABLES,
  isArchived,
  archiveConflict,
  deletionImpact,
  revokePendingInvitations,
  archiveLifeSpace,
  restoreLifeSpace,
  cascadeDeleteLifeSpace,
  lifecycleStatusFilter,
  compareLifeSpaces,
  lifecycleSummary,
};
