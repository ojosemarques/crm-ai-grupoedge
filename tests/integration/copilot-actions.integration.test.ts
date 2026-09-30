import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createAccountService } from "@/modules/accounts/application/account-service";
import { createCopilotActionsService } from "@/modules/ai-assistant/application/copilot-actions-service";
import { createCopilotService } from "@/modules/ai-assistant/application/copilot-service";
import type { CopilotAction } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const now = () => new Date("2026-09-30T15:00:00Z");
const actions = createCopilotActionsService({ database, now });
const authorization = createAuthorizationService({ database });
const finance = createFinanceService({ database, authorization, now });
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let workspaceId: string;
let leadId: string;
let accountId: string;
let categoryId: string;
let financialAccountId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { workspaceId, workspaceSlug: "politizai", sessionId: randomUUID(), userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}
beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  admin = await context("admin@demo.politizai.local"); viewer = await context("viewer@demo.politizai.local");
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization, now }).intake({ channel: "MANUAL", idempotencyKey: `copilot-test:${randomUUID()}`, fullName: "Lead Copilot", phone: "+5511998877665", sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Operação Copilot integrada", rawPayload: { test: true } }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  leadId = intake.leadId;
  accountId = (await createAccountService({ database, authorization, now }).create(admin, { name: "Cliente Copilot", domain: "cliente.example" })).id;
  financialAccountId = (await finance.command(admin, { action: "CREATE_ACCOUNT", name: "Banco Copilot", type: "BANK", openingBalanceCents: "100000" }) as { id: string }).id;
  categoryId = (await finance.command(admin, { action: "CREATE_CATEGORY", key: "copilot_software", name: "Software Copilot", kind: "EXPENSE", dreGroup: "despesas_operacionais" }) as { id: string }).id;
});
afterAll(async () => database.$disconnect());
const confirmation = () => ({ confirmed: true as const, idempotencyKey: randomUUID() });
const expense = (): CopilotAction => ({ kind: "CREATE_EXPENSE", categoryId, financialAccountId, description: "Licença de software", amountCents: "15000", competenceAt: now().toISOString(), dueAt: now().toISOString(), status: "SETTLED", settledAt: now().toISOString(), paymentConfirmed: true });

describe("ações operacionais do Copilot", () => {
  it("prévia não altera dados; confirmação cria tarefa uma vez, com responsável e histórico", async () => {
    const action: CopilotAction = { kind: "CREATE_TASK", leadId, title: "Ligar para confirmar onboarding", taskKind: "CALL", priority: "HIGH", dueAt: "2026-10-01T15:00:00Z" };
    const before = await database.task.count({ where: { workspaceId, leadId } });
    expect(await actions.preview(admin, action)).toMatchObject({ kind: "CREATE_TASK", title: "Criar tarefa" });
    expect(await database.task.count({ where: { workspaceId, leadId } })).toBe(before);
    const key = confirmation();
    const first = await actions.execute(admin, action, key);
    expect((await actions.execute(admin, action, key)).targetId).toBe(first.targetId);
    const task = await database.task.findUniqueOrThrow({ where: { id: first.targetId } });
    const lead = await database.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(task.assigneeMemberId).toBe(lead.ownerMemberId);
    expect(await database.task.count({ where: { workspaceId, leadId } })).toBe(before + 1);
    expect(await database.auditLog.count({ where: { workspaceId, action: "ai.copilot.action.executed", entityId: task.id } })).toBe(1);
    await expect(actions.execute(admin, { ...action, title: "Outra tarefa" }, key)).rejects.toMatchObject({ code: "COPILOT_ACTION_REPLAY_CONFLICT" });
  });

  it("atualiza só os campos confirmados, rejeita versão antiga e preserva replay", async () => {
    const account = await database.account.findUniqueOrThrow({ where: { id: accountId } });
    const action: CopilotAction = { kind: "UPDATE_CUSTOMER", accountId, expectedRevision: account.revision, changes: { name: "Cliente Copilot revisado" } };
    expect((await actions.preview(admin, action)).details).toContainEqual({ label: "Nome", before: "Cliente Copilot", after: "Cliente Copilot revisado" });
    const key = confirmation();
    await actions.execute(admin, action, key);
    await actions.execute(admin, action, key);
    const updated = await database.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(updated).toMatchObject({ name: "Cliente Copilot revisado", originalDomain: "cliente.example", revision: account.revision + 1 });
    await expect(actions.preview(admin, action)).rejects.toMatchObject({ code: "COPILOT_STALE_CUSTOMER" });
  });

  it("registra despesa uma vez no caixa e DRE, bloqueia outro tenant e usuário sem acesso", async () => {
    const before = await finance.screen(admin, { from: "2026-09-01", to: "2026-10-01" });
    const action = expense();
    await expect(actions.preview(viewer, action)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(actions.execute({ ...admin, workspaceId: randomUUID() }, action, confirmation())).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const key = confirmation();
    const first = await actions.execute(admin, action, key);
    await actions.execute(admin, action, key);
    const after = await finance.screen(admin, { from: "2026-09-01", to: "2026-10-01" });
    expect(BigInt(after.metrics.expenseCents) - BigInt(before.metrics.expenseCents)).toBe(15000n);
    expect(BigInt(after.metrics.cashBalanceCents) - BigInt(before.metrics.cashBalanceCents)).toBe(-15000n);
    expect(await database.financialEntry.count({ where: { workspaceId, id: first.targetId } })).toBe(1);
    expect((await actions.options(viewer)).categories).toEqual([]);
  });

  it("fluxo local persiste proposta, exige confirmação e recupera histórico sem OpenAI", async () => {
    const copilot = createCopilotService({ database, authorization, now, actions, sales: createSaleCompletionService({ database, now }), generate: null, loadContext: async () => ({ sources: [], unavailable: [] }), fallback: async () => ({}) });
    const action: CopilotAction = { kind: "CREATE_TASK", leadId, title: "Revisar proposta local", taskKind: "FOLLOW_UP", priority: "MEDIUM", dueAt: "2026-10-02T15:00:00Z" };
    const before = await database.task.count({ where: { workspaceId, title: action.title } });
    const response = await copilot.command(admin, { action: "PROPOSE", payload: action }) as { proposal: { id: string; revision: number } };
    expect(response.proposal.id).toBeTruthy();
    expect(await database.task.count({ where: { workspaceId, title: action.title } })).toBe(before);
    await expect(copilot.command(viewer, { action: "CONFIRM", proposalId: response.proposal.id, expectedRevision: response.proposal.revision, confirmed: true })).rejects.toThrow();
    await copilot.command(admin, { action: "CONFIRM", proposalId: response.proposal.id, expectedRevision: response.proposal.revision, confirmed: true });
    await copilot.command(admin, { action: "CONFIRM", proposalId: response.proposal.id, expectedRevision: response.proposal.revision, confirmed: true });
    expect(await database.task.count({ where: { workspaceId, title: action.title } })).toBe(before + 1);
    expect(await database.aIAssistantProposal.findUnique({ where: { id: response.proposal.id } })).toMatchObject({ status: "PUBLISHED" });
    expect(await copilot.screen(admin)).toHaveProperty("history");
  });

  it("recuperação sem execução prévia rejeita responsável alterado; replay executado continua recuperável", async () => {
    const action: CopilotAction = { kind: "CREATE_TASK", leadId, title: "Tarefa com dono revisado", taskKind: "CALL", priority: "MEDIUM", dueAt: "2026-10-02T15:00:00Z" };
    const preview = await actions.preview(admin, action);
    const lead = await database.lead.findUniqueOrThrow({ where: { id: leadId } });
    await database.lead.update({ where: { id: leadId }, data: { ownerMemberId: admin.memberId } });
    try {
      await expect(actions.execute(admin, action, { ...confirmation(), expectedPreview: preview })).rejects.toMatchObject({ code: "COPILOT_PREVIEW_CHANGED" });
      expect(await database.task.count({ where: { workspaceId, title: action.title } })).toBe(0);
    } finally { await database.lead.update({ where: { id: leadId }, data: { ownerMemberId: lead.ownerMemberId } }); }
  });

  it("migration mantém publicação de configuração sem versão e tipos arbitrários bloqueados", async () => {
    const base = { workspaceId, requestedByActorId: admin.actorId, type: "EXECUTE_SQL", request: "Constraint test", payload: {}, diff: {}, impact: [], preview: {}, requestFingerprint: "e".repeat(64) };
    await expect(database.aIAssistantProposal.create({ data: base })).rejects.toThrow(/type_check/);
    await expect(database.aIAssistantProposal.create({ data: { ...base, type: "AGENT", status: "PUBLISHED", publishedTargetType: "GovernedAgent", publishedTargetId: randomUUID() } })).rejects.toThrow(/published_state_check/);
    await expect(database.aIAssistantProposal.create({ data: { ...base, type: "CREATE_TASK", status: "PUBLISHED" } })).rejects.toThrow(/published_state_check/);
  });

  it("refazer proposta expirada preserva histórico e não colide com índice de rascunhos", async () => {
    const copilot = createCopilotService({ database, authorization, now, actions, sales: createSaleCompletionService({ database, now }), generate: null, loadContext: async () => ({ sources: [], unavailable: [] }), fallback: async () => ({}) });
    const payload: CopilotAction = { kind: "CREATE_TASK", leadId, title: "Retomar proposta expirada", taskKind: "GENERAL", priority: "MEDIUM", dueAt: "2026-10-03T15:00:00Z" };
    const first = await copilot.command(admin, { action: "PROPOSE", payload }) as { proposal: { id: string } };
    await database.aIAssistantProposal.update({ where: { id: first.proposal.id }, data: { createdAt: new Date(now().getTime() - 31 * 60_000) } });
    const next = await copilot.command(admin, { action: "PROPOSE", payload }) as { proposal: { id: string } };
    expect(next.proposal.id).not.toBe(first.proposal.id);
    expect(await database.aIAssistantProposal.findUnique({ where: { id: first.proposal.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await database.task.count({ where: { workspaceId, title: payload.title } })).toBe(0);
  });
});
