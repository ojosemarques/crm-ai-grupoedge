import { assertSafeTestSchemaName } from "@/shared/core/database/test-schema-lifecycle";

export type FaultPoint = "before-commit" | "after-commit" | "worker-claim" | "outbox-delivery";

export function assertFaultInjectionRuntime(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.NODE_ENV !== "test" || env.RESILIENCE_FAULT_INJECTION !== "1") {
    throw new Error("Fault injection exige NODE_ENV=test e RESILIENCE_FAULT_INJECTION=1.");
  }
  const schema = env.PRISMA_TEST_SCHEMA ?? "";
  assertSafeTestSchemaName(schema);
  if (!schema.startsWith("politizai_test_resilience_")) {
    throw new Error("Fault injection só pode usar schema efêmero de resiliência.");
  }
  return schema;
}

export function createDeterministicFaultInjector(options: Readonly<{ enabledPoints: readonly FaultPoint[]; failOnAttempt?: number; env?: Readonly<Record<string, string | undefined>> }>) {
  assertFaultInjectionRuntime(options.env);
  let attempt = 0;
  const enabled = new Set(options.enabledPoints);
  return Object.freeze({
    hit(point: FaultPoint) {
      attempt += 1;
      if (enabled.has(point) && attempt === (options.failOnAttempt ?? 1)) {
        throw new Error(`RESILIENCE_FAULT:${point}:${attempt}`);
      }
    },
    attempts: () => attempt,
  });
}

export function createBackpressureGate(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limite de concorrência inválido.");
  let active = 0;
  let rejected = 0;
  return Object.freeze({
    enter() {
      if (active >= limit) { rejected += 1; return false; }
      active += 1; return true;
    },
    leave() { active = Math.max(0, active - 1); },
    snapshot: () => ({ active, limit, rejected }),
  });
}
