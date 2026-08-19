const { v4: uuid } = require("uuid");
const db = require("../db");
const {
  compareTasks,
  descendantsOf,
  dependencyPathExists,
  validateParent,
  validateDependency,
  validateDependencySet,
  completionBlockers,
  decorateTasks,
  cleanupTaskRelationships,
} = require("../taskGraph");
const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const { api, registerUser, createLifeSpace, addTeamMember, createTask } = require("./helpers/factories");

function rawTask(spaceId, overrides = {}) {
  return db.table("tasks").insert({
    id: uuid(),
    life_space_id: spaceId,
    title: "Task",
    category: "General",
    due_date: null,
    priority: "medium",
    completed: false,
    notes: "",
    parent_task_id: null,
    created_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  });
}

function rawDependency(spaceId, taskId, dependencyTaskId, overrides = {}) {
  return db.table("task_dependencies").insert({
    id: uuid(), life_space_id: spaceId, task_id: taskId, dependency_task_id: dependencyTaskId,
    created_at: "2099-01-01T00:00:00.000Z", ...overrides,
  });
}

describe("task graph deterministic helpers", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("sorts by due date, then creation timestamp, then stable id", () => {
    const tasks = [
      { id: "c", due_date: null, created_at: "2099-01-01T00:00:00Z" },
      { id: "b", due_date: "2099-02-01", created_at: "2099-01-02T00:00:00Z" },
      { id: "a", due_date: "2099-02-01", created_at: "2099-01-02T00:00:00Z" },
      { id: "d", due_date: "2099-01-01", created_at: "2099-01-03T00:00:00Z" },
    ];
    expect(tasks.sort(compareTasks).map((task) => task.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("finds every nested descendant exactly once in breadth-first order", () => {
    const tasks = [
      { id: "root", parent_task_id: null, due_date: null, created_at: "1" },
      { id: "child-b", parent_task_id: "root", due_date: "2099-02-01", created_at: "2" },
      { id: "child-a", parent_task_id: "root", due_date: "2099-01-01", created_at: "3" },
      { id: "grandchild", parent_task_id: "child-a", due_date: null, created_at: "4" },
    ];
    expect(descendantsOf("root", tasks).map((task) => task.id)).toEqual(["child-a", "child-b", "grandchild"]);
  });

  it("does not loop forever when legacy parent data contains a cycle", () => {
    const tasks = [
      { id: "a", parent_task_id: "b", due_date: null, created_at: "1" },
      { id: "b", parent_task_id: "a", due_date: null, created_at: "2" },
    ];
    expect(descendantsOf("a", tasks).map((task) => task.id)).toEqual(["b", "a"]);
  });

  it("detects a transitive dependency path and rejects unrelated targets", () => {
    const rows = [
      { task_id: "c", dependency_task_id: "b" },
      { task_id: "b", dependency_task_id: "a" },
    ];
    expect(dependencyPathExists("c", "a", rows)).toBe(true);
    expect(dependencyPathExists("a", "c", rows)).toBe(false);
  });

  it("handles cycles in legacy dependency rows deterministically", () => {
    const rows = [
      { task_id: "a", dependency_task_id: "b" },
      { task_id: "b", dependency_task_id: "a" },
    ];
    expect(dependencyPathExists("a", "missing", rows)).toBe(false);
  });
});

describe("parent and dependency validation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("normalizes blank and null parents to root tasks", () => {
    const task = rawTask("space");
    expect(validateParent(task, "")).toEqual({ value: null });
    expect(validateParent(task, null)).toEqual({ value: null });
  });

  it("accepts a parent in the same life space", () => {
    const parent = rawTask("space", { title: "Parent" });
    const child = rawTask("space", { title: "Child" });
    expect(validateParent(child, parent.id)).toEqual({ value: parent.id });
  });

  it("uses the same safe response for unknown and cross-tenant parents", () => {
    const task = rawTask("space-a");
    const outsider = rawTask("space-b");
    expect(validateParent(task, "missing").error).toMatch(/belong to this life space/i);
    expect(validateParent(task, outsider.id).error).toMatch(/belong to this life space/i);
  });

  it("rejects making a task the child of its grandchild", () => {
    const root = rawTask("space");
    const child = rawTask("space", { parent_task_id: root.id });
    const grandchild = rawTask("space", { parent_task_id: child.id });
    expect(validateParent(root, grandchild.id).error).toMatch(/cycle/i);
  });

  it("requires a dependency task id", () => {
    const task = rawTask("space");
    expect(validateDependency(task, null).error).toMatch(/required/i);
  });

  it("accepts an unrelated same-space dependency", () => {
    const task = rawTask("space");
    const prerequisite = rawTask("space");
    expect(validateDependency(task, prerequisite.id).dependency.id).toBe(prerequisite.id);
  });

  it("returns conflict status for an existing edge", () => {
    const task = rawTask("space");
    const prerequisite = rawTask("space");
    rawDependency("space", task.id, prerequisite.id);
    expect(validateDependency(task, prerequisite.id)).toMatchObject({ status: 409, error: expect.stringMatching(/already exists/i) });
  });

  it("rejects a transitive dependency cycle", () => {
    const first = rawTask("space");
    const second = rawTask("space");
    const third = rawTask("space");
    rawDependency("space", second.id, first.id);
    rawDependency("space", third.id, second.id);
    expect(validateDependency(first, third.id).error).toMatch(/cycle/i);
  });

  it("validates an atomic dependency set in stable id order", () => {
    const task = rawTask("space");
    const second = rawTask("space", { id: "second" });
    const first = rawTask("space", { id: "first" });
    expect(validateDependencySet(task, [second.id, first.id]).dependencies.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("rejects malformed and duplicate atomic dependency sets", () => {
    const task = rawTask("space");
    const prerequisite = rawTask("space");
    expect(validateDependencySet(task, "not-an-array").error).toMatch(/array/i);
    expect(validateDependencySet(task, [prerequisite.id, prerequisite.id]).error).toMatch(/duplicate/i);
  });
});

describe("decorated task summaries and cleanup", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("reports recursive subtask progress and hierarchy depths", () => {
    const root = rawTask("space", { title: "Root" });
    const child = rawTask("space", { title: "Child", parent_task_id: root.id, completed: true });
    const grandchild = rawTask("space", { title: "Grandchild", parent_task_id: child.id });
    const decorated = decorateTasks("space");
    expect(decorated.find((task) => task.id === root.id).subtask_progress).toEqual({ total: 2, completed: 1, percent: 50 });
    expect(decorated.find((task) => task.id === grandchild.id).depth).toBe(2);
  });

  it("orders dependency summaries by task due date", () => {
    const dependent = rawTask("space", { title: "Dependent" });
    const later = rawTask("space", { title: "Later", due_date: "2099-02-01" });
    const sooner = rawTask("space", { title: "Sooner", due_date: "2099-01-01" });
    rawDependency("space", dependent.id, later.id);
    rawDependency("space", dependent.id, sooner.id);
    expect(decorateTasks("space").find((task) => task.id === dependent.id).dependencies.map((task) => task.title)).toEqual(["Sooner", "Later"]);
  });

  it("marks only incomplete non-completed dependents as blocked", () => {
    const prerequisite = rawTask("space", { completed: false });
    const open = rawTask("space", { completed: false });
    const done = rawTask("space", { completed: true });
    rawDependency("space", open.id, prerequisite.id);
    rawDependency("space", done.id, prerequisite.id);
    const decorated = decorateTasks("space");
    expect(decorated.find((task) => task.id === open.id).blocked).toBe(true);
    expect(decorated.find((task) => task.id === done.id).blocked).toBe(false);
    expect(decorated.find((task) => task.id === prerequisite.id)).toMatchObject({
      unlocks_count: 1,
      dependents: expect.arrayContaining([expect.objectContaining({ id: open.id })]),
    });
  });

  it("finds incomplete dependency and descendant completion blockers", () => {
    const parent = rawTask("space");
    const child = rawTask("space", { parent_task_id: parent.id });
    const prerequisite = rawTask("space");
    rawDependency("space", parent.id, prerequisite.id);
    const blockers = completionBlockers(parent);
    expect(blockers.incompleteDependencies.map((task) => task.id)).toEqual([prerequisite.id]);
    expect(blockers.incompleteSubtasks.map((task) => task.id)).toEqual([child.id]);
  });

  it("cleanup removes incoming/outgoing edges and promotes direct children", () => {
    const doomed = rawTask("space");
    const child = rawTask("space", { parent_task_id: doomed.id });
    const incoming = rawTask("space");
    const outgoing = rawTask("space");
    rawDependency("space", incoming.id, doomed.id);
    rawDependency("space", doomed.id, outgoing.id);
    cleanupTaskRelationships(doomed);
    expect(rawState().task_dependencies).toEqual([]);
    expect(db.table("tasks").find(child.id).parent_task_id).toBeNull();
  });

  it("cleanup leaves relationships from other tasks and tenants intact", () => {
    const doomed = rawTask("space-a");
    const first = rawTask("space-b");
    const second = rawTask("space-b");
    const keeper = rawDependency("space-b", first.id, second.id);
    cleanupTaskRelationships(doomed);
    expect(rawState().task_dependencies).toEqual([keeper]);
  });
});

describe("task graph API edge policy", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("rejects non-boolean completion without changing persisted state", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const response = await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ completed: "yes" });
    expect(response.status).toBe(400);
    expect(db.table("tasks").find(task.id).completed).toBe(false);
  });

  it("rejects a whitespace-only title on create and edit", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    expect((await api().post(`/api/lifespaces/${space.id}/tasks`).set(owner.headers).send({ title: "   " })).status).toBe(400);
    const task = await createTask(owner.token, space.id);
    expect((await api().patch(`/api/tasks/${task.id}`).set(owner.headers).send({ title: "   " })).status).toBe(400);
  });

  it("returns 404 when removing a dependency that does not exist", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const task = await createTask(owner.token, space.id);
    const response = await api().delete(`/api/tasks/${task.id}/dependencies/missing`).set(owner.headers);
    expect(response.status).toBe(404);
  });

  it("atomically replaces a task's dependency set", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await createTask(owner.token, space.id, { title: "First" });
    const second = await createTask(owner.token, space.id, { title: "Second" });
    const dependent = await createTask(owner.token, space.id, { title: "Dependent" });
    await api().post(`/api/tasks/${dependent.id}/dependencies`).set(owner.headers).send({ dependencyTaskId: first.id });
    const response = await api().put(`/api/tasks/${dependent.id}/dependencies`).set(owner.headers).send({ dependencyTaskIds: [second.id] });
    expect(response.status).toBe(200);
    expect(response.body.task.dependency_ids).toEqual([second.id]);
    expect(rawState().task_dependencies).toHaveLength(1);
  });

  it("rejects an invalid atomic replacement without losing existing edges", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const prerequisite = await createTask(owner.token, space.id);
    const dependent = await createTask(owner.token, space.id);
    await api().post(`/api/tasks/${dependent.id}/dependencies`).set(owner.headers).send({ dependencyTaskId: prerequisite.id });
    const response = await api().put(`/api/tasks/${dependent.id}/dependencies`).set(owner.headers).send({ dependencyTaskIds: ["missing"] });
    expect(response.status).toBe(400);
    expect(rawState().task_dependencies[0].dependency_task_id).toBe(prerequisite.id);
  });

  it("requires authentication before dependency resource lookup", async () => {
    const response = await api().post("/api/tasks/missing/dependencies").send({ dependencyTaskId: "anything" });
    expect(response.status).toBe(401);
  });

  it("lets a volunteer read enriched graph data", async () => {
    const owner = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    const prerequisite = await createTask(owner.token, space.id, { title: "First" });
    const dependent = await createTask(owner.token, space.id, { title: "Second" });
    await api().post(`/api/tasks/${dependent.id}/dependencies`).set(owner.headers).send({ dependencyTaskId: prerequisite.id });
    const response = await api().get(`/api/lifespaces/${space.id}/tasks`).set(volunteer.headers);
    expect(response.status).toBe(200);
    expect(response.body.tasks.find((task) => task.id === dependent.id).blocked).toBe(true);
  });

  it("deleting a task cleans graph references but preserves the remaining tasks", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const parent = await createTask(owner.token, space.id, { title: "Parent" });
    const child = await createTask(owner.token, space.id, { title: "Child", parentTaskId: parent.id });
    await api().post(`/api/tasks/${child.id}/dependencies`).set(owner.headers).send({ dependencyTaskId: parent.id });
    expect((await api().delete(`/api/tasks/${parent.id}`).set(owner.headers)).status).toBe(204);
    const response = await api().get(`/api/lifespaces/${space.id}/tasks`).set(owner.headers);
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.tasks[0]).toMatchObject({ id: child.id, parent_task_id: null, dependency_ids: [] });
  });
});
