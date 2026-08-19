const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createContribution,
} = require("./helpers/factories");

async function dashboard(owner, lifeSpaceId) {
  const res = await api()
    .get(`/api/lifespaces/${lifeSpaceId}/dashboard`)
    .set(owner.headers);
  return res;
}

describe("GET /api/lifespaces/:id/dashboard — headline stats", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns zeroed stats for an empty life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 10000 });
    const res = await dashboard(owner, space.id);
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({
      goal: 10000,
      raised: 0,
      spent: 0,
      available: 0,
      remainingGoal: 10000,
      progress: 0,
    });
  });

  it("sums every contribution into raised", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 10000 });
    await createContribution(space.slug, { amount: 1500 });
    await createContribution(space.slug, { amount: 500 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.raised).toBe(2000);
  });

  it("sums every expense into spent", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 10000 });
    await createExpense(owner.token, space.id, { amount: 300 });
    await createExpense(owner.token, space.id, { amount: 200 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.spent).toBe(500);
  });

  it("computes available as raised minus spent", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 10000 });
    await createContribution(space.slug, { amount: 2000 });
    await createExpense(owner.token, space.id, { amount: 750 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.available).toBe(1250);
  });

  it("floors available at zero when spending exceeds raising", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 10000 });
    await createContribution(space.slug, { amount: 100 });
    await createExpense(owner.token, space.id, { amount: 900 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.available).toBe(0);
  });

  it("computes remainingGoal and floors it at zero once exceeded", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 1000 });
    await createContribution(space.slug, { amount: 400 });
    let res = await dashboard(owner, space.id);
    expect(res.body.stats.remainingGoal).toBe(600);
    await createContribution(space.slug, { amount: 5000 });
    res = await dashboard(owner, space.id);
    expect(res.body.stats.remainingGoal).toBe(0);
  });

  it("expresses progress as a rounded percentage of the goal", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 900 });
    await createContribution(space.slug, { amount: 300 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.progress).toBe(33);
  });

  it("caps progress at 100 percent", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 100 });
    await createContribution(space.slug, { amount: 5000 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.progress).toBe(100);
  });

  it("reports zero progress for a zero goal rather than dividing by zero", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { goalAmount: 0 });
    await createContribution(space.slug, { amount: 500 });
    const res = await dashboard(owner, space.id);
    expect(res.body.stats.progress).toBe(0);
  });

  it("404s for an unknown life space", async () => {
    const owner = await registerUser();
    const res = await dashboard(owner, "no-such-id");
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/dashboard`);
    expect(res.status).toBe(401);
  });
});

describe("dashboard category breakdown", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("is empty when no categories exist", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await dashboard(owner, space.id);
    expect(res.body.categoryBreakdown).toEqual([]);
  });

  it("reports one entry per category with its identity fields", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const venue = await createCategory(owner.token, space.id, {
      name: "Venue",
      icon: "building",
      budgetAmount: 4000,
    });
    const res = await dashboard(owner, space.id);
    expect(res.body.categoryBreakdown).toHaveLength(1);
    expect(res.body.categoryBreakdown[0]).toMatchObject({
      id: venue.id,
      name: "Venue",
      icon: "building",
      budget: 4000,
    });
  });

  it("splits raised and spent per category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const venue = await createCategory(owner.token, space.id, {
      name: "Venue",
      budgetAmount: 1000,
    });
    const catering = await createCategory(owner.token, space.id, {
      name: "Catering",
      budgetAmount: 1000,
    });
    await createContribution(space.slug, { amount: 600, categoryId: venue.id });
    await createExpense(owner.token, space.id, { amount: 250, categoryId: catering.id });
    const res = await dashboard(owner, space.id);
    const byName = Object.fromEntries(
      res.body.categoryBreakdown.map((c) => [c.name, c])
    );
    expect(byName.Venue).toMatchObject({ raised: 600, spent: 0 });
    expect(byName.Catering).toMatchObject({ raised: 0, spent: 250 });
  });

  it("computes remaining budget per category and floors it at zero", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const venue = await createCategory(owner.token, space.id, { budgetAmount: 500 });
    await createExpense(owner.token, space.id, { amount: 900, categoryId: venue.id });
    const res = await dashboard(owner, space.id);
    expect(res.body.categoryBreakdown[0].remaining).toBe(0);
  });

  it("computes per-category progress capped at 100", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const venue = await createCategory(owner.token, space.id, { budgetAmount: 200 });
    await createContribution(space.slug, { amount: 800, categoryId: venue.id });
    const res = await dashboard(owner, space.id);
    expect(res.body.categoryBreakdown[0].progress).toBe(100);
  });
});

describe("dashboard monthly trend", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("is empty with no expenses", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await dashboard(owner, space.id);
    expect(res.body.monthlyTrend).toEqual([]);
  });

  it("buckets expenses by payment month", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { amount: 100, paymentDate: "2026-01-05" });
    await createExpense(owner.token, space.id, { amount: 50, paymentDate: "2026-01-28" });
    await createExpense(owner.token, space.id, { amount: 70, paymentDate: "2026-02-02" });
    const res = await dashboard(owner, space.id);
    expect(res.body.monthlyTrend).toEqual([
      { month: "2026-01", total: 150 },
      { month: "2026-02", total: 70 },
    ]);
  });

  it("sorts months chronologically regardless of insertion order", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { amount: 10, paymentDate: "2026-06-01" });
    await createExpense(owner.token, space.id, { amount: 20, paymentDate: "2026-02-01" });
    await createExpense(owner.token, space.id, { amount: 30, paymentDate: "2026-04-01" });
    const res = await dashboard(owner, space.id);
    expect(res.body.monthlyTrend.map((m) => m.month)).toEqual([
      "2026-02",
      "2026-04",
      "2026-06",
    ]);
  });
});

describe("dashboard financial health", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("scores a clean life space 100 and rates it Excellent", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(100);
    expect(res.body.financialHealth.rating).toBe("Excellent");
    expect(res.body.financialHealth.flags).toEqual([]);
  });

  it("deducts 15 points per over-budget category and flags it", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const venue = await createCategory(owner.token, space.id, {
      name: "Venue",
      budgetAmount: 100,
    });
    await createExpense(owner.token, space.id, {
      amount: 500,
      categoryId: venue.id,
      receiptUrl: "r.pdf",
    });
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(85);
    expect(res.body.financialHealth.flags).toContain("Venue is over budget");
  });

  it("deducts 3 points per expense missing a receipt", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { amount: 10 });
    await createExpense(owner.token, space.id, { amount: 20 });
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(94);
    expect(res.body.financialHealth.flags).toContain("2 expense(s) missing receipts");
  });

  it("caps the missing-receipt deduction at 20 points", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (let i = 0; i < 10; i += 1) {
      await createExpense(owner.token, space.id, { amount: 5 });
    }
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(80);
  });

  it("does not deduct for an expense that has a receipt", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, { amount: 10, receiptUrl: "r.pdf" });
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(100);
  });

  it("deducts 10 points per overdue expense and flags it", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createExpense(owner.token, space.id, {
      amount: 10,
      status: "overdue",
      receiptUrl: "r.pdf",
    });
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(90);
    expect(res.body.financialHealth.flags).toContain("1 overdue payment(s)");
  });

  it("never scores below zero", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (let i = 0; i < 12; i += 1) {
      const category = await createCategory(owner.token, space.id, {
        name: `Cat ${i}`,
        budgetAmount: 1,
      });
      await createExpense(owner.token, space.id, {
        amount: 100,
        categoryId: category.id,
        status: "overdue",
      });
    }
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(0);
    expect(res.body.financialHealth.rating).toBe("At Risk");
  });

  it.each([
    [85, "Excellent"],
    [70, "Good"],
    [45, "Needs Attention"],
    [30, "At Risk"],
  ])("rates a score of about %i as %s", async (targetScore, rating) => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    // Each over-budget category costs 15 points, so drive the score down in steps.
    const steps = Math.round((100 - targetScore) / 15);
    for (let i = 0; i < steps; i += 1) {
      const category = await createCategory(owner.token, space.id, {
        name: `Cat ${i}`,
        budgetAmount: 1,
      });
      await createExpense(owner.token, space.id, {
        amount: 100,
        categoryId: category.id,
        receiptUrl: "r.pdf",
      });
    }
    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.rating).toBe(rating);
  });
});

describe("dashboard feeds", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("echoes the life space back", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { title: "Echo" });
    const res = await dashboard(owner, space.id);
    expect(res.body.lifeSpace.id).toBe(space.id);
    expect(res.body.lifeSpace.title).toBe("Echo");
  });

  it("returns the most recent notifications first, capped at ten", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (let i = 0; i < 12; i += 1) {
      await createExpense(owner.token, space.id, { amount: 1, vendor: `V${i}` });
    }
    const res = await dashboard(owner, space.id);
    expect(res.body.notifications).toHaveLength(10);
    const times = res.body.notifications.map((n) => Date.parse(n.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("returns the most recent contributions first, capped at eight", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (let i = 0; i < 10; i += 1) {
      await createContribution(space.slug, { amount: i + 1 });
    }
    const res = await dashboard(owner, space.id);
    expect(res.body.recentContributions).toHaveLength(8);
  });

  it("scopes notifications and contributions to the requested life space", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    await createContribution(b.slug, { amount: 100 });
    const res = await dashboard(owner, a.id);
    expect(res.body.recentContributions).toEqual([]);
    expect(res.body.notifications).toEqual([]);
  });
});

describe("GET /api/lifespaces/:id/dashboard — upcoming recurring expenses", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns an empty list when there are no recurring expenses", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await dashboard(owner, space.id);
    expect(res.body.upcomingRecurringExpenses).toEqual([]);
  });

  it("lists the next upcoming occurrence of an active recurring expense", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res1 = await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Netflix",
        amount: 15.99,
        frequency: "monthly",
        startDate: "2099-01-01",
      });
    const rule = res1.body.recurringExpense;

    const res2 = await dashboard(owner, space.id);
    expect(res2.body.upcomingRecurringExpenses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recurringExpenseId: rule.id,
          vendor: "Netflix",
          amount: 15.99,
        }),
      ])
    );
    expect(res2.body.upcomingRecurringExpenses.length).toBeLessThanOrEqual(5);
    expect(res2.body.upcomingRecurringExpenses).toHaveLength(1);
  });

  it("returns upcoming dates in deterministic order: sorted by date, then by vendor", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res1 = await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Zebra Inc",
        amount: 50,
        frequency: "weekly",
        startDate: "2099-01-15",
      });
    const res2 = await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Alpha LLC",
        amount: 30,
        frequency: "weekly",
        startDate: "2099-01-15",
      });

    const res = await dashboard(owner, space.id);
    const upcoming = res.body.upcomingRecurringExpenses;
    for (let i = 0; i < upcoming.length - 1; i += 1) {
      const cur = upcoming[i];
      const next = upcoming[i + 1];
      if (cur.dueDate === next.dueDate) {
        expect(cur.vendor <= next.vendor).toBe(true);
      } else {
        expect(cur.dueDate <= next.dueDate).toBe(true);
      }
    }
  });

  it("excludes paused and stopped recurring expenses from the upcoming list", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res1 = await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Active Vendor",
        amount: 50,
        frequency: "monthly",
        startDate: "2099-01-01",
      });
    const active = res1.body.recurringExpense;

    const res2 = await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Paused Vendor",
        amount: 50,
        frequency: "monthly",
        startDate: "2099-01-01",
      });
    const paused = res2.body.recurringExpense;

    const pauseRes = await api()
      .post(`/api/recurring-expenses/${paused.id}/pause`)
      .set(owner.headers);
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.recurringExpense.status).toBe("paused");

    const res3 = await dashboard(owner, space.id);
    const upcomingVendors = res3.body.upcomingRecurringExpenses.map((x) => x.vendor);
    expect(upcomingVendors).toContain("Active Vendor");
    expect(upcomingVendors).not.toContain("Paused Vendor");
  });

  it("respects end-date: stops including occurrences after the end date", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Short-Lived",
        amount: 50,
        frequency: "monthly",
        startDate: "2026-01-01",
        endDate: "2026-01-15",
      });

    const res = await dashboard(owner, space.id);
    expect(res.body.upcomingRecurringExpenses.some((x) => x.vendor === "Short-Lived")).toBe(false);
  });

  it("limits the result to 5 total upcoming occurrences across all rules", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Weekly",
        amount: 10,
        frequency: "weekly",
        startDate: "2099-01-01",
      });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Biweekly",
        amount: 20,
        frequency: "biweekly",
        startDate: "2099-01-01",
      });

    const res = await dashboard(owner, space.id);
    expect(res.body.upcomingRecurringExpenses.length).toBeLessThanOrEqual(5);
  });

  it("shows one next due item per rule so a frequent rule cannot crowd out other vendors", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    for (const [vendor, frequency, startDate] of [
      ["Weekly", "weekly", "2099-01-01"],
      ["Annual", "yearly", "2099-01-02"],
      ["Quarterly", "quarterly", "2099-01-03"],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({
        vendor, amount: 10, frequency, startDate,
      });
    }

    const res = await dashboard(owner, space.id);
    expect(res.body.upcomingRecurringExpenses.map((item) => item.vendor)).toEqual([
      "Weekly", "Annual", "Quarterly",
    ]);
  });

  it("includes category identity and name in each upcoming item", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { name: "Hosting" });
    await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({
      vendor: "Cloud Co", amount: 75, categoryId: category.id, frequency: "monthly", startDate: "2099-01-01",
    });

    const res = await dashboard(owner, space.id);
    expect(res.body.upcomingRecurringExpenses[0]).toMatchObject({
      vendor: "Cloud Co", amount: 75, categoryId: category.id, category: "Hosting", dueDate: "2099-01-01",
    });
  });
});

describe("GET /api/lifespaces/:id/dashboard — budget projection and financial health", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("projects spending for each category: current + upcoming recurring", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Marketing", budgetAmount: 500 });
    await createExpense(owner.token, space.id, { amount: 100, categoryId: cat.id });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Ad Platform",
        amount: 150,
        categoryId: cat.id,
        frequency: "monthly",
        startDate: "2099-01-01",
      });

    const res = await dashboard(owner, space.id);
    const breakdown = res.body.categoryBreakdown.find((c) => c.id === cat.id);
    expect(breakdown.spent).toBe(100);
    expect(breakdown.projectedSpent).toBeGreaterThanOrEqual(150);
  });

  it("marks categories as projectedOver when upcoming expenses exceed budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Services", budgetAmount: 100 });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Premium Service",
        amount: 150,
        categoryId: cat.id,
        frequency: "monthly",
        startDate: "2099-01-01",
      });

    const res = await dashboard(owner, space.id);
    const breakdown = res.body.categoryBreakdown.find((c) => c.id === cat.id);
    expect(breakdown.projectedOver).toBe(true);
  });

  it("does not mark a category as projectedOver if it has no budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Uncategorized", budgetAmount: 0 });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Service",
        amount: 999999,
        categoryId: cat.id,
        frequency: "monthly",
        startDate: "2099-01-01",
      });

    const res = await dashboard(owner, space.id);
    const breakdown = res.body.categoryBreakdown.find((c) => c.id === cat.id);
    expect(breakdown.projectedOver).toBe(false);
  });

  it("includes projectedOver categories in financialHealth.projectedOver", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Risky", budgetAmount: 50 });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Expensive",
        amount: 200,
        categoryId: cat.id,
        frequency: "monthly",
        startDate: "2099-01-01",
      });

    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.projectedOver).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Risky" })])
    );
  });

  it("adds warnings for projectedOver categories to the flags", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Budget Risk", budgetAmount: 100 });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "High Cost",
        amount: 200,
        categoryId: cat.id,
        frequency: "monthly",
        startDate: "2099-01-01",
      });

    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.flags).toEqual(
      expect.arrayContaining([expect.stringContaining("Budget Risk")])
    );
  });

  it("warns when current spending plus the next due expense exceeds budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Operations", budgetAmount: 200 });
    await createExpense(owner.token, space.id, { amount: 125, categoryId: cat.id, receiptUrl: "receipt.png" });
    await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({
      vendor: "Software", amount: 100, categoryId: cat.id, frequency: "monthly", startDate: "2099-01-01",
    });

    const res = await dashboard(owner, space.id);
    expect(res.body.categoryBreakdown.find((item) => item.id === cat.id)).toMatchObject({
      spent: 125, projectedSpent: 225, projectedOver: true,
    });
    expect(res.body.financialHealth.projectedOver.map((item) => item.id)).toContain(cat.id);
    expect(res.body.financialHealth.score).toBe(90);
  });

  it("does not apply a projected penalty again when a category is already over budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Already Over", budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 125, categoryId: cat.id, receiptUrl: "receipt.png" });
    await api().post(`/api/lifespaces/${space.id}/recurring-expenses`).set(owner.headers).send({
      vendor: "Later", amount: 50, categoryId: cat.id, frequency: "monthly", startDate: "2099-01-01",
    });

    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBe(85);
    expect(res.body.financialHealth.projectedOver).toEqual([]);
  });

  it("preserves existing financial health score logic for current over-budget categories", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Over Now", budgetAmount: 100 });
    await createExpense(owner.token, space.id, { amount: 200, categoryId: cat.id });

    const res = await dashboard(owner, space.id);
    expect(res.body.financialHealth.score).toBeLessThan(100);
    expect(res.body.financialHealth.flags).toEqual(
      expect.arrayContaining([expect.stringContaining("Over Now")])
    );
  });

  it("does not double-count expenses for recurring expense preview", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const cat = await createCategory(owner.token, space.id, { name: "Recurring Cat", budgetAmount: 500 });
    await api()
      .post(`/api/lifespaces/${space.id}/recurring-expenses`)
      .set(owner.headers)
      .send({
        vendor: "Repeating",
        amount: 100,
        categoryId: cat.id,
        frequency: "monthly",
        startDate: "2026-01-01",
      });

    const res1 = await dashboard(owner, space.id);
    const breakdown1 = res1.body.categoryBreakdown.find((c) => c.id === cat.id);
    const upcoming1Count = res1.body.upcomingRecurringExpenses.filter((x) => x.categoryId === cat.id).length;

    const res2 = await dashboard(owner, space.id);
    const breakdown2 = res2.body.categoryBreakdown.find((c) => c.id === cat.id);
    const upcoming2Count = res2.body.upcomingRecurringExpenses.filter((x) => x.categoryId === cat.id).length;

    // The spending values should be consistent across calls (not accumulating)
    expect(breakdown1.spent).toBe(breakdown2.spent);
    // The upcoming list should not grow on subsequent calls
    expect(upcoming1Count).toBe(upcoming2Count);
  });

  it("counts only completed contributions in raised totals", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createContribution(space.slug, { amount: 100 });
    for (const status of ["pending", "failed", "refunded", "voided"]) {
      // eslint-disable-next-line no-await-in-loop
      await api().post(`/api/lifespaces/${space.id}/contributions`).set(owner.headers).send({
        contributorName: `Manual ${status}`, amount: 50, status,
      });
    }

    const res = await dashboard(owner, space.id);
    expect(res.body.stats.raised).toBe(100); // only completed counts
  });

  it("403s a non-member trying to access the dashboard", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await dashboard(other, space.id);
    expect(res.status).toBe(403);
  });

  it("404s an unknown life space", async () => {
    const owner = await registerUser();
    const res = await dashboard(owner, "unknown-id");
    expect(res.status).toBe(404);
  });
});
