const { v4: uuid } = require("uuid");
const db = require("../db");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, registerUser, createLifeSpace, createCategory, addTeamMember } = require("./helpers/factories");
const { validDate, previousRange, percentChange } = require("../analytics");

function expense(space, overrides = {}) {
  return db.table("expenses").insert({
    id: uuid(), life_space_id: space.id, category_id: null, vendor: "Vendor", planned_amount: 0,
    amount: 100, invoice_url: null, receipt_url: "receipt", payment_date: "2026-04-10",
    status: "paid", notes: "", created_at: "2026-04-10T12:00:00.000Z", ...overrides,
  });
}

function contribution(space, overrides = {}) {
  return db.table("contributions").insert({
    id: uuid(), life_space_id: space.id, category_id: null, contributor_name: "Donor", amount: 100,
    message: "", payment_method: "card", status: "completed", notes: "", source: "manual",
    created_at: "2026-04-10T12:00:00.000Z", ...overrides,
  });
}

function analytics(owner, space, query = "") {
  return api().get(`/api/lifespaces/${space.id}/analytics${query}`).set(owner.headers);
}

describe("analytics date helpers", () => {
  it.each(["2026-01-01", "2024-02-29", "2099-12-31"])("accepts valid date %s", (date) => expect(validDate(date)).toBe(true));
  it.each(["", "2026-1-01", "2026-02-30", "not-a-date", null])("rejects invalid date %s", (date) => expect(validDate(date)).toBe(false));
  it("calculates an inclusive previous period", () => expect(previousRange("2026-04-10", "2026-04-12")).toEqual({ from: "2026-04-07", to: "2026-04-09" }));
  it("returns null without a complete range", () => expect(previousRange("2026-04-10", undefined)).toBeNull());
  it("calculates signed percentage changes", () => { expect(percentChange(150, 100)).toBe(50); expect(percentChange(50, 100)).toBe(-50); });
  it("handles zero comparison values without infinity", () => { expect(percentChange(0, 0)).toBe(0); expect(percentChange(10, 0)).toBeNull(); });
});

describe("GET /api/lifespaces/:id/analytics — access and validation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("requires authentication", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await api().get(`/api/lifespaces/${space.id}/analytics`)).status).toBe(401);
  });

  it("404s an unknown life space", async () => {
    const owner = await registerUser();
    expect((await api().get("/api/lifespaces/unknown/analytics").set(owner.headers)).status).toBe(404);
  });

  it("403s a non-member", async () => {
    const owner = await registerUser(); const stranger = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await analytics(stranger, space)).status).toBe(403);
  });

  it("allows every member role to view analytics", async () => {
    const owner = await registerUser(); const member = await registerUser(); const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, member, "volunteer");
    expect((await analytics(member, space)).status).toBe(200);
  });

  it.each(["from=bad", "from=2026-02-30", "to=2026-2-01"])("rejects invalid dates: %s", async (query) => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await analytics(owner, space, `?${query}`)).status).toBe(400);
  });

  it("rejects a reversed range", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    const res = await analytics(owner, space, "?from=2026-05-01&to=2026-04-01");
    expect(res.status).toBe(400); expect(res.body.error).toMatch(/on or before/);
  });

  it("rejects an unknown comparison mode", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await analytics(owner, space, "?comparison=year")).status).toBe(400);
  });

  it("requires a complete range for previous comparison", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await analytics(owner, space, "?from=2026-01-01&comparison=previous")).status).toBe(400);
  });

  it("rejects a category from another tenant", async () => {
    const owner = await registerUser(); const a = await createLifeSpace(owner.token); const b = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, b.id);
    const res = await analytics(owner, a, `?categoryId=${category.id}`);
    expect(res.status).toBe(400); expect(res.body.error).toMatch(/belong/);
  });
});

describe("GET /api/lifespaces/:id/analytics — summaries", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns a stable empty response", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token, { currency: "KES" });
    const res = await analytics(owner, space);
    expect(res.status).toBe(200);
    expect(res.body.analytics).toMatchObject({ currency: "KES", summary: { spent: 0, raised: 0, net: 0, expenseCount: 0, contributionCount: 0, averageExpense: 0 } });
    expect(res.body.analytics.monthlyTrend).toEqual([]); expect(res.body.analytics.topVendors).toEqual([]);
  });

  it("calculates headline metrics", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { amount: 100 }); expense(space, { amount: 50 }); contribution(space, { amount: 300 });
    const summary = (await analytics(owner, space)).body.analytics.summary;
    expect(summary).toMatchObject({ spent: 150, raised: 300, net: 150, expenseCount: 2, contributionCount: 1, averageExpense: 75 });
    expect(summary.largestExpense).toBe(100); expect(summary.largestContribution).toBe(300);
  });

  it("calculates daily average only for a bounded range", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); expense(space, { amount: 90, payment_date: "2026-04-02" });
    const bounded = (await analytics(owner, space, "?from=2026-04-01&to=2026-04-03")).body.analytics.summary;
    const allTime = (await analytics(owner, space)).body.analytics.summary;
    expect(bounded).toMatchObject({ durationDays: 3, dailyAverageSpent: 30 }); expect(allTime.dailyAverageSpent).toBeNull();
  });

  it("counts completed contributions only", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    for (const status of ["completed", "pending", "failed", "refunded", "voided"]) contribution(space, { status, amount: 40 });
    const summary = (await analytics(owner, space)).body.analytics.summary;
    expect(summary.raised).toBe(40); expect(summary.contributionCount).toBe(1);
  });

  it("sums category budgets and variance", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    const a = await createCategory(owner.token, space.id, { budgetAmount: 500 }); const b = await createCategory(owner.token, space.id, { budgetAmount: 300 });
    expense(space, { amount: 125, category_id: a.id }); expense(space, { amount: 75, category_id: b.id });
    expect((await analytics(owner, space)).body.analytics.summary).toMatchObject({ budget: 800, spent: 200, variance: 600 });
  });

  it("filters expenses inclusively by date", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { amount: 10, payment_date: "2026-03-31" }); expense(space, { amount: 20, payment_date: "2026-04-01" }); expense(space, { amount: 30, payment_date: "2026-04-30" }); expense(space, { amount: 40, payment_date: "2026-05-01" });
    const summary = (await analytics(owner, space, "?from=2026-04-01&to=2026-04-30")).body.analytics.summary;
    expect(summary.spent).toBe(50); expect(summary.expenseCount).toBe(2);
  });

  it("filters completed contributions by created date", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    contribution(space, { amount: 10, created_at: "2026-03-31T23:00:00.000Z" }); contribution(space, { amount: 20, created_at: "2026-04-01T00:00:00.000Z" });
    expect((await analytics(owner, space, "?from=2026-04-01&to=2026-04-30")).body.analytics.summary.raised).toBe(20);
  });

  it("filters both financial streams by category", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    const a = await createCategory(owner.token, space.id, { name: "A", budgetAmount: 100 }); const b = await createCategory(owner.token, space.id, { name: "B", budgetAmount: 200 });
    expense(space, { amount: 60, category_id: a.id }); expense(space, { amount: 90, category_id: b.id }); contribution(space, { amount: 80, category_id: a.id }); contribution(space, { amount: 120, category_id: b.id });
    const result = (await analytics(owner, space, `?categoryId=${a.id}`)).body.analytics;
    expect(result.summary).toMatchObject({ spent: 60, raised: 80, budget: 100 }); expect(result.categoryBreakdown.map((row) => row.id)).toEqual([a.id]);
  });

  it("never includes another tenant's rows", async () => {
    const owner = await registerUser(); const a = await createLifeSpace(owner.token); const b = await createLifeSpace(owner.token);
    expense(a, { amount: 25 }); expense(b, { amount: 900 }); contribution(a, { amount: 50 }); contribution(b, { amount: 1000 });
    expect((await analytics(owner, a)).body.analytics.summary).toMatchObject({ spent: 25, raised: 50 });
  });
});

describe("GET /api/lifespaces/:id/analytics — breakdowns and comparison", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("orders categories by spent, then name", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    const z = await createCategory(owner.token, space.id, { name: "Zulu" }); const a = await createCategory(owner.token, space.id, { name: "Alpha" });
    expense(space, { category_id: z.id, amount: 50 }); expense(space, { category_id: a.id, amount: 50 });
    expect((await analytics(owner, space)).body.analytics.categoryBreakdown.map((row) => row.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("reports category budget utilization and negative variance", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); const cat = await createCategory(owner.token, space.id, { budgetAmount: 80 });
    expense(space, { category_id: cat.id, amount: 100 });
    expect((await analytics(owner, space)).body.analytics.categoryBreakdown[0]).toMatchObject({ spent: 100, variance: -20, utilization: 125 });
  });

  it("uses null utilization for a zero budget", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); await createCategory(owner.token, space.id, { budgetAmount: 0 });
    expect((await analytics(owner, space)).body.analytics.categoryBreakdown[0].utilization).toBeNull();
  });

  it("groups monthly trends chronologically", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { amount: 20, payment_date: "2026-05-01" }); expense(space, { amount: 10, payment_date: "2026-03-01" }); expense(space, { amount: 30, payment_date: "2026-05-20" });
    expect((await analytics(owner, space)).body.analytics.monthlyTrend).toEqual([{ month: "2026-03", total: 10 }, { month: "2026-05", total: 50 }]);
  });

  it("groups statuses deterministically", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { status: "paid" }); expense(space, { status: "pending" }); expense(space, { status: "paid" });
    expect((await analytics(owner, space)).body.analytics.statusBreakdown).toEqual([{ status: "paid", count: 2 }, { status: "pending", count: 1 }]);
  });

  it("returns the top five vendors by spend with stable ties", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    for (const [vendor, amount] of [["Zulu", 50], ["Alpha", 50], ["Big", 100], ["D", 40], ["E", 30], ["F", 20]]) expense(space, { vendor, amount });
    const vendors = (await analytics(owner, space)).body.analytics.topVendors;
    expect(vendors).toHaveLength(5); expect(vendors.map((row) => row.vendor)).toEqual(["Big", "Alpha", "Zulu", "D", "E"]);
  });

  it("aggregates repeated vendors", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { vendor: "Acme", amount: 20 }); expense(space, { vendor: "Acme", amount: 30 });
    expect((await analytics(owner, space)).body.analytics.topVendors[0]).toEqual({ vendor: "Acme", total: 50, count: 2 });
  });

  it("compares against the immediately preceding equal-length period", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { amount: 100, payment_date: "2026-04-07" }); expense(space, { amount: 150, payment_date: "2026-04-10" });
    const comparison = (await analytics(owner, space, "?from=2026-04-10&to=2026-04-12&comparison=previous")).body.analytics.comparison;
    expect(comparison.range).toEqual({ from: "2026-04-07", to: "2026-04-09" }); expect(comparison.previous.spent).toBe(100); expect(comparison.changes.spent).toBe(50);
  });

  it("does not include comparison data when disabled", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await analytics(owner, space)).body.analytics.comparison).toBeNull();
  });

  it("groups daily trends chronologically", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expense(space, { payment_date: "2026-04-03", amount: 10 }); expense(space, { payment_date: "2026-04-01", amount: 20 }); expense(space, { payment_date: "2026-04-03", amount: 15 });
    expect((await analytics(owner, space)).body.analytics.dailyTrend).toEqual([{ date: "2026-04-01", total: 20 }, { date: "2026-04-03", total: 25 }]);
  });

  it("reports uncategorized spending separately", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); const category = await createCategory(owner.token, space.id);
    expense(space, { amount: 35 }); expense(space, { amount: 65, category_id: category.id });
    expect((await analytics(owner, space)).body.analytics.summary.uncategorizedSpent).toBe(35);
  });

  it("emits an over-budget insight with affected category ids", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); const category = await createCategory(owner.token, space.id, { budgetAmount: 50 });
    expense(space, { amount: 75, category_id: category.id });
    expect((await analytics(owner, space)).body.analytics.insights).toContainEqual(expect.objectContaining({ code: "categories_over_budget", categoryIds: [category.id] }));
  });

  it("emits a negative-net insight", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); expense(space, { amount: 75 }); contribution(space, { amount: 25 });
    expect((await analytics(owner, space)).body.analytics.insights.map((row) => row.code)).toContain("negative_net");
  });

  it("emits a vendor-concentration insight at fifty percent", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); expense(space, { vendor: "Major", amount: 50 }); expense(space, { vendor: "Minor", amount: 50 });
    expect((await analytics(owner, space)).body.analytics.insights).toContainEqual(expect.objectContaining({ code: "vendor_concentration", vendor: "Major" }));
  });

  it("does not emit concentration below fifty percent", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); expense(space, { vendor: "A", amount: 40 }); expense(space, { vendor: "B", amount: 35 }); expense(space, { vendor: "C", amount: 25 });
    expect((await analytics(owner, space)).body.analytics.insights.map((row) => row.code)).not.toContain("vendor_concentration");
  });

  it("emits a no-activity insight for empty filters", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token);
    expect((await analytics(owner, space)).body.analytics.insights).toContainEqual(expect.objectContaining({ code: "no_activity" }));
  });

  it("filters insights using the same date range as summaries", async () => {
    const owner = await registerUser(); const space = await createLifeSpace(owner.token); expense(space, { amount: 100, payment_date: "2026-01-01" }); contribution(space, { amount: 10, created_at: "2026-01-01T00:00:00.000Z" });
    const result = (await analytics(owner, space, "?from=2026-04-01&to=2026-04-30")).body.analytics;
    expect(result.insights.map((row) => row.code)).toEqual(["no_activity"]);
  });
});
