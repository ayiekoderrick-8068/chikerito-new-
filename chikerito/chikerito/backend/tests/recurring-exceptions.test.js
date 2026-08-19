const db = require("../db");
const {
  scheduledDates,
  effectiveOccurrence,
  previewOccurrences,
  nextOccurrenceWithExceptions,
  runDueOccurrences,
} = require("../recurrence");
const { validDate, isScheduled, validate } = require("../routes/recurringExceptions");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createRecurringExpense,
  addTeamMember,
} = require("./helpers/factories");

function ruleFixture(spaceId, categoryId = null, overrides = {}) {
  return db.table("recurring_expenses").insert({
    id: overrides.id || "rule-fixed",
    life_space_id: spaceId,
    category_id: categoryId,
    vendor: "Original vendor",
    amount: 100,
    frequency: "weekly",
    start_date: "2026-06-01",
    end_date: "2026-06-30",
    status: "active",
    last_generated_date: null,
    created_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  });
}

function exceptionFixture(rule, occurrenceDate, overrides = {}) {
  return db.table("recurring_expense_exceptions").insert({
    id: overrides.id || `exception-${occurrenceDate}`,
    recurring_expense_id: rule.id,
    life_space_id: rule.life_space_id,
    occurrence_date: occurrenceDate,
    action: "skip",
    override_date: null,
    override_amount: null,
    override_category_id: null,
    override_vendor: null,
    status: "active",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("recurring exception validation primitives", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it.each([
    ["2026-06-01", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["June 1", false],
  ])("validates exception date %s", (date, expected) => {
    expect(validDate(date)).toBe(expected);
  });

  it("recognizes weekly scheduled dates and rejects in-between dates", () => {
    const rule = { start_date: "2026-06-01", end_date: "2026-06-30", frequency: "weekly" };
    expect(isScheduled(rule, "2026-06-15")).toBe(true);
    expect(isScheduled(rule, "2026-06-16")).toBe(false);
  });

  it("recognizes clamped month-end schedule dates", () => {
    const rule = { start_date: "2026-01-31", end_date: "2026-04-30", frequency: "monthly" };
    expect(scheduledDates(rule, "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-28", "2026-04-28"]);
    expect(isScheduled(rule, "2026-02-28")).toBe(true);
  });

  it("requires an override to change at least one field", () => {
    const rule = { start_date: "2026-06-01", end_date: null, frequency: "weekly", life_space_id: "space" };
    expect(validate(rule, { occurrenceDate: "2026-06-08", action: "override" })).toContain("an override must change at least one field");
  });

  it("accepts a skip without override fields", () => {
    const rule = { start_date: "2026-06-01", end_date: null, frequency: "weekly", life_space_id: "space" };
    expect(validate(rule, { occurrenceDate: "2026-06-08", action: "skip" })).toEqual([]);
  });

  it.each([
    [{ overrideAmount: 0 }, /positive/],
    [{ overrideAmount: "nope" }, /positive/],
    [{ overrideDate: "tomorrow" }, /valid/],
    [{ overrideVendor: " " }, /blank/],
  ])("rejects malformed override fields", (override, message) => {
    const rule = { start_date: "2026-06-01", end_date: null, frequency: "weekly", life_space_id: "space" };
    expect(validate(rule, { occurrenceDate: "2026-06-08", action: "override", ...override })[0]).toMatch(message);
  });
});

describe("exception-aware preview and next occurrence", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("applies only active exceptions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    exceptionFixture(rule, "2026-06-08", { status: "removed" });
    expect(effectiveOccurrence(rule, "2026-06-08")).toMatchObject({ state: "scheduled", amount: 100 });
  });

  it("applies partial overrides while inheriting other rule fields", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    exceptionFixture(rule, "2026-06-08", { action: "override", override_amount: 125 });
    expect(effectiveOccurrence(rule, "2026-06-08")).toMatchObject({
      state: "overridden", effectiveDate: "2026-06-08", amount: 125,
      vendor: "Original vendor", categoryId: null,
    });
  });

  it("returns deterministic occurrence previews in schedule order", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    exceptionFixture(rule, "2026-06-08");
    const preview = previewOccurrences(rule, { from: "2026-06-01", to: "2026-06-20" });
    expect(preview.map((item) => item.occurrenceDate)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15"]);
    expect(preview.map((item) => item.state)).toEqual(["scheduled", "skipped", "scheduled"]);
  });

  it("marks a preview occurrence materialized by original occurrence identity", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    db.table("expenses").insert({
      id: "generated", life_space_id: space.id, recurring_expense_id: rule.id,
      recurring_occurrence_date: "2026-06-08", payment_date: "2026-06-10", amount: 100,
    });
    expect(previewOccurrences(rule, { from: "2026-06-08", to: "2026-06-08" })[0]).toMatchObject({ materialized: true, expenseId: "generated" });
  });

  it("skips consecutive exceptions when calculating the next occurrence", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id, null, { start_date: "2026-06-01", end_date: null });
    exceptionFixture(rule, "2026-06-01");
    exceptionFixture(rule, "2026-06-08", { id: "second" });
    expect(nextOccurrenceWithExceptions(rule, "2026-06-01")).toBe("2026-06-15");
  });

  it("uses an override date as the effective next occurrence", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id, null, { start_date: "2026-06-01", end_date: null });
    exceptionFixture(rule, "2026-06-01", { action: "override", override_date: "2026-06-03" });
    expect(nextOccurrenceWithExceptions(rule, "2026-06-01")).toBe("2026-06-03");
  });
});

describe("exception-aware materialization", () => {
  beforeEach(() => freshDatabase());
  afterEach(() => jest.useRealTimers());
  afterAll(() => cleanupDatabases());

  it("advances over a skipped date and generates surrounding occurrences", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    exceptionFixture(rule, "2026-06-08");
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    runDueOccurrences(space.id);
    const generated = db.table("expenses").where((expense) => expense.recurring_expense_id === rule.id);
    expect(generated.map((expense) => expense.recurring_occurrence_date)).toEqual(["2026-06-01", "2026-06-15"]);
    expect(db.table("recurring_expenses").find(rule.id).last_generated_date).toBe("2026-06-15");
  });

  it("materializes all override fields on only the targeted expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const alternate = await createCategory(owner.token, space.id, { name: "Alternate" });
    const rule = ruleFixture(space.id);
    exceptionFixture(rule, "2026-06-08", {
      action: "override", override_date: "2026-06-10", override_amount: 175,
      override_category_id: alternate.id, override_vendor: "Changed vendor",
    });
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    runDueOccurrences(space.id);
    const target = db.table("expenses").where((expense) => expense.recurring_occurrence_date === "2026-06-08")[0];
    expect(target).toMatchObject({ payment_date: "2026-06-10", amount: 175, category_id: alternate.id, vendor: "Changed vendor" });
    expect(db.table("expenses").where((expense) => expense.recurring_occurrence_date === "2026-06-15")[0].vendor).toBe("Original vendor");
  });

  it("defers a later-date override and materializes it when effective", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    exceptionFixture(rule, "2026-06-08", { action: "override", override_date: "2026-06-20" });
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    runDueOccurrences(space.id);
    expect(db.table("expenses").where((expense) => expense.recurring_occurrence_date === "2026-06-08")).toEqual([]);
    jest.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
    runDueOccurrences(space.id);
    expect(db.table("expenses").where((expense) => expense.recurring_occurrence_date === "2026-06-08")[0].payment_date).toBe("2026-06-20");
  });

  it("is idempotent across repeated generation calls", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    runDueOccurrences(space.id);
    runDueOccurrences(space.id);
    expect(db.table("expenses").where((expense) => expense.recurring_expense_id === rule.id)).toHaveLength(3);
  });

  it("generates a previously skipped date after its exception is removed", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    const exception = exceptionFixture(rule, "2026-06-08");
    jest.useFakeTimers().setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    runDueOccurrences(space.id);
    db.table("recurring_expense_exceptions").update(exception.id, { status: "removed" });
    runDueOccurrences(space.id);
    expect(db.table("expenses").where((expense) => expense.recurring_occurrence_date === "2026-06-08")).toHaveLength(1);
  });
});

describe("recurring exception API policy", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("rejects an occurrence date that is not on the rule schedule", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { startDate: "2099-01-01", endDate: "2099-02-01", frequency: "weekly" });
    const response = await api().post(`/api/recurring-expenses/${rule.id}/exceptions`).set(owner.headers).send({ occurrenceDate: "2099-01-02", action: "skip" });
    expect(response.status).toBe(400);
  });

  it("lets a finance manager manage exceptions", async () => {
    const owner = await registerUser();
    const manager = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, manager, "finance_manager");
    const rule = await createRecurringExpense(owner.token, space.id, { startDate: "2099-01-01", endDate: "2099-02-01", frequency: "weekly" });
    const created = await api().post(`/api/recurring-expenses/${rule.id}/exceptions`).set(manager.headers).send({ occurrenceDate: "2099-01-01", action: "skip" });
    expect(created.status).toBe(201);
    expect((await api().delete(`/api/recurring-expense-exceptions/${created.body.exception.id}`).set(manager.headers)).status).toBe(204);
  });

  it("returns 404 for unknown rules and exceptions", async () => {
    const owner = await registerUser();
    expect((await api().get("/api/recurring-expenses/missing/occurrences").set(owner.headers)).status).toBe(404);
    expect((await api().post("/api/recurring-expense-exceptions/missing/restore").set(owner.headers)).status).toBe(404);
  });

  it("rejects exception mutations after the occurrence is materialized", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = ruleFixture(space.id);
    const exception = exceptionFixture(rule, "2026-06-08", { id: "final-exception" });
    db.table("expenses").insert({
      id: "generated-final", life_space_id: space.id, recurring_expense_id: rule.id,
      recurring_occurrence_date: "2026-06-08", payment_date: "2026-06-08", amount: 100,
    });

    const create = await api().post(`/api/recurring-expenses/${rule.id}/exceptions`).set(owner.headers)
      .send({ occurrenceDate: "2026-06-08", action: "skip" });
    const update = await api().patch(`/api/recurring-expense-exceptions/${exception.id}`).set(owner.headers)
      .send({ action: "override", overrideAmount: 90 });
    const remove = await api().delete(`/api/recurring-expense-exceptions/${exception.id}`).set(owner.headers);

    expect([create.status, update.status, remove.status]).toEqual([409, 409, 409]);
    expect(update.body.error).toMatch(/materialized/i);
  });
});
