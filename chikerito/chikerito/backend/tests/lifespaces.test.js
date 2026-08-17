const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
} = require("./helpers/factories");

// These cover the owner's own access paths only. Cross-tenant access is
// deliberately not asserted here — it is an open defect, not intended
// behaviour, and pinning it would cement the bug.
describe("POST /api/lifespaces", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a life space owned by the caller", async () => {
    const owner = await registerUser();
    const res = await api().post("/api/lifespaces").set(owner.headers).send({
      title: "Clinton & Mary's Wedding Fund",
      milestoneType: "wedding",
      story: "Help us celebrate.",
      goalAmount: 25000,
      currency: "KES",
    });
    expect(res.status).toBe(201);
    expect(res.body.lifeSpace).toMatchObject({
      title: "Clinton & Mary's Wedding Fund",
      milestone_type: "wedding",
      story: "Help us celebrate.",
      goal_amount: 25000,
      currency: "KES",
      owner_id: owner.user.id,
      status: "active",
    });
  });

  it("maps camelCase input onto snake_case columns", async () => {
    const owner = await registerUser();
    const res = await api().post("/api/lifespaces").set(owner.headers).send({
      title: "Cover Test",
      milestoneType: "wedding",
      goalAmount: 500,
      theme: "royal",
      coverImage: "cover.jpg",
    });
    expect(res.body.lifeSpace.goal_amount).toBe(500);
    expect(res.body.lifeSpace.theme).toBe("royal");
    expect(res.body.lifeSpace.cover_image).toBe("cover.jpg");
  });

  it("applies defaults for optional fields, private with no passcode", async () => {
    const owner = await registerUser();
    const res = await api()
      .post("/api/lifespaces")
      .set(owner.headers)
      .send({ title: "Bare Minimum", milestoneType: "graduation" });
    expect(res.status).toBe(201);
    expect(res.body.lifeSpace).toMatchObject({
      story: "",
      goal_amount: 0,
      currency: "USD",
      theme: "classic",
      visibility: "private",
      show_budget_public: false,
      allow_indexing: false,
      cover_image: null,
      hasPasscode: false,
    });
  });

  it("never exposes the passcode hash, even when there is none", async () => {
    const owner = await registerUser();
    const res = await api()
      .post("/api/lifespaces")
      .set(owner.headers)
      .send({ title: "No Leak", milestoneType: "wedding" });
    expect(res.body.lifeSpace.passcode_hash).toBeUndefined();
  });

  // Known gap, not fixed here: POST doesn't read `visibility` from the body
  // at all (only PATCH does), so a caller cannot request a public life space
  // at creation time — it's always born private regardless of what's sent.
  it("known gap: ignores a visibility field sent at creation time", async () => {
    const owner = await registerUser();
    const res = await api().post("/api/lifespaces").set(owner.headers).send({
      title: "Should Stay Private",
      milestoneType: "wedding",
      visibility: "public",
    });
    expect(res.body.lifeSpace.visibility).toBe("private");
  });

  it("coerces a numeric string goal amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: "1250" });
    expect(space.goal_amount).toBe(1250);
  });

  it("falls back to zero for an unparseable goal amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: "not-a-number" });
    expect(space.goal_amount).toBe(0);
  });

  it("derives a url-safe slug from the title", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, {
      title: "Clinton & Mary's Wedding!",
    });
    expect(space.slug).toMatch(/^clinton-mary-s-wedding-[a-z0-9]{5}$/);
  });

  it("gives two identically-titled life spaces different slugs", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "Same Title" });
    const b = await createLifeSpace(owner.token, { title: "Same Title" });
    expect(a.slug).not.toBe(b.slug);
  });

  it("records the creator as an owner team member", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .get(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.team).toHaveLength(1);
    expect(res.body.team[0]).toMatchObject({ user_id: owner.user.id, role: "owner" });
  });

  it("stamps created_at as an ISO timestamp", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    expect(Number.isNaN(Date.parse(space.created_at))).toBe(false);
  });

  it("requires a title", async () => {
    const owner = await registerUser();
    const res = await api()
      .post("/api/lifespaces")
      .set(owner.headers)
      .send({ milestoneType: "wedding" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("requires a milestoneType", async () => {
    const owner = await registerUser();
    const res = await api()
      .post("/api/lifespaces")
      .set(owner.headers)
      .send({ title: "No Type" });
    expect(res.status).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await api()
      .post("/api/lifespaces")
      .send({ title: "Anon", milestoneType: "wedding" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/lifespaces", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns an empty list for a new account", async () => {
    const owner = await registerUser();
    const res = await api().get("/api/lifespaces").set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.lifeSpaces).toEqual([]);
  });

  it("lists the life spaces the caller owns", async () => {
    const owner = await registerUser();
    await createLifeSpace(owner.token, { title: "First" });
    await createLifeSpace(owner.token, { title: "Second" });
    const res = await api().get("/api/lifespaces").set(owner.headers);
    expect(res.body.lifeSpaces).toHaveLength(2);
    expect(res.body.lifeSpaces.map((s) => s.title).sort()).toEqual(["First", "Second"]);
  });

  it("does not list another account's life spaces", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    await createLifeSpace(owner.token, { title: "Private Plans" });
    const res = await api().get("/api/lifespaces").set(stranger.headers);
    expect(res.body.lifeSpaces).toEqual([]);
  });

  it("includes life spaces the caller was added to as a team member", async () => {
    const owner = await registerUser();
    const helper = await registerUser();
    const space = await createLifeSpace(owner.token, { title: "Shared" });
    await api()
      .post(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers)
      .send({ email: helper.user.email, role: "finance_manager" });
    const res = await api().get("/api/lifespaces").set(helper.headers);
    expect(res.body.lifeSpaces.map((s) => s.id)).toContain(space.id);
  });

  it("never exposes a passcode hash in the list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "secret" });
    const res = await api().get("/api/lifespaces").set(owner.headers);
    expect(res.body.lifeSpaces[0].passcode_hash).toBeUndefined();
    expect(res.body.lifeSpaces[0].hasPasscode).toBe(true);
  });

  it("401s without a token", async () => {
    const res = await api().get("/api/lifespaces");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/lifespaces/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns the owner's life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { title: "Readable" });
    const res = await api().get(`/api/lifespaces/${space.id}`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.lifeSpace.id).toBe(space.id);
  });

  it("404s for an unknown id", async () => {
    const owner = await registerUser();
    const res = await api().get("/api/lifespaces/no-such-id").set(owner.headers);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}`);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/lifespaces/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("updates the editable fields", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ title: "Renamed", story: "New story", goalAmount: 4200 });
    expect(res.status).toBe(200);
    expect(res.body.lifeSpace).toMatchObject({
      title: "Renamed",
      story: "New story",
      goal_amount: 4200,
    });
  });

  it("maps visibility, showBudgetPublic, allowIndexing, and coverImage onto their columns", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ visibility: "public", showBudgetPublic: true, allowIndexing: true, coverImage: "new.png" });
    expect(res.body.lifeSpace).toMatchObject({
      visibility: "public",
      show_budget_public: true,
      allow_indexing: true,
      cover_image: "new.png",
    });
  });

  it("sets a passcode, hashing it and exposing only hasPasscode", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ passcode: "letmein" });
    expect(res.body.lifeSpace.hasPasscode).toBe(true);
    expect(res.body.lifeSpace.passcode_hash).toBeUndefined();
  });

  it("replaces an existing passcode with a new one", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "first" });
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ passcode: "second" });
    expect(res.body.lifeSpace.hasPasscode).toBe(true);
  });

  it("clears an existing passcode when patched with an explicit empty string", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ passcode: "" });
    expect(res.body.lifeSpace.hasPasscode).toBe(false);
  });

  it("leaves the passcode untouched when the passcode key is omitted", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ title: "Unrelated change" });
    expect(res.body.lifeSpace.hasPasscode).toBe(true);
  });

  it("leaves unmentioned fields untouched", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { story: "Keep me" });
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ title: "Only the title" });
    expect(res.body.lifeSpace.story).toBe("Keep me");
    expect(res.body.lifeSpace.slug).toBe(space.slug);
  });

  it("ignores fields that are not editable", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ owner_id: "someone-else", slug: "hijacked" });
    expect(res.body.lifeSpace.owner_id).toBe(owner.user.id);
    expect(res.body.lifeSpace.slug).toBe(space.slug);
  });

  it("coerces the goal amount to a number", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(owner.headers)
      .send({ goalAmount: "900" });
    expect(res.body.lifeSpace.goal_amount).toBe(900);
  });

  it("404s for an unknown id", async () => {
    const owner = await registerUser();
    const res = await api()
      .patch("/api/lifespaces/no-such-id")
      .set(owner.headers)
      .send({ title: "X" });
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().patch(`/api/lifespaces/${space.id}`).send({ title: "X" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/lifespaces/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("deletes the life space and returns 204", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers);
    expect(res.status).toBe(204);
    const after = await api().get(`/api/lifespaces/${space.id}`).set(owner.headers);
    expect(after.status).toBe(404);
  });

  it("removes it from the caller's list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().delete(`/api/lifespaces/${space.id}`).set(owner.headers);
    const list = await api().get("/api/lifespaces").set(owner.headers);
    expect(list.body.lifeSpaces.map((s) => s.id)).not.toContain(space.id);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().delete(`/api/lifespaces/${space.id}`);
    expect(res.status).toBe(401);
  });
});

describe("team membership", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("adds an existing user to the team with the given role", async () => {
    const owner = await registerUser();
    const helper = await registerUser({ firstName: "Ada", lastName: "Lovelace" });
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers)
      .send({ email: helper.user.email, role: "event_planner" });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      life_space_id: space.id,
      user_id: helper.user.id,
      role: "event_planner",
    });
  });

  it("defaults an invited member to the volunteer role", async () => {
    const owner = await registerUser();
    const helper = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers)
      .send({ email: helper.user.email });
    expect(res.body.member.role).toBe("volunteer");
  });

  it("matches the invited email case-insensitively", async () => {
    const owner = await registerUser({ email: "o@chikerito.test" });
    await registerUser({ email: "Helper@chikerito.test" });
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers)
      .send({ email: "HELPER@chikerito.test" });
    expect(res.status).toBe(201);
  });

  it("404s when inviting an email with no account", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers)
      .send({ email: "nobody@chikerito.test" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no user/i);
  });

  it("lists team members with their names and emails resolved", async () => {
    const owner = await registerUser({ firstName: "Grace", lastName: "Hopper" });
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .get(`/api/lifespaces/${space.id}/team`)
      .set(owner.headers);
    expect(res.body.team[0].name).toBe("Grace Hopper");
    expect(res.body.team[0].email).toBe(owner.user.email);
  });

  it("returns an empty team for an unknown life space", async () => {
    const owner = await registerUser();
    const res = await api()
      .get("/api/lifespaces/no-such-id/team")
      .set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.team).toEqual([]);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/team`);
    expect(res.status).toBe(401);
  });
});
