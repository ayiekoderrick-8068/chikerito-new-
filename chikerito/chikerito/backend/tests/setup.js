// Runs before the test framework and before any module under test is required,
// so environment-dependent modules (JWT secret, datastore path) pick these up.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-do-not-use-in-production";
// Password-hash behavior is covered by the tests, but production-strength
// work factors make suite duration depend heavily on host CPU contention.
// Production keeps the route's default of 10 rounds; tests use a standard
// low work factor so timeout-based results remain deterministic.
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || "4";
