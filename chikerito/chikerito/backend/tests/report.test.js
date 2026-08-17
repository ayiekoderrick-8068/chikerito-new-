// report.js has no equivalent in the old snapshot this suite's siblings were
// adapted from — the public report page, publicAccess.js's visibility/
// passcode gate, and this route were all added since then. This file is new
// baseline coverage, not an adaptation.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createContribution,
} = require("./helpers/factories");

function getReport(slug, passcode) {
  return api().get(`/api/public/lifespaces/${slug}/report${passcode ? `?passcode=${passcode}` : ""}`);
}

describe("GET /api/public/lifespaces/:slug/report", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns the report for a public life space with no passcode", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, {
      title: "Ada & Chip's Wedding",
      milestoneType: "wedding",
      goalAmount: 10000,
      currency: "USD",
      coverImage: "cover.jpg",
    });
    const res = await getReport(space.slug);
    expect(res.status).toBe(200);
    expect(res.body.lifeSpace).toMatchObject({
      title: "Ada & Chip's Wedding",
      milestoneType: "wedding",
      goalAmount: 10000,
      currency: "USD",
      slug: space.slug,
      coverImage: "cover.jpg",
      allowIndexing: false,
    });
  });

  it("never exposes internal fields like id, owner_id, or the passcode hash", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await getReport(space.slug, "letmein");
    expect(res.body.lifeSpace.id).toBeUndefined();
    expect(res.body.lifeSpace.owner_id).toBeUndefined();
    expect(res.body.lifeSpace.passcode_hash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("letmein");
  });

  it("403s a private life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const res = await getReport(space.slug);
    expect(res.status).toBe(403);
    expect(res.body.private).toBe(true);
  });

  it("401s a passcode-protected space when no passcode is supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await getReport(space.slug);
    expect(res.status).toBe(401);
    expect(res.body.passcodeRequired).toBe(true);
  });

  it("401s a passcode-protected space when the wrong passcode is supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await getReport(space.slug, "wrong");
    expect(res.status).toBe(401);
  });

  it("200s a passcode-protected space when the right passcode is supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await getReport(space.slug, "letmein");
    expect(res.status).toBe(200);
  });

  it("accepts the passcode via the x-event-passcode header too", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await api()
      .get(`/api/public/lifespaces/${space.slug}/report`)
      .set("x-event-passcode", "letmein");
    expect(res.status).toBe(200);
  });

  it("404s for an unknown slug", async () => {
    const res = await getReport("no-such-slug");
    expect(res.status).toBe(404);
  });

  it("sums only contributions into raised, not expenses", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 1000 });
    await createContribution(space.slug, { amount: 300 });
    await createExpense(owner.token, space.id, { amount: 5000 });
    const res = await getReport(space.slug);
    expect(res.body.stats.raised).toBe(300);
  });

  it("computes remainingGoal and progress, flooring and capping correctly", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 1000 });
    await createContribution(space.slug, { amount: 1500 });
    const res = await getReport(space.slug);
    expect(res.body.stats.remainingGoal).toBe(0);
    expect(res.body.stats.progress).toBe(100);
  });

  it("counts contributorCount as the number of contribution records", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createContribution(space.slug, { amount: 10 });
    await createContribution(space.slug, { amount: 20 });
    await createContribution(space.slug, { amount: 30 });
    const res = await getReport(space.slug);
    expect(res.body.stats.contributorCount).toBe(3);
  });

  it("hides the category/budget breakdown by default", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const venue = await createCategory(owner.token, space.id, { name: "Venue", budgetAmount: 1000 });
    await createExpense(owner.token, space.id, { amount: 200, categoryId: venue.id });
    const res = await getReport(space.slug);
    expect(res.body.budgetVisible).toBe(false);
    expect(res.body.categoryBreakdown).toEqual([]);
  });

  it("includes the category/budget breakdown once the owner opts in", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ showBudgetPublic: true });
    const venue = await createCategory(owner.token, space.id, { name: "Venue", budgetAmount: 1000 });
    await createContribution(space.slug, { amount: 600, categoryId: venue.id });
    await createExpense(owner.token, space.id, { amount: 200, categoryId: venue.id });
    const res = await getReport(space.slug);
    expect(res.body.budgetVisible).toBe(true);
    expect(res.body.categoryBreakdown).toHaveLength(1);
    expect(res.body.categoryBreakdown[0]).toMatchObject({
      name: "Venue",
      budget: 1000,
      raised: 600,
      spent: 200,
      remaining: 800,
      progress: 60,
    });
  });
});
