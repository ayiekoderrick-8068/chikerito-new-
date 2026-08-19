module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setup.js"],
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  collectCoverageFrom: [
    "routes/**/*.js",
    "middleware/**/*.js",
    "db.js",
    "app.js",
    "publicAccess.js",
    "notify.js",
  ],
  coverageDirectory: "coverage",
  testTimeout: 15000,
  clearMocks: true,
  verbose: false,
};
