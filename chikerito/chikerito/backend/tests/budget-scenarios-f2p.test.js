// Task 4 black-box future-to-past contract. This file depends only on public
// HTTP behavior and helpers available on evaluation-base-v1.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createRecurringExpense,
  createContribution,
  addTeamMember,
} = require("./helpers/factories");

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function scenarioPayload(category, overrides = {}) {
  return {
    name: "Expanded reception plan",
    description: "Model a larger guest list without changing live records.",
    horizonDate: dateOffset(90),
    allocations: category ? [{
      categoryId: category.id,
      budgetAmount: 5000,
      projectedExpenses: 700,
      projectedContributions: 1200,
      note: "Tentative guest increase",
    }] : [],
    ...overrides,
  };
}

async function createScenario(owner, space, payload) {
  return api().post(`/api/lifespaces/${space.id}/budget-scenarios`).set(owner.headers).send(payload);
}

describe("Task 4 F2P: persistent hypothetical scenarios", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a scenario with category assumptions and a forecast", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { name: "Reception", budgetAmount: 3000 });

    const response = await createScenario(owner, space, scenarioPayload(category));

    expect(response.status).toBe(201);
    expect(response.body.scenario).toMatchObject({ name: "Expanded reception plan", horizonDate: dateOffset(90) });
    expect(response.body.scenario.allocations).toHaveLength(1);
    expect(response.body.scenario.forecast.totals.scenarioBudget).toBe(5000);
  });

  it("lists saved scenarios with useful deterministic summaries", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    await createScenario(owner, space, scenarioPayload(category, { name: "Plan B" }));

    const response = await api().get(`/api/lifespaces/${space.id}/budget-scenarios`).set(owner.headers);

    expect(response.status).toBe(200);
    expect(response.body.scenarios).toHaveLength(1);
    expect(response.body.scenarios[0].summary).toEqual(expect.objectContaining({ scenarioBudget: 5000, warningCount: expect.any(Number) }));
  });

  it("edits scenario assumptions without modifying the live category budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    const created = await createScenario(owner, space, scenarioPayload(category));

    const edited = await api().patch(`/api/budget-scenarios/${created.body.scenario.id}`).set(owner.headers).send({
      name: "Lean plan",
      allocations: [{ categoryId: category.id, budgetAmount: 800, projectedExpenses: 50 }],
    });
    const liveCategories = await api().get(`/api/lifespaces/${space.id}/categories`).set(owner.headers);

    expect(edited.status).toBe(200);
    expect(edited.body.scenario.name).toBe("Lean plan");
    expect(edited.body.scenario.forecast.totals.scenarioBudget).toBe(800);
    expect(liveCategories.body.categories[0].budget_amount).toBe(1000);
  });

  it("deletes only the scenario and leaves live financial records intact", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    const expense = await createExpense(owner.token, space.id, { categoryId: category.id, amount: 125 });
    const created = await createScenario(owner, space, scenarioPayload(category));

    expect((await api().delete(`/api/budget-scenarios/${created.body.scenario.id}`).set(owner.headers)).status).toBe(204);
    expect((await api().get(`/api/lifespaces/${space.id}/budget-scenarios`).set(owner.headers)).body.scenarios).toEqual([]);
    const expenses = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    expect(expenses.body.expenses.map((item) => item.id)).toContain(expense.id);
  });
});

describe("Task 4 F2P: read-only deterministic forecasting", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("previews a draft without persisting a scenario", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });

    const preview = await api().post(`/api/lifespaces/${space.id}/budget-scenarios/preview`).set(owner.headers).send(scenarioPayload(category));
    const list = await api().get(`/api/lifespaces/${space.id}/budget-scenarios`).set(owner.headers);

    expect(preview.status).toBe(200);
    expect(preview.body.readOnly).toBe(true);
    expect(preview.body.forecast.totals.scenarioBudget).toBe(5000);
    expect(list.body.scenarios).toEqual([]);
  });

  it("projects future recurring occurrences without materializing expenses", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    await createRecurringExpense(owner.token, space.id, {
      categoryId: category.id,
      vendor: "Weekly rentals",
      amount: 100,
      frequency: "weekly",
      startDate: dateOffset(1),
      endDate: dateOffset(15),
    });

    const before = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const preview = await api().post(`/api/lifespaces/${space.id}/budget-scenarios/preview`).set(owner.headers).send(
      scenarioPayload(category, { horizonDate: dateOffset(15), allocations: [] })
    );
    const after = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);

    expect(preview.body.forecast.recurringOccurrences).toHaveLength(3);
    expect(preview.body.forecast.totals.projectedRecurring).toBe(300);
    expect(after.body.expenses).toHaveLength(before.body.expenses.length);
  });

  it("counts only completed contributions in current and forecast raised totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 2000 });
    await createContribution(space.slug, { categoryId: category.id, amount: 400 });
    await api().post(`/api/lifespaces/${space.id}/contributions`).set(owner.headers).send({
      contributorName: "Pending donor", amount: 900, categoryId: category.id, status: "pending",
    });
    await api().post(`/api/lifespaces/${space.id}/contributions`).set(owner.headers).send({
      contributorName: "Failed donor", amount: 800, categoryId: category.id, status: "failed",
    });

    const preview = await api().post(`/api/lifespaces/${space.id}/budget-scenarios/preview`).set(owner.headers).send(
      scenarioPayload(category, { allocations: [{ categoryId: category.id, projectedContributions: 100 }] })
    );

    expect(preview.body.forecast.totals.currentRaised).toBe(400);
    expect(preview.body.forecast.totals.forecastRaised).toBe(500);
  });

  it("detects projected category and total budget overruns", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { name: "Venue", budgetAmount: 500 });
    await createExpense(owner.token, space.id, { categoryId: category.id, amount: 450 });

    const preview = await api().post(`/api/lifespaces/${space.id}/budget-scenarios/preview`).set(owner.headers).send(
      scenarioPayload(category, { allocations: [{ categoryId: category.id, budgetAmount: 500, projectedExpenses: 200 }] })
    );

    const categoryForecast = preview.body.forecast.categoryForecasts[0];
    expect(categoryForecast.projectedOverBudget).toBe(true);
    expect(categoryForecast.overBudgetBy).toBe(150);
    expect(preview.body.forecast.warnings).toHaveLength(2);
  });
});

describe("Task 4 F2P: membership, RBAC, and tenant isolation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("allows a volunteer to view forecasts but not create scenarios", async () => {
    const owner = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    const created = await createScenario(owner, space, scenarioPayload(null));

    expect((await api().get(`/api/budget-scenarios/${created.body.scenario.id}`).set(volunteer.headers)).status).toBe(200);
    expect((await createScenario(volunteer, space, scenarioPayload(null))).status).toBe(403);
  });

  it("prevents members of another tenant from reading or changing a scenario", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "Tenant A" });
    const created = await createScenario(ownerA, spaceA, scenarioPayload(null));
    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "Tenant B" });

    expect((await api().get(`/api/lifespaces/${spaceA.id}/budget-scenarios`).set(ownerB.headers)).status).toBe(403);
    expect((await api().get(`/api/budget-scenarios/${created.body.scenario.id}`).set(ownerB.headers)).status).toBe(403);
    expect((await api().patch(`/api/budget-scenarios/${created.body.scenario.id}`).set(ownerB.headers).send({ name: "Stolen" })).status).toBe(403);
    expect((await api().get(`/api/lifespaces/${spaceB.id}/budget-scenarios`).set(ownerB.headers)).body.scenarios).toEqual([]);
  });
});
