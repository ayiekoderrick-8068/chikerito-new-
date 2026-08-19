require("dotenv").config();
const { createApp } = require("./app");

if (process.env.NODE_ENV === "production") {
  const required = ["DATABASE_URL", "JWT_SECRET", "FRONTEND_URL", "CORS_ORIGINS", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "EMAIL_DELIVERY_URL", "EMAIL_DELIVERY_TOKEN"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  if (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === "change-this-to-a-long-random-string") {
    throw new Error("JWT_SECRET must be a unique secret of at least 32 characters");
  }
}

const app = createApp();
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => console.log(`Chikerito API listening on port ${PORT}`));
