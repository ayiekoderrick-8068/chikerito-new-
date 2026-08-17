// invitations.js has no equivalent in the old snapshot or in the RBAC phase
// (which had immediate-grant POST /:id/team instead) — new baseline
// coverage for a new feature, not an adaptation.
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const {
  api,
  registerUser,
  createLifeSpace,
  addTeamMember,
} = require("./helpers/factories");

function invite(ownerHeaders, spaceId, email, role = "volunteer") {
  return api().post(`/api/lifespaces/${spaceId}/invitations`).set(ownerHeaders).send({ email, role });
}

describe("POST /api/lifespaces/:id/invitations", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("creates a pending invitation", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, "future@chikerito.test", "finance_manager");
    expect(res.status).toBe(201);
    expect(res.body.invitation).toMatchObject({
      life_space_id: space.id,
      email: "future@chikerito.test",
      role: "finance_manager",
      status: "pending",
    });
  });

  it("does not require the invited email to already have an account", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, "never-signed-up@chikerito.test");
    expect(res.status).toBe(201);
  });

  it("normalizes the invited email to lowercase", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, "MiXeD@Chikerito.test");
    expect(res.body.invitation.email).toBe("mixed@chikerito.test");
  });

  it("sets an expiry in the future", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, "future@chikerito.test");
    expect(new Date(res.body.invitation.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("requires an email", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/invitations`).set(owner.headers).send({ role: "volunteer" });
    expect(res.status).toBe(400);
  });

  it("rejects role=owner", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, "future@chikerito.test", "owner");
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognised role", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, "future@chikerito.test", "super-admin");
    expect(res.status).toBe(400);
  });

  it("prevents inviting someone who is already a member", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const helper = await registerUser();
    await addTeamMember(owner.token, space.id, helper, "volunteer");
    const res = await invite(owner.headers, space.id, helper.user.email, "editor");
    expect(res.status).toBe(409);
  });

  it("prevents inviting the owner themselves", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await invite(owner.headers, space.id, owner.user.email, "editor");
    expect(res.status).toBe(409);
  });

  it("prevents a duplicate active invitation to the same email", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await invite(owner.headers, space.id, "future@chikerito.test", "volunteer");
    const res = await invite(owner.headers, space.id, "future@chikerito.test", "editor");
    expect(res.status).toBe(409);
  });

  it("allows a fresh invitation once the earlier one is revoked", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await invite(owner.headers, space.id, "future@chikerito.test");
    await api().delete(`/api/lifespaces/${space.id}/invitations/${first.body.invitation.id}`).set(owner.headers);
    const second = await invite(owner.headers, space.id, "future@chikerito.test");
    expect(second.status).toBe(201);
  });

  it("allows a fresh invitation once the earlier one has expired", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await invite(owner.headers, space.id, "future@chikerito.test");
    const db = require("../db");
    db.table("invitations").update(first.body.invitation.id, { expires_at: "2020-01-01T00:00:00.000Z" });
    const second = await invite(owner.headers, space.id, "future@chikerito.test");
    expect(second.status).toBe(201);
  });

  it("allows re-inviting the same email after a decline", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const first = await invite(owner.headers, space.id, invitee.user.email);
    await api().post(`/api/invitations/${first.body.invitation.id}/decline`).set(invitee.headers);
    const second = await invite(owner.headers, space.id, invitee.user.email);
    expect(second.status).toBe(201);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().post(`/api/lifespaces/${space.id}/invitations`).send({ email: "x@y.z", role: "volunteer" });
    expect(res.status).toBe(401);
  });

  it("403s a non-owner, including a role with edit_settings", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const editor = await registerUser();
    await addTeamMember(owner.token, space.id, editor, "editor");
    const res = await invite(editor.headers, space.id, "future@chikerito.test");
    expect(res.status).toBe(403);
  });

  it("404s an unknown life space", async () => {
    const owner = await registerUser();
    const res = await invite(owner.headers, "no-such-id", "future@chikerito.test");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/lifespaces/:id/invitations", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("lists pending invitations for the life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await invite(owner.headers, space.id, "a@chikerito.test");
    await invite(owner.headers, space.id, "b@chikerito.test");
    const res = await api().get(`/api/lifespaces/${space.id}/invitations`).set(owner.headers);
    expect(res.body.invitations).toHaveLength(2);
    expect(res.body.invitations.every((i) => i.status === "pending")).toBe(true);
  });

  it("excludes accepted, declined, revoked, and expired invitations", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const accepted = await registerUser();
    await addTeamMember(owner.token, space.id, accepted, "volunteer");

    const declinee = await registerUser();
    const declined = await invite(owner.headers, space.id, declinee.user.email);
    await api().post(`/api/invitations/${declined.body.invitation.id}/decline`).set(declinee.headers);

    const revoked = await invite(owner.headers, space.id, "revoked@chikerito.test");
    await api().delete(`/api/lifespaces/${space.id}/invitations/${revoked.body.invitation.id}`).set(owner.headers);

    const expired = await invite(owner.headers, space.id, "expired@chikerito.test");
    require("../db").table("invitations").update(expired.body.invitation.id, { expires_at: "2020-01-01T00:00:00.000Z" });

    const res = await api().get(`/api/lifespaces/${space.id}/invitations`).set(owner.headers);
    expect(res.body.invitations).toEqual([]);
  });

  it("any role, including volunteer, can view pending invitations", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const volunteer = await registerUser();
    await addTeamMember(owner.token, space.id, volunteer, "volunteer");
    await invite(owner.headers, space.id, "future@chikerito.test");
    const res = await api().get(`/api/lifespaces/${space.id}/invitations`).set(volunteer.headers);
    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(1);
  });

  it("403s a non-member, 404s an unknown life space", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const stranger = await registerUser();
    expect((await api().get(`/api/lifespaces/${space.id}/invitations`).set(stranger.headers)).status).toBe(403);
    expect((await api().get("/api/lifespaces/no-such-id/invitations").set(owner.headers)).status).toBe(404);
  });
});

describe("DELETE /api/lifespaces/:id/invitations/:invitationId (revoke)", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("revokes a pending invitation", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, "future@chikerito.test");
    const res = await api().delete(`/api/lifespaces/${space.id}/invitations/${inv.body.invitation.id}`).set(owner.headers);
    expect(res.status).toBe(204);
    const list = await api().get(`/api/lifespaces/${space.id}/invitations`).set(owner.headers);
    expect(list.body.invitations).toEqual([]);
  });

  it("a revoked invitation can no longer be accepted", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    await api().delete(`/api/lifespaces/${space.id}/invitations/${inv.body.invitation.id}`).set(owner.headers);
    const acceptRes = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);
    expect(acceptRes.status).toBe(409);
  });

  it("403s a non-owner", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const editor = await registerUser();
    await addTeamMember(owner.token, space.id, editor, "editor");
    const inv = await invite(owner.headers, space.id, "future@chikerito.test");
    const res = await api().delete(`/api/lifespaces/${space.id}/invitations/${inv.body.invitation.id}`).set(editor.headers);
    expect(res.status).toBe(403);
  });

  it("404s an invitation id that doesn't belong to the given life space", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token);
    const invA = await invite(ownerA.headers, spaceA.id, "future@chikerito.test");

    const ownerB = await registerUser();
    const spaceB = await createLifeSpace(ownerB.token);

    const res = await api().delete(`/api/lifespaces/${spaceB.id}/invitations/${invA.body.invitation.id}`).set(ownerB.headers);
    expect(res.status).toBe(404);
  });

  it("404s an unknown invitation id", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const res = await api().delete(`/api/lifespaces/${space.id}/invitations/no-such-id`).set(owner.headers);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/invitations/pending", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("lists invitations addressed to the caller's own email, with the life space title", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { title: "Ada's Wedding" });
    const invitee = await registerUser();
    await invite(owner.headers, space.id, invitee.user.email);

    const res = await api().get("/api/invitations/pending").set(invitee.headers);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].lifeSpaceTitle).toBe("Ada's Wedding");
  });

  it("does not list another account's invitations", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    await invite(owner.headers, space.id, "someone-else@chikerito.test");

    const uninvolvedUser = await registerUser();
    const res = await api().get("/api/invitations/pending").set(uninvolvedUser.headers);
    expect(res.body.invitations).toEqual([]);
  });

  it("does not list resolved or expired invitations", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token);
    const invitee = await registerUser();
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    await api().post(`/api/invitations/${inv.body.invitation.id}/decline`).set(invitee.headers);

    const res = await api().get("/api/invitations/pending").set(invitee.headers);
    expect(res.body.invitations).toEqual([]);
  });

  it("401s without a token", async () => {
    const res = await api().get("/api/invitations/pending");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/invitations/:id/accept", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("adds the caller to the team with the invited role", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email, "editor");

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("accepted");

    const dashboardCheck = await api().get(`/api/lifespaces/${space.id}`).set(invitee.headers);
    expect(dashboardCheck.status).toBe(200);
    expect(dashboardCheck.body.lifeSpace.role).toBe("editor");
  });

  it("removes the invitation from the pending list once accepted", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);

    const list = await api().get(`/api/lifespaces/${space.id}/invitations`).set(owner.headers);
    expect(list.body.invitations).toEqual([]);
  });

  it("raises a team_joined notification visible to the life space", async () => {
    const owner = await registerUser();
    const invitee = await registerUser({ firstName: "Nia", lastName: "Okoye" });
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email, "volunteer");
    await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);

    const notifications = await api().get(`/api/lifespaces/${space.id}/notifications`).set(owner.headers);
    const joined = notifications.body.notifications.find((n) => n.type === "team_joined");
    expect(joined).toBeDefined();
    expect(joined.message).toContain("Nia Okoye");
  });

  it("403s when the accepting account's email doesn't match the invitation", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const impostor = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(impostor.headers);
    expect(res.status).toBe(403);

    // Confirms this is a real security boundary, not just a UI nicety.
    const check = await api().get(`/api/lifespaces/${space.id}`).set(impostor.headers);
    expect(check.status).toBe(403);
  });

  it("409s accepting an already-accepted invitation twice", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);
    expect(res.status).toBe(409);
  });

  it("409s accepting a declined invitation", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    await api().post(`/api/invitations/${inv.body.invitation.id}/decline`).set(invitee.headers);

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);
    expect(res.status).toBe(409);
  });

  it("409s accepting an expired invitation and does not create a membership", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    require("../db").table("invitations").update(inv.body.invitation.id, { expires_at: "2020-01-01T00:00:00.000Z" });

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);
    expect(res.status).toBe(409);

    const check = await api().get(`/api/lifespaces/${space.id}`).set(invitee.headers);
    expect(check.status).toBe(403);
  });

  it("404s an unknown invitation id", async () => {
    const invitee = await registerUser();
    const res = await api().post("/api/invitations/no-such-id/accept").set(invitee.headers);
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/accept`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/invitations/:id/decline", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("marks the invitation declined without creating a membership", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/decline`).set(invitee.headers);
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("declined");

    const check = await api().get(`/api/lifespaces/${space.id}`).set(invitee.headers);
    expect(check.status).toBe(403);
  });

  it("403s when the declining account's email doesn't match the invitation", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const impostor = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/decline`).set(impostor.headers);
    expect(res.status).toBe(403);
  });

  it("409s declining an already-resolved invitation", async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const space = await createLifeSpace(owner.token);
    const inv = await invite(owner.headers, space.id, invitee.user.email);
    await api().post(`/api/invitations/${inv.body.invitation.id}/decline`).set(invitee.headers);

    const res = await api().post(`/api/invitations/${inv.body.invitation.id}/decline`).set(invitee.headers);
    expect(res.status).toBe(409);
  });
});

describe("cross-tenant isolation", () => {
  beforeEach(() => freshDatabase());
  afterAll(() => cleanupDatabases());

  it("an owner with no role at all on a different life space cannot revoke its invitations", async () => {
    const ownerA = await registerUser();
    const spaceA = await createLifeSpace(ownerA.token);
    const invA = await invite(ownerA.headers, spaceA.id, "future@chikerito.test");

    const ownerB = await registerUser();
    await createLifeSpace(ownerB.token);

    const res = await api().delete(`/api/lifespaces/${spaceA.id}/invitations/${invA.body.invitation.id}`).set(ownerB.headers);
    expect(res.status).toBe(403); // ownerB isn't a member of spaceA at all
  });

  it("accepting an invitation only grants access to that one life space, not the inviter's others", async () => {
    const owner = await registerUser();
    const spaceA = await createLifeSpace(owner.token, { title: "A" });
    const spaceB = await createLifeSpace(owner.token, { title: "B" });
    const invitee = await registerUser();
    const inv = await invite(owner.headers, spaceA.id, invitee.user.email);
    await api().post(`/api/invitations/${inv.body.invitation.id}/accept`).set(invitee.headers);

    expect((await api().get(`/api/lifespaces/${spaceA.id}`).set(invitee.headers)).status).toBe(200);
    expect((await api().get(`/api/lifespaces/${spaceB.id}`).set(invitee.headers)).status).toBe(403);
  });
});
