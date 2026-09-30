import { describe, expect, it } from "vitest";
import { catalogSellabilityReason } from "@/modules/catalog/domain/catalog-sellability-policy";

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
