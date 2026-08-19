const { v4: uuid } = require("uuid");
const db = require("../db");
const {
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
} = require("../lifeSpaceLifecycle");
const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const { api, registerUser, createLifeSpace, addTeamMember, createCategory, createExpense, createTask } = require("./helpers/factories");

function rawSpace(overrides = {}) {
  return db.table("life_spaces").insert({
    id: uuid(), owner_id: "owner", title: "Space", milestone_type: "wedding", status: "active",
    created_at: "2099-01-01T00:00:00.000Z", ...overrides,
  });
}

function scopedRow(table, lifeSpaceId, overrides = {}) {
  return db.table(table).insert({ id: uuid(), life_space_id: lifeSpaceId, ...overrides });
}

describe("life-space lifecycle helpers", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("recognizes only the archived status as archived", () => {
    expect(isArchived({ status: "archived" })).toBe(true);
    expect(isArchived({ status: "active" })).toBe(false);
    expect(isArchived(null)).toBe(false);
  });

  it("returns a structured read-only conflict for archived spaces", () => {
    expect(archiveConflict({ status: "archived" })).toEqual({
      error: "This life space is archived and read-only", archived: true,
    });
    expect(archiveConflict({ status: "active" })).toBeNull();
  });

  it("defaults lifecycle listing to active and validates explicit filters", () => {
    expect(lifecycleStatusFilter()).toEqual({ value: "active" });
    expect(lifecycleStatusFilter("")).toEqual({ value: "active" });
    expect(lifecycleStatusFilter("archived")).toEqual({ value: "archived" });
    expect(lifecycleStatusFilter("all")).toEqual({ value: "all" });
    expect(lifecycleStatusFilter("deleted").error).toMatch(/active, archived, all/i);
  });

  it("sorts active before archived, then title and stable id", () => {
    const spaces = [
      { id: "z", title: "A", status: "archived", created_at: "1" },
      { id: "b", title: "B", status: "active", created_at: "1" },
      { id: "c", title: "A", status: "active", created_at: "2" },
      { id: "a", title: "A", status: "active", created_at: "2" },
    ];
    expect(spaces.sort(compareLifeSpaces).map((space) => space.id)).toEqual(["a", "c", "b", "z"]);
  });

  it("also sorts wrapped role-aware list entries", () => {
    const first = { space: { id: "1", title: "First", status: "active", created_at: "1" }, role: "owner" };
    const second = { space: { id: "2", title: "Second", status: "archived", created_at: "1" }, role: "owner" };
    expect([second, first].sort(compareLifeSpaces)).toEqual([first, second]);
  });

  it("summarizes active, archived, owned, and shared entries", () => {
    expect(lifecycleSummary([
      { space: { status: "active" }, role: "owner" },
      { space: { status: "archived" }, role: "owner" },
      { space: { status: "active" }, role: "volunteer" },
    ])).toEqual({ total: 3, active: 2, archived: 1, owned: 2, shared: 1 });
  });

  it("archives with actor/timestamp metadata and revokes pending invitations", () => {
    const space = rawSpace();
    const pending = scopedRow("invitations", space.id, { status: "pending", responded_at: null });
    const accepted = scopedRow("invitations", space.id, { status: "accepted", responded_at: "earlier" });
    const updated = archiveLifeSpace(space, "actor", "2099-02-01T00:00:00.000Z");
    expect(updated).toMatchObject({ status: "archived", archived_by: "actor", archived_at: "2099-02-01T00:00:00.000Z" });
    expect(db.table("invitations").find(pending.id)).toMatchObject({ status: "revoked", responded_at: "2099-02-01T00:00:00.000Z" });
    expect(db.table("invitations").find(accepted.id)).toMatchObject({ status: "accepted", responded_at: "earlier" });
  });

  it("does not revoke invitations belonging to another space", () => {
    const invitation = scopedRow("invitations", "other", { status: "pending", responded_at: null });
    revokePendingInvitations("target", "2099-02-01T00:00:00.000Z");
    expect(db.table("invitations").find(invitation.id)).toMatchObject({ status: "pending", responded_at: null });
  });

  it("archive is idempotent at the domain-helper level", () => {
    const space = rawSpace({ status: "archived", archived_at: "original", archived_by: "first" });
    expect(archiveLifeSpace(space, "second", "later")).toMatchObject({ archived_at: "original", archived_by: "first" });
  });

  it("stores a supplied archive reason", () => {
    const space = rawSpace();
    expect(archiveLifeSpace(space, "actor", "timestamp", "Event completed").archive_reason).toBe("Event completed");
  });

  it("restores lifecycle metadata while preserving history", () => {
    const space = rawSpace({ status: "archived", archived_at: "old", archived_by: "archiver" });
    expect(restoreLifeSpace(space, "restorer", "2099-03-01T00:00:00.000Z")).toMatchObject({
      status: "active", archived_at: null, archived_by: null,
      restored_at: "2099-03-01T00:00:00.000Z", restored_by: "restorer",
    });
  });

  it("restore is idempotent for already-active spaces", () => {
    const space = rawSpace({ restored_at: null });
    expect(restoreLifeSpace(space, "actor", "later").restored_at).toBeNull();
  });
});

describe("deletion impact and cascade helpers", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("reports every supported table even when empty", () => {
    const impact = deletionImpact("space");
    expect(Object.keys(impact.counts)).toEqual(CASCADE_TABLES);
    expect(Object.values(impact.counts).every((count) => count === 0)).toBe(true);
    expect(impact).toMatchObject({ dependentRecords: 0, requiresArchive: false, requiresConfirmation: false });
  });

  it("counts substantive financial and planning rows for confirmation", () => {
    scopedRow("budget_categories", "space");
    scopedRow("expenses", "space");
    scopedRow("tasks", "space");
    const impact = deletionImpact("space");
    expect(impact.counts).toMatchObject({ budget_categories: 1, expenses: 1, tasks: 1 });
    expect(impact).toMatchObject({ dependentRecords: 3, requiresArchive: true, requiresConfirmation: true });
  });

  it("reports bookkeeping counts without making empty-domain deletion incompatible", () => {
    scopedRow("team_members", "space", { role: "owner" });
    scopedRow("team_members", "space", { role: "volunteer" });
    scopedRow("invitations", "space", { status: "accepted" });
    scopedRow("notifications", "space");
    const impact = deletionImpact("space");
    expect(impact.counts).toMatchObject({ team_members: 2, invitations: 1, notifications: 1 });
    expect(impact.dependentRecords).toBe(0);
  });

  it("cascade returns exact removal counts and removes the life space", () => {
    const space = rawSpace({ id: "target" });
    scopedRow("expenses", space.id);
    scopedRow("expenses", space.id);
    scopedRow("tasks", space.id);
    const removed = cascadeDeleteLifeSpace(space.id);
    expect(removed).toMatchObject({ expenses: 2, tasks: 1 });
    expect(db.table("life_spaces").find(space.id)).toBeUndefined();
  });

  it("cascade preserves all other-space rows in every table", () => {
    const target = rawSpace({ id: "target" });
    const other = rawSpace({ id: "other", title: "Other" });
    const keepers = CASCADE_TABLES.map((table) => scopedRow(table, other.id));
    CASCADE_TABLES.forEach((table) => scopedRow(table, target.id));
    cascadeDeleteLifeSpace(target.id);
    CASCADE_TABLES.forEach((table, index) => expect(db.table(table).find(keepers[index].id)).toBeDefined());
    expect(db.table("life_spaces").find(other.id)).toBeDefined();
  });
});

describe("lifecycle API edge cases", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("rejects an invalid status list filter", async () => {
    const owner = await registerUser();
    const response = await api().get("/api/lifespaces?status=deleted").set(owner.headers);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/status/i);
  });

  it("does not let non-members discover lifecycle controls", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const space = await createLifeSpace(owner.token);
    expect((await api().post(`/api/lifespaces/${space.id}/archive`).set(stranger.headers)).status).toBe(403);
    expect((await api().get(`/api/lifespaces/${space.id}/deletion-impact`).set(stranger.headers)).status).toBe(403);
  });

  it("rejects restore for an active life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await api().post(`/api/lifespaces/${space.id}/restore`).set(owner.headers);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/not archived/i);
  });

  it("rejects repeated archive through the write-protection boundary", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    const response = await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ archived: true });
  });

  it("trims and persists an archive reason", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers).send({ reason: "  Event complete  " });
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace.archive_reason).toBe("Event complete");
  });

  it("rejects an archive reason longer than 500 characters", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers).send({ reason: "x".repeat(501) });
    expect(response.status).toBe(400);
    expect(db.table("life_spaces").find(space.id).status).toBe("active");
  });

  it("does not allow direct status changes through general settings", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ status: "archived" });
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace.status).toBe("active");
  });

  it("reports deterministic deletion-impact counts to the owner", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createCategory(owner.token, space.id);
    await createExpense(owner.token, space.id);
    await createTask(owner.token, space.id);
    const response = await api().get(`/api/lifespaces/${space.id}/deletion-impact`).set(owner.headers);
    expect(response.status).toBe(200);
    expect(response.body.impact).toMatchObject({
      counts: expect.objectContaining({ budget_categories: 1, expenses: 1, tasks: 1 }),
      dependentRecords: 3,
      requiresArchive: true,
      requiresConfirmation: true,
    });
  });

  it("restoring does not revive invitations revoked by archive", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const invitation = await api().post(`/api/lifespaces/${space.id}/invitations`).set(owner.headers).send({ email: invitee.user.email, role: "volunteer" });
    await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    await api().post(`/api/lifespaces/${space.id}/restore`).set(owner.headers);
    expect(db.table("invitations").find(invitation.body.invitation.id).status).toBe("revoked");
  });

  it("an empty life space retains backward-compatible immediate deletion", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    expect((await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers)).status).toBe(204);
  });

  it("title confirmation is exact and case-sensitive", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { title: "Exact Name" });
    await createExpense(owner.token, space.id);
    await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    const response = await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers).send({ confirmDelete: true, confirmationTitle: "exact name" });
    expect(response.status).toBe(409);
    expect(db.table("life_spaces").find(space.id)).toBeDefined();
  });

  it("archived public contribution endpoints return gone without inserting money", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "public" });
    await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    const response = await api().post(`/api/public/lifespaces/${space.slug}/contribute`).send({ contributorName: "Guest", amount: 50 });
    expect(response.status).toBe(410);
    expect(rawState().contributions).toEqual([]);
  });

  it("members see archived spaces only when explicitly requested", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "editor");
    await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    expect((await api().get("/api/lifespaces").set(member.headers)).body.lifeSpaces).toEqual([]);
    expect((await api().get("/api/lifespaces?status=archived").set(member.headers)).body.lifeSpaces[0]).toMatchObject({ id: space.id, role: "editor" });
  });

  it("returns lifecycle summary with all-status listings", async () => {
    const owner = await registerUser();
    const archived = await createLifeSpace(owner.token, { title: "Archived" });
    await createLifeSpace(owner.token, { title: "Active" });
    await api().post(`/api/lifespaces/${archived.id}/archive`).set(owner.headers);
    const response = await api().get("/api/lifespaces?status=all").set(owner.headers);
    expect(response.body.summary).toEqual({ total: 2, active: 1, archived: 1, owned: 2, shared: 0 });
  });

  it("lets a member leave an active or archived space without deleting tenant data", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "volunteer");
    await createTask(owner.token, space.id, { title: "Keep" });
    await api().post(`/api/lifespaces/${space.id}/archive`).set(owner.headers);
    expect((await api().post(`/api/lifespaces/${space.id}/leave`).set(member.headers)).status).toBe(204);
    expect(db.table("tasks").where((task) => task.life_space_id === space.id)).toHaveLength(1);
    expect((await api().get(`/api/lifespaces/${space.id}`).set(member.headers)).status).toBe(403);
  });

  it("prevents the authoritative owner from leaving", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await api().post(`/api/lifespaces/${space.id}/leave`).set(owner.headers);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/owner cannot leave/i);
    expect(db.table("life_spaces").find(space.id)).toBeDefined();
  });
});
