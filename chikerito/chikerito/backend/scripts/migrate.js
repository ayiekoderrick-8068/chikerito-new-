require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const files = fs.readdirSync(path.join(__dirname, "..", "migrations")).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      await pool.query(fs.readFileSync(path.join(__dirname, "..", "migrations", file), "utf8"));
      console.log(`Applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
