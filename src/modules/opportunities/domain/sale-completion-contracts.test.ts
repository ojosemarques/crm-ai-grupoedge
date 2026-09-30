import { describe, expect, it } from "vitest";
import { executeSaleCompletionSchema, saleCompletionSchema, saleMonth, saleSchedule } from "./sale-completion-contracts";

const input = { opportunityId: "00000000-0000-4000-8000-000000000001", sellerMemberId: "00000000-0000-4000-8000-000000000002", templateVersionId: "00000000-0000-4000-8000-000000000003", expectedRevision: 1, totalCents: "2500000", monthlyCents: "300000", upfrontCents: "700000", durationMonths: 6, startsAt: "2026-01-31T12:00:00.000Z" };

describe("fechamento integrado", () => {
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
    expect(saleCompletionSchema.safeParse({ ...input, onboardingOwnerMemberId: input.sellerMemberId }).success).toBe(false);
  });
});
