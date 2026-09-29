import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

import { Pool } from "pg";

import { evaluateLoadBudget, loadResultSchema, percentile, RESILIENCE_CONTRACT_VERSION, type LoadProfile } from "@/modules/resilience/domain/resilience-contracts";
import { createEphemeralTestSchema, dropEphemeralTestSchema, resolveTestSchemaTarget, shouldKeepTestSchema } from "@/shared/core/database/test-schema-lifecycle";
import { recordLocalResilienceEvidence } from "./lib/resilience-evidence";

type Cli = Readonly<{ execute: boolean; profile: LoadProfile; seed: number; concurrency: number; durationSeconds: number; target: "ephemeral"; output: string }>;

function parseCli(args: readonly string[]): Cli {
  const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const profile = (value("profile") ?? "smoke") as LoadProfile;
  if (!(["smoke", "baseline", "stress"] as const).includes(profile)) throw new Error("Perfil deve ser smoke, baseline ou stress.");
  const execute = args.includes("--execute");
  if (profile === "stress" && value("confirm") !== "RUN_LOCAL_STRESS") throw new Error("Stress exige --confirm=RUN_LOCAL_STRESS.");
  const defaults = profile === "smoke" ? { concurrency: 2, duration: 2 } : profile === "baseline" ? { concurrency: 8, duration: 10 } : { concurrency: 20, duration: 30 };
  const concurrency = Number(value("concurrency") ?? defaults.concurrency);
  const durationSeconds = Number(value("duration") ?? defaults.duration);
  const seed = Number(value("seed") ?? 63001);
  const target = value("target") ?? "ephemeral";
  if (target !== "ephemeral") throw new Error("O runner aceita somente --target=ephemeral.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error("Concorrência deve estar entre 1 e 100.");
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) throw new Error("Duração deve estar entre 1 e 300 segundos.");
  if (!Number.isInteger(seed)) throw new Error("Seed deve ser inteiro.");
  return { execute, profile, seed, concurrency, durationSeconds, target, output: resolve(value("output") ?? `.cache/resilience/load-${profile}.json`) };
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, [...args], { env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} falhou com status ${result.status ?? 1}.`);
}

const scenarios = [
  { name: "dashboard", sql: `SELECT count(*) FROM leads WHERE "deletedAt" IS NULL` },
  { name: "lead-list", sql: `SELECT id FROM leads WHERE "deletedAt" IS NULL ORDER BY priority DESC, "createdAt" DESC LIMIT 50` },
  { name: "timeline", sql: `SELECT id FROM activities ORDER BY "occurredAt" DESC LIMIT 50` },
  { name: "tasks", sql: `SELECT status, count(*) FROM tasks GROUP BY status` },
  { name: "meetings", sql: `SELECT status, count(*) FROM meetings GROUP BY status` },
  { name: "opportunities", sql: `SELECT status, count(*) FROM opportunities GROUP BY status` },
  { name: "jobs", sql: `SELECT id FROM jobs WHERE status = 'PENDING' ORDER BY priority DESC, "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED` },
  { name: "outbox", sql: `SELECT status, count(*) FROM outbox_events GROUP BY status` },
  { name: "reconciliation", sql: `SELECT status, count(*) FROM payment_reconciliation_issues GROUP BY status` },
  { name: "alerts", sql: `SELECT status, count(*) FROM observability_alerts GROUP BY status` },
  { name: "privacy", sql: `SELECT status, count(*) FROM data_subject_requests GROUP BY status` },
  { name: "lead-update-rollback", sql: `UPDATE leads SET "updatedAt" = "updatedAt" WHERE id = (SELECT id FROM leads LIMIT 1)` },
] as const;

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL é obrigatória.");
  const target = resolveTestSchemaTarget(sourceUrl, "resilience");
  const recordWorkspace = valueFromArgs(process.argv.slice(2), "record-workspace");
  if (!cli.execute) {
    process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN", ...cli, recordWorkspace: recordWorkspace ?? null, targetSchema: target.schema, localOnly: true, externalEgress: false }, null, 2)}\n`);
    return;
  }
  await createEphemeralTestSchema(target);
  let pool: Pool | undefined;
  try {
    run("pnpm", ["db:test:migrate"], { ...process.env, NODE_ENV: "test", DATABASE_URL: target.databaseUrl, PRISMA_TEST_SCHEMA: target.schema });
    run("pnpm", ["db:seed"], { ...process.env, NODE_ENV: "test", DATABASE_URL: target.databaseUrl, PRISMA_TEST_SCHEMA: target.schema });
    const parsed = new URL(target.adminDatabaseUrl);
    parsed.searchParams.set("options", `-c search_path=${target.schema}`);
    pool = new Pool({ connectionString: parsed.toString(), max: cli.concurrency, statement_timeout: 2_000, connectionTimeoutMillis: 2_000 });
    const backlogBefore = Number((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM jobs WHERE status IN ('PENDING', 'RUNNING')`)).rows[0]?.count ?? 0);
    const startedAt = new Date();
    const deadline = performance.now() + cli.durationSeconds * 1_000;
    const latencies: number[] = [];
    const byScenario = new Map<string, { latencies: number[]; errors: number }>();
    let requests = 0; let errors = 0; let timeouts = 0; let cursor = Math.abs(cli.seed);
    const worker = async () => {
      while (performance.now() < deadline) {
        cursor = (cursor * 1_664_525 + 1_013_904_223) >>> 0;
        const scenario = scenarios[cursor % scenarios.length]!;
        const stats = byScenario.get(scenario.name) ?? { latencies: [], errors: 0 };
        byScenario.set(scenario.name, stats);
        const began = performance.now();
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          await client.query(scenario.sql);
          await client.query("ROLLBACK");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          errors += 1; stats.errors += 1;
          if (error instanceof Error && /timeout/i.test(error.message)) timeouts += 1;
        } finally {
          client.release();
        }
        const latency = performance.now() - began;
        latencies.push(latency); stats.latencies.push(latency); requests += 1;
      }
    };
    await Promise.all(Array.from({ length: cli.concurrency }, worker));
    const finishedAt = new Date();
    const durationMs = Math.max(1, finishedAt.getTime() - startedAt.getTime());
    const throughputPerSecond = requests / (durationMs / 1_000);
    const p95 = percentile(latencies, 0.95);
    const budget = evaluateLoadBudget(cli.profile, { p95Ms: p95, errors, requests, throughputPerSecond });
    const backlogAfter = Number((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM jobs WHERE status IN ('PENDING', 'RUNNING')`)).rows[0]?.count ?? 0);
    const memory = process.memoryUsage();
    const bottleneck = budget.passed ? "Nenhum gargalo acima do budget local." : budget.reasons[0] ?? "Falha sem classificação.";
    const report = loadResultSchema.parse({
      contractVersion: RESILIENCE_CONTRACT_VERSION, profile: cli.profile, seed: cli.seed, targetSchema: target.schema,
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs, concurrency: cli.concurrency,
      requests, errors, timeouts, throughputPerSecond, latencyMs: { min: percentile(latencies, 0), p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9), p95, p99: percentile(latencies, 0.99), max: percentile(latencies, 1) },
      backlog: { before: backlogBefore, after: backlogAfter }, resources: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount },
      scenarios: [...byScenario].map(([name, stats]) => ({ name, requests: stats.latencies.length, errors: stats.errors, p95Ms: percentile(stats.latencies, 0.95) })),
      budget: { passed: budget.passed, reasons: budget.reasons }, bottleneck,
      recommendedAction: budget.passed ? "Manter baseline e repetir após mudanças de consulta ou pool." : "Investigar o primeiro budget violado antes de elevar concorrência.",
      localOnly: true, externalEgress: false,
    });
    mkdirSync(dirname(cli.output), { recursive: true }); writeFileSync(cli.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (recordWorkspace) {
      await recordLocalResilienceEvidence({ databaseUrl: sourceUrl, workspaceSlug: recordWorkspace, operation: "resilience.load.completed", outcome: report.budget.passed ? "SUCCESS" : "ERROR", durationMs, metadata: { profile: report.profile, budgetPassed: report.budget.passed, p95Ms: report.latencyMs.p95, throughputPerSecond: Number(report.throughputPerSecond.toFixed(2)), errors, timeouts, backlogBefore, backlogAfter, targetCleanupPolicy: "finally" } });
      await recordLocalResilienceEvidence({ databaseUrl: sourceUrl, workspaceSlug: recordWorkspace, operation: "resilience.invariants.completed", outcome: errors === 0 && backlogBefore === backlogAfter ? "SUCCESS" : "ERROR", metadata: { errors, backlogStable: backlogBefore === backlogAfter, publicTouchedByLoad: false } });
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.budget.passed) process.exitCode = 2;
  } finally {
    await pool?.end();
    if (shouldKeepTestSchema(process.env)) process.stdout.write(`Schema preservado para depuração: ${target.schema}. Limpe com pnpm db:test:cleanup -- --confirm=DROP_LOCAL_TEST_SCHEMAS\n`);
    else await dropEphemeralTestSchema(target);
  }
}

await main();

function valueFromArgs(args: readonly string[], name: string) {
  return args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}
