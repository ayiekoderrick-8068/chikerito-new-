const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, registerUser, createLifeSpace, addTeamMember, createTask } = require("./helpers/factories");

async function addDependency(user, taskId, dependencyTaskId) {
  return api().post(`/api/tasks/${taskId}/dependencies`).set(user.headers).send({ dependencyTaskId });
}

async function list(user, spaceId) {
  return api().get(`/api/lifespaces/${spaceId}/tasks`).set(user.headers);
}

describe("Task 6 F2P: parent tasks and progress", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a subtask and reports hierarchy plus parent progress", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const parent = await createTask(owner.token, space.id, { title: "Plan ceremony", dueDate: "2099-01-01" });
    const child = await createTask(owner.token, space.id, { title: "Book officiant", parentTaskId: parent.id, dueDate: "2099-01-02" });
    const response = await list(owner, space.id);
    const returnedParent = response.body.tasks.find((task) => task.id === parent.id);
    const returnedChild = response.body.tasks.find((task) => task.id === child.id);
    expect(returnedChild).toMatchObject({ parent_task_id: parent.id, depth: 1 });
    expect(returnedParent.subtask_progress).toEqual({ total: 1, completed: 0, percent: 0 });
  });

  it("moves a task under a parent and can return it to the root", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const parent = await createTask(owner.token, space.id, { title: "Reception" });
    const task = await createTask(owner.token, space.id, { title: "Choose tables" });
    let response = await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ parentTaskId: parent.id });
    expect(response.status).toBe(200);
    expect(response.body.task.parent_task_id).toBe(parent.id);
    response = await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ parentTaskId: null });
    expect(response.body.task.parent_task_id).toBeNull();
  });

  it("rejects a task as its own parent", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const response = await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ parentTaskId: task.id });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/own parent/i);
  });

  it("prevents a parent hierarchy cycle", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const parent = await createTask(owner.token, space.id, { title: "Parent" });
    const child = await createTask(owner.token, space.id, { title: "Child", parentTaskId: parent.id });
    const response = await api().patch(`/api/tasks/${parent.id}`).set(owner.headers).send({ parentTaskId: child.id });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/cycle/i);
  });

  it("prevents completing a parent while any descendant is incomplete", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const parent = await createTask(owner.token, space.id, { title: "Parent" });
    await createTask(owner.token, space.id, { title: "Child", parentTaskId: parent.id });
    const response = await api().patch(`/api/tasks/${parent.id}`).set(owner.headers).send({ completed: true });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/subtasks/i);
    expect(response.body.blockers[0].title).toBe("Child");
  });
});

describe("Task 6 F2P: dependency graph and completion", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("adds a dependency and exposes deterministic blocked details", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const prerequisite = await createTask(owner.token, space.id, { title: "Choose menu", dueDate: "2099-01-01" });
    const dependent = await createTask(owner.token, space.id, { title: "Print menu", dueDate: "2099-01-02" });
    expect((await addDependency(owner, dependent.id, prerequisite.id)).status).toBe(201);
    const response = await list(owner, space.id);
    const task = response.body.tasks.find((item) => item.id === dependent.id);
    expect(task).toMatchObject({ blocked: true, dependency_ids: [prerequisite.id] });
    expect(task.blockers).toEqual([{ id: prerequisite.id, title: "Choose menu", completed: false }]);
  });

  it("rejects self-dependencies", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const response = await addDependency(owner, task.id, task.id);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/itself/i);
  });

  it("rejects a duplicate dependency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const prerequisite = await createTask(owner.token, space.id);
    const dependent = await createTask(owner.token, space.id);
    expect((await addDependency(owner, dependent.id, prerequisite.id)).status).toBe(201);
    const duplicate = await addDependency(owner, dependent.id, prerequisite.id);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already exists/i);
  });

  it("prevents dependency cycles across multiple tasks", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await createTask(owner.token, space.id, { title: "First" });
    const second = await createTask(owner.token, space.id, { title: "Second" });
    const third = await createTask(owner.token, space.id, { title: "Third" });
    await addDependency(owner, second.id, first.id);
    await addDependency(owner, third.id, second.id);
    const response = await addDependency(owner, first.id, third.id);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/cycle/i);
  });

  it("blocks completion until dependencies are complete, then unblocks", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const prerequisite = await createTask(owner.token, space.id, { title: "Deposit" });
    const dependent = await createTask(owner.token, space.id, { title: "Confirmation" });
    await addDependency(owner, dependent.id, prerequisite.id);
    let response = await api().patch(`/api/tasks/${dependent.id}`).set(owner.headers).send({ completed: true });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/dependencies/i);
    await api().patch(`/api/tasks/${prerequisite.id}`).set(owner.headers).send({ completed: true });
    response = await api().patch(`/api/tasks/${dependent.id}`).set(owner.headers).send({ completed: true });
    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({ completed: true, blocked: false });
  });

  it("removes a dependency and immediately unblocks the task", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const prerequisite = await createTask(owner.token, space.id);
    const dependent = await createTask(owner.token, space.id);
    await addDependency(owner, dependent.id, prerequisite.id);
    const removed = await api().delete(`/api/tasks/${dependent.id}/dependencies/${prerequisite.id}`).set(owner.headers);
    expect(removed.status).toBe(204);
    const task = (await list(owner, space.id)).body.tasks.find((item) => item.id === dependent.id);
    expect(task).toMatchObject({ blocked: false, dependency_ids: [], blockers: [] });
  });
});

describe("Task 6 F2P: policy and tenant isolation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("allows an event planner but denies a volunteer dependency writes", async () => {
    const owner = await registerUser();
    const planner = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, planner, "event_planner");
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    const prerequisite = await createTask(owner.token, space.id);
    const dependent = await createTask(owner.token, space.id);
    expect((await addDependency(planner, dependent.id, prerequisite.id)).status).toBe(201);
    expect((await api().delete(`/api/tasks/${dependent.id}/dependencies/${prerequisite.id}`).set(volunteer.headers)).status).toBe(403);
  });

  it("rejects parent and dependency relationships across life spaces", async () => {
    const owner = await registerUser();
    const firstSpace = await createLifeSpace(owner.token, { title: "First" });
    const secondSpace = await createLifeSpace(owner.token, { title: "Second" });
    const first = await createTask(owner.token, firstSpace.id);
    const second = await createTask(owner.token, secondSpace.id);
    expect((await api().patch(`/api/tasks/${first.id}`).set(owner.headers).send({ parentTaskId: second.id })).status).toBe(400);
    expect((await addDependency(owner, first.id, second.id)).status).toBe(400);
  });
});
