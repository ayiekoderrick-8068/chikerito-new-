// recurring-expenses.js has no equivalent anywhere earlier — new baseline
// coverage for a new feature, not an adaptation.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createRecurringExpense,
  addTeamMember,
} = require("./helpers/factories");
const { addInterval, dueDates, nextOccurrence } = require("../recurrence");

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pure date math — fully deterministic, hardcoded dates, no clock involved.
// ---------------------------------------------------------------------------
describe("recurrence date math", () => {
  it("weekly adds 7 days", () => {
    expect(addInterval("2026-06-01", "weekly")).toBe("2026-06-08");
  });

  it("biweekly adds 14 days", () => {
    expect(addInterval("2026-06-01", "biweekly")).toBe("2026-06-15");
  });

  it("monthly adds one calendar month on an ordinary day", () => {
    expect(addInterval("2026-06-15", "monthly")).toBe("2026-07-15");
  });

  it("monthly clamps to the last day of a shorter target month", () => {
    expect(addInterval("2026-01-31", "monthly")).toBe("2026-02-28");
  });

  it("monthly clamps correctly into a leap February", () => {
    expect(addInterval("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("quarterly adds three calendar months", () => {
    expect(addInterval("2026-01-31", "quarterly")).toBe("2026-04-30");
  });

  it("yearly adds twelve months and lands on Feb 28 the following (non-leap) year from a leap day", () => {
    expect(addInterval("2028-02-29", "yearly")).toBe("2029-02-28");
  });

  it("yearly on an ordinary date just advances the year", () => {
    expect(addInterval("2026-03-10", "yearly")).toBe("2027-03-10");
  });

  it("rejects an unknown frequency", () => {
    expect(() => addInterval("2026-01-01", "daily")).toThrow(/unknown frequency/i);
  });

  it("dueDates is empty when start_date is after the reference today", () => {
    const dates = dueDates({ start_date: "2026-06-10", frequency: "weekly", last_generated_date: null, end_date: null }, "2026-06-01");
    expect(dates).toEqual([]);
  });

  it("dueDates includes start_date itself on the first run", () => {
    const dates = dueDates({ start_date: "2026-06-01", frequency: "weekly", last_generated_date: null, end_date: null }, "2026-06-01");
    expect(dates).toEqual(["2026-06-01"]);
  });

  it("dueDates continues forward from last_generated_date without repeating it", () => {
    const dates = dueDates({ start_date: "2026-01-01", frequency: "weekly", last_generated_date: "2026-06-01", end_date: null }, "2026-06-15");
    expect(dates).toEqual(["2026-06-08", "2026-06-15"]);
  });

  it("dueDates stops at end_date even if today is later", () => {
    const dates = dueDates({ start_date: "2026-06-01", frequency: "weekly", last_generated_date: null, end_date: "2026-06-10" }, "2026-12-31");
    expect(dates).toEqual(["2026-06-01", "2026-06-08"]);
  });

  it("nextOccurrence is null for a paused or stopped rule", () => {
    expect(nextOccurrence({ status: "paused", start_date: "2026-01-01", frequency: "monthly", last_generated_date: null })).toBeNull();
    expect(nextOccurrence({ status: "stopped", start_date: "2026-01-01", frequency: "monthly", last_generated_date: null })).toBeNull();
  });

  it("nextOccurrence is null once past end_date", () => {
    const result = nextOccurrence(
      { status: "active", start_date: "2026-01-01", frequency: "monthly", last_generated_date: "2026-05-01", end_date: "2026-05-15" },
      "2026-06-01"
    );
    expect(result).toBeNull();
  });

  it("nextOccurrence advances from last_generated_date for an active rule", () => {
    const result = nextOccurrence(
      { status: "active", start_date: "2026-01-01", frequency: "monthly", last_generated_date: "2026-05-01", end_date: null },
      "2026-06-01"
    );
    expect(result).toBe("2026-06-01");
  });
});

// ---------------------------------------------------------------------------
// Create / edit / validation
// ---------------------------------------------------------------------------
describe("POST /api/lifespaces/:id/recurring-expenses", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a recurring expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { vendor: "Storage Unit", amount: 75, frequency: "monthly" });
    expect(rule).toMatchObject({ life_space_id: space.id, vendor: "Storage Unit", amount: 75, frequency: "monthly", status: "active" });
  });

  it("links an optional category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const rule = await createRecurringExpense(owner.token, space.id, { categoryId: category.id });
    expect(rule.category_id).toBe(category.id);
  });

  it("defaults category to null when omitted", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id);
    expect(rule.category_id).toBeNull();
  });

  it("rejects a missing vendor", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ amount: 50, frequency: "weekly", startDate: "2026-06-01" });
    expect(res.status).toBe(400);
  });

  it("rejects a zero amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ vendor: "X", amount: 0, frequency: "weekly", startDate: "2026-06-01" });
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ vendor: "X", amount: -50, frequency: "weekly", startDate: "2026-06-01" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ vendor: "X", amount: "lots", frequency: "weekly", startDate: "2026-06-01" });
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognised frequency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ vendor: "X", amount: 50, frequency: "daily", startDate: "2026-06-01" });
    expect(res.status).toBe(400);
  });

  it.each(["weekly", "biweekly", "monthly", "quarterly", "yearly"])("accepts frequency=%s", async (frequency) => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ vendor: "X", amount: 50, frequency, startDate: daysAgo(0) });
    expect(res.status).toBe(201);
    expect(res.body.recurringExpense.frequency).toBe(frequency);
  });

  it("rejects a missing or malformed startDate", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({ vendor: "X", amount: 50, frequency: "weekly", startDate: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed endDate", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({ vendor: "X", amount: 50, frequency: "weekly", startDate: "2026-06-01", endDate: "whenever" });
    expect(res.status).toBe(400);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).send({ vendor: "X", amount: 50, frequency: "weekly", startDate: "2026-06-01" });
    expect(res.status).toBe(401);
  });

  it("404s an unknown life space", async () => {
    const owner = await registerUser();
    const res = await api().post("/api/lifespaces/no-such-id/recurring-expenses").set(owner.headers).send({ vendor: "X", amount: 50, frequency: "weekly", startDate: "2026-06-01" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/recurring-expenses/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("updates vendor, amount, category, and frequency", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const rule = await createRecurringExpense(owner.token, space.id, { vendor: "Old", amount: 10, frequency: "weekly" });

    const res = await api()
      .patch(`/api/recurring-expenses/${rule.id}`)
      .set(owner.headers)
      .send({ vendor: "New", amount: 20, categoryId: category.id, frequency: "monthly" });

    expect(res.status).toBe(200);
    expect(res.body.recurringExpense).toMatchObject({ vendor: "New", amount: 20, category_id: category.id, frequency: "monthly" });
  });

  it("rejects patching amount to zero or negative", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id);
    const res = await api().patch(`/api/recurring-expenses/${rule.id}`).set(owner.headers).send({ amount: -5 });
    expect(res.status).toBe(400);
  });

  it("leaves unmentioned fields untouched", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { vendor: "Keep", amount: 30 });
    const res = await api().patch(`/api/recurring-expenses/${rule.id}`).set(owner.headers).send({ frequency: "yearly" });
    expect(res.body.recurringExpense.vendor).toBe("Keep");
    expect(res.body.recurringExpense.amount).toBe(30);
  });

  it("404s an unknown id", async () => {
    const owner = await registerUser();
    const res = await api().patch("/api/recurring-expenses/no-such-id").set(owner.headers).send({ vendor: "X" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Occurrence generation and idempotency — deterministic via addInterval/
// dueDates computed relative to real "now", not hardcoded dates or a mocked
// clock, so these hold regardless of what day the suite actually runs on.
// ---------------------------------------------------------------------------
describe("occurrence generation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("generates every due weekly occurrence from start_date up to today on creation", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const startDate = daysAgo(30);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate, amount: 40 });

    const expected = dueDates({ start_date: startDate, frequency: "weekly", last_generated_date: null, end_date: null });
    const res = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const generated = res.body.expenses.filter((e) => e.recurring_expense_id === rule.id);

    expect(generated).toHaveLength(expected.length);
    expect(generated.map((e) => e.payment_date).sort()).toEqual(expected.sort());
    generated.forEach((e) => {
      expect(e.amount).toBe(40);
      expect(e.status).toBe("paid");
    });
  });

  it("does not generate anything before start_date arrives", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { startDate: daysAgo(-10) }); // 10 days in the future
    const res = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    expect(res.body.expenses.filter((e) => e.recurring_expense_id === rule.id)).toHaveLength(0);
  });

  it("does not double-generate on repeated reads (idempotent)", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate: daysAgo(21) });

    const first = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const second = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const dashboardA = await api().get(`/api/lifespaces/${space.id}/dashboard`).set(owner.headers);
    const dashboardB = await api().get(`/api/lifespaces/${space.id}/dashboard`).set(owner.headers);

    const countIn = (list) => list.filter((e) => e.recurring_expense_id === rule.id).length;
    expect(countIn(first.body.expenses)).toBe(countIn(second.body.expenses));
    expect(dashboardA.body.stats.spent).toBe(dashboardB.body.stats.spent);
  });

  it("also generates via the dashboard endpoint, not only the expenses list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate: daysAgo(14), amount: 25 });
    // createRecurringExpense's own creation already runs generation once — confirm dashboard reflects it without a separate expenses call.
    const dashboard = await api().get(`/api/lifespaces/${space.id}/dashboard`).set(owner.headers);
    const expected = dueDates({ start_date: daysAgo(14), frequency: "weekly", last_generated_date: null, end_date: null });
    expect(dashboard.body.stats.spent).toBe(expected.length * 25);
  });

  it("respects end_date — nothing generates past it", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const startDate = daysAgo(60);
    const endDate = daysAgo(40);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate, endDate });

    const expected = dueDates({ start_date: startDate, frequency: "weekly", last_generated_date: null, end_date: endDate });
    const res = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const generated = res.body.expenses.filter((e) => e.recurring_expense_id === rule.id);
    expect(generated).toHaveLength(expected.length);
    generated.forEach((e) => expect(e.payment_date <= endDate).toBe(true));
  });

  it("feeds category totals correctly, matching a manually-entered expense in the same category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    await createExpense(owner.token, space.id, { amount: 100, categoryId: category.id });
    const startDate = daysAgo(7);
    await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate, amount: 60, categoryId: category.id });

    const expected = dueDates({ start_date: startDate, frequency: "weekly", last_generated_date: null, end_date: null });
    const res = await api().get(`/api/lifespaces/${space.id}/categories`).set(owner.headers);
    const cat = res.body.categories.find((c) => c.id === category.id);
    expect(cat.spent).toBe(100 + expected.length * 60);
  });
});

// ---------------------------------------------------------------------------
// Pause / resume / stop
// ---------------------------------------------------------------------------
describe("pause / resume / stop", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("pauses an active rule", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id);
    const res = await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.recurringExpense.status).toBe("paused");
    expect(res.body.recurringExpense.nextOccurrence).toBeNull();
  });

  it("a paused rule generates nothing even with occurrences overdue", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate: daysAgo(21) });
    const before = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const beforeCount = before.body.expenses.filter((e) => e.recurring_expense_id === rule.id).length;

    await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(owner.headers);
    // Simulate more time passing while paused by rolling the cursor back.
    require("../db").table("recurring_expenses").update(rule.id, { last_generated_date: daysAgo(30) });

    const after = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const afterCount = after.body.expenses.filter((e) => e.recurring_expense_id === rule.id).length;
    expect(afterCount).toBe(beforeCount);
  });

  it("rejects pausing an already-paused rule", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id);
    await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(owner.headers);
    const res = await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(owner.headers);
    expect(res.status).toBe(409);
  });

  it("resumes a paused rule without backfilling what was missed", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate: daysAgo(21) });
    await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(owner.headers);
    require("../db").table("recurring_expenses").update(rule.id, { last_generated_date: daysAgo(60) }); // simulate a long pause

    const resumeRes = await api().post(`/api/recurring-expenses/${rule.id}/resume`).set(owner.headers);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.recurringExpense.status).toBe("active");

    const before = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const beforeCount = before.body.expenses.filter((e) => e.recurring_expense_id === rule.id).length;
    const after = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const afterCount = after.body.expenses.filter((e) => e.recurring_expense_id === rule.id).length;
    expect(afterCount).toBe(beforeCount); // resuming itself generated nothing extra
  });

  it("rejects resuming a rule that isn't paused", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id);
    const res = await api().post(`/api/recurring-expenses/${rule.id}/resume`).set(owner.headers);
    expect(res.status).toBe(409);
  });

  it("stops a rule via DELETE and it no longer generates", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate: daysAgo(21) });
    const before = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const beforeCount = before.body.expenses.filter((e) => e.recurring_expense_id === rule.id).length;

    const del = await api().delete(`/api/recurring-expenses/${rule.id}`).set(owner.headers);
    expect(del.status).toBe(204);
    require("../db").table("recurring_expenses").update(rule.id, { last_generated_date: daysAgo(60) });

    const after = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const afterCount = after.body.expenses.filter((e) => e.recurring_expense_id === rule.id).length;
    expect(afterCount).toBe(beforeCount);
  });

  it("deleting (stopping) a rule does not remove its already-generated expenses", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id, { frequency: "weekly", startDate: daysAgo(21) });
    const before = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const beforeGenerated = before.body.expenses.filter((e) => e.recurring_expense_id === rule.id);
    expect(beforeGenerated.length).toBeGreaterThan(0);

    await api().delete(`/api/recurring-expenses/${rule.id}`).set(owner.headers);

    const after = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    const afterGenerated = after.body.expenses.filter((e) => e.recurring_expense_id === rule.id);
    expect(afterGenerated.map((e) => e.id).sort()).toEqual(beforeGenerated.map((e) => e.id).sort());

    const dashboard = await api().get(`/api/lifespaces/${space.id}/dashboard`).set(owner.headers);
    expect(dashboard.body.stats.spent).toBeGreaterThanOrEqual(beforeGenerated.reduce((s, e) => s + e.amount, 0));
  });

  it("stopped rules still appear in the list, for visibility, with no next occurrence", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const rule = await createRecurringExpense(owner.token, space.id);
    await api().delete(`/api/recurring-expenses/${rule.id}`).set(owner.headers);

    const res = await api().get(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers);
    const found = res.body.recurringExpenses.find((r) => r.id === rule.id);
    expect(found.status).toBe("stopped");
    expect(found.nextOccurrence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RBAC — reusing the existing capability system
// ---------------------------------------------------------------------------
describe("authorization", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("finance_manager (has expense:manage) can create, edit, pause, resume, and delete", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const financeManager = await registerUser();
    await addTeamMember(owner.token, space.id, financeManager, "finance_manager");

    const create = await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(financeManager.headers).send({ vendor: "X", amount: 20, frequency: "weekly", startDate: daysAgo(0) });
    expect(create.status).toBe(201);
    const id = create.body.recurringExpense.id;

    expect((await api().patch(`/api/recurring-expenses/${id}`).set(financeManager.headers).send({ vendor: "Y" })).status).toBe(200);
    expect((await api().post(`/api/recurring-expenses/${id}/pause`).set(financeManager.headers)).status).toBe(200);
    expect((await api().post(`/api/recurring-expenses/${id}/resume`).set(financeManager.headers)).status).toBe(200);
    expect((await api().delete(`/api/recurring-expenses/${id}`).set(financeManager.headers)).status).toBe(204);
  });

  it.each(["event_planner", "editor", "volunteer"])("%s (no expense:manage) cannot create, edit, pause, resume, or delete", async (role) => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const member = await registerUser();
    await addTeamMember(owner.token, space.id, member, role);
    const rule = await createRecurringExpense(owner.token, space.id);

    expect((await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(member.headers).send({ vendor: "X", amount: 20, frequency: "weekly", startDate: daysAgo(0) })).status).toBe(403);
    expect((await api().patch(`/api/recurring-expenses/${rule.id}`).set(member.headers).send({ vendor: "Y" })).status).toBe(403);
    expect((await api().post(`/api/recurring-expenses/${rule.id}/pause`).set(member.headers)).status).toBe(403);
    expect((await api().delete(`/api/recurring-expenses/${rule.id}`).set(member.headers)).status).toBe(403);
  });

  it("any role, including volunteer, can view the recurring expense list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const volunteer = await registerUser();
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    await createRecurringExpense(owner.token, space.id);

    const res = await api().get(`/api/lifespaces/${space.id}/recurring-expenses`).set(volunteer.headers);
    expect(res.status).toBe(200);
    expect(res.body.recurringExpenses).toHaveLength(1);
  });

  it("403s a non-member entirely, 404s an unknown life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();
    expect((await api().get(`/api/lifespaces/${space.id}/recurring-expenses`).set(stranger.headers)).status).toBe(403);
    expect((await api().get("/api/lifespaces/no-such-id/recurring-expenses").set(owner.headers)).status).toBe(404);
  });
});

describe("cross-tenant isolation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("a finance_manager of space A cannot edit, pause, or delete a rule belonging to space B", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token, { title: "A" });
    const financeManagerA = await registerUser();
    await addTeamMember(ownerA.token, spaceA.id, financeManagerA, "finance_manager");

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token, { title: "B" });
    const ruleB = await createRecurringExpense(ownerB.token, spaceB.id);

    expect((await api().patch(`/api/recurring-expenses/${ruleB.id}`).set(financeManagerA.headers).send({ vendor: "Hijacked" })).status).toBe(403);
    expect((await api().post(`/api/recurring-expenses/${ruleB.id}/pause`).set(financeManagerA.headers)).status).toBe(403);
    expect((await api().delete(`/api/recurring-expenses/${ruleB.id}`).set(financeManagerA.headers)).status).toBe(403);
  });

  it("space A's recurring expenses never appear in space B's list", async () => {
    const owner = await registerUser();
    const spaceA = await createLifeSpace(owner.token, { title: "A" });
    const spaceB = await createLifeSpace(owner.token, { title: "B" });
    await createRecurringExpense(owner.token, spaceA.id);

    const res = await api().get(`/api/lifespaces/${spaceB.id}/recurring-expenses`).set(owner.headers);
    expect(res.body.recurringExpenses).toEqual([]);
  });
});
