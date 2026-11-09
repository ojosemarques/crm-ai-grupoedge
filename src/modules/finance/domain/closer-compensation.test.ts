import { describe, expect, it } from "vitest";
import {
  calculateFixedCloserCommission,
  calculateInstallmentCommission,
  evaluateInstallmentRelease,
  firstFifthBusinessDateOnOrAfter,
  projectCloserMonth,
  resolveCloserD0,
} from "./closer-compensation";

describe("apuração de modalidades com taxa fixa", () => {
  it.each([
    ["ANNUAL_PREPAID", 900_000n, 900n, 81_000n],
    ["PROJECT", 900_000n, 600n, 54_000n],
    ["EXPANSION", 1_000_000n, 600n, 60_000n],
    ["NEGOTIATED_RENEWAL", 1_000_000n, 300n, 30_000n],
    ["AUTOMATIC_RENEWAL", 1_000_000n, 0n, 0n],
    ["AUTOMATIC_LOW_TICKET", 1_000_000n, 0n, 0n],
  ] as const)("aplica a base e taxa de %s", (modality, basisCents, rateBps, amountCents) => {
    expect(calculateFixedCloserCommission({
      modality, acvCents: 1_000_000n, netSettledCents: 900_000n, selfSourced: true,
    })).toEqual({ basisCents, rateBps, amountCents });
  });
});

describe("apuração de novos anuais parcelados", () => {
  it("ordena pelo D0 na competência local e inclui o anual antecipado no acumulado", () => {
    const facts = {
      acvCents: 5_500_000n, netSettledCents: 5_000_000n, selfSourced: false,
      d0: new Date("2026-12-01T02:00:00Z"), recordedAt: new Date("2026-10-30T02:00:00Z"),
    };
    const result = projectCloserMonth({
      month: "2026-11",
      timeZone: "America/Sao_Paulo",
      plan: { kind: "TARGET", targetCents: 6_000_000n },
      sales: [
        { ...facts, opportunityId: "b", modality: "ANNUAL_INSTALLMENTS", acvCents: 2_500_000n },
        { ...facts, opportunityId: "a", modality: "ANNUAL_PREPAID" },
        { ...facts, opportunityId: "c", modality: "ANNUAL_PREPAID", d0: null },
        { ...facts, opportunityId: "d", modality: "PROJECT" },
      ],
    });
    expect(result).toMatchObject({
      newAcvCents: 8_000_000n, pendingAcvCents: 5_500_000n, reachesTarget: true,
      sales: [
        { opportunityId: "a", commission: { amountCents: 400_000n } },
        { opportunityId: "b", commission: { amountCents: 200_000n } },
      ],
    });
  });

  it("atravessa três faixas e acrescenta um ponto quando a origem é comprovada", () => {
    const sale = {
      acvCents: 2_500_000n,
      accumulatedAcvCents: 5_500_000n,
      plan: { kind: "TARGET", targetCents: 6_000_000n } as const,
    };
    expect(calculateInstallmentCommission({ ...sale, selfSourced: false })).toEqual({
      tiers: [
        { basisCents: 500_000n, rateBps: 600n },
        { basisCents: 1_500_000n, rateBps: 800n },
        { basisCents: 500_000n, rateBps: 1000n },
      ],
      amountCents: 200_000n,
    });
    expect(calculateInstallmentCommission({ ...sale, selfSourced: true }).amountCents).toBe(225_000n);
    expect(calculateInstallmentCommission({
      ...sale, plan: { kind: "RAMP" }, selfSourced: false,
    }).amountCents).toBe(150_000n);
  });

  it("aguarda as três evidências de D0 e usa a data mais recente", () => {
    const accepted = new Date("2026-10-20T13:00:00Z");
    const activated = new Date("2026-11-01T13:00:00Z");
    const settled = new Date("2026-10-31T22:00:00Z");
    expect(resolveCloserD0(accepted, null, settled)).toBeNull();
    expect(resolveCloserD0(accepted, activated, null)).toBeNull();
    expect(resolveCloserD0(accepted, activated, settled)).toEqual(activated);
  });

  it("avalia 25% até D+30 e um terço de caixa em centavos, descontando baixas e abertos", () => {
    const upfront = { settledOn: "2026-01-31", netCents: 750_000n, upfrontNetCents: 750_000n };
    const remainder = { settledOn: "2026-03-31", netCents: 250_000n, upfrontNetCents: 0n };
    const facts = {
      d0On: "2026-01-01", evaluatedOn: "2026-04-01", acvCents: 3_000_000n,
      active: true, hasOverdueBalance: false, settlements: [upfront, remainder],
      commissionCents: 180_000n, paidCents: 60_000n, openCents: 0n,
    };
    expect(evaluateInstallmentRelease(facts)).toMatchObject({
      milestoneOn: "2026-04-01", meetsConditions: true, releasableCents: 120_000n,
    });
    expect(evaluateInstallmentRelease({ ...facts, openCents: 120_000n }).releasableCents).toBe(0n);
    expect(evaluateInstallmentRelease({ ...facts, hasOverdueBalance: true }).releasableCents).toBe(0n);
    expect(evaluateInstallmentRelease({ ...facts, active: false }).releasableCents).toBe(0n);
    expect(evaluateInstallmentRelease({
      ...facts, settlements: [{ ...upfront, upfrontNetCents: 749_999n }, remainder],
    }).milestoneOn).toBe("2026-05-01");
    expect(evaluateInstallmentRelease({
      ...facts, settlements: [{ ...upfront, settledOn: "2026-02-01" }, remainder],
    }).milestoneOn).toBe("2026-05-01");
    expect(evaluateInstallmentRelease({
      ...facts, settlements: [upfront, { ...remainder, netCents: 249_999n }],
    }).releasableCents).toBe(0n);
    expect(evaluateInstallmentRelease({
      ...facts, settlements: [upfront, { ...remainder, settledOn: "2026-04-02" }],
    }).releasableCents).toBe(0n);
  });

  it("usa o quinto dia útil com feriado e avança a competência após o quinto dia", () => {
    const holidays = new Set(["2026-12-01", "2027-01-01"]);
    expect(firstFifthBusinessDateOnOrAfter("2026-12-01", holidays)).toBe("2026-12-08");
    expect(firstFifthBusinessDateOnOrAfter("2026-12-09", holidays)).toBe("2027-01-08");
  });
});
