// tasks-v2.test.js — covers priority field, edit behaviour, RBAC enforcement,
// and cross-tenant isolation added in Task Management v2.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createTask,
  addTeamMember,
} = require("./helpers/factories");

// ---------------------------------------------------------------------------
// Priority — POST
// ---------------------------------------------------------------------------
describe("POST /api/lifespaces/:id/tasks — priority", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("defaults priority to medium when not supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { title: "No priority" });
    expect(task.priority).toBe("medium");
  });

  it("accepts priority=low", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ title: "Low task", priority: "low" });
    expect(res.status).toBe(201);
    expect(res.body.task.priority).toBe("low");
  });

  it("accepts priority=medium", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ title: "Med task", priority: "medium" });
    expect(res.status).toBe(201);
    expect(res.body.task.priority).toBe("medium");
  });

  it("accepts priority=high", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ title: "High task", priority: "high" });
    expect(res.status).toBe(201);
    expect(res.body.task.priority).toBe("high");
  });

  it("rejects an invalid priority value", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ title: "Bad priority", priority: "critical" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/priority/i);
  });

  it("rejects an empty-string priority", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ title: "Empty priority", priority: "" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Priority — PATCH
// ---------------------------------------------------------------------------
describe("PATCH /api/tasks/:id — priority", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("updates priority from medium to high", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ priority: "high" });
    expect(res.status).toBe(200);
    expect(res.body.task.priority).toBe("high");
  });

  it("updates priority from high to low", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { priority: "high" });
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ priority: "low" });
    expect(res.body.task.priority).toBe("low");
  });

  it("rejects an invalid priority on PATCH", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ priority: "urgent" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/priority/i);
  });

  it("leaves priority unchanged when not included in the patch", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { priority: "high" });
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ title: "Renamed" });
    expect(res.body.task.priority).toBe("high");
    expect(res.body.task.title).toBe("Renamed");
  });
});

// ---------------------------------------------------------------------------
// Edit — full field coverage
// ---------------------------------------------------------------------------
describe("PATCH /api/tasks/:id — edit fields", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("updates title, category, dueDate, notes, and priority in one call", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { title: "Old", category: "General" });
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ title: "New", category: "Music", dueDate: "2026-10-01", notes: "Updated notes", priority: "high" });
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({
      title: "New",
      category: "Music",
      due_date: "2026-10-01",
      notes: "Updated notes",
      priority: "high",
    });
  });

  it("clears due date when set to null", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { dueDate: "2026-06-01" });
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ dueDate: null });
    expect(res.body.task.due_date).toBeNull();
  });

  it("persists the edit — a subsequent GET reflects the new values", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { title: "Before" });
    await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ title: "After", priority: "low" });
    const list = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    const found = list.body.tasks.find((t) => t.id === task.id);
    expect(found.title).toBe("After");
    expect(found.priority).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// RBAC — task:manage capability
// ---------------------------------------------------------------------------
describe("task:manage RBAC", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("event_planner can create, edit, and delete tasks", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const planner = await registerUser();
    await addTeamMember(owner.token, space.id, planner, "event_planner");

    const createRes = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(planner.headers)
      .send({ title: "Planner task", priority: "high" });
    expect(createRes.status).toBe(201);

    const taskId = createRes.body.task.id;
    const editRes = await api()
      .patch(`/api/tasks/${taskId}`)
      .set(planner.headers)
      .send({ title: "Edited by planner" });
    expect(editRes.status).toBe(200);

    const deleteRes = await api().delete(`/api/tasks/${taskId}`).set(planner.headers);
    expect(deleteRes.status).toBe(204);
  });

  it("finance_manager cannot create, edit, or delete tasks", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const fm = await registerUser();
    await addTeamMember(owner.token, space.id, fm, "finance_manager");
    const task = await createTask(owner.token, space.id);

    expect((await api().post(`/api/lifespaces/${space.id}/tasks`).set(fm.headers).send({ title: "X" })).status).toBe(403);
    expect((await api().patch(`/api/tasks/${task.id}`).set(fm.headers).send({ title: "X" })).status).toBe(403);
    expect((await api().delete(`/api/tasks/${task.id}`).set(fm.headers)).status).toBe(403);
  });

  it("volunteer cannot create, edit, or delete tasks", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const vol = await registerUser();
    await addTeamMember(owner.token, space.id, vol, "volunteer");
    const task = await createTask(owner.token, space.id);

    expect((await api().post(`/api/lifespaces/${space.id}/tasks`).set(vol.headers).send({ title: "X" })).status).toBe(403);
    expect((await api().patch(`/api/tasks/${task.id}`).set(vol.headers).send({ completed: true })).status).toBe(403);
    expect((await api().delete(`/api/tasks/${task.id}`).set(vol.headers)).status).toBe(403);
  });

  it("any member can read tasks regardless of role", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createTask(owner.token, space.id);
    const vol = await registerUser();
    await addTeamMember(owner.token, space.id, vol, "volunteer");

    const res = await api().get(`/api/lifespaces/${space.id}/tasks`).set(vol.headers);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    expect((await api().patch(`/api/tasks/${task.id}`).send({ title: "X" })).status).toBe(401);
    expect((await api().delete(`/api/tasks/${task.id}`)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------
describe("cross-tenant isolation — tasks", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("a member of space A cannot edit a task belonging to space B", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "A" });
    const plannerA = await registerUser();
    await addTeamMember(ownerA.token, spaceA.id, plannerA, "event_planner");

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });
    const taskInB = await createTask(ownerB.token, spaceB.id, { title: "B task" });

    const res = await api()
      .patch(`/api/tasks/${taskInB.id}`)
      .set(plannerA.headers)
      .send({ title: "Hijacked" });
    expect(res.status).toBe(403);

    // Task in B is untouched.
    const list = await api().get(`/api/lifespaces/${spaceB.id}/tasks`).set(ownerB.headers);
    expect(list.body.tasks[0].title).toBe("B task");
  });

  it("a member of space A cannot delete a task belonging to space B", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "A" });
    const plannerA = await registerUser();
    await addTeamMember(ownerA.token, spaceA.id, plannerA, "event_planner");

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });
    const taskInB = await createTask(ownerB.token, spaceB.id);

    const res = await api().delete(`/api/tasks/${taskInB.id}`).set(plannerA.headers);
    expect(res.status).toBe(403);

    const list = await api().get(`/api/lifespaces/${spaceB.id}/tasks`).set(ownerB.headers);
    expect(list.body.tasks).toHaveLength(1);
  });

  it("GET tasks for space A never returns tasks from space B", async () => {
    const owner = await registerUser();
    const spaceA = await createLifeSpace(owner.token, { title: "A" });
    const spaceB = await createLifeSpace(owner.token, { title: "B" });
    await createTask(owner.token, spaceA.id, { title: "In A" });
    await createTask(owner.token, spaceB.id, { title: "In B" });

    const res = await api().get(`/api/lifespaces/${spaceA.id}/tasks`).set(owner.headers);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe("In A");
  });
});
