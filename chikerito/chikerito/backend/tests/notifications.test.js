// notifications.js has no equivalent in the old snapshot — new baseline
// coverage for a new feature, not an adaptation.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createContribution,
  addTeamMember,
  createNotification,
} = require("./helpers/factories");

describe("GET /api/lifespaces/:id/notifications", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("is empty for a life space with no notifications", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it("lists a real expense_added notification produced by recording an expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { vendor: "Florist", amount: 75 });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    const added = res.body.notifications.find((n) => n.type === "expense_added");
    expect(added).toBeDefined();
    expect(added.message).toContain("Florist");
    expect(added.read).toBe(false);
  });

  it("lists a real budget_warning notification produced by an over-budget expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 150, categoryId: category.id });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    expect(res.body.notifications.some((n) => n.type === "budget_warning")).toBe(true);
  });

  it("lists real donation and milestone_funded notifications produced by contributions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createContribution(space.slug, { amount: 100, categoryId: category.id, contributorName: "Aunt Mary" });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    const types = res.body.notifications.map((n) => n.type);
    expect(types).toContain("donation");
    expect(types).toContain("milestone_funded");
    expect(res.body.notifications.find((n) => n.type === "donation").message).toContain("Aunt Mary");
  });

  it("returns notifications newest first", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const older = createNotification(space.id, { created_at: "2026-01-01T00:00:00.000Z", message: "Older" });
    const newer = createNotification(space.id, { created_at: "2026-06-01T00:00:00.000Z", message: "Newer" });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    expect(res.body.notifications.map((n) => n.id)).toEqual([newer.id, older.id]);
  });

  it("scopes notifications to the requested life space only", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    createNotification(a.id, { message: "For A" });
    createNotification(b.id, { message: "For B" });
    const res = await api().get(`/api/lifespaces/${a.id}/notifications`).set(owner.headers);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].message).toBe("For A");
  });

  it("filters to unread only with ?unreadOnly=true", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id, { read: true, message: "Already read" });
    createNotification(space.id, { read: false, message: "Still unread" });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications?unreadOnly=true`).set(owner.headers);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].message).toBe("Still unread");
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`);
    expect(res.status).toBe(401);
  });

  it("403s a registered non-member", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(stranger.headers);
    expect(res.status).toBe(403);
  });

  it("404s an unknown life space", async () => {
    const owner = await registerUser();
    const res = await api().get("/api/lifespaces/no-such-id/notifications").set(owner.headers);
    expect(res.status).toBe(404);
  });

  it("any role, including volunteer, can list notifications", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const helper = await registerUser();
    // addTeamMember() itself raises a team_joined notification (the invitations
    // phase integrating with this feature), on top of the one seeded below.
    await addTeamMember(owner.token, space.id, helper, "volunteer");
    createNotification(space.id, { message: "Seeded for this test" });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications`).set(helper.headers);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.notifications.some((n) => n.message === "Seeded for this test")).toBe(true);
    expect(res.body.notifications.some((n) => n.type === "team_joined")).toBe(true);
  });
});

describe("pagination", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  async function seedMany(space, count) {
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const created = [];
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      created.push(createNotification(space.id, { created_at: new Date(base + i * 1000).toISOString(), message: `N${i}` }));
    }
    return created; // oldest to newest
  }

  it("caps the page at the requested limit and reports hasMore", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await seedMany(space, 5);
    const res = await api().get(`/api/lifespaces/${space.id}/notifications?limit=2`).set(owner.headers);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
  });

  it("hasMore is false once every notification fits on the page", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await seedMany(space, 3);
    const res = await api().get(`/api/lifespaces/${space.id}/notifications?limit=10`).set(owner.headers);
    expect(res.body.notifications).toHaveLength(3);
    expect(res.body.hasMore).toBe(false);
  });

  it("continues from a before cursor without repeating or skipping items", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const created = await seedMany(space, 5); // oldest..newest
    const firstPage = await api().get(`/api/lifespaces/${space.id}/notifications?limit=2`).set(owner.headers);
    const oldestOnFirstPage = firstPage.body.notifications[firstPage.body.notifications.length - 1];

    const secondPage = await api()
      .get(`/api/lifespaces/${space.id}/notifications?limit=2&before=${oldestOnFirstPage.created_at}`)
      .set(owner.headers);

    const firstIds = firstPage.body.notifications.map((n) => n.id);
    const secondIds = secondPage.body.notifications.map((n) => n.id);
    expect(firstIds).not.toEqual(expect.arrayContaining(secondIds));
    // Together, the two pages are the 4 newest of the 5 seeded (cursor excludes the oldest's own timestamp boundary correctly).
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect([...firstIds, ...secondIds]).not.toContain(created[0].id);
  });

  it("caps limit at the server maximum even if a huge value is requested", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await seedMany(space, 3);
    const res = await api().get(`/api/lifespaces/${space.id}/notifications?limit=999999`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(3);
  });
});

describe("GET /api/lifespaces/:id/notifications/unread-count", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("is zero for a life space with no notifications", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(owner.headers);
    expect(res.body.count).toBe(0);
  });

  it("counts only unread notifications", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id, { read: false });
    createNotification(space.id, { read: false });
    createNotification(space.id, { read: true });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(owner.headers);
    expect(res.body.count).toBe(2);
  });

  it("decreases after marking one read", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id, { read: false });
    await api().patch(`/api/notifications/${n.id}`).set(owner.headers).send({ read: true });
    const res = await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(owner.headers);
    expect(res.body.count).toBe(0);
  });

  it("is scoped per life space", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    createNotification(a.id, { read: false });
    createNotification(b.id, { read: false });
    createNotification(b.id, { read: false });
    const resA = await api().get(`/api/lifespaces/${a.id}/notifications/unread-count`).set(owner.headers);
    const resB = await api().get(`/api/lifespaces/${b.id}/notifications/unread-count`).set(owner.headers);
    expect(resA.body.count).toBe(1);
    expect(resB.body.count).toBe(2);
  });

  it("403s a non-member, 404s an unknown life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();
    expect((await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(stranger.headers)).status).toBe(403);
    expect((await api().get("/api/lifespaces/no-such-id/notifications/unread-count").set(owner.headers)).status).toBe(404);
  });
});

describe("PATCH /api/notifications/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("marks a notification read", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id, { read: false });
    const res = await api().patch(`/api/notifications/${n.id}`).set(owner.headers).send({ read: true });
    expect(res.status).toBe(200);
    expect(res.body.notification.read).toBe(true);
  });

  it("marks a read notification unread again", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id, { read: true });
    const res = await api().patch(`/api/notifications/${n.id}`).set(owner.headers).send({ read: false });
    expect(res.body.notification.read).toBe(false);
  });

  it("rejects a non-boolean read value", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    const res = await api().patch(`/api/notifications/${n.id}`).set(owner.headers).send({ read: "yes" });
    expect(res.status).toBe(400);
  });

  it("404s an unknown notification", async () => {
    const owner = await registerUser();
    const res = await api().patch("/api/notifications/no-such-id").set(owner.headers).send({ read: true });
    expect(res.status).toBe(404);
  });

  it("403s a non-member of the notification's life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    const stranger = await registerUser();
    const res = await api().patch(`/api/notifications/${n.id}`).set(stranger.headers).send({ read: true });
    expect(res.status).toBe(403);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    const res = await api().patch(`/api/notifications/${n.id}`).send({ read: true });
    expect(res.status).toBe(401);
  });

  it("any role, including volunteer, can mark a notification read", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const helper = await registerUser();
    await addTeamMember(owner.token, space.id, helper, "volunteer");
    const n = createNotification(space.id, { read: false });
    const res = await api().patch(`/api/notifications/${n.id}`).set(helper.headers).send({ read: true });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/lifespaces/:id/notifications/mark-all-read", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("marks every unread notification for the life space as read", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id, { read: false });
    createNotification(space.id, { read: false });
    createNotification(space.id, { read: true });
    const res = await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const list = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    expect(list.body.notifications.every((n) => n.read)).toBe(true);
  });

  it("does not touch another life space's notifications", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    createNotification(b.id, { read: false });
    await api().post(`/api/lifespaces/${a.id}/notifications/mark-all-read`).set(owner.headers);
    const res = await api().get(`/api/lifespaces/${b.id}/notifications/unread-count`).set(owner.headers);
    expect(res.body.count).toBe(1);
  });

  it("is idempotent — a second call marks nothing further", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id, { read: false });
    await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
    const second = await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
    expect(second.body.updated).toBe(0);
  });

  it("403s a non-member, 404s an unknown life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();
    expect((await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(stranger.headers)).status).toBe(403);
    expect((await api().post("/api/lifespaces/no-such-id/notifications/mark-all-read").set(owner.headers)).status).toBe(404);
  });
});

describe("DELETE /api/notifications/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("dismisses a notification", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    const res = await api().delete(`/api/notifications/${n.id}`).set(owner.headers);
    expect(res.status).toBe(204);
    const list = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    expect(list.body.notifications.map((x) => x.id)).not.toContain(n.id);
  });

  it("404s deleting an already-dismissed notification", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    await api().delete(`/api/notifications/${n.id}`).set(owner.headers);
    const res = await api().delete(`/api/notifications/${n.id}`).set(owner.headers);
    expect(res.status).toBe(404);
  });

  it("403s a non-member of the notification's life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    const stranger = await registerUser();
    const res = await api().delete(`/api/notifications/${n.id}`).set(stranger.headers);
    expect(res.status).toBe(403);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const n = createNotification(space.id);
    const res = await api().delete(`/api/notifications/${n.id}`);
    expect(res.status).toBe(401);
  });
});

describe("cross-tenant isolation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("a member of space A cannot read, mark, or delete a notification belonging to space B", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "A" });
    const memberA = await registerUser();
    await addTeamMember(ownerA.token, spaceA.id, memberA, "finance_manager");

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });
    const notificationInB = createNotification(spaceB.id);

    expect((await api().get(`/api/lifespaces/${spaceB.id}/notifications`).set(memberA.headers)).status).toBe(403);
    expect(
      (await api().patch(`/api/notifications/${notificationInB.id}`).set(memberA.headers).send({ read: true })).status
    ).toBe(403);
    expect((await api().delete(`/api/notifications/${notificationInB.id}`).set(memberA.headers)).status).toBe(403);

    // Untouched.
    const stillThere = await api().get(`/api/lifespaces/${spaceB.id}/notifications`).set(ownerB.headers);
    expect(stillThere.body.notifications[0].read).toBe(false);
  });
});
