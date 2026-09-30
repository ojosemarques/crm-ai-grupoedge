import { describe, expect, it } from "vitest";
import { catalogSellabilityReason, transactionalCatalogEligibilityReason } from "@/modules/catalog/domain/catalog-sellability-policy";

const base = { active: true, audience: "INSTITUTIONAL" as const, availability: "AVAILABLE" as const, capacityUnits: null };

describe("política de venda do catálogo", () => {
  it("permite somente item institucional disponível", () => expect(catalogSellabilityReason(base)).toBeNull());
  it.each([
    [{ ...base, audience: "INDIVIDUAL" as const }, "AUDIENCE_NOT_APPROVED"],
    [{ ...base, audience: "GOVERNMENT" as const }, "AUDIENCE_NOT_APPROVED"],
    [{ ...base, availability: "FUTURE" as const }, "AVAILABILITY_NOT_SELLABLE"],
    [{ ...base, availability: "CAPACITY_LIMITED" as const, capacityUnits: 0 }, "CAPACITY_UNAVAILABLE"],
  ])("bloqueia promessa não aprovada", (item, reason) => expect(catalogSellabilityReason(item)).toBe(reason));
});

describe("elegibilidade de checkout transacional", () => {
  const transactional = { ...base, audience: "INDIVIDUAL" as const, kind: "PRODUCT" as const, revenueCategory: "SOFTWARE" as const, salesGateProfile: "STANDARD" as const, listPriceCents: 10_000n, currency: "BRL" as const };

  it("permite produto individual unitário disponível", () => expect(transactionalCatalogEligibilityReason(transactional)).toBeNull());
  it.each([
    [{ ...transactional, audience: "INSTITUTIONAL" as const }, "AUDIENCE_NOT_INDIVIDUAL"],
    [{ ...transactional, salesGateProfile: "MANDATO" as const }, "CONSULTATIVE_SALES_GATE"],
    [{ ...transactional, kind: "IMPLEMENTATION" as const }, "ITEM_NOT_TRANSACTIONAL"],
    [{ ...transactional, availability: "CAPACITY_LIMITED" as const }, "AVAILABILITY_NOT_SELLABLE"],
    [{ ...transactional, listPriceCents: 0n }, "PRICE_NOT_ELIGIBLE"],
  ])("impede checkout fora da política", (item, reason) => expect(transactionalCatalogEligibilityReason(item)).toBe(reason));
});
