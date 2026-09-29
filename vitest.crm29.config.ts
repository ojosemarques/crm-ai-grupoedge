import "dotenv/config";

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for CRM-29 integration tests.");
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/crm29/**/*.integration.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
