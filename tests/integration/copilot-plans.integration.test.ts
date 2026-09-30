import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { createCopilotPlanService } from "@/modules/ai-assistant/application/copilot-plan-service";
import type { CopilotPlan } from "@/modules/ai-assistant/domain/copilot-plan-contracts";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const now = () => new Date();
const service = createCopilotPlanService({ database, now });
const authorization = createAuthorizationService({ database });
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let categoryId: string;
let financialAccountId: string;
let leadId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { workspaceId, workspaceSlug: "politizai", sessionId: randomUUID(), userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}
beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  admin = await context("admin@demo.politizai.local"); viewer = await context("viewer@demo.politizai.local");
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization, now }).intake({ channel: "MANUAL", idempotencyKey: `plan-test:${randomUUID()}`, fullName: "Lead Plano", phone: `+55119${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`, sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Plano de teste", rawPayload: { test: true } }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  leadId = intake.leadId;
  const finance = createFinanceService({ database, authorization, now });
  financialAccountId = (await finance.command(admin, { action: "CREATE_ACCOUNT", name: "Banco planos", type: "BANK", openingBalanceCents: "100000" }) as { id: string }).id;
  categoryId = (await finance.command(admin, { action: "CREATE_CATEGORY", key: "copilot_plan", name: "Despesa planos", kind: "EXPENSE", dreGroup: "despesas_operacionais" }) as { id: string }).id;
});
afterAll(async () => database.$disconnect());

const task = (title: string): CopilotPlan["steps"][number] => ({ kind: "CREATE_TASK", leadId, title, taskKind: "CALL", priority: "HIGH", dueAt: "2027-01-03T15:00:00Z" });
const expense = (description: string): CopilotPlan["steps"][number] => ({ kind: "CREATE_EXPENSE", categoryId, financialAccountId, description, amountCents: "15000", competenceAt: now().toISOString(), dueAt: now().toISOString(), status: "PLANNED" });
const confirmation = (proposal: { id: string; revision: number }) => ({ proposalId: proposal.id, expectedRevision: proposal.revision, confirmed: true as const });

async function saleFixture() {
  const account = await database.account.create({ data: { workspaceId, name: "Cliente plano integrado", normalizedName: `cliente-plano-${randomUUID()}`, origin: "SEED", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const contact = await database.contact.create({ data: { workspaceId, preferredName: "Contato plano", origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.lead.update({ where: { id: leadId }, data: { accountId: account.id, contactId: contact.id } });
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "NEGOTIATION", deletedAt: null } });
  const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, salesGateProfile: "STANDARD", deletedAt: null } });
  const opportunity = await database.opportunity.create({ data: { workspaceId, leadId, accountId: account.id, pipelineId: stage.pipelineId, currentStageId: stage.id, ownerMemberId: admin.memberId, productId: product.id, name: "Venda plano", status: "OPEN", amountCents: 150000n, mrrCents: 50000n, tcvCents: 150000n, probabilityBps: 8000, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.stageHistory.create({ data: { workspaceId, pipelineId: stage.pipelineId, stageId: stage.id, opportunityId: opportunity.id, enteredAt: now(), enteredByActorId: admin.actorId } });
  await database.offer.create({ data: { workspaceId, opportunityId: opportunity.id, productId: product.id, name: "Três meses", quantity: 1, unitPriceCents: 150000n, totalCents: 150000n, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const clause = await database.contractTemplateClause.findFirstOrThrow({ where: { workspaceId } });
  const template = await database.contractTemplateVersion.findUniqueOrThrow({ where: { id: clause.templateVersionId } });
  return { opportunityId: opportunity.id, expectedRevision: 1, sellerMemberId: admin.memberId, totalCents: "150000", monthlyCents: "50000", upfrontCents: "0", durationMonths: 3, startsAt: now().toISOString(), templateVersionId: template.id, acceptance: { acceptedByName: "Cliente plano", acceptedByRole: "Diretor", evidenceText: "Aceite real registrado na fixture de integração." } };
}

describe("planos atômicos persistidos do Copilot", () => {
  it("prévia não grava efeitos, é idempotente e persiste ordem e conteúdo aprovável", async () => {
    const payload = { steps: [task("Plano sem efeito"), expense("Despesa sem efeito")] };
    const first = await service.propose(admin, "Preparar duas ações", payload);
    expect(await service.propose(admin, "Preparar novamente", payload)).toEqual(first);
    expect(first.preview).toMatchObject({ atomic: true, steps: [{ position: 1, kind: "CREATE_TASK" }, { position: 2, kind: "CREATE_EXPENSE" }] });
    expect(await database.task.count({ where: { workspaceId, title: "Plano sem efeito" } })).toBe(0);
    expect(await database.financialEntry.count({ where: { workspaceId, description: "Despesa sem efeito" } })).toBe(0);
  });

  it("confirmações simultâneas e replay geram cada efeito uma vez e o mesmo recibo", async () => {
    const proposal = await service.propose(admin, "Criar tarefa e despesa", { steps: [task("Plano concorrente"), expense("Despesa concorrente")] });
    const [first, second] = await Promise.all([service.confirm(admin, confirmation(proposal)), service.confirm(admin, confirmation(proposal))]);
    expect(second).toEqual(first);
    expect(await service.confirm(admin, confirmation(proposal))).toEqual(first);
    expect(await database.task.count({ where: { workspaceId, title: "Plano concorrente" } })).toBe(1);
    expect(await database.financialEntry.count({ where: { workspaceId, description: "Despesa concorrente" } })).toBe(1);
    expect(await database.auditLog.count({ where: { workspaceId, entityId: proposal.id, action: "ai.copilot.plan.executed" } })).toBe(1);
    expect(await database.aIAssistantProposal.findUniqueOrThrow({ where: { id: proposal.id } })).toMatchObject({ status: "PUBLISHED", revision: 2, publishedTargetType: "CopilotPlan", publishedTargetId: proposal.id });
    expect((await service.screen(admin)).history).toContainEqual(expect.objectContaining({ id: proposal.id, status: "PUBLISHED" }));
  });

  it("falha na segunda etapa reverte tarefa, fechamento, contrato e recibos de domínio", async () => {
    const payload = await saleFixture();
    const original = await database.contractTemplateVersion.findUniqueOrThrow({ where: { id: payload.templateVersionId } });
    const emptyTemplate = await database.contractTemplateVersion.create({ data: { workspaceId, templateId: original.templateId, version: 901, titleTemplate: "Contrato incompleto", introduction: "Sem cláusulas para provar rollback", contentHash: "a".repeat(64), allowedVariables: [], createdByActorId: admin.actorId } });
    const proposal = await service.propose(admin, "Tarefa e fechamento inválido", { steps: [task("Plano rollback de venda"), { kind: "CLOSE_SALE", payload: { ...payload, templateVersionId: emptyTemplate.id } }] });
    const receiptsBefore = await database.auditLog.count({ where: { workspaceId, action: "ai.copilot.action.executed" } });
    await expect(service.confirm(admin, confirmation(proposal))).rejects.toThrow("cláusulas");
    expect(await database.task.count({ where: { workspaceId, title: "Plano rollback de venda" } })).toBe(0);
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: payload.opportunityId } })).toMatchObject({ status: "OPEN", revision: 1 });
    expect(await database.commercialContract.count({ where: { opportunityId: payload.opportunityId } })).toBe(0);
    expect(await database.commission.count({ where: { opportunityId: payload.opportunityId } })).toBe(0);
    expect(await database.auditLog.count({ where: { workspaceId, action: "ai.copilot.action.executed" } })).toBe(receiptsBefore);
    expect(await database.aIAssistantProposal.findUniqueOrThrow({ where: { id: proposal.id } })).toMatchObject({ status: "DRAFT", revision: 1, approvedAt: null });
  });

  it("fechamento e tarefa na mesma transação persistem contrato e cobranças uma vez", async () => {
    const payload = await saleFixture();
    const proposal = await service.propose(admin, "Fechar e acompanhar", { steps: [{ kind: "CLOSE_SALE", payload }, task("Acompanhar plano fechado")] });
    const first = await service.confirm(admin, confirmation(proposal));
    expect(await service.confirm(admin, confirmation(proposal))).toEqual(first);
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: payload.opportunityId } })).toMatchObject({ status: "WON" });
    const contract = await database.commercialContract.findFirstOrThrow({ where: { opportunityId: payload.opportunityId } });
    expect(await database.invoice.count({ where: { contractId: contract.id } })).toBe(3);
    expect(await database.task.count({ where: { workspaceId, title: "Acompanhar plano fechado" } })).toBe(1);
  });

  it("revalida todas as prévias antes de escrever e oculta histórico depois da revogação", async () => {
    const proposal = await service.propose(admin, "Plano com dados que mudarão", { steps: [task("Plano desatualizado"), expense("Despesa desatualizada")] });
    const category = await database.financialCategory.findUniqueOrThrow({ where: { id: categoryId } });
    await database.financialCategory.update({ where: { id: categoryId }, data: { name: "Categoria alterada depois da prévia" } });
    await expect(service.confirm(admin, confirmation(proposal))).rejects.toMatchObject({ code: "COPILOT_PREVIEW_CHANGED" });
    expect(await database.task.count({ where: { workspaceId, title: "Plano desatualizado" } })).toBe(0);
    await database.financialCategory.update({ where: { id: categoryId }, data: { name: category.name } });
    const grant = await database.rolePermission.findFirstOrThrow({ where: { workspaceId, roleId: admin.roleId, permission: { key: PermissionKeys.TASKS_WRITE } } });
    await database.rolePermission.delete({ where: { id: grant.id } });
    try {
      await expect(service.confirm({ ...admin }, confirmation(proposal))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      expect((await service.screen({ ...admin })).history.some((item) => item.id === proposal.id)).toBe(false);
    } finally { await database.rolePermission.create({ data: grant }); }
  });

  it("falha na gravação do recibo final desfaz todos os efeitos e permite nova confirmação", async () => {
    const proposal = await service.propose(admin, "Plano com falha de persistência", { steps: [task("Plano recibo indisponível"), expense("Despesa recibo indisponível")] });
    let effectsObserved = false;
    const failingDatabase = new Proxy(database, { get(target, property) {
      if (property === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, settings: unknown) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(transaction, key) {
        if (key === "auditLog") return new Proxy(transaction.auditLog, { get(delegate, method) {
          if (method === "create") return async (args: Prisma.AuditLogCreateArgs) => {
            if (args.data.action === "ai.copilot.plan.executed") {
              effectsObserved = await tx.task.count({ where: { workspaceId, title: "Plano recibo indisponível" } }) === 1 && await tx.financialEntry.count({ where: { workspaceId, description: "Despesa recibo indisponível" } }) === 1;
              throw new Error("Falha de teste no recibo final");
            }
            return delegate.create(args);
          };
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(transaction, key);
      } })), settings as { timeout?: number });
      return Reflect.get(target, property);
    } });
    await expect(createCopilotPlanService({ database: failingDatabase, now }).confirm(admin, confirmation(proposal))).rejects.toThrow("Falha de teste");
    expect(effectsObserved).toBe(true);
    expect(await database.task.count({ where: { workspaceId, title: "Plano recibo indisponível" } })).toBe(0);
    expect(await database.financialEntry.count({ where: { workspaceId, description: "Despesa recibo indisponível" } })).toBe(0);
    expect(await database.aIAssistantProposal.findUniqueOrThrow({ where: { id: proposal.id } })).toMatchObject({ status: "DRAFT", revision: 1 });
    await service.confirm(admin, confirmation(proposal));
    expect(await database.task.count({ where: { workspaceId, title: "Plano recibo indisponível" } })).toBe(1);
  });

  it("nega outro tenant/ator e preserva cancelamento e expiração sem efeitos", async () => {
    const payload = { steps: [task("Plano cancelado"), expense("Despesa cancelada")] };
    const proposal = await service.propose(admin, "Cancelar plano", payload);
    await expect(service.confirm(viewer, confirmation(proposal))).rejects.toThrow();
    await expect(service.confirm({ ...admin, workspaceId: randomUUID() }, confirmation(proposal))).rejects.toThrow();
    await expect(service.confirm({ ...admin, actorId: randomUUID() }, confirmation(proposal))).rejects.toThrow();
    await service.cancel(admin, { proposalId: proposal.id, expectedRevision: proposal.revision });
    await expect(service.confirm(admin, confirmation(proposal))).rejects.toMatchObject({ code: "COPILOT_REVISION_CONFLICT" });
    const expiring = await service.propose(admin, "Prévia expirada", payload);
    await database.aIAssistantProposal.update({ where: { id: expiring.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    await expect(service.confirm(admin, confirmation(expiring))).rejects.toMatchObject({ code: "COPILOT_PROPOSAL_EXPIRED" });
    const next = await service.propose(admin, "Nova prévia", payload);
    expect(next.id).not.toBe(expiring.id);
    expect(await database.aIAssistantProposal.findUniqueOrThrow({ where: { id: expiring.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await database.task.count({ where: { workspaceId, title: "Plano cancelado" } })).toBe(0);
  });

  it("constraints liberam somente ACTION_PLAN e preservam publicação versionada de configuração", async () => {
    const base = { workspaceId, requestedByActorId: admin.actorId, request: "Constraint", payload: {}, diff: {}, impact: [], preview: {}, requestFingerprint: "e".repeat(64), status: "PUBLISHED" };
    await expect(database.aIAssistantProposal.create({ data: { ...base, type: "ACTION_PLAN" } })).rejects.toThrow(/published_state_check/);
    await expect(database.aIAssistantProposal.create({ data: { ...base, type: "AGENT", publishedTargetType: "GovernedAgent", publishedTargetId: randomUUID() } })).rejects.toThrow(/published_state_check/);
    await expect(database.aIAssistantProposal.create({ data: { ...base, type: "EXECUTE_SQL", status: "DRAFT" } })).rejects.toThrow(/type_check/);
  });
});
