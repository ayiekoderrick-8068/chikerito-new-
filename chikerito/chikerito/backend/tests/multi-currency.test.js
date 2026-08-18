const db = require("../db");
const {
  SUPPORTED_CURRENCIES,
  currencyCode,
  roundForCurrency,
  normalizeTransaction,
  baseAmount,
  transactionView,
} = require("../currency");
const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const {
  api,
  auth,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createRecurringExpense,
  addTeamMember,
} = require("./helpers/factories");

beforeEach(() => freshDatabase());
afterAll(() => cleanupDatabases());

async function manualContribution(user, space, body = {}) {
  return api()
    .post(`/api/lifespaces/${space.id}/contributions`)
    .set(auth(user.token))
    .send({ contributorName: "Currency Donor", amount: 100, ...body });
}

async function dashboard(user, space) {
  return api().get(`/api/lifespaces/${space.id}/dashboard`).set(auth(user.token));
}

describe("currency domain", () => {
  it("publishes a stable supported currency list", () => {
    expect(SUPPORTED_CURRENCIES.map((currency) => currency.code)).toEqual(["USD", "EUR", "GBP", "KES", "JPY", "CAD", "AUD"]);
  });

  it("includes unambiguous metadata for every supported currency", () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      expect(currency).toEqual(expect.objectContaining({ code: expect.any(String), name: expect.any(String), symbol: expect.any(String), minorUnits: expect.any(Number) }));
    }
  });

  it("normalizes lower-case currency codes", () => {
    expect(currencyCode("kes")).toBe("KES");
  });

  it("returns null for an unsupported currency", () => {
    expect(currencyCode("BTC")).toBeNull();
  });

  it("rounds two-decimal currencies half-up", () => {
    expect(roundForCurrency(12.345, "USD")).toBe(12.35);
  });

  it("rounds zero-decimal currencies to whole units", () => {
    expect(roundForCurrency(125.6, "JPY")).toBe(126);
  });

  it("normalizes a base-currency transaction at rate one", () => {
    expect(normalizeTransaction({ amount: 12.345, currency: "USD" }, { currency: "USD" })).toEqual({
      originalAmount: 12.35, currency: "USD", exchangeRate: 1, baseAmount: 12.35, baseCurrency: "USD",
    });
  });

  it("normalizes a foreign transaction with an explicit rate", () => {
    expect(normalizeTransaction({ amount: 10, currency: "EUR", exchangeRate: 1.234 }, { currency: "USD" })).toEqual({
      originalAmount: 10, currency: "EUR", exchangeRate: 1.234, baseAmount: 12.34, baseCurrency: "USD",
    });
  });

  it("requires a rate for foreign currency", () => {
    expect(normalizeTransaction({ amount: 10, currency: "EUR" }, { currency: "USD" }).error).toMatch(/required/i);
  });

  it("rejects a non-unit rate for base currency", () => {
    expect(normalizeTransaction({ amount: 10, currency: "USD", exchangeRate: 2 }, { currency: "USD" }).error).toMatch(/must be 1/i);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid exchange rate %s", (exchangeRate) => {
    expect(normalizeTransaction({ amount: 10, currency: "EUR", exchangeRate }, { currency: "USD" }).error).toMatch(/positive finite/i);
  });

  it("treats legacy amount-only rows as base currency", () => {
    expect(baseAmount({ amount: 42.5 }, "KES")).toBe(42.5);
    expect(transactionView({ amount: 42.5 }, "KES")).toEqual({
      originalAmount: 42.5, currency: "KES", exchangeRate: 1, baseAmount: 42.5, baseCurrency: "KES", converted: false,
    });
  });

  it("prefers the persisted base amount over original amount", () => {
    expect(baseAmount({ amount: 100, base_amount: 74.12 }, "USD")).toBe(74.12);
  });
});

describe("GET /api/currencies", () => {
  it("returns metadata without authentication", async () => {
    const response = await api().get("/api/currencies");
    expect(response.status).toBe(200);
    expect(response.body.currencies).toHaveLength(7);
  });

  it("documents rate direction and rounding", async () => {
    const response = await api().get("/api/currencies");
    expect(response.body.rateSemantics).toMatch(/transaction-currency unit.*base-currency/i);
    expect(response.body.rounding).toMatch(/minor-unit/i);
  });
});

describe("Life Space base currency", () => {
  it("defaults omitted currency to USD", async () => {
    const owner = await registerUser();
    const response = await api().post("/api/lifespaces").set(auth(owner.token)).send({ title: "Default Currency", milestoneType: "wedding" });
    expect(response.status).toBe(201);
    expect(response.body.lifeSpace.currency).toBe("USD");
  });

  it("accepts and normalizes a supported base currency", async () => {
    const owner = await registerUser();
    const response = await api().post("/api/lifespaces").set(auth(owner.token)).send({ title: "Kenya", milestoneType: "wedding", currency: "kes" });
    expect(response.status).toBe(201);
    expect(response.body.lifeSpace.currency).toBe("KES");
  });

  it("rejects unsupported base currency on creation", async () => {
    const owner = await registerUser();
    const response = await api().post("/api/lifespaces").set(auth(owner.token)).send({ title: "Crypto", milestoneType: "business", currency: "BTC" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsupported currency/i);
  });

  it("lets an owner update currency before financial activity", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await api().patch(`/api/lifespaces/${space.id}`).set(auth(owner.token)).send({ currency: "EUR" });
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace.currency).toBe("EUR");
  });

  it("lets a finance manager update currency before activity", async () => {
    const owner = await registerUser();
    const manager = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await addTeamMember(owner.token, space.id, manager, "finance_manager");
    const response = await api().patch(`/api/lifespaces/${space.id}`).set(auth(manager.token)).send({ currency: "GBP" });
    expect(response.status).toBe(200);
    expect(response.body.lifeSpace.currency).toBe("GBP");
  });

  it("rejects currency updates by a volunteer", async () => {
    const owner = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    const response = await api().patch(`/api/lifespaces/${space.id}`).set(auth(volunteer.token)).send({ currency: "EUR" });
    expect(response.status).toBe(403);
  });

  it("rejects a base change after an expense exists", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await createExpense(owner.token, space.id);
    const response = await api().patch(`/api/lifespaces/${space.id}`).set(auth(owner.token)).send({ currency: "EUR" });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/financial activity/i);
  });

  it("does not rewrite historical rows when a blocked change is attempted", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const expense = await createExpense(owner.token, space.id, { amount: 44 });
    await api().patch(`/api/lifespaces/${space.id}`).set(auth(owner.token)).send({ currency: "EUR" });
    expect(db.table("expenses").find(expense.id).amount).toBe(44);
    expect(db.table("life_spaces").find(space.id).currency).toBe("USD");
  });

  it("returns 404 rather than exposing an unknown space", async () => {
    const user = await registerUser();
    const response = await api().patch("/api/lifespaces/not-real").set(auth(user.token)).send({ currency: "EUR" });
    expect(response.status).toBe(404);
  });
});

describe("expense currency persistence", () => {
  it("stores explicit base-currency fields", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { currency: "KES", visibility: "private" });
    const expense = await createExpense(owner.token, space.id, { amount: 2500, currency: "KES" });
    expect(expense).toEqual(expect.objectContaining({ amount: 2500, original_amount: 2500, currency: "KES", exchange_rate: 1, base_amount: 2500, base_currency: "KES" }));
  });

  it("stores original and normalized foreign amounts", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { currency: "USD", visibility: "private" });
    const expense = await createExpense(owner.token, space.id, { amount: 100, currency: "EUR", exchangeRate: 1.075 });
    expect(expense).toEqual(expect.objectContaining({ amount: 100, original_amount: 100, currency: "EUR", exchange_rate: 1.075, base_amount: 107.5, base_currency: "USD" }));
    expect(expense.money).toEqual(expect.objectContaining({ originalAmount: 100, baseAmount: 107.5, converted: true }));
  });

  it("rounds converted expense amounts deterministically", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const expense = await createExpense(owner.token, space.id, { amount: 10.01, currency: "EUR", exchangeRate: 1.2345 });
    expect(expense.base_amount).toBe(12.36);
  });

  it("rejects foreign expense without a rate", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await api().post(`/api/lifespaces/${space.id}/expenses`).set(auth(owner.token)).send({ vendor: "Foreign", amount: 10, currency: "EUR" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/exchangeRate is required/i);
  });

  it("rejects unsupported expense currency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await api().post(`/api/lifespaces/${space.id}/expenses`).set(auth(owner.token)).send({ vendor: "Crypto", amount: 10, currency: "BTC", exchangeRate: 2 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsupported currency/i);
  });

  it("preserves the historical rate when listing later", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await createExpense(owner.token, space.id, { amount: 20, currency: "GBP", exchangeRate: 1.25 });
    const list = await api().get(`/api/lifespaces/${space.id}/expenses`).set(auth(owner.token));
    expect(list.body.expenses[0].money).toEqual(expect.objectContaining({ exchangeRate: 1.25, baseAmount: 25 }));
  });

  it("recalculates all monetary fields during an authorized edit", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const expense = await createExpense(owner.token, space.id, { amount: 20 });
    const response = await api().patch(`/api/expenses/${expense.id}`).set(auth(owner.token)).send({ amount: 30, currency: "EUR", exchangeRate: 1.2 });
    expect(response.status).toBe(200);
    expect(response.body.expense).toEqual(expect.objectContaining({ amount: 30, currency: "EUR", exchange_rate: 1.2, base_amount: 36 }));
  });

  it("keeps planned-only foreign expense semantics", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const expense = await createExpense(owner.token, space.id, { amount: 0, plannedAmount: 50, currency: "EUR", exchangeRate: 1.1 });
    expect(expense.amount).toBe(0);
    expect(expense.planned_base_amount).toBe(55);
    expect(expense.planned_currency).toBe("EUR");
  });

  it("rejects a category from another tenant", async () => {
    const owner = await registerUser();
    const first = await createLifeSpace(owner.token, { visibility: "private" });
    const second = await createLifeSpace(owner.token, { visibility: "private" });
    const category = await createCategory(owner.token, second.id);
    const response = await api().post(`/api/lifespaces/${first.id}/expenses`).set(auth(owner.token)).send({ vendor: "Wrong tenant", amount: 10, categoryId: category.id });
    expect(response.status).toBe(400);
  });
});

describe("contribution and aggregate currency semantics", () => {
  it("stores a foreign contribution snapshot", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { currency: "KES", visibility: "private" });
    const response = await manualContribution(owner, space, { amount: 10, currency: "USD", exchangeRate: 130 });
    expect(response.status).toBe(201);
    expect(response.body.contribution).toEqual(expect.objectContaining({ amount: 10, currency: "USD", exchange_rate: 130, base_amount: 1300, base_currency: "KES" }));
  });

  it("uses normalized amounts in mixed-currency dashboard totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await createExpense(owner.token, space.id, { amount: 20 });
    await createExpense(owner.token, space.id, { amount: 10, currency: "EUR", exchangeRate: 1.5 });
    await manualContribution(owner, space, { amount: 40, currency: "GBP", exchangeRate: 1.25 });
    const response = await dashboard(owner, space);
    expect(response.body.stats).toEqual(expect.objectContaining({ spent: 35, raised: 50, available: 15 }));
  });

  it("uses normalized amounts in mixed-currency category totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 10, currency: "EUR", exchangeRate: 2, categoryId: category.id });
    await manualContribution(owner, space, { amount: 30, currency: "GBP", exchangeRate: 2, categoryId: category.id });
    const response = await api().get(`/api/lifespaces/${space.id}/categories`).set(auth(owner.token));
    expect(response.body.categories[0]).toEqual(expect.objectContaining({ spent: 20, raised: 60, available: 40 }));
  });

  it("uses normalized amounts in the public report", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 1000, showBudgetPublic: true });
    await manualContribution(owner, space, { amount: 100, currency: "EUR", exchangeRate: 1.5 });
    const response = await api().get(`/api/public/lifespaces/${space.slug}/report`);
    expect(response.status).toBe(200);
    expect(response.body.stats).toEqual(expect.objectContaining({ raised: 150, remainingGoal: 850, currency: "USD" }));
  });

  it.each(["failed", "refunded", "voided", "pending"])("excludes %s foreign contributions from totals", async (status) => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await manualContribution(owner, space, { amount: 100, currency: "EUR", exchangeRate: 2, status });
    const response = await dashboard(owner, space);
    expect(response.body.stats.raised).toBe(0);
  });

  it("includes only completed foreign contributions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    await manualContribution(owner, space, { amount: 100, currency: "EUR", exchangeRate: 2, status: "completed" });
    const response = await dashboard(owner, space);
    expect(response.body.stats.raised).toBe(200);
  });

  it("rejects a contribution category from another tenant", async () => {
    const owner = await registerUser();
    const first = await createLifeSpace(owner.token, { visibility: "private" });
    const second = await createLifeSpace(owner.token, { visibility: "private" });
    const category = await createCategory(owner.token, second.id);
    const response = await manualContribution(owner, first, { categoryId: category.id });
    expect(response.status).toBe(400);
  });

  it("does not let a non-member list currency-enriched contributions", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const response = await api().get(`/api/lifespaces/${space.id}/contributions`).set(auth(stranger.token));
    expect(response.status).toBe(403);
  });
});

describe("recurring expense currency", () => {
  it("stores a deterministic foreign-currency rule", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const rule = await createRecurringExpense(owner.token, space.id, { amount: 25, currency: "EUR", exchangeRate: 1.2 });
    expect(rule).toEqual(expect.objectContaining({ amount: 25, currency: "EUR", exchange_rate: 1.2, base_amount: 30 }));
  });

  it("copies the rule's original and base values to generated expenses", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00Z"));
    try {
      const owner = await registerUser();
      const space = await createLifeSpace(owner.token, { visibility: "private" });
      await createRecurringExpense(owner.token, space.id, { amount: 25, currency: "EUR", exchangeRate: 1.2, startDate: "2026-06-15" });
      await api().get(`/api/lifespaces/${space.id}/expenses`).set(auth(owner.token));
      const generated = db.table("expenses").where((expense) => expense.life_space_id === space.id)[0];
      expect(generated).toEqual(expect.objectContaining({ amount: 25, currency: "EUR", exchange_rate: 1.2, base_amount: 30, base_currency: "USD" }));
    } finally {
      jest.useRealTimers();
    }
  });

  it("projects recurring spend in base currency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createRecurringExpense(owner.token, space.id, { amount: 25, currency: "EUR", exchangeRate: 2, categoryId: category.id });
    const response = await dashboard(owner, space);
    expect(response.body.upcomingRecurringExpenses[0].baseAmount).toBe(50);
    expect(response.body.categoryBreakdown[0].projectedSpent).toBe(50);
  });

  it("rejects unsupported recurring currency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const response = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(auth(owner.token)).send({ vendor: "Crypto", amount: 10, currency: "BTC", exchangeRate: 2, frequency: "monthly", startDate: tomorrow });
    expect(response.status).toBe(400);
  });

  it("keeps legacy raw datastore rows readable without migration", () => {
    const row = db.table("expenses").insert({ id: "legacy-expense", life_space_id: "legacy", vendor: "Old Vendor", amount: 19.99 });
    expect(rawState().expenses.find((expense) => expense.id === row.id)).not.toHaveProperty("currency");
    expect(transactionView(row, "CAD").baseAmount).toBe(19.99);
    expect(transactionView(row, "CAD").currency).toBe("CAD");
  });
});
