import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    globals: true,
    css: false,
    restoreMocks: true,
    // The UI suites exercise timers, document listeners, and optimistic async
    // state heavily. A single worker keeps those process-wide resources
    // isolated and avoids CPU-contention timeouts without relaxing assertions.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
