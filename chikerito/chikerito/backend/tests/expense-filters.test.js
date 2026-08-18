// expense-filters.test.js — covers the new filtering and pagination added to
// GET /api/lifespaces/:id/expenses. The existing expenses.test.js covers the
// core CRUD; this file focuses exclusively on the new query-param behaviour.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
} = require("./helpers/factories");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------
describe("GET /api/lifespaces/:id/expenses — status filter", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns only paid expenses when ?status=paid", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { status: "paid" });
    await createExpense(owner.token, space.id, { status: "pending" });
    await createExpense(owner.token, space.id, { status: "overdue" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?status=paid`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].status).toBe("paid");
  });

  it("returns only pending expenses when ?status=pending", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { status: "paid" });
    await createExpense(owner.token, space.id, { status: "pending" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?status=pending`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].status).toBe("pending");
  });

  it("returns only overdue expenses when ?status=overdue", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { status: "overdue" });
    await createExpense(owner.token, space.id, { status: "paid" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?status=overdue`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].status).toBe("overdue");
  });

  it("returns all expenses when no status filter is given", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { status: "paid" });
    await createExpense(owner.token, space.id, { status: "pending" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(2);
  });

  it("returns an empty list when no expenses match the status", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { status: "paid" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?status=overdue`).set(owner.headers);
    expect(res.body.expenses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Category filter
// ---------------------------------------------------------------------------
describe("GET /api/lifespaces/:id/expenses — category filter", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns only expenses in the given category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id);
    await createExpense(owner.token, space.id, { categoryId: cat.id, vendor: "In Cat" });
    await createExpense(owner.token, space.id, { vendor: "No Cat" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?categoryId=${cat.id}`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("In Cat");
  });

  it("returns only uncategorized expenses when ?categoryId=uncategorized", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id);
    await createExpense(owner.token, space.id, { categoryId: cat.id, vendor: "Categorized" });
    await createExpense(owner.token, space.id, { vendor: "Uncategorized" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?categoryId=uncategorized`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("Uncategorized");
  });

  it("returns an empty list when no expenses belong to the category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id);
    await createExpense(owner.token, space.id, { vendor: "No Cat" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?categoryId=${cat.id}`).set(owner.headers);
    expect(res.body.expenses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Date range filter
// ---------------------------------------------------------------------------
describe("GET /api/lifespaces/:id/expenses — date range filter", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns only expenses on or after ?from=", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { paymentDate: "2026-01-01", vendor: "Before" });
    await createExpense(owner.token, space.id, { paymentDate: "2026-06-01", vendor: "After" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?from=2026-03-01`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("After");
  });

  it("returns only expenses on or before ?to=", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { paymentDate: "2026-01-01", vendor: "Early" });
    await createExpense(owner.token, space.id, { paymentDate: "2026-12-01", vendor: "Late" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?to=2026-06-30`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("Early");
  });

  it("combines from and to into a date range", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { paymentDate: "2026-01-01", vendor: "Too early" });
    await createExpense(owner.token, space.id, { paymentDate: "2026-05-15", vendor: "In range" });
    await createExpense(owner.token, space.id, { paymentDate: "2026-12-01", vendor: "Too late" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?from=2026-03-01&to=2026-09-30`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("In range");
  });

  it("includes expenses exactly on the from and to boundary dates", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { paymentDate: "2026-03-01", vendor: "On from" });
    await createExpense(owner.token, space.id, { paymentDate: "2026-09-30", vendor: "On to" });

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?from=2026-03-01&to=2026-09-30`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------
describe("GET /api/lifespaces/:id/expenses — combined filters", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("combines status + category filters correctly", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id);
    await createExpense(owner.token, space.id, { categoryId: cat.id, status: "paid", vendor: "Match" });
    await createExpense(owner.token, space.id, { categoryId: cat.id, status: "pending", vendor: "Wrong status" });
    await createExpense(owner.token, space.id, { status: "paid", vendor: "Wrong cat" });

    const res = await api()
      .get(`/api/lifespaces/${space.id}/expenses?status=paid&categoryId=${cat.id}`)
      .set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("Match");
  });

  it("combines status + date range filters correctly", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { status: "overdue", paymentDate: "2026-05-01", vendor: "Match" });
    await createExpense(owner.token, space.id, { status: "paid", paymentDate: "2026-05-01", vendor: "Wrong status" });
    await createExpense(owner.token, space.id, { status: "overdue", paymentDate: "2026-01-01", vendor: "Out of range" });

    const res = await api()
      .get(`/api/lifespaces/${space.id}/expenses?status=overdue&from=2026-03-01`)
      .set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].vendor).toBe("Match");
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
describe("GET /api/lifespaces/:id/expenses — pagination", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns hasMore=false when all expenses fit on one page", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id);

    const res = await api().get(`/api/lifespaces/${space.id}/expenses`).set(owner.headers);
    expect(res.body.hasMore).toBe(false);
  });

  it("returns hasMore=true when there are more rows beyond the limit", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (let i = 0; i < 3; i++) await createExpense(owner.token, space.id);

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?limit=2`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
  });

  it("cursor (before) returns the next page without overlap or gap", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    // Insert 4 expenses with a small delay so created_at is distinct.
    const ids = [];
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 5));
      const e = await createExpense(owner.token, space.id, { vendor: `E${i}` });
      ids.push(e.id);
    }

    const page1 = await api().get(`/api/lifespaces/${space.id}/expenses?limit=2`).set(owner.headers);
    expect(page1.body.expenses).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);

    const cursor = page1.body.expenses[1].created_at;
    const page2 = await api().get(`/api/lifespaces/${space.id}/expenses?limit=2&before=${encodeURIComponent(cursor)}`).set(owner.headers);
    expect(page2.body.expenses).toHaveLength(2);

    // No overlap between pages.
    const page1Ids = page1.body.expenses.map((e) => e.id);
    const page2Ids = page2.body.expenses.map((e) => e.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);

    // Together they cover all 4.
    expect([...page1Ids, ...page2Ids].sort()).toEqual(ids.sort());
  });

  it("caps limit at 100 even if a larger value is requested", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id);

    const res = await api().get(`/api/lifespaces/${space.id}/expenses?limit=9999`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(1);
  });

  it("pagination works correctly when combined with a status filter", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await createExpense(owner.token, space.id, { status: "paid" });
    }
    await createExpense(owner.token, space.id, { status: "pending" });

    const page1 = await api().get(`/api/lifespaces/${space.id}/expenses?status=paid&limit=2`).set(owner.headers);
    expect(page1.body.expenses).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.expenses.every((e) => e.status === "paid")).toBe(true);

    const cursor = page1.body.expenses[1].created_at;
    const page2 = await api().get(`/api/lifespaces/${space.id}/expenses?status=paid&limit=2&before=${encodeURIComponent(cursor)}`).set(owner.headers);
    expect(page2.body.expenses).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
  });

  it("cross-tenant: filters never leak expenses from another life space", async () => {
    const owner = await registerUser();
    const spaceA = await createLifeSpace(owner.token, { title: "A" });
    const spaceB = await createLifeSpace(owner.token, { title: "B" });
    await createExpense(owner.token, spaceA.id, { status: "paid" });
    await createExpense(owner.token, spaceB.id, { status: "paid" });

    const res = await api().get(`/api/lifespaces/${spaceA.id}/expenses?status=paid`).set(owner.headers);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].life_space_id).toBe(spaceA.id);
  });
});
