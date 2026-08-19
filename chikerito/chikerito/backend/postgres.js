const db = require("./db");

const LOCK_ID = 728491;
let pool;

function enabled() {
  return Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== "test";
}

function getPool() {
  if (!pool) {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch {
      throw new Error("PostgreSQL production mode requires the 'pg' package. Run npm install before deployment.");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
      max: Number(process.env.DATABASE_POOL_SIZE) || 10,
    });
  }
  return pool;
}

async function loadState(client) {
  const state = db.emptyState();
  for (const table of db.TABLES) {
    const result = await client.query(`SELECT data FROM ${table} ORDER BY id`);
    state[table] = result.rows.map((row) => row.data);
  }
  return state;
}

async function persistState(client, data) {
  const reverse = [...db.TABLES].reverse();
  for (const table of reverse) await client.query(`DELETE FROM ${table}`);
  for (const table of db.TABLES) {
    for (const row of data[table]) {
      await client.query(`INSERT INTO ${table} (id, data) VALUES ($1::uuid, $2::jsonb)`, [row.id, row]);
    }
  }
}

function postgresRequest(req, res, next) {
  if (!enabled()) return next();
  getPool().connect().then(async (client) => {
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
      const state = { data: await loadState(client), dirty: false };
      let finalized = false;
      const finalize = async (commit) => {
        if (finalized) return;
        finalized = true;
        try {
          if (commit && state.dirty) await persistState(client, state.data);
          await client.query(commit ? "COMMIT" : "ROLLBACK");
        } catch (error) {
          try { await client.query("ROLLBACK"); } catch {}
          console.error("PostgreSQL transaction failed", error);
        } finally {
          client.release();
        }
      };
      res.once("finish", () => finalize(res.statusCode < 500));
      res.once("close", () => finalize(false));
      db.runWithState(state, next);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      client.release();
      next(error);
    }
  }).catch(next);
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { enabled, postgresRequest, getPool, loadState, persistState, closePool };
