const db = require("../db");
const {
  money,
  isValidDate,
  validateScenarioInput,
  futureOccurrences,
  buildForecast,
} = require("../budgetForecast");
const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  addTeamMember,
} = require("./helpers/factories");

const AS_OF = "2026-08-18";
const HORIZON = "2026-11-18";

function draft(overrides = {}) {
  return { name: "Baseline what-if", description: "", horizonDate: HORIZON, allocations: [], ...overrides };
}

function insertContribution(spaceId, categoryId, amount, status = "completed") {
  return db.table("contributions").insert({
    id: `contribution-${status}-${amount}`,
    life_space_id: spaceId,
    category_id: categoryId,
    contributor_name: "Forecast fixture",
    amount,
    status,
    created_at: "2026-08-01T00:00:00.000Z",
  });
}

function insertRecurring(spaceId, categoryId, overrides = {}) {
  return db.table("recurring_expenses").insert({
    id: overrides.id || `recurring-${db.table("recurring_expenses").count()}`,
    life_space_id: spaceId,
    category_id: categoryId,
    vendor: "Rental vendor",
    amount: 100,
    frequency: "monthly",
    start_date: "2026-08-20",
    end_date: null,
    status: "active",
    last_generated_date: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("budget forecast primitives", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it.each([
    ["2026-01-01", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["01-01-2026", false],
    ["", false],
  ])("validates ISO calendar date %s", (value, expected) => {
    expect(isValidDate(value)).toBe(expected);
  });

  it("rounds monetary arithmetic to cents", () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money("12.345")).toBe(12.35);
  });

  it("enumerates only occurrences strictly after the as-of date", () => {
    const rule = {
      id: "r1", category_id: "c1", vendor: "Rentals", amount: 25,
      frequency: "weekly", start_date: "2026-08-04", end_date: null,
      status: "active", last_generated_date: null,
    };
    expect(futureOccurrences(rule, AS_OF, "2026-09-01").map((item) => item.dueDate)).toEqual([
      "2026-08-25", "2026-09-01",
    ]);
  });

  it("starts after last_generated_date without repeating it", () => {
    const rule = {
      id: "r1", category_id: null, vendor: "Storage", amount: 50,
      frequency: "monthly", start_date: "2026-01-31", end_date: null,
      status: "active", last_generated_date: "2026-07-31",
    };
    expect(futureOccurrences(rule, AS_OF, "2026-10-31").map((item) => item.dueDate)).toEqual([
      "2026-08-31", "2026-09-30", "2026-10-30",
    ]);
  });

  it.each(["paused", "stopped"])("excludes %s recurring rules", (status) => {
    const rule = {
      id: "r1", category_id: null, vendor: "Storage", amount: 50,
      frequency: "weekly", start_date: "2026-08-20", end_date: null,
      status, last_generated_date: null,
    };
    expect(futureOccurrences(rule, AS_OF, HORIZON)).toEqual([]);
  });

  it("stops recurring projections at the rule end date", () => {
    const rule = {
      id: "r1", category_id: null, vendor: "Storage", amount: 50,
      frequency: "weekly", start_date: "2026-08-20", end_date: "2026-09-03",
      status: "active", last_generated_date: null,
    };
    expect(futureOccurrences(rule, AS_OF, HORIZON).map((item) => item.dueDate)).toEqual([
      "2026-08-20", "2026-08-27", "2026-09-03",
    ]);
  });
});

describe("buildForecast", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("orders category forecasts by name and then id", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { currency: "KES" });
    const zulu = await createCategory(owner.token, space.id, { name: "Zulu", budgetAmount: 100 });
    const alpha = await createCategory(owner.token, space.id, { name: "Alpha", budgetAmount: 200 });
    const forecast = buildForecast(space.id, draft(), { asOf: AS_OF });
    expect(forecast.categoryForecasts.map((item) => item.categoryId)).toEqual([alpha.id, zulu.id]);
    expect(forecast.currency).toBe("KES");
  });

  it("uses all live expenses but only completed contributions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    await createExpense(owner.token, space.id, { categoryId: category.id, amount: 175 });
    insertContribution(space.id, category.id, 400, "completed");
    insertContribution(space.id, category.id, 900, "pending");
    insertContribution(space.id, category.id, 800, "refunded");

    const forecast = buildForecast(space.id, draft(), { asOf: AS_OF });
    expect(forecast.totals.currentSpent).toBe(175);
    expect(forecast.totals.currentRaised).toBe(400);
    expect(forecast.categoryForecasts[0]).toMatchObject({ currentSpent: 175, currentRaised: 400 });
  });

  it("overrides only the hypothetical category budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    const forecast = buildForecast(space.id, draft({ allocations: [{ categoryId: category.id, budgetAmount: 1500 }] }), { asOf: AS_OF });
    expect(forecast.categoryForecasts[0]).toMatchObject({ currentBudget: 1000, scenarioBudget: 1500, budgetAdjustment: 500 });
    expect(db.table("budget_categories").find(category.id).budget_amount).toBe(1000);
  });

  it("adds hypothetical expenses and contributions to separate forecast totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    const forecast = buildForecast(space.id, draft({ allocations: [{
      categoryId: category.id, projectedExpenses: 250, projectedContributions: 600,
    }] }), { asOf: AS_OF });
    expect(forecast.totals).toMatchObject({ projectedExpenses: 250, projectedContributions: 600, forecastSpent: 250, forecastRaised: 600 });
    expect(forecast.totals.projectedAvailable).toBe(350);
    expect(forecast.totals.fundingGap).toBe(0);
  });

  it("includes active recurring rules and excludes paused and stopped rules", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 2000 });
    insertRecurring(space.id, category.id, { id: "active", amount: 100 });
    insertRecurring(space.id, category.id, { id: "paused", amount: 900, status: "paused" });
    insertRecurring(space.id, category.id, { id: "stopped", amount: 800, status: "stopped" });
    const forecast = buildForecast(space.id, draft(), { asOf: AS_OF });
    expect(forecast.recurringOccurrences.map((item) => item.recurringExpenseId)).toEqual(["active", "active", "active"]);
    expect(forecast.totals.projectedRecurring).toBe(300);
  });

  it("sorts equal-date recurring projections by vendor then rule id", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    insertRecurring(space.id, null, { id: "z-rule", vendor: "Alpha", frequency: "yearly" });
    insertRecurring(space.id, null, { id: "a-rule", vendor: "Alpha", frequency: "yearly" });
    insertRecurring(space.id, null, { id: "b-rule", vendor: "Beta", frequency: "yearly" });
    const forecast = buildForecast(space.id, draft(), { asOf: AS_OF });
    expect(forecast.recurringOccurrences.map((item) => item.recurringExpenseId)).toEqual(["a-rule", "z-rule", "b-rule"]);
  });

  it("reports category and overall warnings with exact overages", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { name: "Venue", budgetAmount: 500 });
    await createExpense(owner.token, space.id, { categoryId: category.id, amount: 450 });
    const forecast = buildForecast(space.id, draft({ allocations: [{ categoryId: category.id, projectedExpenses: 125 }] }), { asOf: AS_OF });
    expect(forecast.categoryForecasts[0].overBudgetBy).toBe(75);
    expect(forecast.warnings.map((warning) => warning.overBy)).toEqual([75, 75]);
  });
});

describe("scenario input validation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("requires a name and a non-past horizon", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const errors = validateScenarioInput(space.id, { name: " ", horizonDate: "2026-08-17", allocations: [] }, { asOf: AS_OF });
    expect(errors).toEqual(expect.arrayContaining(["name is required", "horizonDate cannot be before today"]));
  });

  it("rejects duplicate category allocations", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const errors = validateScenarioInput(space.id, draft({ allocations: [{ categoryId: category.id }, { categoryId: category.id }] }), { asOf: AS_OF });
    expect(errors.some((error) => error.includes("duplicate category"))).toBe(true);
  });

  it("rejects categories belonging to a different life space", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    const categoryB = await createCategory(owner.token, b.id);
    const errors = validateScenarioInput(a.id, draft({ allocations: [{ categoryId: categoryB.id }] }), { asOf: AS_OF });
    expect(errors[0]).toMatch(/not in this life space/);
  });

  it.each(["budgetAmount", "projectedExpenses", "projectedContributions"])("rejects a negative %s", async (field) => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const errors = validateScenarioInput(space.id, draft({ allocations: [{ categoryId: category.id, [field]: -1 }] }), { asOf: AS_OF });
    expect(errors[0]).toMatch(/non-negative number/);
  });
});

describe("budget scenario API validation and role policy", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns all validation errors without persisting partial data", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const response = await api().post(`/api/lifespaces/${space.id}/budget-scenarios`).set(owner.headers).send({
      name: "", horizonDate: "invalid", allocations: "wrong",
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.length).toBeGreaterThanOrEqual(3);
    expect(rawState().budget_scenarios).toEqual([]);
  });

  it("lets a finance manager create, edit, and delete a scenario", async () => {
    const owner = await registerUser();
    const manager = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, manager, "finance_manager");
    const created = await api().post(`/api/lifespaces/${space.id}/budget-scenarios`).set(manager.headers).send(draft({ horizonDate: "2099-01-01" }));
    expect(created.status).toBe(201);
    expect((await api().patch(`/api/budget-scenarios/${created.body.scenario.id}`).set(manager.headers).send({ name: "Manager edit" })).status).toBe(200);
    expect((await api().delete(`/api/budget-scenarios/${created.body.scenario.id}`).set(manager.headers)).status).toBe(204);
  });

  it.each(["event_planner", "volunteer", "editor"])("denies scenario writes to %s", async (role) => {
    const owner = await registerUser();
    const member = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, role);
    const response = await api().post(`/api/lifespaces/${space.id}/budget-scenarios`).set(member.headers).send(draft({ horizonDate: "2099-01-01" }));
    expect(response.status).toBe(403);
  });

  it("requires authentication on every scenario entry point", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    expect((await api().get(`/api/lifespaces/${space.id}/budget-scenarios`)).status).toBe(401);
    expect((await api().post(`/api/lifespaces/${space.id}/budget-scenarios/preview`).send(draft())).status).toBe(401);
    expect((await api().post(`/api/lifespaces/${space.id}/budget-scenarios`).send(draft())).status).toBe(401);
  });
});
