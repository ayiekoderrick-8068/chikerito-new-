const fs = require("fs");
const path = require("path");
const db = require("../db");
const { freshDatabase, cleanupDatabases } = require("./helpers/database");

describe("db — JSON datastore", () => {
  let file;

  beforeEach(() => {
    file = freshDatabase();
  });

  afterAll(() => {
    cleanupDatabases();
  });

  describe("file handling", () => {
    it("creates the database file on first access", () => {
      expect(fs.existsSync(file)).toBe(true);
    });

    it("honours CHIKERITO_DB_FILE over the default location", () => {
      expect(db.dbFile()).toBe(file);
      expect(db.dbFile()).not.toBe(db.DEFAULT_DB_FILE);
    });

    it("starts with every table present and empty", () => {
      const state = db.load();
      for (const name of db.TABLES) {
        expect(Array.isArray(state[name])).toBe(true);
        expect(state[name]).toHaveLength(0);
      }
    });

    it("creates missing parent directories", () => {
      const nested = path.join(path.dirname(file), "deep", "nested", "db.json");
      process.env.CHIKERITO_DB_FILE = nested;
      db.reset();
      expect(fs.existsSync(nested)).toBe(true);
    });

    it("leaves no temp files behind after a write", () => {
      db.table("users").insert({ id: "u1", email: "a@b.c" });
      const leftovers = fs
        .readdirSync(path.dirname(file))
        .filter((f) => f.endsWith(".tmp"));
      expect(leftovers).toHaveLength(0);
    });

    it("persists writes across a reload", () => {
      db.table("users").insert({ id: "u1", email: "a@b.c" });
      const reread = JSON.parse(fs.readFileSync(file, "utf-8"));
      expect(reread.users).toHaveLength(1);
      expect(reread.users[0].email).toBe("a@b.c");
    });

    it("tolerates a file missing a table added in a later version", () => {
      fs.writeFileSync(file, JSON.stringify({ users: [{ id: "u1" }] }));
      const state = db.load();
      expect(state.users).toHaveLength(1);
      expect(state.expenses).toEqual([]);
      expect(state.notifications).toEqual([]);
    });

    it("throws a descriptive error on a corrupt file", () => {
      fs.writeFileSync(file, "{ this is not json");
      expect(() => db.load()).toThrow(/Corrupt database file/);
    });
  });

  describe("table API", () => {
    it("rejects an unknown table name", () => {
      expect(() => db.table("wizards")).toThrow(/Unknown table/);
    });

    it("inserts and returns the row", () => {
      const row = db.table("users").insert({ id: "u1", email: "a@b.c" });
      expect(row).toEqual({ id: "u1", email: "a@b.c" });
      expect(db.table("users").all()).toHaveLength(1);
    });

    it("finds a row by id", () => {
      db.table("users").insert({ id: "u1", email: "a@b.c" });
      expect(db.table("users").find("u1").email).toBe("a@b.c");
    });

    it("returns undefined for a missing id", () => {
      expect(db.table("users").find("nope")).toBeUndefined();
    });

    it("filters with where", () => {
      db.table("users").insert({ id: "u1", email: "a@b.c" });
      db.table("users").insert({ id: "u2", email: "d@e.f" });
      expect(db.table("users").where((u) => u.email.startsWith("d"))).toHaveLength(1);
    });

    it("counts all rows and filtered rows", () => {
      db.table("expenses").insert({ id: "e1", amount: 10 });
      db.table("expenses").insert({ id: "e2", amount: 40 });
      expect(db.table("expenses").count()).toBe(2);
      expect(db.table("expenses").count((e) => e.amount > 20)).toBe(1);
    });

    it("merges a patch on update and leaves other fields intact", () => {
      db.table("users").insert({ id: "u1", email: "a@b.c", first_name: "Ada" });
      const updated = db.table("users").update("u1", { first_name: "Grace" });
      expect(updated.first_name).toBe("Grace");
      expect(updated.email).toBe("a@b.c");
    });

    it("returns null when updating a missing row", () => {
      expect(db.table("users").update("nope", { first_name: "X" })).toBeNull();
    });

    it("removes a row and reports whether anything was removed", () => {
      db.table("users").insert({ id: "u1" });
      expect(db.table("users").remove("u1")).toBe(true);
      expect(db.table("users").all()).toHaveLength(0);
      expect(db.table("users").remove("u1")).toBe(false);
    });

    it("replaces every row in a table", () => {
      db.table("users").insert({ id: "u1" });
      db.table("users").replaceAll([{ id: "x" }, { id: "y" }]);
      expect(db.table("users").all().map((u) => u.id)).toEqual(["x", "y"]);
    });

    it("keeps tables isolated from one another", () => {
      db.table("users").insert({ id: "u1" });
      expect(db.table("expenses").all()).toHaveLength(0);
    });

    // The old snapshot this suite was adapted from predates the tasks table
    // (added alongside routes/tasks.js since then).
    it("includes the tasks table added since the old snapshot", () => {
      expect(db.TABLES).toContain("tasks");
      expect(() => db.table("tasks").insert({ id: "t1" })).not.toThrow();
      expect(db.table("tasks").all()).toHaveLength(1);
    });

    it("empties every table on reset", () => {
      db.table("users").insert({ id: "u1" });
      db.table("expenses").insert({ id: "e1" });
      db.reset();
      expect(db.table("users").all()).toHaveLength(0);
      expect(db.table("expenses").all()).toHaveLength(0);
    });
  });
});
