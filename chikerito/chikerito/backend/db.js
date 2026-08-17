// Lightweight JSON-file datastore that mirrors schema.sql.
// Swap this module for a real Postgres/MySQL driver in production —
// every function here maps 1:1 to a table in schema.sql.
//
// The file location is resolved on every call from CHIKERITO_DB_FILE so that
// test suites (and multiple local environments) can each point at their own
// isolated database without reloading the module.
const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_DB_FILE = path.join(__dirname, "data", "db.json");

const EMPTY = {
  users: [],
  sessions: [],
  password_resets: [],
  life_spaces: [],
  team_members: [],
  invitations: [],
  budget_categories: [],
  contributions: [],
  expenses: [],
  tasks: [],
  notifications: [],
};

const TABLES = Object.keys(EMPTY);

function emptyState() {
  return JSON.parse(JSON.stringify(EMPTY));
}

function dbFile() {
  return process.env.CHIKERITO_DB_FILE || DEFAULT_DB_FILE;
}

function ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  const file = dbFile();
  if (!fs.existsSync(file)) {
    ensureDir(file);
    writeAtomic(file, emptyState());
    return emptyState();
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`Corrupt database file at ${file}: ${err.message}`);
  }
  // Tolerate a file written by an older version that predates a table.
  const state = emptyState();
  for (const name of TABLES) {
    if (Array.isArray(parsed[name])) state[name] = parsed[name];
  }
  return state;
}

// Write to a sibling temp file, flush it, then rename over the target.
// rename(2) is atomic within a filesystem, so a crash mid-write can never
// leave a half-written database behind — readers see either the old file or
// the new one.
function writeAtomic(file, data) {
  ensureDir(file);
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = JSON.stringify(data, null, 2);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function save(data) {
  writeAtomic(dbFile(), data);
}

// Reset the current database to empty. Used by seeding and by test setup.
function reset() {
  save(emptyState());
}

// Create a throwaway database file (used by tests) and point the process at it.
function useTempFile(label = "chikerito") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  const file = path.join(dir, "db.json");
  process.env.CHIKERITO_DB_FILE = file;
  reset();
  return file;
}

// Simple synchronous "table" API: db.table("users").all(), .find(id), .insert(row), .update(id, patch), .remove(id)
function table(name) {
  if (!TABLES.includes(name)) {
    throw new Error(`Unknown table "${name}"`);
  }
  return {
    all() {
      return load()[name];
    },
    find(id) {
      return load()[name].find((r) => r.id === id);
    },
    where(pred) {
      return load()[name].filter(pred);
    },
    count(pred) {
      const rows = load()[name];
      return pred ? rows.filter(pred).length : rows.length;
    },
    insert(row) {
      const data = load();
      data[name].push(row);
      save(data);
      return row;
    },
    update(id, patch) {
      const data = load();
      const idx = data[name].findIndex((r) => r.id === id);
      if (idx === -1) return null;
      data[name][idx] = { ...data[name][idx], ...patch };
      save(data);
      return data[name][idx];
    },
    remove(id) {
      const data = load();
      const before = data[name].length;
      data[name] = data[name].filter((r) => r.id !== id);
      save(data);
      return before !== data[name].length;
    },
    replaceAll(rows) {
      const data = load();
      data[name] = rows;
      save(data);
      return rows;
    },
  };
}

module.exports = { table, load, save, reset, useTempFile, dbFile, TABLES, DEFAULT_DB_FILE };
