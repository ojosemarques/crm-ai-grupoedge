import "dotenv/config";

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { assertSafeTestSchemaName } from "./src/shared/core/database/test-schema-lifecycle";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for relational integration tests.");
}

const integrationDatabaseUrl = new URL(databaseUrl);
const integrationSchema = process.env.PRISMA_TEST_SCHEMA;
if (!integrationSchema) throw new Error("PRISMA_TEST_SCHEMA is required; use pnpm test:integration.");
integrationDatabaseUrl.searchParams.set("schema", assertSafeTestSchemaName(integrationSchema));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      DATABASE_URL: integrationDatabaseUrl.toString(),
    },
  },
});
