import "dotenv/config";

import { spawnSync } from "node:child_process";

import { Client } from "pg";

import { assertSafeDemoResetTarget } from "@/modules/settings/application/crm29-demo-data-service";

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const { databaseUrl, schema } = assertSafeDemoResetTarget(process.env);
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.query(`CREATE SCHEMA "${schema}"`);
} finally {
  await client.end();
}

process.stdout.write(`Schema local de demonstração recriado: ${schema}\n`);
run("pnpm", ["db:migrate:deploy"]);
run("pnpm", ["db:seed"]);
