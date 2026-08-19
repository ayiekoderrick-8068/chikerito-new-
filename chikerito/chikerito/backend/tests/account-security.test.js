// Password recovery and session management — new baseline coverage for a
// new feature, not an adaptation of anything.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, registerUser, loginUser } = require("./helpers/factories");

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("returns the same generic message for a registered email", async () => {
    const { user } = await registerUser();
    const res = await api().post("/api/auth/forgot-password").send({ email: user.email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
  });

  it("returns the identical message for an unregistered email — does not reveal existence", async () => {
    const known = await registerUser();
    const registeredRes = await api().post("/api/auth/forgot-password").send({ email: known.user.email });
    const unknownRes = await api().post("/api/auth/forgot-password").send({ email: "nobody@chikerito.test" });
    expect(unknownRes.status).toBe(registeredRes.status);
    expect(unknownRes.body.message).toBe(registeredRes.body.message);
  });

  it("does not create a reset record for an unregistered email", async () => {
    await api().post("/api/auth/forgot-password").send({ email: "nobody@chikerito.test" });
    const db = require("../db");
    expect(db.table("password_resets").all()).toHaveLength(0);
  });

  it("issues a usable reset token in non-production for a registered email", async () => {
    const { user } = await registerUser();
    const res = await api().post("/api/auth/forgot-password").send({ email: user.email });
    expect(typeof res.body.resetToken).toBe("string");
    expect(res.body.resetToken.length).toBeGreaterThan(20);
  });

  it("requires an email", async () => {
    const res = await api().post("/api/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });

  it("matches the email case-insensitively", async () => {
    const { user } = await registerUser({ email: "MixedCase@chikerito.test" });
    const res = await api().post("/api/auth/forgot-password").send({ email: user.email.toUpperCase() });
    expect(typeof res.body.resetToken).toBe("string");
  });

  it("a second request supersedes the first — only the newest token works", async () => {
    const { user } = await registerUser();
    const first = await api().post("/api/auth/forgot-password").send({ email: user.email });
    const second = await api().post("/api/auth/forgot-password").send({ email: user.email });

    const useFirst = await api().post("/api/auth/reset-password").send({ token: first.body.resetToken, password: "newpass123" });
    expect(useFirst.status).toBe(400);

    const useSecond = await api().post("/api/auth/reset-password").send({ token: second.body.resetToken, password: "newpass123" });
    expect(useSecond.status).toBe(200);
  });
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  async function requestReset(email) {
    const res = await api().post("/api/auth/forgot-password").send({ email });
    return res.body.resetToken;
  }

  it("resets the password and allows logging in with the new one", async () => {
    const { user, password } = await registerUser();
    const token = await requestReset(user.email);

    const res = await api().post("/api/auth/reset-password").send({ token, password: "brandnewpass" });
    expect(res.status).toBe(200);

    const oldLogin = await loginUser(user.email, password);
    expect(oldLogin.status).toBe(401);
    const newLogin = await loginUser(user.email, "brandnewpass");
    expect(newLogin.status).toBe(200);
  });

  it("never stores the raw token — only a hash", async () => {
    const { user } = await registerUser();
    const token = await requestReset(user.email);
    const db = require("../db");
    const stored = db.table("password_resets").all()[0];
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("rejects a completely invalid token", async () => {
    const res = await api().post("/api/auth/reset-password").send({ token: "not-a-real-token", password: "newpassword" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const { user } = await registerUser();
    const token = await requestReset(user.email);
    const db = require("../db");
    const record = db.table("password_resets").all()[0];
    db.table("password_resets").update(record.id, { expires_at: "2020-01-01T00:00:00.000Z" });

    const res = await api().post("/api/auth/reset-password").send({ token, password: "newpassword" });
    expect(res.status).toBe(400);
  });

  it("is single-use — the same token cannot be used twice", async () => {
    const { user } = await registerUser();
    const token = await requestReset(user.email);
    await api().post("/api/auth/reset-password").send({ token, password: "firstchange" });

    const res = await api().post("/api/auth/reset-password").send({ token, password: "secondchange" });
    expect(res.status).toBe(400);
  });

  it("requires a minimum password length", async () => {
    const { user } = await registerUser();
    const token = await requestReset(user.email);
    const res = await api().post("/api/auth/reset-password").send({ token, password: "short" });
    expect(res.status).toBe(400);
  });

  it("invalidates all of the user's existing sessions", async () => {
    const { token: sessionToken, user, password } = await registerUser();
    await loginUser(user.email, password); // a second session for the same user
    const resetToken = await requestReset(user.email);

    await api().post("/api/auth/reset-password").send({ token: resetToken, password: "newpassword" });

    const check = await api().get("/api/auth/me").set(auth(sessionToken));
    expect(check.status).toBe(401);
  });

  function auth(token) {
    return { Authorization: `Bearer ${token}` };
  }
});

describe("GET /api/auth/sessions", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("lists the current session, marked current", async () => {
    const { token, headers } = await registerUser();
    const res = await api().get("/api/auth/sessions").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].current).toBe(true);
  });

  it("lists multiple sessions across logins, exactly one marked current", async () => {
    const { user, password, headers } = await registerUser();
    await loginUser(user.email, password);
    await loginUser(user.email, password);

    const res = await api().get("/api/auth/sessions").set(headers);
    expect(res.body.sessions).toHaveLength(3);
    expect(res.body.sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it("never exposes a token or token hash", async () => {
    const { headers } = await registerUser();
    const res = await api().get("/api/auth/sessions").set(headers);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it("does not list another user's sessions", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const resA = await api().get("/api/auth/sessions").set(a.headers);
    const resB = await api().get("/api/auth/sessions").set(b.headers);
    expect(resA.body.sessions).toHaveLength(1);
    expect(resB.body.sessions).toHaveLength(1);
    expect(resA.body.sessions[0].id).not.toBe(resB.body.sessions[0].id);
  });

  it("401s without a token", async () => {
    const res = await api().get("/api/auth/sessions");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/auth/sessions/:id", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("revokes a session, which can no longer be used", async () => {
    const { user, password, headers } = await registerUser();
    const second = await loginUser(user.email, password);
    const list = await api().get("/api/auth/sessions").set(headers);
    const secondSession = list.body.sessions.find((s) => !s.current);

    const res = await api().delete(`/api/auth/sessions/${secondSession.id}`).set(headers);
    expect(res.status).toBe(204);

    const check = await api().get("/api/auth/me").set({ Authorization: `Bearer ${second.body.token}` });
    expect(check.status).toBe(401);
  });

  it("revoking the current session invalidates the very request's own token going forward", async () => {
    const { headers, token } = await registerUser();
    const list = await api().get("/api/auth/sessions").set(headers);
    const currentSession = list.body.sessions[0];

    await api().delete(`/api/auth/sessions/${currentSession.id}`).set(headers);

    const check = await api().get("/api/auth/me").set({ Authorization: `Bearer ${token}` });
    expect(check.status).toBe(401);
  });

  it("404s revoking another user's session", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const listA = await api().get("/api/auth/sessions").set(a.headers);
    const res = await api().delete(`/api/auth/sessions/${listA.body.sessions[0].id}`).set(b.headers);
    expect(res.status).toBe(404);

    // Confirms it's a real security boundary, not just a UI nicety.
    const check = await api().get("/api/auth/me").set(a.headers);
    expect(check.status).toBe(200);
  });

  it("404s an unknown session id", async () => {
    const { headers } = await registerUser();
    const res = await api().delete("/api/auth/sessions/no-such-id").set(headers);
    expect(res.status).toBe(404);
  });

  it("404s revoking an already-revoked session", async () => {
    const { user, password, headers } = await registerUser();
    await loginUser(user.email, password);
    const list = await api().get("/api/auth/sessions").set(headers);
    const other = list.body.sessions.find((s) => !s.current);
    await api().delete(`/api/auth/sessions/${other.id}`).set(headers);

    const res = await api().delete(`/api/auth/sessions/${other.id}`).set(headers);
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const { headers } = await registerUser();
    const list = await api().get("/api/auth/sessions").set(headers);
    const res = await api().delete(`/api/auth/sessions/${list.body.sessions[0].id}`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/sessions/revoke-others", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("revokes every other session but leaves the current one usable", async () => {
    const { user, password, headers, token } = await registerUser();
    const second = await loginUser(user.email, password);
    const third = await loginUser(user.email, password);

    const res = await api().post("/api/auth/sessions/revoke-others").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);

    expect((await api().get("/api/auth/me").set({ Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await api().get("/api/auth/me").set({ Authorization: `Bearer ${second.body.token}` })).status).toBe(401);
    expect((await api().get("/api/auth/me").set({ Authorization: `Bearer ${third.body.token}` })).status).toBe(401);
  });

  it("does not touch another user's sessions", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await api().post("/api/auth/sessions/revoke-others").set(a.headers);
    const check = await api().get("/api/auth/me").set(b.headers);
    expect(check.status).toBe(200);
  });

  it("is a no-op with only one active session", async () => {
    const { headers } = await registerUser();
    const res = await api().post("/api/auth/sessions/revoke-others").set(headers);
    expect(res.body.revoked).toBe(0);
  });

  it("401s without a token", async () => {
    const res = await api().post("/api/auth/sessions/revoke-others");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("revokes the current token server-side", async () => {
    const { headers } = await registerUser();
    expect((await api().post("/api/auth/logout").set(headers)).status).toBe(204);
    expect((await api().get("/api/auth/me").set(headers)).status).toBe(401);
  });
});

describe("existing RBAC/auth behavior still holds under session tracking", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("a freshly registered/logged-in session authenticates normally against protected routes", async () => {
    const { headers } = await registerUser();
    const res = await api().get("/api/lifespaces").set(headers);
    expect(res.status).toBe(200);
  });

  it("a garbage bearer token still 401s", async () => {
    const res = await api().get("/api/lifespaces").set({ Authorization: "Bearer garbage" });
    expect(res.status).toBe(401);
  });
});
