import { createHash } from "node:crypto";

import { z } from "zod";

export const RESILIENCE_CONTRACT_VERSION = "resilience.v1" as const;

export const criticalityCatalog = [
  { key: "identity", name: "Autenticação e RBAC", criticality: "CRITICAL", rpoMinutes: 0, rtoMinutes: 30, owner: "Plataforma", runbook: "RB-IDENTITY" },
  { key: "lead-intake", name: "Entrada e identidade de leads", criticality: "CRITICAL", rpoMinutes: 0, rtoMinutes: 30, owner: "Revenue Ops", runbook: "RB-LEAD-INTAKE" },
  { key: "commercial-history", name: "Timeline, tarefas e auditoria", criticality: "CRITICAL", rpoMinutes: 0, rtoMinutes: 60, owner: "Revenue Ops", runbook: "RB-HISTORY" },
  { key: "sales", name: "Reuniões, oportunidades e receita", criticality: "HIGH", rpoMinutes: 5, rtoMinutes: 120, owner: "Vendas", runbook: "RB-SALES" },
  { key: "automation", name: "Jobs, automações e outbox", criticality: "HIGH", rpoMinutes: 15, rtoMinutes: 120, owner: "Operações", runbook: "RB-AUTOMATION" },
  { key: "analytics", name: "Dashboard, métricas e forecast", criticality: "MEDIUM", rpoMinutes: 60, rtoMinutes: 240, owner: "RevOps", runbook: "RB-ANALYTICS" },
  { key: "privacy", name: "Privacidade, retenção e DSR", criticality: "CRITICAL", rpoMinutes: 0, rtoMinutes: 60, owner: "Privacidade", runbook: "RB-PRIVACY" },
] as const;

export type LoadProfile = "smoke" | "baseline" | "stress";
export type RecoveryDecision = "RETRY" | "ROLLBACK" | "FORWARD_FIX" | "MANUAL_REVIEW";
export type DegradationState = "NORMAL" | "DEGRADED" | "SHED_NON_CRITICAL";

export const loadBudgets = {
  smoke: { p95Ms: 500, errorRateBasisPoints: 0, minThroughputPerSecond: 1 },
  baseline: { p95Ms: 750, errorRateBasisPoints: 100, minThroughputPerSecond: 5 },
  stress: { p95Ms: 1500, errorRateBasisPoints: 500, minThroughputPerSecond: 10 },
} as const;

const nonNegative = z.number().finite().nonnegative();
export const loadResultSchema = z.object({
  contractVersion: z.literal(RESILIENCE_CONTRACT_VERSION),
  profile: z.enum(["smoke", "baseline", "stress"]),
  seed: z.number().int(),
  targetSchema: z.string().regex(/^politizai_test_resilience_/),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().int().positive(),
  concurrency: z.number().int().positive().max(100),
  requests: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  throughputPerSecond: nonNegative,
  latencyMs: z.object({ min: nonNegative, p50: nonNegative, p90: nonNegative, p95: nonNegative, p99: nonNegative, max: nonNegative }),
  backlog: z.object({ before: z.number().int().nonnegative(), after: z.number().int().nonnegative() }),
  resources: z.object({ rssBytes: z.number().int().nonnegative(), heapUsedBytes: z.number().int().nonnegative(), poolTotal: z.number().int().nonnegative(), poolIdle: z.number().int().nonnegative(), poolWaiting: z.number().int().nonnegative() }),
  scenarios: z.array(z.object({ name: z.string().min(1), requests: z.number().int().nonnegative(), errors: z.number().int().nonnegative(), p95Ms: nonNegative })),
  budget: z.object({ passed: z.boolean(), reasons: z.array(z.string()) }),
  bottleneck: z.string(),
  recommendedAction: z.string(),
  localOnly: z.literal(true),
  externalEgress: z.literal(false),
}).strict();

export const recoveryManifestSchema = z.object({
  contractVersion: z.literal(RESILIENCE_CONTRACT_VERSION),
  sourceDatabase: z.literal("politizai_crm"),
  sourceSchema: z.literal("public"),
  temporaryDatabase: z.string().regex(/^politizai_resilience_restore_[0-9]{8}t[0-9]{6}z_[a-f0-9]{8}$/),
  createdAt: z.string().datetime(),
  postgresqlVersion: z.string().min(1),
  backupPath: z.string().min(1),
  backupSha256: z.string().regex(/^[a-f0-9]{64}$/),
  backupBytes: z.number().int().positive(),
  sourceFingerprint: z.record(z.string(), z.number().int().nonnegative()),
  restoredFingerprint: z.record(z.string(), z.number().int().nonnegative()),
  reconciled: z.boolean(),
  temporaryTargetRemoved: z.boolean(),
}).strict();

export type LoadResult = z.infer<typeof loadResultSchema>;
export type RecoveryManifest = z.infer<typeof recoveryManifestSchema>;

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return Number(sorted[index]!.toFixed(2));
}

export function evaluateLoadBudget(profile: LoadProfile, input: Readonly<{ p95Ms: number; errors: number; requests: number; throughputPerSecond: number }>) {
  const budget = loadBudgets[profile];
  const errorRateBasisPoints = input.requests === 0 ? 10_000 : Math.round((input.errors / input.requests) * 10_000);
  const reasons = [
    ...(input.p95Ms > budget.p95Ms ? [`p95 ${input.p95Ms}ms acima de ${budget.p95Ms}ms`] : []),
    ...(errorRateBasisPoints > budget.errorRateBasisPoints ? [`erros ${errorRateBasisPoints} bps acima de ${budget.errorRateBasisPoints} bps`] : []),
    ...(input.throughputPerSecond < budget.minThroughputPerSecond ? [`throughput ${input.throughputPerSecond.toFixed(2)}/s abaixo de ${budget.minThroughputPerSecond}/s`] : []),
  ];
  return { passed: reasons.length === 0, reasons, errorRateBasisPoints };
}

export function recoveryDecision(input: Readonly<{ transactionCommitted: boolean; idempotentReplayAvailable: boolean; invariantViolation: boolean }>): RecoveryDecision {
  if (input.invariantViolation) return "MANUAL_REVIEW";
  if (!input.transactionCommitted) return "ROLLBACK";
  if (input.idempotentReplayAvailable) return "RETRY";
  return "FORWARD_FIX";
}

export function degradationPolicy(input: Readonly<{ poolWaiting: number; backlog: number; errorRateBasisPoints: number }>) {
  const state: DegradationState = input.errorRateBasisPoints > 500 || input.poolWaiting > 20 || input.backlog > 1_000
    ? "SHED_NON_CRITICAL"
    : input.errorRateBasisPoints > 100 || input.poolWaiting > 5 || input.backlog > 250
      ? "DEGRADED"
      : "NORMAL";
  return {
    state,
    acceptCriticalWrites: true,
    acceptAnalyticalRefresh: state === "NORMAL",
    maxWorkerConcurrencyFactor: state === "NORMAL" ? 1 : state === "DEGRADED" ? 0.5 : 0.25,
    retryAfterSeconds: state === "NORMAL" ? null : state === "DEGRADED" ? 5 : 30,
  } as const;
}

export function fingerprintManifest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
