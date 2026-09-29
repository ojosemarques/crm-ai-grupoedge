import { describe, expect, it } from "vitest";
import { calculateCustomerHealth, nextPlanStatus } from "@/modules/customer-success/domain/customer-success-contracts";

describe("CRM-52 health score versionado", () => {
  it("calcula score ponderado e classifica a faixa", () => {
    const result = calculateCustomerHealth([
      { key: "adoption", weight: 70, required: true, direction: "POSITIVE", freshness: "CURRENT", observedValue: 100, explanation: "Adoção observada." },
      { key: "risk", weight: 30, required: false, direction: "NEGATIVE", freshness: "CURRENT", observedValue: 50, explanation: "Risco parcial." },
    ], { healthyMinScore: 75, attentionMinScore: 45 });
    expect(result).toEqual({ status: "HEALTHY", score: 85, missingSignals: [] });
  });

  it("separa ausência e evidência vencida de resultado negativo", () => {
    const result = calculateCustomerHealth([
      { key: "required_missing", weight: 50, required: true, direction: "POSITIVE", freshness: "MISSING", observedValue: null, explanation: "Sem fato persistido." },
      { key: "required_stale", weight: 50, required: true, direction: "POSITIVE", freshness: "STALE", observedValue: 100, explanation: "Fato fora da janela." },
    ], { healthyMinScore: 75, attentionMinScore: 45 });
    expect(result.status).toBe("INSUFFICIENT");
    expect(result.score).toBeNull();
    expect(result.missingSignals.map((item) => item.freshness)).toEqual(["MISSING", "STALE"]);
  });

  it("inverte semanticamente sinais negativos", () => {
    const result = calculateCustomerHealth([
      { key: "blocker", weight: 100, required: true, direction: "NEGATIVE", freshness: "CURRENT", observedValue: 100, explanation: "Bloqueio comprovado." },
    ], { healthyMinScore: 75, attentionMinScore: 45 });
    expect(result).toMatchObject({ status: "RISK", score: 0 });
  });
});

describe("CRM-52 transições do plano", () => {
  it("aceita apenas transições explícitas", () => {
    expect(nextPlanStatus("DRAFT", "ACTIVATE")).toBe("ACTIVE");
    expect(nextPlanStatus("ACTIVE", "BLOCK")).toBe("BLOCKED");
    expect(nextPlanStatus("BLOCKED", "UNBLOCK")).toBe("ACTIVE");
    expect(nextPlanStatus("COMPLETED", "ACTIVATE")).toBeNull();
    expect(nextPlanStatus("ACTIVE", "COMPLETE_MILESTONE")).toBe("ACTIVE");
  });
});
