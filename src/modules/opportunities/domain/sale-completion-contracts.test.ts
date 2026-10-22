import { describe, expect, it } from "vitest";
import { completeLeadSaleSchema, directSaleInstallmentCount, executeSaleCompletionSchema, prepareLeadSaleSchema, saleCompletionSchema, saleMonth, saleSchedule } from "./sale-completion-contracts";

const input = { opportunityId: "00000000-0000-4000-8000-000000000001", sellerMemberId: "00000000-0000-4000-8000-000000000002", templateVersionId: "00000000-0000-4000-8000-000000000003", expectedRevision: 1, totalCents: "2500000", monthlyCents: "300000", upfrontCents: "700000", receivedCents: "0", paymentMethod: "PIX", paymentCondition: "Entrada e seis parcelas mensais", durationMonths: 6, startsAt: "2026-01-31T12:00:00.000Z", acceptance: { acceptedByName: "Cliente", acceptedByRole: "Diretor", evidenceText: "Aceite documentado." } } as const;

describe("fechamento integrado", () => {
  it("calcula parcelas a partir dos seis campos e não aceita baixa de recebimento", () => {
    const command = { leadId: input.opportunityId, sellerMemberId: input.sellerMemberId,
      totalCents: "765432", upfrontCents: "65432", installmentCents: "100000",
      paymentPlan: "UPFRONT_INSTALLMENTS" as const, paymentCondition: "Entrada e sete parcelas", confirmed: true,
      idempotencyKey: input.opportunityId };
    expect(completeLeadSaleSchema.safeParse(command).success).toBe(true);
    expect(directSaleInstallmentCount(command)).toBe(7);
    expect(directSaleInstallmentCount({ ...command, paymentPlan: "CARD_INSTALLMENTS" })).toBe(7);
    expect(directSaleInstallmentCount({ ...command, paymentPlan: "CASH", upfrontCents: command.totalCents, installmentCents: "0" })).toBe(1);
    for (const changes of [
      { totalCents: "0" }, { installmentCents: "99999" }, { upfrontCents: "999999" },
      { installmentCents: "0" }, { installmentCents: "1" }, { totalCents: "abc" },
      { totalCents: "-1" }, { totalCents: "1.50" }, { receivedCents: "765432" },
      { financialAccountId: input.opportunityId }, { confirmed: false }, { opportunityId: input.opportunityId },
    ]) expect(completeLeadSaleSchema.safeParse({ ...command, ...changes }).success).toBe(false);
  });
  it("exige explicação explícita da diferença entre total e parcelas", () => {
    expect(saleCompletionSchema.safeParse({ ...input, upfrontCents: "0" }).success).toBe(false);
    expect(saleCompletionSchema.safeParse(input).success).toBe(true);
  });
  it("preserva o dia contratual após meses curtos e soma centavos sem arredondamento", () => {
    const schedule = saleSchedule(saleCompletionSchema.parse(input));
    expect(schedule[0]!.amountCents).toBe("1000000");
    expect(schedule[1]!.dueAt).toBe("2026-02-28T12:00:00.000Z");
    expect(schedule[2]!.dueAt).toBe("2026-03-31T12:00:00.000Z");
    expect(schedule.reduce((sum, row) => sum + BigInt(row.amountCents), 0n)).toBe(2500000n);
    expect(saleMonth("2028-01-31T12:00:00Z", 1).toISOString()).toBe("2028-02-29T12:00:00.000Z");
  });
  it("exige confirmação e não confunde venda avulsa com MRR", () => {
    expect(executeSaleCompletionSchema.safeParse({ ...input, idempotencyKey: input.opportunityId }).success).toBe(false);
    const single = saleCompletionSchema.parse({ ...input, monthlyCents: "0", upfrontCents: input.totalCents, durationMonths: 1 });
    expect(saleSchedule(single)).toHaveLength(1);
    expect(saleCompletionSchema.safeParse({ ...input, acceptance: undefined }).success).toBe(false);
    expect(saleCompletionSchema.safeParse({ ...input, receivedCents: "1" }).success).toBe(false);
    expect(saleCompletionSchema.safeParse({ ...input, receivedCents: "2500001", financialAccountId: input.opportunityId, receivedAt: input.startsAt, paymentReference: "PIX teste" }).success).toBe(false);
  });
  it("exige nome real ou ID explícito para cadastro e vínculo de cliente", () => {
    expect(saleCompletionSchema.safeParse({ ...input, customer: { mode: "CREATE", name: " " } }).success).toBe(false);
    expect(saleCompletionSchema.safeParse({ ...input, customer: { mode: "LINK", name: "Cliente" } }).success).toBe(false);
    expect(saleCompletionSchema.parse({ ...input, customer: { mode: "CREATE", name: "  Cliente confirmado  " } }).customer).toEqual({ mode: "CREATE", name: "Cliente confirmado" });
    expect(saleCompletionSchema.safeParse({ ...input, customer: { mode: "LINK", accountId: input.opportunityId, workspaceId: input.opportunityId } }).success).toBe(false);
  });
  it("valida à vista, parcelas e entrada mais parcelas sem diferença no total", () => {
    const base = {
      leadId: input.opportunityId,
      sellerMemberId: input.sellerMemberId,
      productId: input.templateVersionId,
      description: "Venda anual da plataforma",
      paymentMethod: "PIX" as const,
      totalCents: "1800000",
      idempotencyKey: "00000000-0000-4000-8000-000000000004",
    };
    expect(prepareLeadSaleSchema.safeParse({ ...base, paymentPlan: "UPFRONT_INSTALLMENTS", upfrontCents: "300000", installmentCents: "150000", installmentCount: 10 }).success).toBe(true);
    expect(prepareLeadSaleSchema.safeParse({ ...base, paymentPlan: "INSTALLMENTS", upfrontCents: "0", installmentCents: "180000", installmentCount: 10 }).success).toBe(true);
    expect(prepareLeadSaleSchema.safeParse({ ...base, paymentPlan: "CASH", upfrontCents: "1800000", installmentCents: "0", installmentCount: 1 }).success).toBe(true);
    expect(prepareLeadSaleSchema.safeParse({ ...base, paymentPlan: "UPFRONT_INSTALLMENTS", upfrontCents: "300000", installmentCents: "140000", installmentCount: 10 }).success).toBe(false);
  });
});
