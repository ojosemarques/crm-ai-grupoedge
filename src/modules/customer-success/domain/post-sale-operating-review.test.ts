import { describe, expect, it } from "vitest";

import { capacityState, postSaleRisks, progress } from "./post-sale-operating-review";

describe("etapa 18 pós-venda", () => {
  it("não fabrica taxa quando não há entregável", () => {
    expect(progress(0, 0, 0).completionRate).toBeNull();
    expect(progress(4, 3, 1).completionRate).toBe(0.75);
  });

  it("torna capacidade explícita e reproduzível", () => {
    expect(capacityState(15)).toBe("AVAILABLE");
    expect(capacityState(16)).toBe("ATTENTION");
    expect(capacityState(26)).toBe("FULL");
  });

  it("deriva riscos somente de fatos persistidos", () => {
    expect(postSaleRisks({ healthStatus: "RISK", blockedPlans: 1, overdueDeliverables: 0, overdueRequests: 1, urgentRequests: 0, renewalRiskLevel: "HIGH" }).map((item) => item.code)).toEqual([
      "CUSTOMER_HEALTH_RISK", "SUCCESS_PLAN_BLOCKED", "REQUEST_SLA_OVERDUE", "RENEWAL_AT_RISK",
    ]);
  });
});
