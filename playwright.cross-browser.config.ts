import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_CROSS_BROWSER_BASE_URL ?? "http://127.0.0.1:3102";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ?? ".cache/playwright-cross-browser",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3102",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
