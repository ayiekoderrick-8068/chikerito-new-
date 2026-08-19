const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
} = require("./helpers/factories");

describe("POST /api/lifespaces/:id/expenses", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("records an expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers)
      .send({ vendor: "Grand Hall", amount: 1200, notes: "Deposit" });
    expect(res.status).toBe(201);
    expect(res.body.expense).toMatchObject({
      life_space_id: space.id,
      vendor: "Grand Hall",
      amount: 1200,
      notes: "Deposit",
    });
  });

  it("defaults status to paid and category to null", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    expect(expense.status).toBe("paid");
    expect(expense.category_id).toBeNull();
    expect(expense.invoice_url).toBeNull();
    expect(expense.receipt_url).toBeNull();
    expect(expense.notes).toBe("");
  });

  it("defaults the payment date to today", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    expect(expense.payment_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("keeps an explicit payment date", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id, {
      paymentDate: "2026-03-14",
    });
    expect(expense.payment_date).toBe("2026-03-14");
  });

  it("maps camelCase input onto snake_case columns", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const expense = await createExpense(owner.token, space.id, {
      categoryId: category.id,
      invoiceUrl: "inv-7.pdf",
      receiptUrl: "rec-7.jpg",
    });
    expect(expense.category_id).toBe(category.id);
    expect(expense.invoice_url).toBe("inv-7.pdf");
    expect(expense.receipt_url).toBe("rec-7.jpg");
  });

  it("coerces a numeric string amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id, { amount: "349" });
    expect(expense.amount).toBe(349);
  });

  it("requires a vendor", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers)
      .send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("requires an amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers)
      .send({ vendor: "Grand Hall" });
    expect(res.status).toBe(400);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .send({ vendor: "X", amount: 1 });
    expect(res.status).toBe(401);
  });
});

// plannedAmount didn't exist in the old snapshot this suite was adapted
// from — it's current-only budget-vs-actual tracking.
describe("planned vs. actual amount", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("accepts a plannedAmount-only expense with no amount paid yet", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers)
      .send({ vendor: "Caterer", plannedAmount: 2000 });
    expect(res.status).toBe(201);
    expect(res.body.expense.planned_amount).toBe(2000);
    expect(res.body.expense.amount).toBe(0);
  });

  it("defaults status to pending when only plannedAmount is given", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers)
      .send({ vendor: "Caterer", plannedAmount: 2000 });
    expect(res.body.expense.status).toBe("pending");
  });

  it("defaults plannedAmount to the paid amount when none is given", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id, { amount: 300 });
    expect(expense.planned_amount).toBe(300);
  });

  it("keeps an explicit plannedAmount independent of a smaller paid amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers)
      .send({ vendor: "Caterer", amount: 500, plannedAmount: 2000 });
    expect(res.body.expense.amount).toBe(500);
    expect(res.body.expense.planned_amount).toBe(2000);
  });

  it("coerces a numeric string plannedAmount on update", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({ plannedAmount: "1500" });
    expect(res.body.expense.planned_amount).toBe(1500);
  });
});

describe("expense notifications", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  function notifications(lifeSpaceId) {
    return rawState().notifications.filter((n) => n.life_space_id === lifeSpaceId);
  }

  it("raises an expense_added notification", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { vendor: "Florist", amount: 75 });
    const added = notifications(space.id).filter((n) => n.type === "expense_added");
    expect(added).toHaveLength(1);
    expect(added[0].message).toContain("Florist");
    expect(added[0].message).toContain("75.00");
  });

  it("creates notifications unread", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id);
    expect(notifications(space.id).every((n) => n.read === false)).toBe(true);
  });

  it("warns when an expense pushes a category over budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 150, categoryId: category.id });
    const warnings = notifications(space.id).filter((n) => n.type === "budget_warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("50.00");
  });

  it("warns on the cumulative total, not just a single expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 60, categoryId: category.id });
    expect(notifications(space.id).filter((n) => n.type === "budget_warning")).toHaveLength(0);
    await createExpense(owner.token, space.id, { amount: 60, categoryId: category.id });
    expect(notifications(space.id).filter((n) => n.type === "budget_warning")).toHaveLength(1);
  });

  it("does not warn when spending lands exactly on budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 100, categoryId: category.id });
    expect(notifications(space.id).filter((n) => n.type === "budget_warning")).toHaveLength(0);
  });

  it("does not warn for a zero-budget category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 0 });
    await createExpense(owner.token, space.id, { amount: 500, categoryId: category.id });
    expect(notifications(space.id).filter((n) => n.type === "budget_warning")).toHaveLength(0);
  });

  it("does not warn for an uncategorised expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { amount: 5000 });
    expect(notifications(space.id).filter((n) => n.type === "budget_warning")).toHaveLength(0);
  });
});

describe("GET /api/lifespaces/:id/expenses", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns an empty list before any expense exists", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .get(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toEqual([]);
  });

  it("returns only the expenses of the requested life space", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    await createExpense(owner.token, a.id, { vendor: "In A" });
    await createExpense(owner.token, b.id, { vendor: "In B" });
    const res = await api()
      .get(`/api/lifespaces/${a.id}/expenses`)
      .set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("In A");
  });

  it("returns the newest expense first", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await createExpense(owner.token, space.id, { vendor: "First" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createExpense(owner.token, space.id, { vendor: "Second" });
    const res = await api()
      .get(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers);
    expect(res.body.expenses.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/expenses`);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/expenses/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("updates the vendor", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id, { vendor: "Old" });
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({ vendor: "New" });
    expect(res.status).toBe(200);
    expect(res.body.expense.vendor).toBe("New");
  });

  it("coerces an updated amount to a number", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({ amount: "412" });
    expect(res.body.expense.amount).toBe(412);
  });

  it("maps camelCase patch keys onto their columns", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const expense = await createExpense(owner.token, space.id);
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({
        categoryId: category.id,
        invoiceUrl: "i.pdf",
        receiptUrl: "r.jpg",
        paymentDate: "2026-01-02",
      });
    expect(res.body.expense).toMatchObject({
      category_id: category.id,
      invoice_url: "i.pdf",
      receipt_url: "r.jpg",
      payment_date: "2026-01-02",
    });
  });

  it("changes the status", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({ status: "overdue" });
    expect(res.body.expense.status).toBe("overdue");
  });

  it("leaves unmentioned fields untouched", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id, {
      vendor: "Keep",
      amount: 300,
    });
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({ notes: "Just a note" });
    expect(res.body.expense.vendor).toBe("Keep");
    expect(res.body.expense.amount).toBe(300);
  });

  it("ignores keys outside the allow-list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api()
      .patch(`/api/expenses/${expense.id}`)
      .set(owner.headers)
      .send({ life_space_id: "somewhere-else", id: "new-id" });
    expect(res.body.expense.life_space_id).toBe(space.id);
    expect(res.body.expense.id).toBe(expense.id);
  });

  it("404s for an unknown expense", async () => {
    const owner = await registerUser();
    const res = await api()
      .patch("/api/expenses/no-such-id")
      .set(owner.headers)
      .send({ vendor: "X" });
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api().patch(`/api/expenses/${expense.id}`).send({ vendor: "X" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/expenses/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("deletes the expense and returns 204", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api().delete(`/api/expenses/${expense.id}`).set(owner.headers);
    expect(res.status).toBe(204);
    const list = await api()
      .get(`/api/lifespaces/${space.id}/expenses`)
      .set(owner.headers);
    expect(list.body.expenses).toEqual([]);
  });

  it("releases the category spend it was counted against", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    const expense = await createExpense(owner.token, space.id, {
      amount: 400,
      categoryId: category.id,
    });
    await api().delete(`/api/expenses/${expense.id}`).set(owner.headers);
    const res = await api()
      .get(`/api/lifespaces/${space.id}/categories`)
      .set(owner.headers);
    expect(res.body.categories[0].spent).toBe(0);
    expect(res.body.categories[0].remainingBudget).toBe(1000);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const expense = await createExpense(owner.token, space.id);
    const res = await api().delete(`/api/expenses/${expense.id}`);
    expect(res.status).toBe(401);
  });
});
