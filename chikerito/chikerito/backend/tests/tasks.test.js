// tasks.js has no equivalent in the old snapshot this suite's siblings were
// adapted from — routes/tasks.js and the Planning page were both added since
// then. This file is new baseline coverage, not an adaptation.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createTask,
} = require("./helpers/factories");

describe("POST /api/lifespaces/:id/tasks", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a task", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ title: "Book venue", category: "Venue", dueDate: "2026-06-20", notes: "Ask for a discount" });
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      life_space_id: space.id,
      title: "Book venue",
      category: "Venue",
      due_date: "2026-06-20",
      notes: "Ask for a discount",
      completed: false,
    });
  });

  it("defaults category to General, due date to null, notes to empty", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { title: "Bare task" });
    expect(task.category).toBe("General");
    expect(task.due_date).toBeNull();
    expect(task.notes).toBe("");
  });

  it("starts a task incomplete", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    expect(task.completed).toBe(false);
  });

  it("stamps created_at as an ISO timestamp", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    expect(Number.isNaN(Date.parse(task.created_at))).toBe(false);
  });

  it("requires a title", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .set(owner.headers)
      .send({ category: "Venue" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/tasks`)
      .send({ title: "X" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/lifespaces/:id/tasks", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns an empty list before any task exists", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  it("returns only the tasks of the requested life space", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    await createTask(owner.token, a.id, { title: "In A" });
    await createTask(owner.token, b.id, { title: "In B" });
    const res = await api().get(`/api/lifespaces/${a.id}/tasks`).set(owner.headers);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe("In A");
  });

  it("sorts by due date, earliest first", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createTask(owner.token, space.id, { title: "Later", dueDate: "2026-08-01" });
    await createTask(owner.token, space.id, { title: "Sooner", dueDate: "2026-05-01" });
    const res = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    expect(res.body.tasks.map((t) => t.title)).toEqual(["Sooner", "Later"]);
  });

  it("sorts undated tasks after every dated task", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createTask(owner.token, space.id, { title: "No date" });
    await createTask(owner.token, space.id, { title: "Dated", dueDate: "2026-12-31" });
    const res = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    expect(res.body.tasks.map((t) => t.title)).toEqual(["Dated", "No date"]);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/tasks`);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/tasks/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("toggles completed", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.task.completed).toBe(true);
  });

  it("maps dueDate onto due_date", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ dueDate: "2026-09-09" });
    expect(res.body.task.due_date).toBe("2026-09-09");
  });

  it("updates title, category, and notes", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { title: "Old" });
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ title: "New", category: "Music", notes: "Updated" });
    expect(res.body.task).toMatchObject({ title: "New", category: "Music", notes: "Updated" });
  });

  it("leaves unmentioned fields untouched", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id, { title: "Keep", category: "Venue" });
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(owner.headers)
      .send({ completed: true });
    expect(res.body.task.title).toBe("Keep");
    expect(res.body.task.category).toBe("Venue");
  });

  it("404s for an unknown task", async () => {
    const owner = await registerUser();
    const res = await api()
      .patch("/api/tasks/no-such-id")
      .set(owner.headers)
      .send({ completed: true });
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api().patch(`/api/tasks/${task.id}`).send({ completed: true });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/tasks/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("deletes the task and returns 204", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api().delete(`/api/tasks/${task.id}`).set(owner.headers);
    expect(res.status).toBe(204);
    const list = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    expect(list.body.tasks).toEqual([]);
  });

  it("leaves sibling tasks alone", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const doomed = await createTask(owner.token, space.id, { title: "Doomed" });
    const keeper = await createTask(owner.token, space.id, { title: "Keeper" });
    await api().delete(`/api/tasks/${doomed.id}`).set(owner.headers);
    const list = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    expect(list.body.tasks.map((t) => t.id)).toEqual([keeper.id]);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const res = await api().delete(`/api/tasks/${task.id}`);
    expect(res.status).toBe(401);
  });
});
