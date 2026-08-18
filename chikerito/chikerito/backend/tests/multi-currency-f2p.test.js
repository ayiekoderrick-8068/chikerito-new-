// Black-box evaluation tests intentionally import only modules that already
// exist on evaluation-base-v1. This lets the frozen-base run reach real HTTP
// assertions instead of failing because a Task 2 module cannot be resolved.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, auth, registerUser, createLifeSpace, createCategory } = require("./helpers/factories");

beforeEach(() => freshDatabase());
afterAll(() => cleanupDatabases());

async function createForeignExpense(owner, space, overrides = {}) {
  return api()
    .post(`/api/lifespaces/${space.id}/expenses`)
    .set(auth(owner.token))
    .send({ vendor: "European Vendor", amount: 100, currency: "EUR", exchangeRate: 1.25, ...overrides });
}

async function createForeignContribution(owner, space, overrides = {}) {
  return api()
    .post(`/api/lifespaces/${space.id}/contributions`)
    .set(auth(owner.token))
    .send({ contributorName: "International Donor", amount: 100, currency: "EUR", exchangeRate: 1.25, ...overrides });
}

describe("Task 2 black-box F2P behavior", () => {
  it("exposes supported currency metadata", async () => {
    const response = await api().get("/api/currencies");
    expect(response.status).toBe(200);
    expect(response.body.currencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "USD", minorUnits: 2 }),
      expect.objectContaining({ code: "KES", symbol: expect.any(String) }),
      expect.objectContaining({ code: "JPY", minorUnits: 0 }),
    ]));
  });

  it("rejects unsupported Life Space base currency", async () => {
    const owner = await registerUser();
    const response = await api()
      .post("/api/lifespaces")
      .set(auth(owner.token))
      .send({ title: "Unsupported Currency", milestoneType: "business", currency: "BTC" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsupported currency/i);
  });

  it("updates the base currency before financial activity", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await api()
      .patch(`/api/lifespaces/${space.id}`)
      .set(auth(owner.token))
      .send({ currency: "KES" });
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace.currency).toBe("KES");
  });

  it("persists original and normalized expense amounts", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await createForeignExpense(owner, space);
    expect(response.status).toBe(201);
    expect(response.body.expense).toEqual(expect.objectContaining({
      original_amount: 100,
      currency: "EUR",
      exchange_rate: 1.25,
      base_amount: 125,
      base_currency: "USD",
    }));
  });

  it("rejects foreign expenses without an exchange rate", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(auth(owner.token))
      .send({ vendor: "Missing Rate", amount: 100, currency: "EUR" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/exchangeRate is required/i);
  });

  it("persists original and normalized contribution amounts", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await createForeignContribution(owner, space);
    expect(response.status).toBe(201);
    expect(response.body.contribution).toEqual(expect.objectContaining({
      original_amount: 100,
      currency: "EUR",
      exchange_rate: 1.25,
      base_amount: 125,
    }));
  });

  it("aggregates mixed-currency dashboard totals in base currency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await createForeignExpense(owner, space, { amount: 40, exchangeRate: 1.5 });
    await createForeignContribution(owner, space, { amount: 100, exchangeRate: 1.2 });
    const response = await api().get(`/api/lifespaces/${space.id}/dashboard`).set(auth(owner.token));
    expect(response.status).toBe(200);
    expect(response.body.stats).toEqual(expect.objectContaining({ spent: 60, raised: 120, available: 60 }));
  });

  it("aggregates mixed-currency category totals in base currency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const category = await createCategory(owner.token, space.id, { budgetAmount: 500 });
    await createForeignExpense(owner, space, { amount: 40, exchangeRate: 1.5, categoryId: category.id });
    await createForeignContribution(owner, space, { amount: 100, exchangeRate: 1.2, categoryId: category.id });
    const response = await api().get(`/api/lifespaces/${space.id}/categories`).set(auth(owner.token));
    expect(response.status).toBe(200);
    expect(response.body.categories[0]).toEqual(expect.objectContaining({ spent: 60, raised: 120, available: 60 }));
  });

  it("preserves currency snapshots on generated recurring expenses", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00Z"));
    try {
      const owner = await registerUser();
      const space = await createLifeSpace(owner.token, { visibility: "private" });
      const created = await api()
        .post(`/api/lifespaces/${space.id}/recurring-expenses`)
        .set(auth(owner.token))
        .send({ vendor: "Foreign Subscription", amount: 20, currency: "EUR", exchangeRate: 1.5, frequency: "monthly", startDate: "2026-06-15" });
      expect(created.status).toBe(201);
      const listed = await api().get(`/api/lifespaces/${space.id}/expenses`).set(auth(owner.token));
      expect(listed.body.expenses[0]).toEqual(expect.objectContaining({ currency: "EUR", exchange_rate: 1.5, base_amount: 30 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not count failed foreign contributions in dashboard totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await createForeignContribution(owner, space, { status: "failed", amount: 100, exchangeRate: 2 });
    const response = await api().get(`/api/lifespaces/${space.id}/dashboard`).set(auth(owner.token));
    expect(response.body.stats.raised).toBe(0);
    expect(response.body.recentContributions[0]).toEqual(expect.objectContaining({
      status: "failed",
      money: expect.objectContaining({ originalAmount: 100, baseAmount: 200, currency: "EUR" }),
    }));
  });
});
