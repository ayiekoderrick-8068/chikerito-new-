const fs = require("fs");
const path = require("path");
const db = require("../../db");

const created = new Set();

// Point the process at a brand-new empty database file. Call this in a
// beforeEach so no test can ever observe another test's rows.
function freshDatabase() {
  const file = db.useTempFile("chikerito-test");
  created.add(path.dirname(file));
  return file;
}

// Remove every temp database this process created.
function cleanupDatabases() {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // Best effort — a leftover temp dir must never fail a test run.
    }
  }
  created.clear();
  delete process.env.CHIKERITO_DB_FILE;
}

// Read the raw datastore, for assertions about persisted shape.
function rawState() {
  return db.load();
}

module.exports = { freshDatabase, cleanupDatabases, rawState };
