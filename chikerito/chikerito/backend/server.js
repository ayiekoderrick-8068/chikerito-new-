require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const lifeSpaceRoutes = require("./routes/lifespaces");
const categoryRoutes = require("./routes/categories");
const expenseRoutes = require("./routes/expenses");
const contributionRoutes = require("./routes/contributions");
const dashboardRoutes = require("./routes/dashboard");
const reportRoutes = require("./routes/report");
const taskRoutes = require("./routes/tasks");

const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" })); // cover photos are uploaded as base64 data URLs

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "chikerito-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/lifespaces", lifeSpaceRoutes);
app.use("/api", categoryRoutes);   // /api/lifespaces/:id/categories, /api/categories/:id
app.use("/api", expenseRoutes);    // /api/lifespaces/:id/expenses, /api/expenses/:id
app.use("/api", contributionRoutes); // /api/lifespaces/:id/contributions, /api/public/lifespaces/:slug/contribute
app.use("/api", dashboardRoutes);  // /api/lifespaces/:id/dashboard
app.use("/api", reportRoutes);     // /api/public/lifespaces/:slug/report
app.use("/api", taskRoutes);       // /api/lifespaces/:id/tasks, /api/tasks/:id

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || err.statusCode || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Chikerito API listening on port ${PORT}`));
