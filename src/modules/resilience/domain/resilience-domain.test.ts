import { describe, expect, it } from "vitest";

import { createBackpressureGate, createDeterministicFaultInjector } from "@/modules/resilience/domain/fault-injection";
import { criticalityCatalog, degradationPolicy, evaluateLoadBudget, loadResultSchema, percentile, recoveryDecision, RESILIENCE_CONTRACT_VERSION } from "@/modules/resilience/domain/resilience-contracts";

describe("CRM-63 resiliência", () => {
  it("mantém catálogo versionado com RPO/RTO e runbook", () => {
    expect(criticalityCatalog.length).toBeGreaterThanOrEqual(7);
    expect(criticalityCatalog.every((item) => item.rpoMinutes >= 0 && item.rtoMinutes > 0 && item.runbook.startsWith("RB-"))).toBe(true);
  });

  it("calcula percentis e budgets sem mascarar erros", () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(evaluateLoadBudget("smoke", { p95Ms: 501, errors: 1, requests: 10, throughputPerSecond: 0.5 })).toMatchObject({ passed: false, errorRateBasisPoints: 1000 });
  });

  it("diferencia rollback, retry, forward-fix e revisão humana", () => {
    expect(recoveryDecision({ transactionCommitted: false, idempotentReplayAvailable: false, invariantViolation: false })).toBe("ROLLBACK");
    expect(recoveryDecision({ transactionCommitted: true, idempotentReplayAvailable: true, invariantViolation: false })).toBe("RETRY");
    expect(recoveryDecision({ transactionCommitted: true, idempotentReplayAvailable: false, invariantViolation: false })).toBe("FORWARD_FIX");
    expect(recoveryDecision({ transactionCommitted: true, idempotentReplayAvailable: true, invariantViolation: true })).toBe("MANUAL_REVIEW");
  });

  it("bloqueia fault injection fora de teste e aplica backpressure", () => {
    expect(() => createDeterministicFaultInjector({ enabledPoints: ["before-commit"], env: { NODE_ENV: "development", RESILIENCE_FAULT_INJECTION: "1", PRISMA_TEST_SCHEMA: "politizai_test_resilience_20260913t120000z_a1b2c3d4" } })).toThrow(/NODE_ENV=test/);
    const injector = createDeterministicFaultInjector({ enabledPoints: ["before-commit"], env: { NODE_ENV: "test", RESILIENCE_FAULT_INJECTION: "1", PRISMA_TEST_SCHEMA: "politizai_test_resilience_20260913t120000z_a1b2c3d4" } });
    expect(() => injector.hit("before-commit")).toThrow("RESILIENCE_FAULT:before-commit:1");
    const gate = createBackpressureGate(1);
    expect(gate.enter()).toBe(true); expect(gate.enter()).toBe(false); gate.leave(); expect(gate.snapshot()).toEqual({ active: 0, limit: 1, rejected: 1 });
    expect(degradationPolicy({ poolWaiting: 6, backlog: 0, errorRateBasisPoints: 0 })).toMatchObject({ state: "DEGRADED", acceptCriticalWrites: true, acceptAnalyticalRefresh: false, retryAfterSeconds: 5 });
    expect(degradationPolicy({ poolWaiting: 21, backlog: 0, errorRateBasisPoints: 0 })).toMatchObject({ state: "SHED_NON_CRITICAL", retryAfterSeconds: 30 });
  });

  it("rejeita relatório incompleto ou alvo não efêmero", () => {
    expect(() => loadResultSchema.parse({ contractVersion: RESILIENCE_CONTRACT_VERSION, profile: "smoke", targetSchema: "public" })).toThrow();
  });
});
