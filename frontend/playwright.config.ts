import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke test against a RUNNING app (./start.sh). Read-only: it opens pages and
 * clicks around but never saves anything, so it is safe on your real data.
 *   npm run e2e                      # http://127.0.0.1:5173, your installed Google Chrome
 *   E2E_BASE_URL=http://host:port npm run e2e
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    channel: process.env.E2E_CHANNEL ?? "chrome", // the installed Chrome: no browser download
    headless: true,
    trace: "retain-on-failure",
  },
});
