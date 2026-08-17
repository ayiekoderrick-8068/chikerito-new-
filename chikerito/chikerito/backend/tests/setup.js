// Runs before the test framework and before any module under test is required,
// so environment-dependent modules (JWT secret, datastore path) pick these up.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-do-not-use-in-production";
