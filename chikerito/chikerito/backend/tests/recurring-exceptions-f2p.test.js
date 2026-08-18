// Task 5 black-box F2P contract. Uses only frozen-base HTTP helpers.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createRecurringExpense,
  addTeamMember,
} = require("./helpers/factories");

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function setupRule(overrides = {}) {
  const owner = await registerUser();
  const space = await createLifeSpace(owner.token);
  const category = await createCategory(owner.token, space.id, { name: "Rentals", budgetAmount: 2000 });
  const rule = await createRecurringExpense(owner.token, space.id, {
    categoryId: category.id,
    vendor: "Chair rental",
    amount: 100,
    frequency: "weekly",
    startDate: dateOffset(1),
    endDate: dateOffset(30),
    ...overrides,
  });
  return { owner, space, category, rule };
}

function createException(person, rule, payload) {
  return api().post(`/api/recurring-expenses/${rule.id}/exceptions`).set(person.headers).send(payload);
}

describe("Task 5 F2P: occurrence exception lifecycle", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("skips one scheduled occurrence in the preview", async () => {
    const { owner, rule } = await setupRule();
    const occurrenceDate = dateOffset(1);
    const created = await createException(owner, rule, { occurrenceDate, action: "skip" });
    const preview = await api().get(`/api/recurring-expenses/${rule.id}/occurrences?from=${occurrenceDate}&to=${dateOffset(10)}`).set(owner.headers);

    expect(created.status).toBe(201);
    expect(created.body.exception).toMatchObject({ occurrenceDate, action: "skip", status: "active" });
    expect(preview.body.occurrences[0]).toMatchObject({ occurrenceDate, state: "skipped", skipped: true, effectiveDate: null });
  });

  it("overrides date, amount, category, and vendor for one occurrence", async () => {
    const { owner, space, rule } = await setupRule();
    const alternate = await createCategory(owner.token, space.id, { name: "Equipment" });
    const occurrenceDate = dateOffset(1);
    const overrideDate = dateOffset(3);
    const created = await createException(owner, rule, {
      occurrenceDate,
      action: "override",
      overrideDate,
      overrideAmount: 175,
      overrideCategoryId: alternate.id,
      overrideVendor: "Premium chairs",
    });
    const preview = await api().get(`/api/recurring-expenses/${rule.id}/occurrences?from=${occurrenceDate}&to=${dateOffset(5)}`).set(owner.headers);

    expect(created.status).toBe(201);
    expect(preview.body.occurrences[0]).toMatchObject({
      occurrenceDate, effectiveDate: overrideDate, amount: 175,
      categoryId: alternate.id, vendor: "Premium chairs", state: "overridden",
    });
  });

  it("prevents duplicate exceptions for the same rule occurrence", async () => {
    const { owner, rule } = await setupRule();
    const payload = { occurrenceDate: dateOffset(1), action: "skip" };
    expect((await createException(owner, rule, payload)).status).toBe(201);
    const duplicate = await createException(owner, rule, payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already exists/);
  });

  it("edits an active exception without creating a second record", async () => {
    const { owner, rule } = await setupRule();
    const created = await createException(owner, rule, { occurrenceDate: dateOffset(1), action: "skip" });
    const edited = await api().patch(`/api/recurring-expense-exceptions/${created.body.exception.id}`).set(owner.headers).send({
      action: "override", overrideAmount: 80,
    });
    const list = await api().get(`/api/recurring-expenses/${rule.id}/exceptions`).set(owner.headers);
    expect(edited.status).toBe(200);
    expect(edited.body.exception).toMatchObject({ action: "override", overrideAmount: 80 });
    expect(list.body.exceptions).toHaveLength(1);
  });

  it("soft-removes and restores an exception", async () => {
    const { owner, rule } = await setupRule();
    const created = await createException(owner, rule, { occurrenceDate: dateOffset(1), action: "skip" });
    const id = created.body.exception.id;
    expect((await api().delete(`/api/recurring-expense-exceptions/${id}`).set(owner.headers)).status).toBe(204);
    let list = await api().get(`/api/recurring-expenses/${rule.id}/exceptions`).set(owner.headers);
    expect(list.body.exceptions[0].status).toBe("removed");
    expect((await api().post(`/api/recurring-expense-exceptions/${id}/restore`).set(owner.headers)).status).toBe(200);
    list = await api().get(`/api/recurring-expenses/${rule.id}/exceptions`).set(owner.headers);
    expect(list.body.exceptions[0].status).toBe("active");
  });
});

describe("Task 5 F2P: deterministic generation compatibility", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("reports the following schedule date when the first occurrence is skipped", async () => {
    const { owner, space, rule } = await setupRule();
    await createException(owner, rule, { occurrenceDate: dateOffset(1), action: "skip" });
    const rules = await api().get(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers);
    expect(rules.body.recurringExpenses.find((item) => item.id === rule.id).nextOccurrence).toBe(dateOffset(8));
  });

  it("materializes an earlier date override once and keeps its original occurrence identity", async () => {
    const { owner, space, rule } = await setupRule();
    await createException(owner, rule, {
      occurrenceDate: dateOffset(1), action: "override", overrideDate: dateOffset(0), overrideAmount: 135,
    });
    const first = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const second = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const generated = first.body.expenses.find((expense) => expense.recurring_expense_id === rule.id);
    expect(generated).toMatchObject({ amount: 135, payment_date: dateOffset(0), recurring_occurrence_date: dateOffset(1) });
    expect(second.body.expenses.filter((expense) => expense.recurring_expense_id === rule.id)).toHaveLength(1);
  });

  it("does not generate occurrences while a rule is paused", async () => {
    const { owner, space, rule } = await setupRule();
    await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(owner.headers);
    await createException(owner, rule, { occurrenceDate: dateOffset(1), action: "override", overrideDate: dateOffset(0) });
    const expenses = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    expect(expenses.body.expenses.filter((expense) => expense.recurring_expense_id === rule.id)).toEqual([]);
  });
});

describe("Task 5 F2P: authorization and isolation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("lets a volunteer preview occurrences but denies exception writes", async () => {
    const { owner, space, rule } = await setupRule();
    const volunteer = await registerUser();
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    expect((await api().get(`/api/recurring-expenses/${rule.id}/occurrences`).set(volunteer.headers)).status).toBe(200);
    expect((await createException(volunteer, rule, { occurrenceDate: dateOffset(1), action: "skip" })).status).toBe(403);
  });

  it("blocks a member of another tenant from previewing or changing exceptions", async () => {
    const { owner, rule } = await setupRule();
    const created = await createException(owner, rule, { occurrenceDate: dateOffset(1), action: "skip" });
    const outsider = await registerUser();
    await createLifeSpace(outsider.token, { title: "Other tenant" });
    expect((await api().get(`/api/recurring-expenses/${rule.id}/occurrences`).set(outsider.headers)).status).toBe(403);
    expect((await api().patch(`/api/recurring-expense-exceptions/${created.body.exception.id}`).set(outsider.headers).send({ action: "skip" })).status).toBe(403);
    expect((await api().delete(`/api/recurring-expense-exceptions/${created.body.exception.id}`).set(outsider.headers)).status).toBe(403);
  });
});
