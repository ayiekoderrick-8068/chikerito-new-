const { v4: uuid } = require("uuid");
const db = require("../db");
const { sanitizeValue, writeAudit, describeMutation } = require("../audit");
const { compareLogs, encodeCursor, decodeCursor } = require("../routes/auditLogs");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, registerUser, createLifeSpace } = require("./helpers/factories");

describe("audit metadata sanitization", () => {
  it("recursively strips credential-shaped keys while retaining useful values", () => {
    const input = {
      status: "completed",
      password: "bad",
      password_hash: "worse",
      nested: {
        passcode: "1234",
        resetToken: "token",
        safe: "yes",
        rows: [{ apiKey: "secret", amount: 12 }],
      },
    };
    expect(sanitizeValue(input)).toEqual({
      status: "completed",
      nested: { safe: "yes", rows: [{ amount: 12 }] },
    });
  });

  it("bounds metadata strings, arrays, and nesting depth", () => {
    const result = sanitizeValue({
      long: "x".repeat(500),
      list: Array.from({ length: 30 }, (_, index) => index),
      a: { b: { c: { d: { e: "too deep" } } } },
    });
    expect(result.long).toHaveLength(200);
    expect(result.list).toHaveLength(20);
    expect(result.a.b.c.d).toEqual({});
  });

  it("handles nulls, booleans, numbers, unsupported values, and undefined", () => {
    const result = sanitizeValue({
      empty: null,
      enabled: true,
      count: 4,
      missing: undefined,
      callback: () => "no",
      symbol: Symbol("safe"),
    });
    expect(result).toEqual({ empty: null, enabled: true, count: 4, symbol: "Symbol(safe)" });
  });
});

describe("audit persistence and deterministic helpers", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("writeAudit persists a complete sanitized record", () => {
    const record = writeAudit({
      lifeSpaceId: "space-1",
      actor: { id: "user-1", first_name: "Grace", last_name: "Hopper" },
      action: "task.updated",
      resourceType: "task",
      resourceId: "task-1",
      metadata: { completed: true, authToken: "drop-me" },
      occurredAt: "2026-01-02T03:04:05.000Z",
    });
    expect(record).toMatchObject({
      life_space_id: "space-1",
      actor_id: "user-1",
      actor_name: "Grace Hopper",
      action: "task.updated",
      resource_type: "task",
      resource_id: "task-1",
      metadata: { completed: true },
      occurred_at: "2026-01-02T03:04:05.000Z",
    });
    expect(db.table("audit_logs").find(record.id)).toEqual(record);
  });

  it("writeAudit uses a safe public actor and rejects incomplete descriptors", () => {
    expect(writeAudit({
      lifeSpaceId: "space-1",
      actor: null,
      action: "contribution.created",
      resourceType: "contribution",
    })).toMatchObject({ actor_id: null, actor_name: "Public visitor" });
    expect(writeAudit({ action: "task.created", resourceType: "task" })).toBeNull();
    expect(writeAudit({ lifeSpaceId: "space", resourceType: "task" })).toBeNull();
  });

  it("orders equal timestamps by descending IDs", () => {
    const logs = [
      { id: "a", occurred_at: "2026-01-01T00:00:00.000Z" },
      { id: "c", occurred_at: "2026-01-01T00:00:00.000Z" },
      { id: "b", occurred_at: "2026-01-02T00:00:00.000Z" },
    ];
    expect(logs.sort(compareLogs).map((log) => log.id)).toEqual(["b", "c", "a"]);
  });

  it("round-trips opaque pagination cursors and rejects malformed cursors", () => {
    const log = { id: uuid(), occurred_at: "2026-01-02T03:04:05.000Z" };
    expect(decodeCursor(encodeCursor(log))).toEqual({ occurredAt: log.occurred_at, id: log.id });
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ id: "only-id" })).toString("base64url"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("describes child-resource actions with pre-mutation snapshots", () => {
    const request = { path: "/api/expenses/expense-1", method: "DELETE", body: {} };
    expect(describeMutation(request, null, { id: "expense-1", life_space_id: "space-1" })).toEqual({
      lifeSpaceId: "space-1",
      action: "expense.deleted",
      resourceType: "expense",
      resourceId: "expense-1",
    });
  });

  it("ignores unrecognized and read-only route shapes", () => {
    expect(describeMutation({ path: "/api/auth/login", method: "POST", body: {} }, {}, null)).toBeNull();
    expect(describeMutation({ path: "/api/lifespaces/x/dashboard", method: "GET", body: {} }, {}, null)).toBeNull();
    expect(describeMutation({ path: "/api/notifications/n1", method: "PATCH", body: {} }, {}, null)).toBeNull();
  });

  it("rejects malformed filters and cursors with precise 400 responses", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    const paths = [
      "?action=UPPER CASE",
      "?resourceType=bad-type!",
      "?from=not-a-date",
      "?to=still-not-a-date",
      "?cursor=broken",
    ];
    for (const query of paths) {
      const response = await api().get(`/api/lifespaces/${space.id}/audit-logs${query}`).set(owner.headers);
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(String));
    }
  });

  it("clamps page limits to one through one hundred", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "private" });
    let response = await api().get(`/api/lifespaces/${space.id}/audit-logs?limit=9999`).set(owner.headers);
    expect(response.status).toBe(200);
    expect(response.body.page.limit).toBe(100);
    response = await api().get(`/api/lifespaces/${space.id}/audit-logs?limit=-8`).set(owner.headers);
    expect(response.body.page.limit).toBe(1);
  });

  it("returns 404 for an unknown life space without disclosing audit data", async () => {
    const owner = await registerUser();
    const response = await api().get("/api/lifespaces/missing/audit-logs").set(owner.headers);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Life space not found" });
  });
});
