const crypto = require("crypto");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");
const { api, registerUser, createLifeSpace } = require("./helpers/factories");
const db = require("../db");

describe("Stripe webhook trust boundary", () => {
  beforeEach(() => {
    freshDatabase();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  });
  afterAll(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    cleanupDatabases();
  });

  function signature(body, timestamp = Math.floor(Date.now() / 1000)) {
    const digest = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
    return `t=${timestamp},v1=${digest}`;
  }

  it("rejects an unsigned completed-payment claim", async () => {
    const response = await api().post("/api/payments/stripe/webhook").set("Content-Type", "application/json").send({ type: "checkout.session.completed" });
    expect(response.status).toBe(400);
    expect(db.table("contributions").all()).toHaveLength(0);
  });

  it("records a paid provider amount once even when the event is delivered twice", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "public" });
    const event = {
      id: "evt_test_paid_once", type: "checkout.session.completed",
      data: { object: {
        payment_status: "paid", amount_total: 2500, currency: "usd", payment_intent: "pi_test",
        metadata: { life_space_id: space.id, category_id: "", contributor_name: "Verified donor", message: "" },
      } },
    };
    const body = JSON.stringify(event);
    const header = signature(body);
    expect((await api().post("/api/payments/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", header).send(body)).status).toBe(201);
    expect((await api().post("/api/payments/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", header).send(body)).status).toBe(200);
    expect(db.table("contributions").all()).toHaveLength(1);
    expect(db.table("contributions").all()[0]).toMatchObject({ amount: 25, status: "completed", source: "stripe" });
  });

  it("rejects a signed event whose provider status is not paid", async () => {
    const owner = await registerUser();
    const space = await createLifeSpace(owner.token, { visibility: "public" });
    const event = { id: "evt_unpaid", type: "checkout.session.completed", data: { object: {
      payment_status: "unpaid", amount_total: 2500, currency: "usd", metadata: { life_space_id: space.id },
    } } };
    const body = JSON.stringify(event);
    const response = await api().post("/api/payments/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", signature(body)).send(body);
    expect(response.status).toBe(400);
    expect(db.table("contributions").all()).toHaveLength(0);
  });
});
