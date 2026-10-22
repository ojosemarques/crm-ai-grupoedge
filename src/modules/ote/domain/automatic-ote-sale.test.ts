import { describe, expect, it } from "vitest";
import { automaticOteSale, oteSaleTerms } from "./automatic-ote-sale";

const sale = { amountCents: 1800000n, tcvCents: 1800000n, mrrCents: 150000n, product: { sku: "SISTEMA-POLITIZAI", kind: "LICENSE", revenueCategory: "SOFTWARE" } };
describe("regra automática a partir da venda", () => {
  it("usa o valor da licença negociada sem confundir prazo de parcelas com ACV", () => {
    expect(automaticOteSale(sale)).toMatchObject({ kind: "ANNUAL_MONTHLY", acvCents: 1800000n, selfSourced: false });
    expect(automaticOteSale({ ...sale, mrrCents: 300000n })).toMatchObject({ acvCents: 1800000n });
  });
  it("anualiza outras assinaturas, separa projetos e ACV incremental", () => {
    const other = { ...sale, product: { ...sale.product, sku: "OTHER" } };
    expect(automaticOteSale(other)?.acvCents).toBe(1800000n);
    expect(automaticOteSale({ ...other, farmerExpansionSignalId: "signal" })?.kind).toBe("EXPANSION");
    expect(automaticOteSale({ ...sale, mrrCents: 300000n, farmerExpansionSignalId: "signal" })?.acvCents).toBe(3600000n);
    expect(automaticOteSale({ ...other, product: { ...other.product, revenueCategory: "PROJECT" } })).toMatchObject({ kind: "PROJECT", acvCents: 0n });
    expect(automaticOteSale({ ...other, mrrCents: 0n })).toBeNull();
    expect(automaticOteSale({ ...sale, product: null })).toBeNull();
  });
  it("distingue o anual antecipado pelas condições contratuais", () => {
    const version = { totalCents: 1800000n, mrrCents: 0n, durationMonths: 1, billingFrequency: "ONE_TIME", paymentTerms: "À vista" };
    expect(automaticOteSale({ ...sale, mrrCents: 0n }, version)).toMatchObject({ kind: "ANNUAL_UPFRONT", acvCents: 1800000n });
  });
  it("mostra entrada e parcelas do fechamento sem inventar recebimento", () => {
    expect(oteSaleTerms(sale, undefined, { totalCents: "1800000", upfrontCents: "300000", monthlyCents: "150000", durationMonths: 10, paymentCondition: "Entrada e 10 parcelas no PIX" })).toEqual({ totalCents: "1800000", upfrontCents: "300000", installmentCents: "150000", installmentCount: 10, paymentCondition: "Entrada e 10 parcelas no PIX" });
    expect(oteSaleTerms(sale, undefined, { totalCents: "1800000", upfrontCents: "9000000" }).upfrontCents).toBeNull();
  });
});
