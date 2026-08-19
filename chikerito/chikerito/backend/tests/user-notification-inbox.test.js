const db = require("../db");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  addTeamMember,
  createNotification,
} = require("./helpers/factories");

async function getInbox(person, space, query = "") {
  return api().get(`/api/lifespaces/${space.id}/notifications${query}`).set(person.headers);
}

describe("personal notification state persistence", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("does not mutate the shared notification row when a user reads it", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id, { read: false });

    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });

    expect(db.table("notifications").find(notification.id).read).toBe(false);
    const states = db.table("notification_user_states").where((state) => state.notification_id === notification.id);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ user_id: owner.user.id, life_space_id: space.id, read: true });
  });

  it("upserts one state row when the same user toggles repeatedly", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id);

    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });
    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: false });
    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });

    const states = db.table("notification_user_states").where(
      (state) => state.notification_id === notification.id && state.user_id === owner.user.id
    );
    expect(states).toHaveLength(1);
    expect(states[0].read).toBe(true);
    expect(states[0].read_at).toEqual(expect.any(String));
  });

  it("clears read_at when an item is marked unread", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id);
    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });

    const response = await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: false });
    expect(response.body.notification.read_at).toBeNull();
    expect(db.table("notification_user_states").all()[0].read_at).toBeNull();
  });

  it("records and exposes a personal dismissal timestamp", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id);

    await api().delete(`/api/notifications/${notification.id}`).set(owner.headers);
    const state = db.table("notification_user_states").where((item) => item.notification_id === notification.id)[0];
    expect(state.dismissed).toBe(true);
    expect(state.dismissed_at).toEqual(expect.any(String));
    expect(Number.isNaN(new Date(state.dismissed_at).getTime())).toBe(false);
  });

  it("restoring clears dismissed_at but preserves the personal read flag", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id);
    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });
    await api().delete(`/api/notifications/${notification.id}`).set(owner.headers);

    const response = await api().post(`/api/notifications/${notification.id}/restore`).set(owner.headers);
    expect(response.body.notification).toMatchObject({ read: true, dismissed: false, dismissed_at: null });
    expect(db.table("notification_user_states").all()[0].dismissed_at).toBeNull();
  });

  it("inherits the legacy shared read value until the user creates an override", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const legacy = createNotification(space.id, { read: true, message: "Legacy read item" });

    expect((await getInbox(owner, space)).body.notifications.find((item) => item.id === legacy.id).read).toBe(true);
    expect(db.table("notification_user_states").all()).toHaveLength(0);

    await api().patch(`/api/notifications/${legacy.id}`).set(owner.headers).send({ read: false });
    expect((await getInbox(owner, space)).body.notifications.find((item) => item.id === legacy.id).read).toBe(false);
  });

  it("stores independent state rows for independent members", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "finance_manager");
    const notification = createNotification(space.id);

    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });
    await api().patch(`/api/notifications/${notification.id}`).set(member.headers).send({ read: false });

    const states = db.table("notification_user_states").where((state) => state.notification_id === notification.id);
    expect(states).toHaveLength(2);
    expect(states.map((state) => state.user_id).sort()).toEqual([member.user.id, owner.user.id].sort());
  });
});

describe("notification filtering and cursor validation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("combines read, type, and message filters", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const match = createNotification(space.id, { type: "budget_warning", message: "Venue budget reached" });
    const wrongType = createNotification(space.id, { type: "donation", message: "Venue gift" });
    createNotification(space.id, { type: "budget_warning", message: "Catering budget reached" });
    await api().patch(`/api/notifications/${match.id}`).set(owner.headers).send({ read: true });
    await api().patch(`/api/notifications/${wrongType.id}`).set(owner.headers).send({ read: true });

    const response = await getInbox(owner, space, "?filter=read&type=budget_warning&q=venue");
    expect(response.status).toBe(200);
    expect(response.body.notifications.map((item) => item.id)).toEqual([match.id]);
  });

  it("rejects an unsupported filter instead of silently returning misleading data", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await getInbox(owner, space, "?filter=archived");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/filter/);
  });

  it("rejects an invalid opaque cursor", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await getInbox(owner, space, "?cursor=not-a-cursor");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/cursor/);
  });

  it("rejects a decodable cursor missing its deterministic id", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const malformed = Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z" })).toString("base64url");
    const response = await getInbox(owner, space, `?cursor=${encodeURIComponent(malformed)}`);
    expect(response.status).toBe(400);
  });

  it("rejects an invalid legacy before timestamp", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await getInbox(owner, space, "?before=yesterday-ish");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/before/);
  });

  it("keeps supporting valid legacy before pagination", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const older = createNotification(space.id, { created_at: "2026-01-01T00:00:00.000Z" });
    createNotification(space.id, { created_at: "2026-02-01T00:00:00.000Z" });
    const response = await getInbox(owner, space, "?before=2026-01-15T00%3A00%3A00.000Z");
    expect(response.body.notifications.map((item) => item.id)).toEqual([older.id]);
  });

  it("returns a cursor only when another result exists", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id, { created_at: "2026-01-02T00:00:00.000Z" });
    createNotification(space.id, { created_at: "2026-01-01T00:00:00.000Z" });

    const first = await getInbox(owner, space, "?limit=1");
    expect(first.body).toMatchObject({ hasMore: true, nextCursor: expect.any(String), filter: "all" });
    const second = await getInbox(owner, space, `?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("returns personal summary metadata separately from filtered totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const readItem = createNotification(space.id, { type: "donation" });
    createNotification(space.id, { type: "budget_warning" });
    createNotification(space.id, { type: "budget_warning" });
    await api().patch(`/api/notifications/${readItem.id}`).set(owner.headers).send({ read: true });

    const response = await getInbox(owner, space, "?filter=unread&type=budget_warning&limit=1");
    expect(response.body).toMatchObject({
      total: 2,
      pageSize: 1,
      summary: { total: 3, unread: 2, read: 1, byType: { donation: 1, budget_warning: 2 } },
    });
  });

  it("rejects an excessively long search term", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await getInbox(owner, space, `?q=${"x".repeat(201)}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/200 characters/);
  });
});

describe("personal inbox authorization and lifecycle", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("requires authentication to restore an item", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id);
    const response = await api().post(`/api/notifications/${notification.id}/restore`);
    expect(response.status).toBe(401);
  });

  it("forbids a non-member from restoring an item", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id);
    const response = await api().post(`/api/notifications/${notification.id}/restore`).set(stranger.headers);
    expect(response.status).toBe(403);
  });

  it("returns 404 when restoring an unknown item", async () => {
    const owner = await registerUser();
    const response = await api().post("/api/notifications/missing/restore").set(owner.headers);
    expect(response.status).toBe(404);
  });

  it("excludes personally dismissed unread items from the badge", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const notification = createNotification(space.id, { read: false });
    await api().delete(`/api/notifications/${notification.id}`).set(owner.headers);

    const count = await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(owner.headers);
    expect(count.body.count).toBe(0);
  });

  it("does not include dismissed items in mark-all's updated count", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const dismissed = createNotification(space.id, { read: false });
    createNotification(space.id, { read: false });
    await api().delete(`/api/notifications/${dismissed.id}`).set(owner.headers);

    const response = await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
    expect(response.body.updated).toBe(1);
  });

  it("treats notifications created after mark-all as newly unread", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id);
    await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
    const fresh = createNotification(space.id, { message: "Created later" });

    const unread = await getInbox(owner, space, "?filter=unread");
    expect(unread.body.notifications.map((item) => item.id)).toEqual([fresh.id]);
  });
});
