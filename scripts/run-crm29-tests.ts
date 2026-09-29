import "dotenv/config";

import { spawnSync } from "node:child_process";

import {
  createEphemeralTestSchema,
  dropEphemeralTestSchema,
  resolveTestSchemaTarget,
  shouldKeepTestSchema,
} from "@/shared/core/database/test-schema-lifecycle";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL é obrigatória para os testes CRM-29.");
const target = resolveTestSchemaTarget(baseUrl, "crm29");
await createEphemeralTestSchema(target);

function run(args: readonly string[]): void {
  const result = spawnSync("pnpm", args, {
    env: { ...process.env, DATABASE_URL: target.databaseUrl },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Comando CRM-29 falhou com status ${result.status ?? 1}.`);
}

let failed = false;
try {
  run(["db:migrate:deploy"]);
  run(["exec", "vitest", "run", "--config", "vitest.crm29.config.ts"]);
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
