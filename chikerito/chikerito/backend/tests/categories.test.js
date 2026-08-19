const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createContribution,
} = require("./helpers/factories");

describe("POST /api/lifespaces/:id/categories", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a budget category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers)
      .send({ name: "Venue", icon: "building", budgetAmount: 4000 });
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({
      life_space_id: space.id,
      name: "Venue",
      icon: "building",
      budget_amount: 4000,
    });
  });

  it("defaults the icon and budget amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers)
      .send({ name: "Misc" });
    expect(res.body.category.icon).toBe("sparkles");
    expect(res.body.category.budget_amount).toBe(0);
  });

  it("coerces a numeric string budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: "750" });
    expect(category.budget_amount).toBe(750);
  });

  it("returns zeroed computed fields on a brand-new category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    expect(category).toMatchObject({
      raised: 0,
      spent: 0,
      remainingBudget: 1000,
      available: 0,
      progress: 0,
    });
  });

  it("requires a name", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers)
      .send({ budgetAmount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/categories`)
      .send({ name: "Venue" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/lifespaces/:id/categories", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns an empty list before any category exists", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .get(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
  });

  it("returns only the categories of the requested life space", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    await createCategory(owner.token, a.id, { name: "In A" });
    await createCategory(owner.token, b.id, { name: "In B" });
    const res = await api()
      .get(`/api/lifespaces/${a.id}/categories`)
      .set(owner.headers);
    expect(res.body.categories).toHaveLength(1);
    expect(res.body.categories[0].name).toBe("In A");
  });
});

describe("category computed totals", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  async function scenario() {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 10000 });
    const venue = await createCategory(owner.token, space.id, {
      name: "Venue",
      budgetAmount: 1000,
    });
    return { owner, space, venue };
  }

  async function readCategory(owner, space, id) {
    const res = await api()
      .get(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers);
    return res.body.categories.find((c) => c.id === id);
  }

  it("sums contributions into raised", async () => {
    const { owner, space, venue } = await scenario();
    await createContribution(space.slug, { amount: 300, categoryId: venue.id });
    await createContribution(space.slug, { amount: 200, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.raised).toBe(500);
  });

  it("sums expenses into spent", async () => {
    const { owner, space, venue } = await scenario();
    await createExpense(owner.token, space.id, { amount: 120, categoryId: venue.id });
    await createExpense(owner.token, space.id, { amount: 80, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.spent).toBe(200);
  });

  it("ignores contributions and expenses attached to another category", async () => {
    const { owner, space, venue } = await scenario();
    const catering = await createCategory(owner.token, space.id, { name: "Catering" });
    await createContribution(space.slug, { amount: 400, categoryId: catering.id });
    await createExpense(owner.token, space.id, { amount: 90, categoryId: catering.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.raised).toBe(0);
    expect(category.spent).toBe(0);
  });

  it("ignores uncategorised contributions and expenses", async () => {
    const { owner, space, venue } = await scenario();
    await createContribution(space.slug, { amount: 400 });
    await createExpense(owner.token, space.id, { amount: 90 });
    const category = await readCategory(owner, space, venue.id);
    expect(category.raised).toBe(0);
    expect(category.spent).toBe(0);
  });

  it("computes remainingBudget as budget minus spent", async () => {
    const { owner, space, venue } = await scenario();
    await createExpense(owner.token, space.id, { amount: 400, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.remainingBudget).toBe(600);
  });

  it("floors remainingBudget at zero when overspent", async () => {
    const { owner, space, venue } = await scenario();
    await createExpense(owner.token, space.id, { amount: 1500, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.remainingBudget).toBe(0);
  });

  it("computes available as raised minus spent", async () => {
    const { owner, space, venue } = await scenario();
    await createContribution(space.slug, { amount: 700, categoryId: venue.id });
    await createExpense(owner.token, space.id, { amount: 250, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.available).toBe(450);
  });

  it("floors available at zero when spending outpaces raising", async () => {
    const { owner, space, venue } = await scenario();
    await createContribution(space.slug, { amount: 100, categoryId: venue.id });
    await createExpense(owner.token, space.id, { amount: 900, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.available).toBe(0);
  });

  it("expresses progress as a rounded percentage of budget raised", async () => {
    const { owner, space, venue } = await scenario();
    await createContribution(space.slug, { amount: 333, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.progress).toBe(33);
  });

  it("caps progress at 100 percent when over-funded", async () => {
    const { owner, space, venue } = await scenario();
    await createContribution(space.slug, { amount: 4000, categoryId: venue.id });
    const category = await readCategory(owner, space, venue.id);
    expect(category.progress).toBe(100);
  });

  it("reports zero progress for a zero-budget category rather than dividing by zero", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const free = await createCategory(owner.token, space.id, {
      name: "Unbudgeted",
      budgetAmount: 0,
    });
    await createContribution(space.slug, { amount: 500, categoryId: free.id });
    const category = await readCategory(owner, space, free.id);
    expect(category.progress).toBe(0);
    expect(Number.isNaN(category.progress)).toBe(false);
  });
});

describe("PATCH /api/categories/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("renames a category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { name: "Old" });
    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(owner.headers)
      .send({ name: "New" });
    expect(res.status).toBe(200);
    expect(res.body.category.name).toBe("New");
  });

  it("updates the budget and recomputes the derived fields", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    await createExpense(owner.token, space.id, { amount: 200, categoryId: category.id });
    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(owner.headers)
      .send({ budgetAmount: 500 });
    expect(res.body.category.budget_amount).toBe(500);
    expect(res.body.category.remainingBudget).toBe(300);
  });

  it("updates the icon", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(owner.headers)
      .send({ icon: "camera" });
    expect(res.body.category.icon).toBe("camera");
  });

  it("leaves unmentioned fields untouched", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, {
      name: "Keep",
      budgetAmount: 999,
    });
    const res = await api()
      .patch(`/api/categories/${category.id}`)
      .set(owner.headers)
      .send({ icon: "star" });
    expect(res.body.category.name).toBe("Keep");
    expect(res.body.category.budget_amount).toBe(999);
  });

  it("404s for an unknown category", async () => {
    const owner = await registerUser();
    const res = await api()
      .patch("/api/categories/no-such-id")
      .set(owner.headers)
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const res = await api().patch(`/api/categories/${category.id}`).send({ name: "X" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/categories/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("deletes the category and returns 204", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const res = await api()
      .delete(`/api/categories/${category.id}`)
      .set(owner.headers);
    expect(res.status).toBe(204);
    const list = await api()
      .get(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers);
    expect(list.body.categories.map((c) => c.id)).not.toContain(category.id);
  });

  it("leaves sibling categories alone", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const doomed = await createCategory(owner.token, space.id, { name: "Doomed" });
    const keeper = await createCategory(owner.token, space.id, { name: "Keeper" });
    await api().delete(`/api/categories/${doomed.id}`).set(owner.headers);
    const list = await api()
      .get(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers);
    expect(list.body.categories.map((c) => c.id)).toEqual([keeper.id]);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const res = await api().delete(`/api/categories/${category.id}`);
    expect(res.status).toBe(401);
  });
});
