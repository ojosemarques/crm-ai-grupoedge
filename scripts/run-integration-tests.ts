import "dotenv/config";

import { spawnSync } from "node:child_process";

import {
  createEphemeralTestSchema,
  dropEphemeralTestSchema,
  resolveTestSchemaTarget,
  shouldKeepTestSchema,
} from "@/shared/core/database/test-schema-lifecycle";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL é obrigatória para os testes de integração.");
const localDatabaseUrl = baseUrl;

const requestedTests = process.argv.slice(2).filter((argument) => argument !== "--");

function run(args: readonly string[], databaseUrl: string, schema: string): void {
  const result = spawnSync("pnpm", [...args], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PRISMA_TEST_SCHEMA: schema,
    },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Comando de integração falhou com status ${result.status ?? 1}.`);
}

let failed = false;

async function runIsolatedSuite(_label: string, tests: readonly string[]) {
  const target = resolveTestSchemaTarget(localDatabaseUrl, "integration");
  await createEphemeralTestSchema(target);
  try {
    run(["db:test:migrate"], target.databaseUrl, target.schema);
    run(
      ["exec", "vitest", "run", "--config", "vitest.integration.config.ts", ...tests],
      target.databaseUrl,
      target.schema,
    );
  } catch (error) {
    failed = true;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    if (shouldKeepTestSchema(process.env)) {
      process.stdout.write(
        `KEEP_TEST_SCHEMA=1: schema preservado ${target.schema}. Remova depois com: pnpm db:test:cleanup -- --confirm=DROP_LOCAL_TEST_SCHEMAS\n`,
      );
    } else {
      await dropEphemeralTestSchema(target);
    }
  }
}

if (requestedTests.length > 0) {
  await runIsolatedSuite("integration", requestedTests);
} else {
  await runIsolatedSuite("integration", [
    "--exclude", "tests/integration/farmer.integration.test.ts",
    "--exclude", "tests/integration/forecast.integration.test.ts",
    "--exclude", "tests/integration/revenue-metrics.integration.test.ts",
    "--exclude", "tests/integration/stage14-acquisition.integration.test.ts",
    "--exclude", "tests/integration/stage14-public-api.integration.test.ts",
  ]);
  await runIsolatedSuite("integration_farmer", ["tests/integration/farmer.integration.test.ts"]);
  await runIsolatedSuite("integration_forecast", ["tests/integration/forecast.integration.test.ts"]);
  await runIsolatedSuite("integration_revenue_metrics", ["tests/integration/revenue-metrics.integration.test.ts"]);
  await runIsolatedSuite("integration_stage14", ["tests/integration/stage14-acquisition.integration.test.ts", "tests/integration/stage14-public-api.integration.test.ts"]);
}

if (failed) process.exitCode = 1;
