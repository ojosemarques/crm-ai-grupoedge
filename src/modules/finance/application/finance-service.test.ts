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
      commissionRule: { findMany: vi.fn().mockResolvedValue([{ id: "old", sellerMemberId: "seller", active: false, percentageBps: 500, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-09-01") }]) },
      opportunity: { findMany: vi.fn().mockResolvedValue([{ id: "sale", closedAt: new Date("2026-08-20") }]) },
      commission: { findMany: vi.fn().mockResolvedValue([{ opportunityId: "sale" }]), create: vi.fn() },
    };
    expect(await reconcileCommissionsInTransaction(tx as never, context, new Date("2026-09-30"), "sale")).toEqual({ rules: 1, created: 0 });
    expect(tx.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "sale", closedAt: { not: null, gte: new Date("2026-01-01"), lt: new Date("2026-09-01"), lte: new Date("2026-09-30") } }) }));
    expect(tx.commission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", opportunityId: { in: ["sale"] } } }));
    expect(tx.commission.create).not.toHaveBeenCalled();
  });
});
