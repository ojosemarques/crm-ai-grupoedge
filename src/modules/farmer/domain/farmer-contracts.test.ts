import { describe, expect, it } from "vitest";
import { farmerPriority, farmerRevenueDecisionSchema, netRevenueRetention, nextRenewalStatus, renewalEligibility, renewalRate } from "./farmer-contracts";

describe("CRM-54 Farmer domain", () => {
  it("mantém uma máquina de renovação explícita", () => {
    expect(nextRenewalStatus("IN_REVIEW", "RENEW")).toBe("RENEWED");
    expect(nextRenewalStatus("RENEWED", "NOT_RENEW")).toBeNull();
    expect(nextRenewalStatus("NOT_RENEWED", "REOPEN")).toBe("IN_REVIEW");
  });
  it("prioriza ação ausente ou vencida sem score opaco", () => {
    expect(farmerPriority({ targetDate:new Date(), nextActionAt:null, status:"IN_REVIEW", riskLevel:"NONE", baseMrrCents:1n, now:new Date() })).toEqual({rank:1,reason:"Renovação sem próxima ação"});
  });
  it("não fabrica taxa sem denominador", () => {
    expect(renewalRate(0, 0)).toBeNull(); expect(renewalRate(3, 4)).toBe(.75);
  });
  it("calcula NRR somente com base inicial reproduzível", () => {
    expect(netRevenueRetention(null, 1n, 0n, 0n)).toBeNull(); expect(netRevenueRetention(100n, 20n, -10n, -5n)).toBe(1.05);
  });
  it("inicia renovação somente por estado, data e ausência de ciclo existente", () => {
    const now = new Date("2054-01-01T00:00:00.000Z");
    expect(renewalEligibility({ status: "ACTIVE", endsAt: new Date("2054-03-01T00:00:00.000Z"), now, windowDays: 90, hasRenewal: false })).toEqual({ eligible: true, reason: "ACTIVE_SUBSCRIPTION_DUE" });
    expect(renewalEligibility({ status: "CHURNED", endsAt: new Date("2054-03-01T00:00:00.000Z"), now, windowDays: 90, hasRenewal: false }).eligible).toBe(false);
    expect(renewalEligibility({ status: "ACTIVE", endsAt: new Date("2055-03-01T00:00:00.000Z"), now, windowDays: 90, hasRenewal: false }).reason).toBe("OUTSIDE_RENEWAL_WINDOW");
  });
  it("exige aprendizado explícito para churn", () => {
    expect(() => farmerRevenueDecisionSchema.parse({ subscriptionId: "00000000-0000-4000-8000-000000000001", type: "CHURN", newMrrCents: 0, effectiveAt: new Date(), reasonCode: "LOST", comment: "Perda confirmada", evidence: "Cancelamento confirmado", logoChurn: true, revenueChurn: true, idempotencyKey: "farmer:test:churn" })).toThrow("Churn exige aprendizado");
  });
});
