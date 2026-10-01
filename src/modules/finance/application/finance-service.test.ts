import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService, reconcileCommissionsInTransaction } from "./finance-service";

const context = { workspaceId: "workspace", actorId: "actor" } as AuthenticatedContext;

describe("finance service", () => {
  it("inclui saldo histórico, títulos vencidos e projeção sem duplicar entradas antigas", async () => {
    const entry = { id: "entry", categoryId: "category", financialAccountId: "bank", customerAccountId: null, direction: "INCOME", status: "SETTLED", description: "Receita", counterparty: null, amountCents: 200n, competenceAt: new Date("2026-09-02"), dueAt: new Date("2026-09-02"), settledAt: new Date("2026-08-31"), revision: 1 };
    const database = {
      workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ timeZone: "UTC" }) },
      financialCategory: { findMany: vi.fn().mockResolvedValue([{ id: "category", name: "Vendas", kind: "INCOME", dreGroup: null }]) },
      financialAccount: { findMany: vi.fn().mockResolvedValue([{ id: "bank", name: "Banco", openingBalanceCents: 1_000n }]) },
      financialEntry: {
        findMany: vi.fn().mockResolvedValue([entry, { ...entry, id: "planned", direction: "EXPENSE", status: "PLANNED", amountCents: 300n, dueAt: new Date("2026-08-10"), settledAt: null }]),
        groupBy: vi.fn().mockResolvedValue([{ financialAccountId: "bank", direction: "INCOME", _sum: { amountCents: 200n } }]),
      },
      invoice: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      subscription: { findMany: vi.fn().mockResolvedValue([]) },
      revenueMovement: { findMany: vi.fn().mockResolvedValue([]) },
      opportunity: { findMany: vi.fn().mockResolvedValue([]) },
      commissionRule: { findMany: vi.fn().mockResolvedValue([]) },
      commission: { findMany: vi.fn().mockResolvedValue([]) },
      workspaceMember: { findMany: vi.fn().mockResolvedValue([]) },
      financialCostCenter: { findMany: vi.fn().mockResolvedValue([]) },
      financialRecurrence: { findMany: vi.fn().mockResolvedValue([]) },
      bankStatementImport: { findMany: vi.fn().mockResolvedValue([]) },
      bankStatementLine: { findMany: vi.fn().mockResolvedValue([]) },
      financialAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = createFinanceService({ database: database as never, authorization: { assertAuthorized: vi.fn(), authorize: vi.fn().mockResolvedValue({ allowed: true }) } as never, now: () => new Date("2026-09-30") });
    const result = await service.screen(context);
    expect(result.summary).toMatchObject({ openingBalanceCents: "1200", cashBalanceCents: "1200", payableOpenCents: "300", projectedCashCents: "900" });
    expect(result.accounts[0]?.balanceCents).toBe("1200");
    database.workspace.findUniqueOrThrow.mockResolvedValue({ timeZone: "America/Sao_Paulo" });
    expect((await service.screen(context)).period).toEqual({ from: "2026-09-01T03:00:00.000Z", to: "2026-10-01T03:00:00.000Z" });
    expect(result.cashFlow).toHaveLength(30);
    expect(result.cashProjection[0]?.balanceCents).toBe("900");
    expect(database.financialEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", status: "SETTLED", settledAt: { lt: new Date("2026-09-01") } } }));
  });

  it("concilia regra histórica pela vigência da venda e ignora comissão já registrada", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      commissionRule: { findMany: vi.fn().mockResolvedValue([{ id: "old", sellerMemberId: "seller", active: false, percentageBps: 500, basis: "TCV", trigger: "SALE", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-09-01") }]) },
      opportunity: { findMany: vi.fn().mockResolvedValue([{ id: "sale", amountCents: 100n, mrrCents: 0n, tcvCents: 100n, currency: "BRL", closedAt: new Date("2026-08-20") }]) },
      commercialContract: { findFirst: vi.fn().mockResolvedValue(null) },
      commission: { findFirst: vi.fn().mockResolvedValue({ id: "existing" }), create: vi.fn() },
    };
    expect(await reconcileCommissionsInTransaction(tx as never, context, new Date("2026-09-30"), "sale")).toEqual({ rules: 1, created: 0 });
    expect(tx.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "sale", closedAt: { not: null, gte: new Date("2026-01-01"), lt: new Date("2026-09-01"), lte: new Date("2026-09-30") } }) }));
    expect(tx.commission.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", opportunityId: "sale", ruleId: "old", paymentId: null } }));
    expect(tx.commission.create).not.toHaveBeenCalled();
  });

  it("gera comissão proporcional para cada recebimento confirmado sem ultrapassar a base", async () => {
    const create = vi.fn().mockResolvedValue({ id: "commission" });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      commissionRule: { findMany: vi.fn().mockResolvedValue([{ id: "receipt-rule", sellerMemberId: "seller", active: true, percentageBps: 1_000, basis: "SALE_AMOUNT", trigger: "RECEIPT", effectiveFrom: new Date("2026-01-01"), effectiveTo: null }]) },
      opportunity: { findMany: vi.fn().mockResolvedValue([{ id: "sale", amountCents: 10_000n, mrrCents: 1_000n, tcvCents: 12_000n, currency: "BRL", closedAt: new Date("2026-08-20") }]) },
      commercialContract: { findFirst: vi.fn().mockResolvedValue({ id: "contract" }) },
      invoice: { findMany: vi.fn().mockResolvedValue([{ id: "invoice" }]) },
      payment: { findMany: vi.fn().mockResolvedValue([
        { id: "payment-1", amountCents: 6_000n, currency: "BRL", occurredAt: new Date("2026-09-01") },
        { id: "payment-2", amountCents: 7_000n, currency: "BRL", occurredAt: new Date("2026-09-15") },
      ]) },
      commission: { findMany: vi.fn().mockResolvedValue([]), create },
    };
    expect(await reconcileCommissionsInTransaction(tx as never, context, new Date("2026-09-30"), "sale")).toEqual({ rules: 1, created: 2 });
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ paymentId: "payment-1", basisCents: 6_000n, amountCents: 600n }) }));
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ paymentId: "payment-2", basisCents: 4_000n, amountCents: 400n }) }));
  });
});
