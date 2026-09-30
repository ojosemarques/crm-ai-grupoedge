import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for finance integration tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Finance tests require an ephemeral schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const service = createFinanceService({ database, authorization: createAuthorizationService({ database }), now: () => new Date("2026-09-30T15:00:00.000Z") });
let workspaceId: string;
let admin: AuthenticatedContext;
let sdr: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, sdr] = await Promise.all([context("admin@demo.politizai.local"), context("sdr1@demo.politizai.local")]);
});
afterAll(async () => database.$disconnect());

describe("financeiro integrado", () => {
  it("cria conta, categoria e despesa, liquida e projeta caixa/DRE", async () => {
    const account = await service.command(admin, { action: "CREATE_ACCOUNT", name: "Banco principal", type: "BANK", openingBalanceCents: "100000" }) as { id: string };
    const category = await service.command(admin, { action: "CREATE_CATEGORY", key: "operacional", name: "Despesa operacional", kind: "EXPENSE", dreGroup: "OPERATING_EXPENSE" }) as { id: string };
    const entry = await service.command(admin, { action: "CREATE_ENTRY", categoryId: category.id, financialAccountId: account.id, customerAccountId: null, direction: "EXPENSE", status: "PLANNED", description: "Licença mensal do CRM", counterparty: "Fornecedor", amountCents: "15000", competenceAt: "2026-09-20T12:00:00.000Z", dueAt: "2026-09-25T12:00:00.000Z", settledAt: null, idempotencyKey: "finance:test:expense:001" }) as { id: string };
    const replay = await service.command(admin, { action: "CREATE_ENTRY", categoryId: category.id, financialAccountId: account.id, customerAccountId: null, direction: "EXPENSE", status: "PLANNED", description: "Licença mensal do CRM", counterparty: "Fornecedor", amountCents: "15000", competenceAt: "2026-09-20T12:00:00.000Z", dueAt: "2026-09-25T12:00:00.000Z", settledAt: null, idempotencyKey: "finance:test:expense:001" }) as { id: string };
    expect(replay.id).toBe(entry.id);

    await service.command(admin, { action: "SETTLE_ENTRY", entryId: entry.id, status: "SETTLED", settledAt: "2026-09-25T12:00:00.000Z", expectedRevision: 1 });
    const screen = await service.screen(admin, { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
    expect(screen.metrics).toMatchObject({ expenseCents: "15000", cashBalanceCents: "85000", netIncomeCents: "-15000" });
    expect(screen.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: entry.id, status: "SETTLED", direction: "EXPENSE" })]));
  });

  it("nega SDR por padrão e isola workspace adulterado", async () => {
    await expect(service.screen(sdr, {})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.screen({ ...admin, workspaceId: randomUUID() }, {})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("preserva movimentos históricos no saldo e separa custos diretos na DRE", async () => {
    const before = await service.screen(admin);
    const account = await service.command(admin, { action: "CREATE_ACCOUNT", name: "Conta histórico", type: "BANK", openingBalanceCents: "10000" }) as { id: string };
    const category = await service.command(admin, { action: "CREATE_CATEGORY", key: "custos_entrega", name: "Custos de entrega", kind: "EXPENSE", dreGroup: "custos_diretos" }) as { id: string };
    await service.command(admin, { action: "CREATE_ENTRY", categoryId: category.id, financialAccountId: account.id, direction: "EXPENSE", status: "SETTLED", description: "Despesa anterior ao período", amountCents: "2500", competenceAt: "2026-08-10", dueAt: "2026-08-10", settledAt: "2026-08-10", idempotencyKey: "finance:test:historical" });
    await service.command(admin, { action: "CREATE_ENTRY", categoryId: category.id, financialAccountId: account.id, direction: "EXPENSE", status: "PLANNED", description: "Entrega prevista no período", amountCents: "1000", competenceAt: "2026-09-10", dueAt: "2026-09-10", idempotencyKey: "finance:test:planned" });
    const screen = await service.screen(admin);
    expect(screen.accounts.find((row) => row.id === account.id)?.balanceCents).toBe("7500");
    expect(BigInt(screen.summary.cashBalanceCents) - BigInt(before.summary.cashBalanceCents)).toBe(7500n);
    expect(BigInt(screen.summary.projectedCashCents) - BigInt(before.summary.projectedCashCents)).toBe(6500n);
    expect(screen.dre.find((row) => row.categoryId === "group:custos_diretos")).toMatchObject({ resultCents: "-1000", total: true });
    expect(screen.cashFlow).toHaveLength(30);
    expect(screen.cashFlow.at(-1)?.balanceCents).toBe(screen.summary.cashBalanceCents);
  });

  it("registra comissão paga e despesa uma única vez na conta selecionada", async () => {
    const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
    const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => new Date("2026-09-20") }).intake({ channel: "MANUAL", idempotencyKey: "finance:test:commission-lead", fullName: "Cliente comissão", phone: "+5511987654321", sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Comissão de teste", rawPayload: { test: true } }, { workspaceId, actorId: systemActor.id, actorKey: systemActor.key, actorType: "SYSTEM" });
    if (intake.outcome === "REJECTED") throw new Error(intake.code);
    const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "WON", deletedAt: null } });
    const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } });
    const opportunity = await database.opportunity.create({ data: { workspaceId, productId: product.id, leadId: intake.leadId, pipelineId: stage.pipelineId, currentStageId: stage.id, ownerMemberId: admin.memberId, name: "Venda com comissão", status: "WON", amountCents: 100_000n, tcvCents: 100_000n, probabilityBps: 10_000, closedAt: new Date("2026-09-20"), createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const rule = await database.commissionRule.create({ data: { workspaceId, sellerMemberId: opportunity.ownerMemberId!, percentageBps: 500, effectiveFrom: new Date("2026-01-01"), createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const commission = await database.commission.create({ data: { workspaceId, sellerMemberId: opportunity.ownerMemberId!, ruleId: rule.id, opportunityId: opportunity.id, basisCents: 100_000n, percentageBps: 500, amountCents: 5_000n, earnedAt: new Date("2026-09-20"), idempotencyKey: "finance:test:commission", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const account = await service.command(admin, { action: "CREATE_ACCOUNT", name: "Banco comissões", type: "BANK", openingBalanceCents: "10000" }) as { id: string };
    await service.command(admin, { action: "UPDATE_COMMISSION", commissionId: commission.id, status: "APPROVED", expectedRevision: 1 });
    await expect(service.command(admin, { action: "UPDATE_COMMISSION", commissionId: commission.id, status: "PAID", expectedRevision: 2 })).rejects.toThrow("Selecione a conta");
    await expect(service.command(admin, { action: "UPDATE_COMMISSION", commissionId: commission.id, status: "PAID", expectedRevision: 2, financialAccountId: randomUUID() })).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_NOT_FOUND" });
    await service.command(admin, { action: "UPDATE_COMMISSION", commissionId: commission.id, status: "PAID", expectedRevision: 2, financialAccountId: account.id });
    await expect(service.command(admin, { action: "UPDATE_COMMISSION", commissionId: commission.id, status: "PAID", expectedRevision: 2, financialAccountId: account.id })).rejects.toMatchObject({ code: "FINANCE_COMMISSION_TRANSITION" });
    const entries = await database.financialEntry.findMany({ where: { workspaceId, idempotencyKey: `finance:commission-payment:${commission.id}` } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "EXPENSE", status: "SETTLED", amountCents: 5000n, financialAccountId: account.id, competenceAt: new Date("2026-09-20") });
    const screen = await service.screen(admin);
    expect(screen.accounts.find((row) => row.id === account.id)?.balanceCents).toBe("5000");
  });

  it("opera recorrência, aprovação, comprovante e conciliação automática de extrato", async () => {
    const account = await service.command(admin, { action: "CREATE_ACCOUNT", name: "Banco conciliação", type: "BANK", openingBalanceCents: "0" }) as { id: string };
    const category = await service.command(admin, { action: "CREATE_CATEGORY", key: "despesa_recorrente", name: "Despesa recorrente", kind: "EXPENSE", dreGroup: "despesas_operacionais" }) as { id: string };
    const costCenter = await service.command(admin, { action: "CREATE_COST_CENTER", key: "operacoes", name: "Operações" }) as { id: string };
    const recurrence = await service.command(admin, { action: "CREATE_RECURRENCE", categoryId: category.id, financialAccountId: account.id, costCenterId: costCenter.id, direction: "EXPENSE", description: "Licença recorrente", counterparty: "Fornecedor SaaS", amountCents: "12345", firstDueAt: "2026-09-30", installmentCount: 2, requiresApproval: true }) as { id: string };
    const installments = await database.financialEntry.findMany({ where: { workspaceId, recurrenceId: recurrence.id }, orderBy: { installmentNumber: "asc" } });
    expect(installments).toHaveLength(2);
    expect(installments[0]).toMatchObject({ costCenterId: costCenter.id, installmentNumber: 1, approvalStatus: "PENDING", status: "PLANNED" });
    await service.command(admin, { action: "REVIEW_EXPENSE", entryId: installments[0]!.id, decision: "APPROVE", reason: "Contrato e valor conferidos.", expectedRevision: 1 });
    await service.command(admin, { action: "IMPORT_BANK_STATEMENT", financialAccountId: account.id, fileName: "extrato-setembro.csv", csv: "data;descricao;valor\n30/09/2026;Licenca SaaS;-123,45" });
    expect(await database.bankStatementLine.findFirstOrThrow({ where: { workspaceId, description: "Licenca SaaS" } })).toMatchObject({ status: "MATCHED", financialEntryId: installments[0]!.id });
    expect(await database.financialEntry.findUniqueOrThrow({ where: { id: installments[0]!.id } })).toMatchObject({ status: "SETTLED", approvalStatus: "APPROVED" });
    await service.addAttachment(admin, { entryId: installments[0]!.id, fileName: "comprovante.pdf", mimeType: "application/pdf" }, Buffer.from("comprovante financeiro"));
    const storedAttachment = await database.financialAttachment.findFirstOrThrow({ where: { workspaceId } });
    expect(Buffer.from(storedAttachment.content).toString("utf8")).toBe("comprovante financeiro");
    expect((await service.getAttachment(admin, storedAttachment.id)).fileName).toBe("comprovante.pdf");
    await expect(service.getAttachment(sdr, storedAttachment.id)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.addAttachment(admin, { entryId: installments[0]!.id, fileName: "malware.html", mimeType: "text/html" }, Buffer.from("<script>"))).rejects.toMatchObject({ name: "ZodError" });
    expect(await database.financialAttachment.count({ where: { workspaceId, financialEntryId: installments[0]!.id } })).toBe(1);
    await service.command(admin, { action: "IMPORT_BANK_STATEMENT", financialAccountId: account.id, fileName: "extrato-outubro.csv", csv: "data;descricao;valor\n30/10/2026;Licenca SaaS;-123,45" });
    const pendingLine = await database.bankStatementLine.findFirstOrThrow({ where: { workspaceId, description: "Licenca SaaS", status: "UNMATCHED" }, orderBy: { occurredAt: "desc" } });
    await expect(service.command(admin, { action: "REVIEW_BANK_LINE", lineId: pendingLine.id, decision: "MATCH", entryId: installments[1]!.id })).rejects.toMatchObject({ code: "FINANCE_EXPENSE_APPROVAL_REQUIRED" });
    const rule = await service.command(admin, { action: "CREATE_COMMISSION_RULE", sellerMemberId: sdr.memberId, percentageBps: 750, basis: "MRR", effectiveFrom: "2026-10-01" }) as { rule: { basis: string } };
    expect(rule.rule.basis).toBe("MRR");
    const screen = await service.screen(admin);
    expect(screen.costCenters).toEqual(expect.arrayContaining([expect.objectContaining({ id: costCenter.id })]));
    expect(screen.recurrences).toEqual(expect.arrayContaining([expect.objectContaining({ id: recurrence.id })]));
    expect(screen.statementLines).toEqual(expect.arrayContaining([expect.objectContaining({ status: "MATCHED" })]));
    expect(screen.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ fileName: "comprovante.pdf" })]));
  });
});
