import "dotenv/config";

import { spawnSync } from "node:child_process";

import {
  createEphemeralTestSchema,
  dropEphemeralTestSchema,
  resolveTestSchemaTarget,
  shouldKeepTestSchema,
} from "@/shared/core/database/test-schema-lifecycle";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL é obrigatória para os testes E2E.");

const target = resolveTestSchemaTarget(baseUrl, "e2e");
await createEphemeralTestSchema(target);
const requestedTests = process.argv.slice(2).filter((argument) => argument !== "--");

function run(args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}): void {
  const result = spawnSync("pnpm", [...args], {
    env: { ...process.env, DATABASE_URL: target.databaseUrl, ...extraEnv },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Comando E2E falhou com status ${result.status ?? 1}.`);
}

let failed = false;
try {
  run(["db:migrate:deploy"]);
  run(["db:seed"]);
  run(["build"]);
  run(["exec", "playwright", "test", "--config", "playwright.production.config.ts", ...requestedTests], {
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3100",
  });
  if (requestedTests.length === 0) {
    run(["exec", "playwright", "test", "--config", "playwright.local.config.ts"], {
      PLAYWRIGHT_LOCAL_BASE_URL: "http://127.0.0.1:3101",
    });
  }
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

if (failed) process.exitCode = 1;
