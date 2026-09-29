import { describe, expect, it } from "vitest";
import { farmerPriority, netRevenueRetention, nextRenewalStatus, renewalRate } from "./farmer-contracts";

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
});
