require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { getPool, persistState, closePool } = require("../postgres");

async function main() {
  const source = path.resolve(process.argv[2] || db.DEFAULT_DB_FILE);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!fs.existsSync(source)) throw new Error(`JSON database not found: ${source}`);
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  const state = db.emptyState();
  for (const table of db.TABLES) if (Array.isArray(parsed[table])) state[table] = parsed[table];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [728491]);
    await persistState(client, state);
    await client.query("COMMIT");
    console.log(`Imported ${db.TABLES.reduce((sum, table) => sum + state[table].length, 0)} rows from ${source}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
