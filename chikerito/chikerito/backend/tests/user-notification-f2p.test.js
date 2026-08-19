// Black-box future-to-past checks for Task 3. These tests intentionally use
// only the public HTTP API and frozen-base test factories so the same file can
// run against both evaluation-base-v1 and the task solution.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  addTeamMember,
  createNotification,
} = require("./helpers/factories");

async function sharedInbox() {
  const owner = await registerUser();
  const member = await registerUser();
  const space = await createLifeSpace(owner.token);
  await addTeamMember(owner.token, space.id, member, "volunteer");
  // Clear the invitation-generated notification independently before adding
  // fixtures, making exact unread-count assertions meaningful.
  await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
  await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(member.headers);
  return { owner, member, space };
}

async function list(person, space, query = "") {
  return api().get(`/api/lifespaces/${space.id}/notifications${query}`).set(person.headers);
}

describe("Task 3 F2P: personal notification state", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("keeps a member's notification unread when the owner reads it", async () => {
    const { owner, member, space } = await sharedInbox();
    const notification = createNotification(space.id, { message: "Personal read state" });

    expect((await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true })).status).toBe(200);

    const ownerCopy = (await list(owner, space)).body.notifications.find((item) => item.id === notification.id);
    const memberCopy = (await list(member, space)).body.notifications.find((item) => item.id === notification.id);
    expect(ownerCopy.read).toBe(true);
    expect(memberCopy.read).toBe(false);
  });

  it("maintains a separate unread count for every member", async () => {
    const { owner, member, space } = await sharedInbox();
    const notification = createNotification(space.id);
    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });

    const ownerCount = await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(owner.headers);
    const memberCount = await api().get(`/api/lifespaces/${space.id}/notifications/unread-count`).set(member.headers);
    expect(ownerCount.body.count).toBe(0);
    expect(memberCount.body.count).toBe(1);
  });

  it("marks all read for only the acting member", async () => {
    const { owner, member, space } = await sharedInbox();
    createNotification(space.id, { message: "First personal item" });
    createNotification(space.id, { message: "Second personal item" });

    const response = await api().post(`/api/lifespaces/${space.id}/notifications/mark-all-read`).set(owner.headers);
    expect(response.body.updated).toBe(2);
    expect((await list(owner, space, "?filter=unread")).body.notifications).toHaveLength(0);
    expect((await list(member, space, "?filter=unread")).body.notifications).toHaveLength(2);
  });

  it("dismisses an item without removing it from another member's inbox", async () => {
    const { owner, member, space } = await sharedInbox();
    const notification = createNotification(space.id, { message: "Dismiss privately" });

    expect((await api().delete(`/api/notifications/${notification.id}`).set(owner.headers)).status).toBe(204);
    expect((await list(owner, space)).body.notifications.map((item) => item.id)).not.toContain(notification.id);
    expect((await list(member, space)).body.notifications.map((item) => item.id)).toContain(notification.id);
  });

  it("lets a member independently mark an owner-read item unread", async () => {
    const { owner, member, space } = await sharedInbox();
    const notification = createNotification(space.id);
    await api().patch(`/api/notifications/${notification.id}`).set(owner.headers).send({ read: true });
    const response = await api().patch(`/api/notifications/${notification.id}`).set(member.headers).send({ read: false });

    expect(response.status).toBe(200);
    expect(response.body.notification.read).toBe(false);
    expect((await list(owner, space)).body.notifications.find((item) => item.id === notification.id).read).toBe(true);
  });
});

describe("Task 3 F2P: deterministic inbox discovery", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("uses the id as a deterministic tie-breaker for equal timestamps", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const timestamp = "2026-07-10T09:00:00.000Z";
    createNotification(space.id, { id: "notification-a", created_at: timestamp, message: "A" });
    createNotification(space.id, { id: "notification-c", created_at: timestamp, message: "C" });
    createNotification(space.id, { id: "notification-b", created_at: timestamp, message: "B" });

    const response = await list(owner, space);
    expect(response.body.notifications.map((item) => item.id)).toEqual([
      "notification-c",
      "notification-b",
      "notification-a",
    ]);
  });

  it("paginates timestamp collisions without duplicates or omissions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const timestamp = "2026-07-10T09:00:00.000Z";
    ["a", "b", "c", "d", "e"].forEach((suffix) => createNotification(space.id, {
      id: `same-time-${suffix}`,
      created_at: timestamp,
      message: suffix,
    }));

    const first = await list(owner, space, "?limit=2");
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await list(owner, space, `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    const third = await list(owner, space, `?limit=2&cursor=${encodeURIComponent(second.body.nextCursor)}`);
    const ids = [...first.body.notifications, ...second.body.notifications, ...third.body.notifications].map((item) => item.id);
    expect(ids).toEqual(["same-time-e", "same-time-d", "same-time-c", "same-time-b", "same-time-a"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("filters the current user's inbox to read items", async () => {
    const { owner, member, space } = await sharedInbox();
    const readForOwner = createNotification(space.id, { message: "Owner read" });
    const unreadForBoth = createNotification(space.id, { message: "Unread item" });
    await api().patch(`/api/notifications/${readForOwner.id}`).set(owner.headers).send({ read: true });

    const ownerRead = await list(owner, space, "?filter=read");
    const memberRead = await list(member, space, "?filter=read");
    expect(ownerRead.body.notifications.map((item) => item.id)).toContain(readForOwner.id);
    expect(ownerRead.body.notifications.map((item) => item.id)).not.toContain(unreadForBoth.id);
    expect(memberRead.body.notifications.map((item) => item.id)).not.toContain(readForOwner.id);
  });

  it("searches messages case-insensitively within the requested life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    createNotification(space.id, { message: "Venue deposit is due" });
    createNotification(space.id, { message: "Florist confirmed" });

    const response = await list(owner, space, "?q=VENUE");
    expect(response.body.notifications).toHaveLength(1);
    expect(response.body.notifications[0].message).toBe("Venue deposit is due");
  });

  it("filters notification types without changing their read state", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const warning = createNotification(space.id, { type: "budget_warning", message: "Budget warning" });
    createNotification(space.id, { type: "donation", message: "Donation received" });

    const response = await list(owner, space, "?type=budget_warning");
    expect(response.body.notifications.map((item) => item.id)).toEqual([warning.id]);
    expect(response.body.notifications[0].read).toBe(false);
  });

  it("restores a personally dismissed item without affecting another member", async () => {
    const { owner, member, space } = await sharedInbox();
    const notification = createNotification(space.id, { message: "Restorable" });
    await api().delete(`/api/notifications/${notification.id}`).set(owner.headers);

    const restored = await api().post(`/api/notifications/${notification.id}/restore`).set(owner.headers);
    expect(restored.status).toBe(200);
    expect(restored.body.notification.dismissed).toBe(false);
    expect((await list(owner, space)).body.notifications.map((item) => item.id)).toContain(notification.id);
    expect((await list(member, space)).body.notifications.map((item) => item.id)).toContain(notification.id);
  });
});
