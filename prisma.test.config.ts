import "dotenv/config";

import { defineConfig, env } from "prisma/config";

import { assertSafeTestSchemaName } from "./src/shared/core/database/test-schema-lifecycle";

const integrationSchema = process.env.PRISMA_TEST_SCHEMA;
if (!integrationSchema) {
  throw new Error("PRISMA_TEST_SCHEMA é obrigatória; use pnpm test:integration.");
}

assertSafeTestSchemaName(integrationSchema);

const integrationDatabaseUrl = new URL(env("DATABASE_URL"));
integrationDatabaseUrl.searchParams.set("schema", integrationSchema);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: integrationDatabaseUrl.toString(),
  },
});
