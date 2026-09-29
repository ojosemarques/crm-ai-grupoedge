import { describe, expect, it } from "vitest";

import {
  chooseConservativeLifecycle,
  isFutureStageWithoutCurrentEvidence,
  isLifecycleTransitionAllowed,
  requiredOwnershipFunction,
} from "@/modules/lifecycle/domain/lifecycle-policy";

describe("política do lifecycle de receita", () => {
  it("separa a matriz normal do override humano", () => {
    expect(isLifecycleTransitionAllowed("LEAD", "QUALIFIED", { source: "HUMAN" })).toBe(true);
    expect(isLifecycleTransitionAllowed("LEAD", "ACTIVE", { source: "SYSTEM_RULE" })).toBe(false);
    expect(isLifecycleTransitionAllowed("LEAD", "ACTIVE", { source: "HUMAN", override: true })).toBe(true);
  });

  it("não infere estágios futuros no backfill conservador", () => {
    expect(chooseConservativeLifecycle({ hasLead: true, hasQualifiedHistory: true, hasOpenOpportunity: true })).toBe("OPPORTUNITY");
    expect(chooseConservativeLifecycle({ hasLead: true, hasQualifiedHistory: true, hasOpenOpportunity: false })).toBe("QUALIFIED");
    expect(isFutureStageWithoutCurrentEvidence("ACTIVE")).toBe(true);
    expect(isFutureStageWithoutCurrentEvidence("RENEWAL")).toBe(true);
    expect(isFutureStageWithoutCurrentEvidence("CHURN")).toBe(true);
  });

  it("declara a responsabilidade mínima por estágio", () => {
    expect(requiredOwnershipFunction("LEAD")).toBe("SDR");
    expect(requiredOwnershipFunction("OPPORTUNITY")).toBe("CLOSER");
    expect(requiredOwnershipFunction("UNKNOWN")).toBeNull();
  });
});
