const db = require("../db");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createTask,
  createRecurringExpense,
  addTeamMember,
} = require("./helpers/factories");

async function list(owner, lifeSpaceId, query = "") {
  return api().get(`/api/lifespaces/${lifeSpaceId}/audit-logs${query}`).set(owner.headers);
}

async function waitForAudit() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("Task 8 F2P — important mutation capture", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("records life-space creation with a safe actor snapshot", async () => {
    const owner = await registerUser({ firstName: "Ada", lastName: "Owner" });
    const space = await createLifeSpace(owner.token, { title: "Launch Party", visibility: "private" });
    await waitForAudit();

    const response = await list(owner, space.id);
    expect(response.status).toBe(200);
    expect(response.body.auditLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        life_space_id: space.id,
        actor_id: owner.user.id,
        actor_name: "Ada Owner",
        action: "life_space.created",
        resource_type: "life_space",
        resource_id: space.id,
      }),
    ]));
  });

  it("captures creates and updates across finance and planning domains", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const category = await createCategory(owner.token, space.id, { name: "Venue" });
    const expense = await createExpense(owner.token, space.id, { vendor: "Grand Hall" });
    const task = await createTask(owner.token, space.id, { title: "Sign contract" });
    await api().patch(`/api/categories/${category.id}`).set(owner.headers).send({ budgetAmount: 3500 });
    await api().patch(`/api/expenses/${expense.id}`).set(owner.headers).send({ status: "pending" });
    await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ completed: true });
    await waitForAudit();

    const response = await list(owner, space.id, "?limit=100");
    expect(response.status).toBe(200);
    const actions = response.body.auditLogs.map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining([
      "category.created",
      "category.updated",
      "expense.created",
      "expense.updated",
      "task.created",
      "task.updated",
    ]));
  });

  it("records destructive actions using the resource snapshot captured before deletion", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const task = await createTask(owner.token, space.id, { title: "Temporary checklist" });
    expect((await api().delete(`/api/tasks/${task.id}`).set(owner.headers)).status).toBe(204);
    await waitForAudit();

    const response = await list(owner, space.id, "?action=task.deleted");
    expect(response.status).toBe(200);
    expect(response.body.auditLogs).toHaveLength(1);
    expect(response.body.auditLogs[0]).toMatchObject({
      resource_id: task.id,
      metadata: { label: "Temporary checklist", request_method: "DELETE" },
    });
  });

  it("records recurring-expense pause, resume, and stop transitions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const recurring = await createRecurringExpense(owner.token, space.id, {
      vendor: "Monthly Hosting",
      startDate: "2099-01-01",
    });
    await api().post(`/api/recurring-expenses/${recurring.id}/pause`).set(owner.headers);
    await api().post(`/api/recurring-expenses/${recurring.id}/resume`).set(owner.headers);
    await api().delete(`/api/recurring-expenses/${recurring.id}`).set(owner.headers);
    await waitForAudit();

    const response = await list(owner, space.id, "?resourceType=recurring_expense&limit=20");
    expect(response.status).toBe(200);
    expect(response.body.auditLogs.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "recurring_expense.created",
      "recurring_expense.paused",
      "recurring_expense.resumed",
      "recurring_expense.deleted",
    ]));
  });

  it("attributes accepted invitations to the invitee without exposing credentials", async () => {
    const owner = await registerUser();
    const invitee = await registerUser({ firstName: "Nia", lastName: "Planner" });
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const invitation = await api()
      .post(`/api/lifespaces/${space.id}/invitations`)
      .set(owner.headers)
      .send({ email: invitee.user.email, role: "event_planner" });
    await api().post(`/api/invitations/${invitation.body.invitation.id}/accept`).set(invitee.headers);
    await waitForAudit();

    const response = await list(owner, space.id, "?action=invitation.accepted");
    expect(response.status).toBe(200);
    expect(response.body.auditLogs).toHaveLength(1);
    expect(response.body.auditLogs[0]).toMatchObject({
      actor_id: invitee.user.id,
      actor_name: "Nia Planner",
      resource_id: invitation.body.invitation.id,
    });
    expect(JSON.stringify(response.body.auditLogs[0])).not.toMatch(/password|token|credential/i);
  });
});

describe("Task 8 F2P — querying, security, and sanitization", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("supports deterministic cursor pagination without duplicates when timestamps collide", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const sameTime = "2026-06-01T12:00:00.000Z";
    for (const id of ["audit-a", "audit-c", "audit-b"]) {
      db.table("audit_logs").insert({
        id,
        life_space_id: space.id,
        actor_id: owner.user.id,
        actor_name: "Test User",
        action: "task.updated",
        resource_type: "task",
        resource_id: id,
        metadata: {},
        occurred_at: sameTime,
      });
    }

    const first = await list(owner, space.id, "?action=task.updated&limit=2");
    expect(first.status).toBe(200);
    expect(first.body.auditLogs.map((entry) => entry.id)).toEqual(["audit-c", "audit-b"]);
    expect(first.body.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(first.body.page.nextCursor).toEqual(expect.any(String));

    const second = await list(owner, space.id, `?action=task.updated&limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`);
    expect(second.status).toBe(200);
    expect(second.body.auditLogs.map((entry) => entry.id)).toEqual(["audit-a"]);
    expect(second.body.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("combines action, resource, actor, and date filters", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const base = {
      life_space_id: space.id,
      actor_name: "Actor",
      resource_id: "resource",
      metadata: {},
    };
    db.table("audit_logs").insert({ ...base, id: "match", actor_id: owner.user.id, action: "expense.updated", resource_type: "expense", occurred_at: "2026-03-02T10:00:00.000Z" });
    db.table("audit_logs").insert({ ...base, id: "wrong-actor", actor_id: other.user.id, action: "expense.updated", resource_type: "expense", occurred_at: "2026-03-02T10:00:00.000Z" });
    db.table("audit_logs").insert({ ...base, id: "wrong-day", actor_id: owner.user.id, action: "expense.updated", resource_type: "expense", occurred_at: "2026-04-02T10:00:00.000Z" });
    db.table("audit_logs").insert({ ...base, id: "wrong-type", actor_id: owner.user.id, action: "task.updated", resource_type: "task", occurred_at: "2026-03-02T10:00:00.000Z" });

    const response = await list(owner, space.id, `?action=expense.updated&resourceType=expense&actorId=${owner.user.id}&from=2026-03-01&to=2026-03-03`);
    expect(response.status).toBe(200);
    expect(response.body.auditLogs.map((entry) => entry.id)).toEqual(["match"]);
  });

  it("restricts viewing to owners and finance managers", async () => {
    const owner = await registerUser();
    const finance = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await addTeamMember(owner.token, space.id, finance, "finance_manager");
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");

    expect((await list(owner, space.id)).status).toBe(200);
    expect((await list(finance, space.id)).status).toBe(200);
    expect((await list(volunteer, space.id)).status).toBe(403);
    expect((await api().get(`/api/lifespaces/${space.id}/audit-logs`)).status).toBe(401);
  });

  it("enforces cross-tenant isolation for log pages and filter options", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const otherSpace = await createLifeSpace(stranger.token, { visibility: "private" });
    await createExpense(owner.token, space.id, { vendor: "Private Vendor" });
    await createExpense(stranger.token, otherSpace.id, { vendor: "Other Vendor" });
    await waitForAudit();

    expect((await list(stranger, space.id)).status).toBe(403);
    expect((await api().get(`/api/lifespaces/${space.id}/audit-logs/filter-options`).set(stranger.headers)).status).toBe(403);
    const own = await list(owner, space.id, "?limit=100");
    expect(own.body.auditLogs.every((entry) => entry.life_space_id === space.id)).toBe(true);
    expect(JSON.stringify(own.body)).not.toContain("Other Vendor");
  });

  it("never stores passcodes, password-shaped fields, tokens, hashes, or secret keys", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({
      title: "Safe title",
      passcode: "super-secret-passcode",
      password: "must-not-appear",
      resetToken: "raw-reset-token",
      secretKey: "key-material",
      nested: { authorization: "Bearer raw-session", harmless: "ignored input" },
    });
    await waitForAudit();

    const response = await list(owner, space.id, "?action=life_space.updated&limit=10");
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body.auditLogs);
    expect(serialized).toContain("title");
    expect(serialized).not.toContain("super-secret-passcode");
    expect(serialized).not.toContain("must-not-appear");
    expect(serialized).not.toContain("raw-reset-token");
    expect(serialized).not.toContain("key-material");
    expect(serialized).not.toContain("Bearer raw-session");
    expect(response.body.auditLogs[0].metadata.changed_fields).toEqual(["nested", "title"]);
  });

  it("does not create records for rejected or malformed mutations", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const before = await list(owner, space.id, "?limit=100");
    const rejected = await api().post(`/api/lifespaces/${space.id}/expenses`).set(owner.headers).send({ vendor: "Missing amount" });
    expect(rejected.status).toBe(400);
    await waitForAudit();

    const after = await list(owner, space.id, "?limit=100");
    expect(after.status).toBe(200);
    expect(after.body.auditLogs.map((entry) => entry.id)).toEqual(before.body.auditLogs.map((entry) => entry.id));
  });

  it("returns deterministic, sorted filter options without leaking another tenant", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await createTask(owner.token, space.id, { title: "One" });
    await createExpense(owner.token, space.id, { vendor: "Two" });
    await waitForAudit();

    const response = await api().get(`/api/lifespaces/${space.id}/audit-logs/filter-options`).set(owner.headers);
    expect(response.status).toBe(200);
    expect(response.body.actions).toEqual([...response.body.actions].sort());
    expect(response.body.resourceTypes).toEqual([...response.body.resourceTypes].sort());
    expect(response.body.actions).toEqual(expect.arrayContaining(["expense.created", "life_space.created", "task.created"]));
    expect(response.body.actors).toEqual([{ id: owner.user.id, name: "Test User" }]);
  });
});
