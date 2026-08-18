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
    // A single worker avoids cross-file timer and jsdom contention in repeat runs.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
