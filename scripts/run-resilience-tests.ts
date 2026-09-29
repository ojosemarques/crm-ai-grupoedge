import "dotenv/config";

import { spawnSync } from "node:child_process";

import { createEphemeralTestSchema, dropEphemeralTestSchema, resolveTestSchemaTarget, shouldKeepTestSchema } from "@/shared/core/database/test-schema-lifecycle";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL é obrigatória para CRM-63.");
const target = resolveTestSchemaTarget(sourceUrl, "resilience");
await createEphemeralTestSchema(target);
let failed = false;
try {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", DATABASE_URL: target.databaseUrl, PRISMA_TEST_SCHEMA: target.schema, RESILIENCE_FAULT_INJECTION: "1" };
  for (const args of [
    ["db:test:migrate"],
    ["exec", "vitest", "run", "--config", "vitest.integration.config.ts", "tests/integration/resilience-recovery.integration.test.ts"],
  ]) {
    const result = spawnSync("pnpm", args, { env, stdio: "inherit" });
    if (result.status !== 0) { failed = true; break; }
  }
} finally {
  if (shouldKeepTestSchema(process.env)) process.stdout.write(`Schema preservado: ${target.schema}. Limpe com pnpm db:test:cleanup -- --confirm=DROP_LOCAL_TEST_SCHEMAS\n`);
  else await dropEphemeralTestSchema(target);
}
if (failed) process.exitCode = 1;
