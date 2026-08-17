const jwt = require("jsonwebtoken");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, auth, registerUser, loginUser } = require("./helpers/factories");

describe("POST /api/auth/register", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates an account and returns a token", async () => {
    const res = await api().post("/api/auth/register").send({
      firstName: "Clinton",
      lastName: "Otieno",
      email: "clinton@chikerito.test",
      password: "chikerito123",
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user).toMatchObject({
      firstName: "Clinton",
      lastName: "Otieno",
      email: "clinton@chikerito.test",
    });
  });

  it("never returns the password hash", async () => {
    const res = await api().post("/api/auth/register").send({
      firstName: "A",
      lastName: "B",
      email: "hash@chikerito.test",
      password: "chikerito123",
    });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("$2a$");
  });

  it("issues a token carrying the user id and email", async () => {
    const { token, user } = await registerUser({ email: "claims@chikerito.test" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(user.id);
    expect(decoded.email).toBe("claims@chikerito.test");
  });

  it.each([
    ["firstName", { lastName: "B", email: "x@y.z", password: "pw123456" }],
    ["lastName", { firstName: "A", email: "x@y.z", password: "pw123456" }],
    ["email", { firstName: "A", lastName: "B", password: "pw123456" }],
    ["password", { firstName: "A", lastName: "B", email: "x@y.z" }],
  ])("rejects a registration missing %s", async (_field, payload) => {
    const res = await api().post("/api/auth/register").send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("rejects an empty body", async () => {
    const res = await api().post("/api/auth/register").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email with 409", async () => {
    await registerUser({ email: "dupe@chikerito.test" });
    const res = await api().post("/api/auth/register").send({
      firstName: "Other",
      lastName: "Person",
      email: "dupe@chikerito.test",
      password: "chikerito123",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it("treats email uniqueness case-insensitively", async () => {
    await registerUser({ email: "Case@chikerito.test" });
    const res = await api().post("/api/auth/register").send({
      firstName: "Other",
      lastName: "Person",
      email: "CASE@chikerito.test",
      password: "chikerito123",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const res = await api()
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send('{"firstName":');
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns a token for correct credentials", async () => {
    const { user, password } = await registerUser({ email: "login@chikerito.test" });
    const res = await loginUser("login@chikerito.test", password);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.id).toBe(user.id);
  });

  it("accepts a differently-cased email", async () => {
    const { password } = await registerUser({ email: "mixed@chikerito.test" });
    const res = await loginUser("MIXED@chikerito.test", password);
    expect(res.status).toBe(200);
  });

  it("rejects a wrong password with 401", async () => {
    await registerUser({ email: "wrong@chikerito.test" });
    const res = await loginUser("wrong@chikerito.test", "not-the-password");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("rejects an unknown email with 401", async () => {
    const res = await loginUser("ghost@chikerito.test", "chikerito123");
    expect(res.status).toBe(401);
  });

  it("uses the same error message for unknown email and wrong password", async () => {
    await registerUser({ email: "enum@chikerito.test" });
    const wrongPassword = await loginUser("enum@chikerito.test", "nope");
    const unknownEmail = await loginUser("nobody@chikerito.test", "nope");
    expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
  });

  it("rejects a login with no credentials at all", async () => {
    const res = await api().post("/api/auth/login").send({});
    expect(res.status).toBe(401);
  });

  it("does not return a token on failure", async () => {
    const res = await loginUser("ghost@chikerito.test", "chikerito123");
    expect(res.body.token).toBeUndefined();
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns the authenticated user", async () => {
    const { token, user } = await registerUser({ email: "me@chikerito.test" });
    const res = await api().get("/api/auth/me").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: "me@chikerito.test",
    });
  });

  it("401s when the Authorization header is missing", async () => {
    const res = await api().get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing/i);
  });

  it("401s when the scheme is not Bearer", async () => {
    const { token } = await registerUser();
    const res = await api().get("/api/auth/me").set("Authorization", `Basic ${token}`);
    expect(res.status).toBe(401);
  });

  it("401s on a garbage token", async () => {
    const res = await api().get("/api/auth/me").set(auth("not-a-real-token"));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it("401s on a token signed with the wrong secret", async () => {
    const forged = jwt.sign({ id: "u1", email: "x@y.z" }, "some-other-secret");
    const res = await api().get("/api/auth/me").set(auth(forged));
    expect(res.status).toBe(401);
  });

  it("401s on an expired token", async () => {
    const expired = jwt.sign(
      { id: "u1", email: "x@y.z" },
      process.env.JWT_SECRET,
      { expiresIn: "-1s" }
    );
    const res = await api().get("/api/auth/me").set(auth(expired));
    expect(res.status).toBe(401);
  });

  it("404s when the token is valid but the user is gone", async () => {
    const orphan = jwt.sign(
      { id: "no-such-user", email: "gone@chikerito.test" },
      process.env.JWT_SECRET
    );
    const res = await api().get("/api/auth/me").set(auth(orphan));
    expect(res.status).toBe(404);
  });
});

describe("service endpoints", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("reports health", async () => {
    const res = await api().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "chikerito-api" });
  });

  it("404s an unknown route with a JSON body", async () => {
    const res = await api().get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});
