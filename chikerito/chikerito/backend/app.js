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
const recurringExceptionRoutes = require("./routes/recurringExceptions").router;

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "6mb" })); // cover photos are uploaded as base64 data URLs

  app.get("/api/health", (req, res) => res.json({ status: "ok", service: "chikerito-api" }));

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

  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "Malformed JSON body" });
    }
    if (process.env.NODE_ENV !== "test") console.error(err);
    res.status(err.status || err.statusCode || 500).json({ error: err.message || "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
