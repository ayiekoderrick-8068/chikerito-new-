const request = require("supertest");
const { createApp } = require("../../app");

let seq = 0;
function unique(prefix) {
  seq += 1;
  return `${prefix}${seq}`;
}

// A fresh supertest agent bound to a newly-built app instance.
function api() {
  return request(createApp());
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// Register a user and return { token, user, headers }.
async function registerUser(overrides = {}) {
  const payload = {
    firstName: "Test",
    lastName: "User",
    email: `${unique("user")}@chikerito.test`,
    password: "chikerito123",
    ...overrides,
  };
  const res = await api().post("/api/auth/register").send(payload);
  if (res.status !== 201) {
    throw new Error(`registerUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.token,
    user: res.body.user,
    password: payload.password,
    headers: auth(res.body.token),
  };
}

async function loginUser(email, password) {
  return api().post("/api/auth/login").send({ email, password });
}

// Defaults to public: the current app gates the public /contribute endpoint on
// visibility (life spaces are created private, with no way to request public at
// creation time — POST /lifespaces doesn't even read a visibility field, only
// PATCH does), a check that didn't exist when these factories were first
// written. Scenarios built here exist to test unrelated behavior
// (categories/expenses/dashboard math), not the visibility gate itself, so a
// follow-up PATCH to public preserves the original intent — pass
// `visibility: "private"` in overrides where a test needs to stay private.
async function createLifeSpace(token, overrides = {}) {
  const { visibility = "public", ...rest } = overrides;
  const payload = {
    title: unique("Wedding Fund "),
    milestoneType: "wedding",
    story: "A story about the day.",
    goalAmount: 10000,
    currency: "USD",
    ...rest,
  };
  const res = await api().post("/api/lifespaces").set(auth(token)).send(payload);
  if (res.status !== 201) {
    throw new Error(`createLifeSpace failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  let lifeSpace = res.body.lifeSpace;
  if (visibility !== lifeSpace.visibility) {
    const patchRes = await api()
      .patch(`/api/lifespaces/${lifeSpace.id}`)
      .set(auth(token))
      .send({ visibility });
    if (patchRes.status !== 200) {
      throw new Error(`createLifeSpace visibility patch failed (${patchRes.status}): ${JSON.stringify(patchRes.body)}`);
    }
    lifeSpace = patchRes.body.lifeSpace;
  }
  return lifeSpace;
}

async function createCategory(token, lifeSpaceId, overrides = {}) {
  const payload = { name: unique("Venue "), icon: "sparkles", budgetAmount: 2000, ...overrides };
  const res = await api()
    .post(`/api/lifespaces/${lifeSpaceId}/categories`)
    .set(auth(token))
    .send(payload);
  if (res.status !== 201) {
    throw new Error(`createCategory failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.category;
}

async function createExpense(token, lifeSpaceId, overrides = {}) {
  const payload = { vendor: unique("Vendor "), amount: 250, ...overrides };
  const res = await api()
    .post(`/api/lifespaces/${lifeSpaceId}/expenses`)
    .set(auth(token))
    .send(payload);
  if (res.status !== 201) {
    throw new Error(`createExpense failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.expense;
}

async function addTeamMember(ownerToken, lifeSpaceId, email, role) {
  const res = await api()
    .post(`/api/lifespaces/${lifeSpaceId}/team`)
    .set(auth(ownerToken))
    .send({ email, role });
  if (res.status !== 201) {
    throw new Error(`addTeamMember failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.member;
}

async function createTask(token, lifeSpaceId, overrides = {}) {
  const payload = { title: unique("Task "), ...overrides };
  const res = await api()
    .post(`/api/lifespaces/${lifeSpaceId}/tasks`)
    .set(auth(token))
    .send(payload);
  if (res.status !== 201) {
    throw new Error(`createTask failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.task;
}

async function contribute(slug, overrides = {}) {
  const payload = { contributorName: "Aunt Mary", amount: 100, ...overrides };
  const res = await api().post(`/api/public/lifespaces/${slug}/contribute`).send(payload);
  return res;
}

async function createContribution(slug, overrides = {}) {
  const res = await contribute(slug, overrides);
  if (res.status !== 201) {
    throw new Error(`createContribution failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.contribution;
}

// A fully-populated life space: owner, two categories, an expense and a contribution.
async function seedScenario() {
  const owner = await registerUser();
  const lifeSpace = await createLifeSpace(owner.token, { goalAmount: 10000 });
  const venue = await createCategory(owner.token, lifeSpace.id, {
    name: "Venue",
    budgetAmount: 4000,
  });
  const catering = await createCategory(owner.token, lifeSpace.id, {
    name: "Catering",
    budgetAmount: 2000,
  });
  const contribution = await createContribution(lifeSpace.slug, {
    amount: 1500,
    categoryId: venue.id,
  });
  const expense = await createExpense(owner.token, lifeSpace.id, {
    vendor: "Grand Hall",
    amount: 900,
    categoryId: venue.id,
    receiptUrl: "receipt-001.pdf",
    paymentDate: "2026-03-14",
  });
  return { owner, lifeSpace, venue, catering, contribution, expense };
}

module.exports = {
  api,
  auth,
  unique,
  registerUser,
  loginUser,
  createLifeSpace,
  createCategory,
  createExpense,
  createTask,
  addTeamMember,
  contribute,
  createContribution,
  seedScenario,
};
