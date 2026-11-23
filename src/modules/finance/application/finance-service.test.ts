import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService, reconcileCommissionsInTransaction } from "./finance-service";

const context = { workspaceId: "workspace", actorId: "actor" } as AuthenticatedContext;

describe("finance service", () => {
  it("apaga lançamento isolado no workspace com permissão e auditoria", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    const entry = {
      id: entryId, categoryId: "category", financialAccountId: "account", direction: "EXPENSE", status: "SETTLED",
      description: "Despesa duplicada", amountCents: 1_800n, competenceAt: new Date("2026-11-23T03:00:00Z"),
      dueAt: new Date("2026-11-23T03:00:00Z"), settledAt: new Date("2026-11-23T03:00:00Z"), revision: 2,
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      financialEntry: { findFirst: vi.fn().mockResolvedValue(entry), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      bankStatementLine: { count: vi.fn().mockResolvedValue(0) },
      financialAttachment: { count: vi.fn().mockResolvedValue(0) },
      commercialCompensationAllocation: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    };
    const database = { $transaction: vi.fn((callback) => callback(tx)) };
    const assertAuthorized = vi.fn();
    const service = createFinanceService({ database: database as never, authorization: { assertAuthorized } as never, now: () => new Date() });

    await expect(service.command(context, { action: "DELETE_ENTRY", entryId, expectedRevision: 2 })).resolves.toEqual({ id: entryId, deleted: true });
    expect(assertAuthorized).toHaveBeenCalledWith(context, "finance.manage", { workspaceId: "workspace", resourceType: "Finance", resourceId: entryId });
    expect(tx.financialEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: entryId, workspaceId: "workspace" } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "finance.entry.deleted", entityId: entryId }) }));
    expect(tx.financialEntry.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: "workspace", id: entryId, revision: 2 } });
  });

  it("nega exclusão sem autorização antes de abrir transação", async () => {
    const database = { $transaction: vi.fn() };
    const service = createFinanceService({
      database: database as never,
      authorization: { assertAuthorized: vi.fn().mockRejectedValue(new Error("denied")) } as never,
      now: () => new Date(),
    });
    await expect(service.command(context, { action: "DELETE_ENTRY", entryId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1 })).rejects.toThrow("denied");
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("bloqueia exclusão de lançamento conciliado", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      financialEntry: { findFirst: vi.fn().mockResolvedValue({
        id: entryId, categoryId: "category", financialAccountId: "account", direction: "EXPENSE", status: "SETTLED",
        description: "Despesa conciliada", amountCents: 1_800n, competenceAt: new Date(), dueAt: new Date(), settledAt: new Date(), revision: 1,
      }), deleteMany: vi.fn() },
      bankStatementLine: { count: vi.fn().mockResolvedValue(1) },
      financialAttachment: { count: vi.fn().mockResolvedValue(0) },
      commercialCompensationAllocation: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn() },
    };
    const service = createFinanceService({
      database: { $transaction: vi.fn((callback) => callback(tx)) } as never,
      authorization: { assertAuthorized: vi.fn() } as never,
      now: () => new Date(),
    });

    await expect(service.command(context, { action: "DELETE_ENTRY", entryId, expectedRevision: 1 })).rejects.toThrow("possui conciliação");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.financialEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("interrompe a exclusão quando a revisão muda durante a operação", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      financialEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: entryId, categoryId: "category", financialAccountId: "account", direction: "EXPENSE", status: "PLANNED",
          description: "Despesa concorrente", amountCents: 1_800n, competenceAt: new Date(), dueAt: new Date(), settledAt: null, revision: 1,
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      bankStatementLine: { count: vi.fn().mockResolvedValue(0) },
      financialAttachment: { count: vi.fn().mockResolvedValue(0) },
      commercialCompensationAllocation: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    };
    const service = createFinanceService({
      database: { $transaction: vi.fn((callback) => callback(tx)) } as never,
      authorization: { assertAuthorized: vi.fn() } as never,
      now: () => new Date(),
    });

    await expect(service.command(context, { action: "DELETE_ENTRY", entryId, expectedRevision: 1 })).rejects.toThrow("foi alterado");
    expect(tx.financialEntry.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: "workspace", id: entryId, revision: 1 } });
  });

  it("limita o extrato autorizado por workspace, período e página sem selecionar dados brutos", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const assertAuthorized = vi.fn().mockRejectedValueOnce(new Error("denied"));
    const service = createFinanceService({
      database: { bankStatementLine: { findMany } } as never,
      authorization: { assertAuthorized } as never,
      now: () => new Date(),
    });
    const query = { section: "conciliacao" as const, page: 3, pageSize: 10, recordId: "import", from: "2026-11-01T03:00:00Z", to: "2026-11-02T03:00:00Z" };
    await expect(service.listSupportingRecords(context, query)).rejects.toThrow("denied");
    expect(findMany).not.toHaveBeenCalled();
    await expect(service.listSupportingRecords(context, query)).resolves.toEqual([]);
    expect(assertAuthorized).toHaveBeenCalledWith(context, "finance.read", { workspaceId: "workspace", resourceType: "Finance" });
    const [request] = findMany.mock.calls[0]!;
    expect(request).toMatchObject({
      where: { workspaceId: "workspace", importId: "import", occurredAt: { gte: new Date(query.from), lt: new Date(query.to) } },
      skip: 20, take: 11,
    });
    expect(request.select).not.toHaveProperty("rawData");
  });

  it("inclui saldo histórico, títulos vencidos e projeção sem duplicar entradas antigas", async () => {
    const entry = { id: "entry", categoryId: "category", financialAccountId: "bank", customerAccountId: null, direction: "INCOME", status: "SETTLED", description: "Receita", counterparty: null, amountCents: 200n, competenceAt: new Date("2026-09-02"), dueAt: new Date("2026-09-02"), settledAt: new Date("2026-08-31"), revision: 1 };
    const database = {
      commercialCompensationObligation: { findMany: vi.fn().mockResolvedValue([]) },
      workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ timeZone: "UTC" }) },
      financialCategory: { findMany: vi.fn().mockResolvedValue([{ id: "category", name: "Vendas", kind: "INCOME", dreGroup: null }]) },
      financialAccount: { findMany: vi.fn().mockResolvedValue([{ id: "bank", name: "Banco", openingBalanceCents: 1_000n }]) },
      financialEntry: {
        findMany: vi.fn().mockResolvedValue([entry, { ...entry, id: "planned", direction: "EXPENSE", status: "PLANNED", amountCents: 300n, dueAt: new Date("2026-08-10"), settledAt: null }]),
        groupBy: vi.fn().mockResolvedValue([{ financialAccountId: "bank", direction: "INCOME", _sum: { amountCents: 200n } }]),
      },
      invoice: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      paymentEvent: { findMany: vi.fn().mockResolvedValue([]) },
      subscription: { findMany: vi.fn().mockResolvedValue([]) },
      revenueMovement: { findMany: vi.fn().mockResolvedValue([]) },
      opportunity: { findMany: vi.fn().mockResolvedValue([]) },
      commissionRule: { findMany: vi.fn().mockResolvedValue([]) },
      commission: { findMany: vi.fn().mockResolvedValue([]) },
      workspaceMember: { findMany: vi.fn().mockResolvedValue([]) },
      financialCostCenter: { findMany: vi.fn().mockResolvedValue([]) },
      financialRecurrence: { findMany: vi.fn().mockResolvedValue([]) },
      bankStatementImport: { findMany: vi.fn().mockResolvedValue([]) },
      bankStatementLine: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(501) },
      financialAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = createFinanceService({ database: database as never, authorization: { assertAuthorized: vi.fn(), authorize: vi.fn().mockResolvedValue({ allowed: true }) } as never, now: () => new Date("2026-09-30T15:00:00.000Z") });
    const result = await service.screen(context);
    expect(result.summary).toMatchObject({ openingBalanceCents: "1200", cashBalanceCents: "1200", payableOpenCents: "300", projectedCashCents: "900" });
    expect(result.summary.unmatchedStatementLines).toBe(501);
    expect(result.accounts[0]?.balanceCents).toBe("1200");
    database.workspace.findUniqueOrThrow.mockResolvedValue({ timeZone: "America/Sao_Paulo" });
    expect((await service.screen(context)).period).toEqual({ from: "2026-09-01T03:00:00.000Z", to: "2026-10-01T03:00:00.000Z" });
    expect(result.cashFlow).toHaveLength(30);
    expect(result.cashProjection[0]?.balanceCents).toBe("900");
    expect(database.financialEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", status: "SETTLED", settledAt: { lt: new Date("2026-09-01") } } }));
    database.financialCategory.findMany.mockResolvedValue([
      { id: "category", name: "Vendas", kind: "INCOME", dreGroup: null },
      { id: "transfer", name: "Transferência", kind: "EXPENSE", dreGroup: "movimentacao_interna" },
      { id: "adjustment", name: "Ajuste de saldo", kind: "INCOME", dreGroup: "ajuste_saldo" },
      { id: "refund", name: "Estorno de despesa", kind: "INCOME", dreGroup: "despesas_operacionais", key: "estorno_despesa_teste" },
      { id: "expense", name: "Despesa", kind: "EXPENSE", dreGroup: "despesas_operacionais" },
    ]);
    database.financialAccount.findMany.mockResolvedValue([
      { id: "bank", name: "Banco", openingBalanceCents: 1_000n },
      { id: "card", name: "Cartão", openingBalanceCents: 0n },
    ]);
    const settledAt = new Date("2026-09-02T12:00:00.000Z");
    const movement = { ...entry, competenceAt: settledAt, dueAt: settledAt, settledAt };
    database.financialEntry.findMany.mockResolvedValue([
      { ...movement, id: "transfer-out", categoryId: "transfer", direction: "EXPENSE", amountCents: 100n },
      { ...movement, id: "transfer-in", categoryId: "transfer", financialAccountId: "card", amountCents: 100n, settledAt: new Date("2026-09-03T12:00:00.000Z") },
      { ...movement, id: "adjustment", categoryId: "adjustment", amountCents: 5n },
      { ...movement, id: "expense", categoryId: "expense", direction: "EXPENSE", amountCents: 50n },
      { ...movement, id: "refund", categoryId: "refund", amountCents: 10n },
      { ...movement, id: "receipt", amountCents: 200n },
    ]);
    const reconciled = await service.screen(context, {}, { accountId: undefined });
    expect(reconciled.summary).toMatchObject({
      openingBalanceCents: "1200", closingBalanceCents: "1365", incomeCents: "200",
      expenseCents: "40", resultCents: "160", netIncomeCents: "160",
    });
    expect(reconciled.cashFlow[1]).toMatchObject({ balanceCents: "1265", incomeCents: "200", expenseCents: "40" });
    expect(reconciled.cashFlow[2]).toMatchObject({ balanceCents: "1365", incomeCents: "0", expenseCents: "0" });
    expect(reconciled.accounts.map((account) => account.balanceCents)).toEqual(["1265", "100"]);
    expect(reconciled.entries).toHaveLength(6);
    expect(reconciled.cashFlowReport).toMatchObject({
      openingCents: "1200", closingCents: "1365",
      totals: { incomeCents: "200", expenseCents: "40", transferCents: "0", adjustmentCents: "5" },
    });
    const bank = await service.screen(context, { from: "2026-09-02T03:00:00.000Z", to: "2026-09-04T03:00:00.000Z" }, { accountId: "bank" });
    expect(bank.cashFlowReport).toMatchObject({
      accountId: "bank", openingCents: "1200", closingCents: "1265",
      totals: { incomeCents: "200", expenseCents: "40", transferCents: "-100", adjustmentCents: "5" },
      days: [
        { bucket: "2026-09-02", transferCents: "-100", adjustmentCents: "5", balanceCents: "1265" },
        { bucket: "2026-09-03", transferCents: "0", adjustmentCents: "0", balanceCents: "1265" },
      ],
    });

    const endOfToday = new Date("2026-10-01T03:00:00.000Z");
    database.financialEntry.findMany.mockResolvedValue([
      { ...entry, id: "early-receipt", dueAt: endOfToday, settledAt: new Date("2026-10-01T02:59:00.000Z") },
      { ...entry, id: "future-settlement", settledAt: endOfToday },
      { ...entry, id: "planned-today", status: "PLANNED", direction: "EXPENSE", dueAt: new Date("2026-09-30T12:00:00.000Z"), settledAt: null },
      entry,
    ]);
    database.invoice.findMany.mockResolvedValue([{
      id: "future", status: "OPEN", totalCents: 250n, paidCents: 0n, dueAt: endOfToday, billingPeriodStart: endOfToday, paidAt: null,
    }]);
    database.payment.findMany.mockResolvedValue([{
      id: "receipt", status: "REVERSED", amountCents: 100n, occurredAt: new Date("2026-09-29T12:00:00.000Z"), reversedAt: new Date("2026-09-30T12:00:00.000Z"),
    }]);
    const selectedPeriod = { from: "2026-09-01T03:00:00.000Z", to: "2026-10-02T03:00:00.000Z" };
    const ledger = await service.screen(context, selectedPeriod, { entries: true });
    expect(ledger.entries.map((item) => item.id)).toEqual(["early-receipt", "payment:receipt:reversed", "payment:receipt:confirmed"]);
    const receivables = await service.screen(context, selectedPeriod);
    expect(receivables.entries.map((item) => item.id)).toEqual(expect.arrayContaining(["invoice:future", "planned-today"]));
    expect(ledger.summary.payableOpenCents).toBe(receivables.summary.payableOpenCents);
  });

  it("concilia regra histórica pela vigência da venda e ignora comissão já registrada", async () => {
    const tx = {
      commercialCompensationPolicy: { findFirst: vi.fn().mockResolvedValue(null) },
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
      commercialCompensationPolicy: { findFirst: vi.fn().mockResolvedValue(null) },
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
