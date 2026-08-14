// Lightweight JSON-file datastore that mirrors schema.sql.
// Swap this module for a real Postgres/MySQL driver in production —
// every function here maps 1:1 to a table in schema.sql.
const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data", "db.json");

const EMPTY = {
  users: [],
  life_spaces: [],
  team_members: [],
  budget_categories: [],
  contributions: [],
  expenses: [],
  tasks: [],
  notifications: [],
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Simple synchronous "table" API: db.table("users").all(), .find(id), .insert(row), .update(id, patch), .remove(id)
function table(name) {
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
      data[name] = data[name].filter((r) => r.id !== id);
      save(data);
    },
    replaceAll(rows) {
      const data = load();
      data[name] = rows;
      save(data);
    },
  };
}

module.exports = { table, load, save };
