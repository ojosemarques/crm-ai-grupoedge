import { describe, expect, it } from "vitest";

import {
  deliveryPlanChecklists,
  groupContractLinesIntoDeliveryPlans,
} from "./delivery-plan-contracts";

describe("Stage 18 delivery plan contracts", () => {
  it("separa licença e serviço operado e concilia todo o valor contratado", () => {
    const plans = groupContractLinesIntoDeliveryPlans([
      { id: "license-line", productKind: "LICENSE", revenueCategory: "SOFTWARE", totalCents: 300_000n },
      { id: "service-line", productKind: "RECURRING_SERVICE", revenueCategory: "RECURRING_SERVICE", totalCents: 700_000n },
    ]);

    expect(plans).toEqual([
      { type: "LICENSE", contractedValueCents: 300_000n, sourceContractLineIds: ["license-line"] },
      { type: "MANAGED_SERVICE", contractedValueCents: 700_000n, sourceContractLineIds: ["service-line"] },
    ]);
    expect(plans.reduce((total, plan) => total + plan.contractedValueCents, 0n)).toBe(1_000_000n);
  });

  it("mantém checklists próprios para as quatro ofertas", () => {
    expect(Object.keys(deliveryPlanChecklists)).toEqual([
      "LICENSE",
      "IMPLEMENTATION",
      "MANAGED_SERVICE",
      "LAB_PROJECT",
    ]);
    expect(new Set(Object.values(deliveryPlanChecklists).map((items) => items[0]?.[0])).size).toBe(4);
  });
});
