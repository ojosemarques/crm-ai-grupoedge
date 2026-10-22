import { describe, expect, it } from "vitest";
import { calculateSale, expectedOte, oteCommandSchema, oteQuerySchema, releaseSchedule } from "./ote-calculator";

const sale = (acvCents: bigint, options: Partial<Parameters<typeof calculateSale>[0]> = {}) => calculateSale({ kind: "ANNUAL_MONTHLY", acvCents, receivedCents: 0n, selfSourced: false, priorNewAcvCents: 0n, quotaCents: 6_000_000n, ...options });
describe("OTE Politizai", () => {
  it("reproduz exatamente os três OTEs contratados", () => {
    expect(expectedOte({ role: "CLOSER", fixedCents: 370000n, quotaCents: 6000000n, bonusCents: 120000n, meetingQuota: 20, salesQuota: 4 })).toBe(850000n);
    expect(expectedOte({ role: "CLOSER", fixedCents: 250000n, quotaCents: 3500000n, bonusCents: 70000n, meetingQuota: 20, salesQuota: 4 })).toBe(530000n);
    expect(expectedOte({ role: "SDR", fixedCents: 200000n, quotaCents: 0n, bonusCents: 0n, meetingQuota: 20, salesQuota: 4 })).toBe(320000n);
  });
  it("aplica 6/8/10% apenas em cada faixa sem teto", () => {
    expect(sale(6000000n).projectedCents).toBe(360000n);
    expect(sale(7500000n).projectedCents).toBe(480000n);
    expect(sale(9000000n).projectedCents).toBe(630000n);
    expect(sale(90000000n).projectedCents).toBe(8730000n);
    expect(sale(3000000n, { priorNewAcvCents: 6000000n }).projectedCents).toBe(270000n);
    expect(sale(3000000n, { priorNewAcvCents: 5900000n }).projectedCents).toBe(266000n);
  });
  it("adiciona um ponto percentual self-sourced nos anuais", () => {
    expect(sale(9000000n, { selfSourced: true }).projectedCents).toBe(720000n);
    expect(sale(1800000n, { kind: "ANNUAL_UPFRONT", selfSourced: true, receivedCents: 100000n })).toMatchObject({ projectedCents: 9000n, receiptCommissionCents: 9000n });
  });
  it("separa recebido, ACV incremental, renovação e modalidades sem comissão", () => {
    expect(sale(1800000n, { kind: "PROJECT", receivedCents: 200000n, selfSourced: true }).projectedCents).toBe(12000n);
    expect(sale(1800000n, { kind: "EXPANSION" }).projectedCents).toBe(90000n);
    expect(sale(1800000n, { kind: "RENEWAL" }).projectedCents).toBe(36000n);
    for (const kind of ["AUTO_RENEWAL", "LOW_TICKET"]) expect(sale(1800000n, { kind, selfSourced: true }).projectedCents).toBe(0n);
  });
  it("preserva centavos no parcelamento e exige prazo e elegibilidade", () => {
    const dates = [30, 60, 90].map((d) => new Date(Date.UTC(2026, 9, 1 + d)));
    const schedule = releaseSchedule(101n, dates, dates[1]!, true);
    expect(schedule.map((s) => s.amountCents)).toEqual(["35", "30", "36"]);
    expect(schedule.map((s) => s.eligible)).toEqual([true, true, false]);
    expect(releaseSchedule(101n, dates, dates[2]!, false).every((s) => !s.eligible)).toBe(true);
  });
  it("rejeita consulta de outro vendedor e entradas inválidas", () => {
    expect(oteQuerySchema.safeParse({ memberId: "outro" }).success).toBe(false);
    expect(oteQuerySchema.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(oteCommandSchema.safeParse({ action: "SAVE_PLAN", memberId: "invalid" }).success).toBe(false);
  });
});
