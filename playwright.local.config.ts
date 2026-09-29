import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_LOCAL_BASE_URL ?? "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? ".cache/playwright-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  grep: /@local-only/,
  timeout: 90_000,
  // The first dev-server mutation compiles the login route on demand. Keep the
  // local-only assertion above that cold-start window without weakening the
  // production-server suite.
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium-local", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3101",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
