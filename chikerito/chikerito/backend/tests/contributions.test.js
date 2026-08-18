const { freshDatabase, cleanupDatabases, rawState } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  createCategory,
  contribute,
  createContribution,
  addTeamMember,
} = require("./helpers/factories");

describe("POST /api/public/lifespaces/:slug/contribute", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("records a contribution without any authentication", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await contribute(space.slug, { contributorName: "Aunt Mary", amount: 250 });
    expect(res.status).toBe(201);
    expect(res.body.contribution).toMatchObject({
      life_space_id: space.id,
      contributor_name: "Aunt Mary",
      amount: 250,
      status: "completed",
    });
  });

  it("attaches the contribution to the life space matched by slug", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    const contribution = await createContribution(b.slug, { amount: 10 });
    expect(contribution.life_space_id).toBe(b.id);
    expect(contribution.life_space_id).not.toBe(a.id);
  });

  it("defaults an unnamed contributor to Anonymous", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contribution = await createContribution(space.slug, {
      contributorName: undefined,
      amount: 50,
    });
    expect(contribution.contributor_name).toBe("Anonymous");
  });

  it("defaults the payment method to card and the message to empty", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contribution = await createContribution(space.slug, { amount: 50 });
    expect(contribution.payment_method).toBe("card");
    expect(contribution.message).toBe("");
  });

  it("keeps an explicit payment method and message", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contribution = await createContribution(space.slug, {
      amount: 50,
      paymentMethod: "mpesa",
      message: "Congratulations!",
    });
    expect(contribution.payment_method).toBe("mpesa");
    expect(contribution.message).toBe("Congratulations!");
  });

  it("links the contribution to a category when one is given", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id);
    const contribution = await createContribution(space.slug, {
      amount: 50,
      categoryId: category.id,
    });
    expect(contribution.category_id).toBe(category.id);
  });

  it("leaves the category null when none is given", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contribution = await createContribution(space.slug, { amount: 50 });
    expect(contribution.category_id).toBeNull();
  });

  it("coerces a numeric string amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contribution = await createContribution(space.slug, { amount: "125" });
    expect(contribution.amount).toBe(125);
  });

  it("stamps created_at as an ISO timestamp", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contribution = await createContribution(space.slug, { amount: 10 });
    expect(Number.isNaN(Date.parse(contribution.created_at))).toBe(false);
  });

  it("404s for an unknown slug", async () => {
    const res = await contribute("no-such-slug", { amount: 100 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("rejects a missing amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await contribute(space.slug, { amount: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive amount/i);
  });

  it("rejects a zero amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await contribute(space.slug, { amount: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await contribute(space.slug, { amount: -100 });
    expect(res.status).toBe(400);
  });

  it("does not persist a rejected contribution", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await contribute(space.slug, { amount: -100 });
    expect(rawState().contributions).toHaveLength(0);
  });
});

describe("contribution notifications", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  function notifications(lifeSpaceId, type) {
    return rawState().notifications.filter(
      (n) => n.life_space_id === lifeSpaceId && (!type || n.type === type)
    );
  }

  it("raises a donation notification naming the contributor and amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createContribution(space.slug, { contributorName: "Uncle Joe", amount: 80 });
    const donations = notifications(space.id, "donation");
    expect(donations).toHaveLength(1);
    expect(donations[0].message).toContain("Uncle Joe");
    expect(donations[0].message).toContain("80.00");
  });

  it("announces a category becoming fully funded", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, {
      name: "Venue",
      budgetAmount: 500,
    });
    await createContribution(space.slug, { amount: 500, categoryId: category.id });
    const funded = notifications(space.id, "milestone_funded");
    expect(funded).toHaveLength(1);
    expect(funded[0].message).toContain("Venue");
  });

  it("only announces funding once the cumulative total reaches the budget", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 500 });
    await createContribution(space.slug, { amount: 200, categoryId: category.id });
    expect(notifications(space.id, "milestone_funded")).toHaveLength(0);
    await createContribution(space.slug, { amount: 300, categoryId: category.id });
    expect(notifications(space.id, "milestone_funded")).toHaveLength(1);
  });

  it("does not announce funding for a zero-budget category", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 0 });
    await createContribution(space.slug, { amount: 900, categoryId: category.id });
    expect(notifications(space.id, "milestone_funded")).toHaveLength(0);
  });

  it("does not announce funding for an uncategorised contribution", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await createCategory(owner.token, space.id, { budgetAmount: 100 });
    await createContribution(space.slug, { amount: 900 });
    expect(notifications(space.id, "milestone_funded")).toHaveLength(0);
  });
});

describe("GET /api/lifespaces/:id/contributions", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns an empty list before any contribution exists", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .get(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.contributions).toEqual([]);
  });

  it("lists the contributions of the requested life space only", async () => {
    const owner = await registerUser();
    const a = await createLifeSpace(owner.token, { title: "A" });
    const b = await createLifeSpace(owner.token, { title: "B" });
    await createContribution(a.slug, { amount: 10, contributorName: "For A" });
    await createContribution(b.slug, { amount: 20, contributorName: "For B" });
    const res = await api()
      .get(`/api/lifespaces/${a.id}/contributions`)
      .set(owner.headers);
    expect(res.body.contributions).toHaveLength(1);
    expect(res.body.contributions[0].contributor_name).toBe("For A");
  });

  it("returns the newest contribution first", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await createContribution(space.slug, { amount: 10 });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createContribution(space.slug, { amount: 20 });
    const res = await api()
      .get(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers);
    expect(res.body.contributions.map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().get(`/api/lifespaces/${space.id}/contributions`);
    expect(res.status).toBe(401);
  });
});

// publicAccess.js's visibility/passcode gate didn't exist in the old snapshot
// this suite was adapted from — the public contribute endpoint used to be
// reachable unconditionally. It's current-only behavior.
describe("public contribute — visibility and passcode gate", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("403s a private life space with no passcode workaround", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const res = await contribute(space.slug, { amount: 50 });
    expect(res.status).toBe(403);
    expect(res.body.private).toBe(true);
  });

  it("401s a passcode-protected public space when no passcode is supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await contribute(space.slug, { amount: 50 });
    expect(res.status).toBe(401);
    expect(res.body.passcodeRequired).toBe(true);
  });

  it("401s a passcode-protected public space when the wrong passcode is supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await api()
      .post(`/api/public/lifespaces/${space.slug}/contribute?passcode=wrong`)
      .send({ amount: 50 });
    expect(res.status).toBe(401);
  });

  it("accepts the contribution once the correct passcode is supplied", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await api()
      .post(`/api/public/lifespaces/${space.slug}/contribute?passcode=letmein`)
      .send({ amount: 50 });
    expect(res.status).toBe(201);
  });

  it("accepts a passcode supplied via the x-event-passcode header instead of the query string", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    const res = await api()
      .post(`/api/public/lifespaces/${space.slug}/contribute`)
      .set("x-event-passcode", "letmein")
      .send({ amount: 50 });
    expect(res.status).toBe(201);
  });

  it("no longer requires a passcode once it has been cleared", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "letmein" });
    await api().patch(`/api/lifespaces/${space.id}`).set(owner.headers).send({ passcode: "" });
    const res = await contribute(space.slug, { amount: 50 });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST /api/lifespaces/:id/contributions — manual entry
// ---------------------------------------------------------------------------
describe("POST /api/lifespaces/:id/contributions (manual entry)", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a manual contribution when authorized", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John Doe", amount: 150 });
    expect(res.status).toBe(201);
    expect(res.body.contribution).toMatchObject({
      life_space_id: space.id,
      contributor_name: "John Doe",
      amount: 150,
      status: "completed",
      source: "manual",
    });
  });

  it("allows status to be set at creation time", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "Jane", amount: 100, status: "pending" });
    expect(res.status).toBe(201);
    expect(res.body.contribution.status).toBe("pending");
  });

  it("allows notes to be set at creation time", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "Jane", amount: 100, notes: "Bank transfer" });
    expect(res.status).toBe(201);
    expect(res.body.contribution.notes).toBe("Bank transfer");
  });

  it("requires contribution:manage capability", async () => {
    const owner = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token);
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(volunteer.headers)
      .send({ contributorName: "John", amount: 100 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/role.*allow/i);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .send({ contributorName: "John", amount: 100 });
    expect(res.status).toBe(401);
  });

  it("404s for an unknown space", async () => {
    const owner = await registerUser();
    const res = await api()
      .post(`/api/lifespaces/no-such-id/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John", amount: 100 });
    expect(res.status).toBe(404);
  });

  it("rejects invalid status values", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John", amount: 100, status: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be/i);
  });

  it("requires a positive amount", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John", amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive amount/i);
  });

  it("requires a non-empty contributor name", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "   ", amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contributorName/i);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/contributions/:id — status transitions
// ---------------------------------------------------------------------------
describe("PATCH /api/contributions/:id (status transitions)", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("allows status update with contribution:manage capability", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contrib = await createContribution(space.slug, { amount: 100 });
    const res = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "refunded" });
    expect(res.status).toBe(200);
    expect(res.body.contribution.status).toBe("refunded");
  });

  it("allows updating notes without changing status", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contrib = await createContribution(space.slug, { amount: 100 });
    const res = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ notes: "Updated note" });
    expect(res.status).toBe(200);
    expect(res.body.contribution.notes).toBe("Updated note");
    expect(res.body.contribution.status).toBe("completed");
  });

  it("enforces valid status transitions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    
    // Create a contribution with pending status via manual entry endpoint
    const res0 = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John", amount: 100, status: "pending" });
    const contrib = res0.body.contribution;
    
    // pending -> completed is allowed
    const res1 = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "completed" });
    expect(res1.status).toBe(200);
    
    // completed -> pending is NOT allowed
    const res2 = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "pending" });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/cannot transition|not allowed/i);
  });

  it("prevents status changes from refunded status", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contrib = await createContribution(space.slug, { amount: 100 });
    
    // First refund it
    await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "refunded" });
    
    // Try to change from refunded status
    const res = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "voided" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already.*refunded/i);
  });

  it("prevents status changes from voided status", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    
    // Create with pending status
    const res0 = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John", amount: 100, status: "pending" });
    const contrib = res0.body.contribution;
    
    // First void it
    await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "voided" });
    
    // Try to change from voided status
    const res = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "completed" });
    expect(res.status).toBe(409);
  });

  it("requires contribution:manage capability", async () => {
    const owner = await registerUser();
    const volunteer = await registerUser();
    const space = await createLifeSpace(owner.token);
    const contrib = await createContribution(space.slug, { amount: 100 });
    
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    
    const res = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(volunteer.headers)
      .send({ status: "refunded" });
    expect(res.status).toBe(403);
  });

  it("404s for non-existent contribution", async () => {
    const owner = await registerUser();
    const res = await api()
      .patch(`/api/contributions/no-such-id`)
      .set(owner.headers)
      .send({ status: "refunded" });
    expect(res.status).toBe(404);
  });

  it("prevents cross-tenant access", async () => {
    const owner1 = await registerUser();
    const owner2 = await registerUser();
    const space1 = await createLifeSpace(owner1.token);
    const space2 = await createLifeSpace(owner2.token);
    const contrib = await createContribution(space1.slug, { amount: 100 });
    
    const res = await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner2.headers)
      .send({ status: "refunded" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Financial calculations with contribution status
// ---------------------------------------------------------------------------
describe("financial calculations with contribution status", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("only counts completed contributions toward raised total", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    
    // Create completed, pending, and failed contributions
    await createContribution(space.slug, { amount: 300, categoryId: category.id });
    await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "Jane", amount: 300, categoryId: category.id, status: "pending" });
    await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "Bob", amount: 300, categoryId: category.id, status: "failed" });
    
    const dashboard = await api()
      .get(`/api/lifespaces/${space.id}/dashboard`)
      .set(owner.headers);
    
    const categoryStats = dashboard.body.categoryBreakdown.find(c => c.id === category.id);
    expect(categoryStats.raised).toBe(300);
  });

  it("does not count refunded contributions toward raised total", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    
    // Create completed then refund it
    const contrib = await createContribution(space.slug, { amount: 500, categoryId: category.id });
    await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "refunded" });
    
    const dashboard = await api()
      .get(`/api/lifespaces/${space.id}/dashboard`)
      .set(owner.headers);
    
    const categoryStats = dashboard.body.categoryBreakdown.find(c => c.id === category.id);
    expect(categoryStats.raised).toBe(0);
  });

  it("does not count voided contributions toward raised total", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 1000 });
    
    // Create completed then void it
    const contrib = await createContribution(space.slug, { amount: 500, categoryId: category.id });
    await api()
      .patch(`/api/contributions/${contrib.id}`)
      .set(owner.headers)
      .send({ status: "voided" });
    
    const dashboard = await api()
      .get(`/api/lifespaces/${space.id}/dashboard`)
      .set(owner.headers);
    
    const categoryStats = dashboard.body.categoryBreakdown.find(c => c.id === category.id);
    expect(categoryStats.raised).toBe(0);
  });

  it("milestone funding notification only triggers for completed contributions", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const category = await createCategory(owner.token, space.id, { budgetAmount: 200 });
    
    // Create pending, then complete it
    const res = await api()
      .post(`/api/lifespaces/${space.id}/contributions`)
      .set(owner.headers)
      .send({ contributorName: "John", amount: 200, categoryId: category.id, status: "pending" });
    const contribId = res.body.contribution.id;
    
    // Pending status should not trigger notification
    let funded = rawState().notifications.filter(
      (n) => n.life_space_id === space.id && n.type === "milestone_funded"
    );
    expect(funded).toHaveLength(0);
    
    // Complete it
    await api()
      .patch(`/api/contributions/${contribId}`)
      .set(owner.headers)
      .send({ status: "completed" });
    
    // Now should trigger notification
    funded = rawState().notifications.filter(
      (n) => n.life_space_id === space.id && n.type === "milestone_funded"
    );
    expect(funded).toHaveLength(1);
  });
});
