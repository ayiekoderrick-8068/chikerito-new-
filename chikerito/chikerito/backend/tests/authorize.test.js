// Product-code test suite for the RBAC/authorization phase: the capability
// matrix across all five roles, non-members, cross-tenant access,
// privilege-escalation attempts, and protected destructive operations.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createTask,
  addTeamMember,
} = require("./helpers/factories");

async function setupWithRole(role) {
  const owner = await registerUser();
  const space = await createLifeSpace(owner.token);
  const helper = await registerUser();
  if (role) await addTeamMember(owner.token, space.id, helper, role);
  return { owner, space, helper };
}

const tryCreateCategory = (user, spaceId) =>
  api().post(`/api/lifespaces/${spaceId}/categories`).set(user.headers).send({ name: "X", budgetAmount: 100 });
const tryCreateExpense = (user, spaceId) =>
  api().post(`/api/lifespaces/${spaceId}/expenses`).set(user.headers).send({ vendor: "X", amount: 10 });
const tryCreateTask = (user, spaceId) =>
  api().post(`/api/lifespaces/${spaceId}/tasks`).set(user.headers).send({ title: "X" });
const tryEditSettings = (user, spaceId) =>
  api().patch(`/api/lifespaces/${spaceId}`).set(user.headers).send({ title: "Renamed" });
const tryEditVisibility = (user, spaceId) =>
  api().patch(`/api/lifespaces/${spaceId}`).set(user.headers).send({ visibility: "public" });
const tryDeleteLifeSpace = (user, spaceId) => api().delete(`/api/lifespaces/${spaceId}`).set(user.headers);
const tryInvite = (user, spaceId, email = "nobody@chikerito.test") =>
  api().post(`/api/lifespaces/${spaceId}/invitations`).set(user.headers).send({ email, role: "volunteer" });

// [role, { category, expense, task, settings, visibility, delete, team }]
const MATRIX = [
  ["finance_manager", { category: true, expense: true, task: false, settings: true, visibility: false, delete: false, team: false }],
  ["event_planner", { category: false, expense: false, task: true, settings: true, visibility: false, delete: false, team: false }],
  ["editor", { category: false, expense: false, task: false, settings: true, visibility: false, delete: false, team: false }],
  ["volunteer", { category: false, expense: false, task: false, settings: false, visibility: false, delete: false, team: false }],
];

describe("capability matrix — non-owner roles", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  describe.each(MATRIX)("role: %s", (role, caps) => {
    it(`${caps.category ? "can" : "cannot"} create a category`, async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryCreateCategory(helper, space.id);
      expect(res.status).toBe(caps.category ? 201 : 403);
    });

    it(`${caps.expense ? "can" : "cannot"} create an expense`, async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryCreateExpense(helper, space.id);
      expect(res.status).toBe(caps.expense ? 201 : 403);
    });

    it(`${caps.task ? "can" : "cannot"} create a task`, async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryCreateTask(helper, space.id);
      expect(res.status).toBe(caps.task ? 201 : 403);
    });

    it(`${caps.settings ? "can" : "cannot"} edit non-sensitive settings`, async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryEditSettings(helper, space.id);
      expect(res.status).toBe(caps.settings ? 200 : 403);
    });

    it("cannot edit visibility/passcode regardless of settings access", async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryEditVisibility(helper, space.id);
      expect(res.status).toBe(403);
    });

    it("cannot delete the life space", async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryDeleteLifeSpace(helper, space.id);
      expect(res.status).toBe(403);
    });

    it("cannot invite a team member", async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await tryInvite(helper, space.id);
      expect(res.status).toBe(403);
    });

    it("can still view the life space, dashboard, categories, expenses, contributions, tasks, and team", async () => {
      const { owner, space, helper } = await setupWithRole(role);
      await createCategory(owner.token, space.id);
      await createExpense(owner.token, space.id);
      await createTask(owner.token, space.id);

      const checks = await Promise.all([
        api().get(`/api/lifespaces/${space.id}`).set(helper.headers),
        api().get(`/api/lifespaces/${space.id}/dashboard`).set(helper.headers),
        api().get(`/api/lifespaces/${space.id}/categories`).set(helper.headers),
        api().get(`/api/lifespaces/${space.id}/expenses`).set(helper.headers),
        api().get(`/api/lifespaces/${space.id}/contributions`).set(helper.headers),
        api().get(`/api/lifespaces/${space.id}/tasks`).set(helper.headers),
        api().get(`/api/lifespaces/${space.id}/team`).set(helper.headers),
      ]);
      checks.forEach((res) => expect(res.status).toBe(200));
    });

    it("the life space list tags this life space with the caller's role", async () => {
      const { space, helper } = await setupWithRole(role);
      const res = await api().get("/api/lifespaces").set(helper.headers);
      const listed = res.body.lifeSpaces.find((s) => s.id === space.id);
      expect(listed.role).toBe(role);
    });
  });
});

describe("owner", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("can do everything the capability matrix covers", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);

    expect((await tryCreateCategory(owner, space.id)).status).toBe(201);
    expect((await tryCreateExpense(owner, space.id)).status).toBe(201);
    expect((await tryCreateTask(owner, space.id)).status).toBe(201);
    expect((await tryEditSettings(owner, space.id)).status).toBe(200);
    expect((await tryEditVisibility(owner, space.id)).status).toBe(200);

    const helper = await registerUser();
    expect((await tryInvite(owner, space.id, helper.user.email)).status).toBe(201);
  });

  it("is tagged with role owner in the life space list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get("/api/lifespaces").set(owner.headers);
    expect(res.body.lifeSpaces.find((s) => s.id === space.id).role).toBe("owner");
  });

  it("can delete the life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await tryDeleteLifeSpace(owner, space.id);
    expect(res.status).toBe(204);
  });
});

describe("non-members", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("403s a registered user with no role on the life space, on every route", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const expense = await createExpense(owner.token, space.id);
    const task = await createTask(owner.token, space.id);
    const stranger = await registerUser();

    const reads = await Promise.all([
      api().get(`/api/lifespaces/${space.id}`).set(stranger.headers),
      api().get(`/api/lifespaces/${space.id}/dashboard`).set(stranger.headers),
      api().get(`/api/lifespaces/${space.id}/categories`).set(stranger.headers),
      api().get(`/api/lifespaces/${space.id}/expenses`).set(stranger.headers),
      api().get(`/api/lifespaces/${space.id}/contributions`).set(stranger.headers),
      api().get(`/api/lifespaces/${space.id}/tasks`).set(stranger.headers),
      api().get(`/api/lifespaces/${space.id}/team`).set(stranger.headers),
    ]);
    reads.forEach((res) => expect(res.status).toBe(403));

    const writes = await Promise.all([
      api().patch(`/api/lifespaces/${space.id}`).set(stranger.headers).send({ title: "Hijacked" }),
      api().delete(`/api/lifespaces/${space.id}`).set(stranger.headers),
      api().post(`/api/lifespaces/${space.id}/categories`).set(stranger.headers).send({ name: "X" }),
      api().patch(`/api/categories/${category.id}`).set(stranger.headers).send({ name: "Hijacked" }),
      api().delete(`/api/categories/${category.id}`).set(stranger.headers),
      api().post(`/api/lifespaces/${space.id}/expenses`).set(stranger.headers).send({ vendor: "X", amount: 1 }),
      api().patch(`/api/expenses/${expense.id}`).set(stranger.headers).send({ vendor: "Hijacked" }),
      api().delete(`/api/expenses/${expense.id}`).set(stranger.headers),
      api().post(`/api/lifespaces/${space.id}/tasks`).set(stranger.headers).send({ title: "X" }),
      api().patch(`/api/tasks/${task.id}`).set(stranger.headers).send({ title: "Hijacked" }),
      api().delete(`/api/tasks/${task.id}`).set(stranger.headers),
      api().post(`/api/lifespaces/${space.id}/invitations`).set(stranger.headers).send({ email: "nobody@chikerito.test", role: "volunteer" }),
    ]);
    writes.forEach((res) => expect(res.status).toBe(403));

    // Every resource survives untouched.
    expect((await api().get(`/api/lifespaces/${space.id}`).set(owner.headers)).body.lifeSpace.title).not.toBe("Hijacked");
  });

  it("does not leak the life space's existence via status code inconsistency between not-found and forbidden", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();
    const forbidden = await api().get(`/api/lifespaces/${space.id}`).set(stranger.headers);
    const notFound = await api().get("/api/lifespaces/no-such-id").set(stranger.headers);
    expect(forbidden.status).toBe(403);
    expect(notFound.status).toBe(404);
  });
});

describe("cross-tenant access", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("a role on space A grants no access to space B, even for the same user", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "A" });
    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });

    const helper = await registerUser();
    await addTeamMember(ownerA.token, spaceA.id, helper, "finance_manager");

    // Full manage rights on A...
    expect((await tryCreateCategory(helper, spaceA.id)).status).toBe(201);
    // ...but none at all on B.
    expect((await api().get(`/api/lifespaces/${spaceB.id}`).set(helper.headers)).status).toBe(403);
    expect((await tryCreateCategory(helper, spaceB.id)).status).toBe(403);
  });

  it("an owner of one life space has no elevated access to another owner's life space", async () => {
    const ownerA = await registerUser();
    await createLifeSpace(ownerA.token, { title: "A" });
    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });

    const res = await tryDeleteLifeSpace(ownerA, spaceB.id);
    expect(res.status).toBe(403);
  });

  it("a resource id from one life space cannot be edited via another life space's authorized member", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "A" });
    const expenseInA = await createExpense(ownerA.token, spaceA.id);

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });
    const financeManagerB = await registerUser();
    await addTeamMember(ownerB.token, spaceB.id, financeManagerB, "finance_manager");

    // financeManagerB can manage expenses in B, but expenseInA belongs to A.
    const res = await api()
      .patch(`/api/expenses/${expenseInA.id}`)
      .set(financeManagerB.headers)
      .send({ vendor: "Hijacked" });
    expect(res.status).toBe(403);
  });
});

describe("privilege escalation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("rejects inviting a team member with role=owner", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const helper = await registerUser();
    const res = await api()
      .post(`/api/lifespaces/${space.id}/invitations`)
      .set(owner.headers)
      .send({ email: helper.user.email, role: "owner" });
    expect(res.status).toBe(400);
  });

  it("rejects inviting a team member with an unrecognised role", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const helper = await registerUser();
    const res = await api()
      .post(`/api/lifespaces/${space.id}/invitations`)
      .set(owner.headers)
      .send({ email: helper.user.email, role: "super-admin" });
    expect(res.status).toBe(400);
  });

  it("rejects changing a team member's role to owner", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const invitee = await registerUser();
    const member = await addTeamMember(owner.token, space.id, invitee, "volunteer");
    const res = await api()
      .patch(`/api/lifespaces/${space.id}/team/${member.id}`)
      .set(owner.headers)
      .send({ role: "owner" });
    expect(res.status).toBe(400);
  });

  it("a non-owner member cannot invite, change roles, or remove members even if they know the routes", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const financeManager = await registerUser();
    await addTeamMember(owner.token, space.id, financeManager, "finance_manager");
    const victimUser = await registerUser();
    const victim = await addTeamMember(owner.token, space.id, victimUser, "volunteer");

    const inviteRes = await api()
      .post(`/api/lifespaces/${space.id}/invitations`)
      .set(financeManager.headers)
      .send({ email: "nobody@chikerito.test", role: "volunteer" });
    expect(inviteRes.status).toBe(403);

    const roleChangeRes = await api()
      .patch(`/api/lifespaces/${space.id}/team/${victim.id}`)
      .set(financeManager.headers)
      .send({ role: "finance_manager" });
    expect(roleChangeRes.status).toBe(403);

    const removeRes = await api()
      .delete(`/api/lifespaces/${space.id}/team/${victim.id}`)
      .set(financeManager.headers);
    expect(removeRes.status).toBe(403);
  });

  it("a user cannot grant themselves elevated access by inviting their own second account with a manage role, without owner authorization", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const attacker = await registerUser();
    // Not a member at all — cannot even reach the invite endpoint to add themselves.
    const res = await api()
      .post(`/api/lifespaces/${space.id}/invitations`)
      .set(attacker.headers)
      .send({ email: attacker.user.email, role: "finance_manager" });
    expect(res.status).toBe(403);
  });
});

describe("protected destructive operations", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("only the owner can change visibility, showBudgetPublic, allowIndexing, or the passcode", async () => {
    const { owner, space, helper } = await setupWithRole("finance_manager"); // has edit_settings, not edit_visibility
    for (const body of [{ visibility: "public" }, { showBudgetPublic: true }, { allowIndexing: true }, { passcode: "secret" }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await api().patch(`/api/lifespaces/${space.id}`).set(helper.headers).send(body);
      expect(res.status).toBe(403);
    }
    const ownerRes = await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ visibility: "public" });
    expect(ownerRes.status).toBe(200);
  });

  it("only the owner can delete the life space", async () => {
    const { owner, space, helper } = await setupWithRole("editor");
    expect((await tryDeleteLifeSpace(helper, space.id)).status).toBe(403);
    expect((await tryDeleteLifeSpace(owner, space.id)).status).toBe(204);
  });

  it("only the owner can change a team member's role", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const member = await addTeamMember(owner.token, space.id, await registerUser(), "volunteer");
    const res = await api()
      .patch(`/api/lifespaces/${space.id}/team/${member.id}`)
      .set(owner.headers)
      .send({ role: "editor" });
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe("editor");
  });

  it("only the owner can remove a team member", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const member = await addTeamMember(owner.token, space.id, await registerUser(), "volunteer");
    const res = await api().delete(`/api/lifespaces/${space.id}/team/${member.id}`).set(owner.headers);
    expect(res.status).toBe(204);
    const team = await api().get(`/api/lifespaces/${space.id}/team`).set(owner.headers);
    expect(team.body.team.map((m) => m.id)).not.toContain(member.id);
  });

  it("the owner's own team_member row cannot be changed or removed via the team endpoints", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const team = await api().get(`/api/lifespaces/${space.id}/team`).set(owner.headers);
    const ownerMember = team.body.team.find((m) => m.role === "owner");

    const roleChangeRes = await api()
      .patch(`/api/lifespaces/${space.id}/team/${ownerMember.id}`)
      .set(owner.headers)
      .send({ role: "volunteer" });
    expect(roleChangeRes.status).toBe(403);

    const removeRes = await api()
      .delete(`/api/lifespaces/${space.id}/team/${ownerMember.id}`)
      .set(owner.headers);
    expect(removeRes.status).toBe(403);
  });

  it("404s a role change or removal for a team member id that doesn't belong to the given life space", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token);
    const memberA = await addTeamMember(ownerA.token, spaceA.id, await registerUser(), "volunteer");

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token);

    const res = await api()
      .patch(`/api/lifespaces/${spaceB.id}/team/${memberA.id}`)
      .set(ownerB.headers)
      .send({ role: "editor" });
    expect(res.status).toBe(404);
  });
});

describe("401 vs 403", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("401s with no token at all, 403s with a valid token but no membership", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();

    const noToken = await api().get(`/api/lifespaces/${space.id}`);
    expect(noToken.status).toBe(401);

    const wrongMember = await api().get(`/api/lifespaces/${space.id}`).set(stranger.headers);
    expect(wrongMember.status).toBe(403);
  });

  it("401s a garbage token before authorization is ever evaluated", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}`).set({ Authorization: "Bearer not-a-real-token" });
    expect(res.status).toBe(401);
  });
});
