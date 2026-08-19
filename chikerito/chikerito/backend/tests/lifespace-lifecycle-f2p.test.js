const { v4: uuid } = require("uuid");
const db = require("../db");
const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  addTeamMember,
  createCategory,
  createExpense,
  createTask,
} = require("./helpers/factories");

async function archive(user, spaceId) {
  return api().post(`/api/lifespaces/${spaceId}/archive`).set(user.headers);
}

async function restore(user, spaceId) {
  return api().post(`/api/lifespaces/${spaceId}/restore`).set(user.headers);
}

describe("Task 7 F2P: archive and restore lifecycle", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("archives a life space and hides it from the default active list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await archive(owner, space.id);
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace).toMatchObject({ status: "archived", archived_by: owner.user.id });
    expect(Number.isNaN(Date.parse(response.body.lifeSpace.archived_at))).toBe(false);
    expect((await api().get("/api/lifespaces").set(owner.headers)).body.lifeSpaces).toEqual([]);
  });

  it("filters archived and all life spaces with deterministic active-first ordering", async () => {
    const owner = await registerUser();
    const archived = await createLifeSpace(owner.token, { title: "Z Archived" });
    await createLifeSpace(owner.token, { title: "B Active" });
    await createLifeSpace(owner.token, { title: "A Active" });
    await archive(owner, archived.id);
    const archivedOnly = await api().get("/api/lifespaces?status=archived").set(owner.headers);
    const all = await api().get("/api/lifespaces?status=all").set(owner.headers);
    expect(archivedOnly.body.lifeSpaces.map((space) => space.id)).toEqual([archived.id]);
    expect(all.body.lifeSpaces.map((space) => space.title)).toEqual(["A Active", "B Active", "Z Archived"]);
  });

  it("keeps archived spaces readable to existing members", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "volunteer");
    await createTask(owner.token, space.id, { title: "Preserved plan" });
    await archive(owner, space.id);
    expect((await api().get(`/api/lifespaces/${space.id}`).set(member.headers)).status).toBe(200);
    const tasks = await api().get(`/api/lifespaces/${space.id}/tasks`).set(member.headers);
    expect(tasks.status).toBe(200);
    expect(tasks.body.tasks[0].title).toBe("Preserved plan");
  });

  it("makes archived domain data read-only across resource and collection writes", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const expense = await createExpense(owner.token, space.id, { categoryId: category.id });
    const task = await createTask(owner.token, space.id);
    await archive(owner, space.id);
    const responses = await Promise.all([
      api().post(`/api/lifespaces/${space.id}/categories`).set(owner.headers).send({ name: "Blocked" }),
      api().patch(`/api/expenses/${expense.id}`).set(owner.headers).send({ vendor: "Blocked" }),
      api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ completed: true }),
      api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ title: "Blocked" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([409, 409, 409, 409]);
    responses.forEach((response) => expect(response.body).toMatchObject({ archived: true }));
  });

  it("restores an archived space and permits writes again", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await archive(owner, space.id);
    const response = await restore(owner, space.id);
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace).toMatchObject({ status: "active", archived_at: null, archived_by: null, restored_by: owner.user.id });
    expect((await api().post(`/api/lifespaces/${space.id}/tasks`).set(owner.headers).send({ title: "Available again" })).status).toBe(201);
  });

  it("revokes pending invitations when archived", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const invitation = await api().post(`/api/lifespaces/${space.id}/invitations`).set(owner.headers).send({ email: invitee.user.email, role: "editor" });
    await archive(owner, space.id);
    expect(db.table("invitations").find(invitation.body.invitation.id)).toMatchObject({ status: "revoked" });
    expect((await api().post(`/api/invitations/${invitation.body.invitation.id}/accept`).set(invitee.headers)).status).toBe(409);
  });
});

describe("Task 7 F2P: ownership safeguards and controlled deletion", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("allows only the authoritative owner to archive, restore, or inspect deletion impact", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "event_planner");
    expect((await archive(member, space.id)).status).toBe(403);
    await archive(owner, space.id);
    expect((await restore(member, space.id)).status).toBe(403);
    expect((await api().get(`/api/lifespaces/${space.id}/deletion-impact`).set(member.headers)).status).toBe(403);
  });

  it("takes archived public pages offline", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "public" });
    await archive(owner, space.id);
    const response = await api().get(`/api/public/lifespaces/${space.slug}/report`);
    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({ archived: true });
  });

  it("requires a populated life space to be archived before permanent deletion", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id);
    const response = await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers).send({ confirmDelete: true, confirmationTitle: space.title });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/archive/i);
    expect(db.table("life_spaces").find(space.id)).toBeDefined();
  });

  it("requires the exact title before deleting substantive archived data", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createTask(owner.token, space.id);
    await archive(owner, space.id);
    let response = await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers).send({ confirmDelete: true, confirmationTitle: "wrong" });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/exact life space title/i);
    response = await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers).send({ confirmDelete: true, confirmationTitle: space.title });
    expect(response.status).toBe(204);
  });

  it("cascades every supported tenant-owned resource without orphan rows", async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "volunteer");
    await createCategory(owner.token, space.id);
    await createExpense(owner.token, space.id);
    await createTask(owner.token, space.id);
    db.table("contributions").insert({ id: uuid(), life_space_id: space.id, amount: 10 });
    db.table("recurring_expenses").insert({ id: uuid(), life_space_id: space.id, vendor: "Rent" });
    for (const table of ["recurring_expense_exceptions", "budget_scenarios", "budget_scenario_adjustments", "task_dependencies", "notification_user_states", "audit_logs"]) {
      db.table(table).insert({ id: uuid(), life_space_id: space.id });
    }
    await archive(owner, space.id);
    const response = await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers).send({ confirmDelete: true, confirmationTitle: space.title });
    expect(response.status).toBe(204);
    for (const table of ["team_members", "invitations", "budget_categories", "contributions", "expenses", "recurring_expenses", "recurring_expense_exceptions", "budget_scenarios", "budget_scenario_adjustments", "tasks", "task_dependencies", "notifications", "notification_user_states", "audit_logs"]) {
      expect(rawState()[table].filter((row) => row.life_space_id === space.id)).toEqual([]);
    }
  });

  it("never removes records belonging to another tenant during cascade deletion", async () => {
    const owner = await registerUser();
    const first = await createLifeSpace(owner.token, { title: "Delete me" });
    const second = await createLifeSpace(owner.token, { title: "Keep me" });
    await createExpense(owner.token, first.id, { vendor: "First expense" });
    const keeper = await createExpense(owner.token, second.id, { vendor: "Second expense" });
    await archive(owner, first.id);
    await api().delete(`/api/lifespaces/${first.id}`).set(owner.headers).send({ confirmDelete: true, confirmationTitle: first.title });
    expect(db.table("life_spaces").find(second.id)).toBeDefined();
    expect(db.table("expenses").find(keeper.id)).toBeDefined();
  });
});
