// The Express application, with no listener attached.
//
// Kept separate from server.js so that tests (and any future serverless or
// multi-process host) can mount the app directly without binding a port.
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const lifeSpaceRoutes = require("./routes/lifespaces");
const categoryRoutes = require("./routes/categories");
const expenseRoutes = require("./routes/expenses");
const contributionRoutes = require("./routes/contributions").router;
const dashboardRoutes = require("./routes/dashboard");
const reportRoutes = require("./routes/report");
const taskRoutes = require("./routes/tasks");
const notificationRoutes = require("./routes/notifications");
const invitationRoutes = require("./routes/invitations");
const recurringExpenseRoutes = require("./routes/recurringExpenses");
const currencyRoutes = require("./routes/currencies");
const recurringExceptionRoutes = require("./routes/recurringExceptions").router;
const budgetScenarioRoutes = require("./routes/budgetScenarios");
const analyticsRoutes = require("./routes/analytics");
const auditRoutes = require("./routes/auditLogs");
const { auditMutations } = require("./audit");
const { postgresRequest } = require("./postgres");
const { stripeWebhook } = require("./routes/contributions");
const { rateLimit } = require("./rateLimit");

function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

  const configuredOrigins = (process.env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || process.env.NODE_ENV !== "production" || configuredOrigins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error("Origin not allowed"), { status: 403 }));
    },
  }));
  app.use(auditMutations);
  app.use(postgresRequest);
  app.post("/api/payments/stripe/webhook", express.raw({ type: "application/json", limit: "256kb" }), stripeWebhook);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 10_000 : 100 }));

  app.get("/api/health", (req, res) => res.json({ status: "ok", service: "chikerito-api" }));
  app.use("/api", currencyRoutes);

  app.use("/api/auth", authRoutes);
  app.use("/api/lifespaces", lifeSpaceRoutes);
  app.use("/api", categoryRoutes);     // /api/lifespaces/:id/categories, /api/categories/:id
  app.use("/api", expenseRoutes);      // /api/lifespaces/:id/expenses, /api/expenses/:id
  app.use("/api", contributionRoutes); // /api/lifespaces/:id/contributions, /api/public/lifespaces/:slug/contribute
  app.use("/api", dashboardRoutes);    // /api/lifespaces/:id/dashboard
  app.use("/api", reportRoutes);       // /api/public/lifespaces/:slug/report
  app.use("/api", taskRoutes);         // /api/lifespaces/:id/tasks, /api/tasks/:id
  app.use("/api", notificationRoutes); // /api/lifespaces/:id/notifications, /api/notifications/:id
  app.use("/api", invitationRoutes);   // /api/lifespaces/:id/invitations, /api/invitations/:id/accept|decline, /api/invitations/pending
  app.use("/api", recurringExpenseRoutes); // /api/lifespaces/:id/recurring-expenses, /api/recurring-expenses/:id
  app.use("/api", recurringExceptionRoutes); // /api/recurring-expenses/:id/occurrences|exceptions
  app.use("/api", budgetScenarioRoutes); // /api/lifespaces/:id/budget-scenarios, /api/budget-scenarios/:id
  app.use("/api", analyticsRoutes); // /api/lifespaces/:id/analytics
  app.use("/api", auditRoutes);       // /api/lifespaces/:id/audit-logs

  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "Malformed JSON body" });
    }
    if (process.env.NODE_ENV !== "test") console.error(err);
    const status = err.status || err.statusCode || 500;
    const message = status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error" : (err.message || "Internal server error");
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
