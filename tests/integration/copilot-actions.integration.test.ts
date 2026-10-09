import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createAccountService } from "@/modules/accounts/application/account-service";
import { createCopilotActionsService } from "@/modules/ai-assistant/application/copilot-actions-service";
import { createCopilotService } from "@/modules/ai-assistant/application/copilot-service";
import { loadCopilotContext } from "@/modules/ai-assistant/application/copilot-context";
import type { CopilotAction } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
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
  it("lista somente tarefas diárias do vendedor e conclui ligação pelo fluxo canônico", async () => {
    const task = await database.task.create({ data: {
      workspaceId, leadId, assigneeMemberId: admin.memberId,
      title: "Ligação da meta diária pelo Copilot", kind: "CALL",
      sourceKey: `active-prospecting:copilot-test:${randomUUID()}:call-1`,
      status: "OPEN", priority: "HIGH", dueAt: now(),
      createdByActorId: admin.actorId, updatedByActorId: admin.actorId,
    } });
    const list = await actions.dailyList(admin, "CALL");
    const entry = list.entries.find((item) => item.tasks.some((candidate) => candidate.taskId === task.id));
    expect(entry).toMatchObject({ leadId, name: "Lead Copilot", phones: expect.arrayContaining(["+5511998877665"]) });
    expect((await actions.dailyList(viewer, "CALL")).entries.some((item) => item.leadId === leadId)).toBe(false);

    const sourceLead = await database.lead.findUniqueOrThrow({ where: { id: leadId } });
    const phoneLessLeadId = randomUUID();
    await database.lead.create({ data: { ...sourceLead, id: phoneLessLeadId, contactId: null, normalizedPhone: null, normalizedEmail: null, fullName: "Lead sem telefone", nextActionTaskId: null, nextActionAt: null, nextActionDescription: null } });
    try {
      await database.task.create({ data: {
        workspaceId, leadId: phoneLessLeadId, assigneeMemberId: admin.memberId,
        title: "Ligação inválida sem telefone", kind: "CALL",
        sourceKey: `active-prospecting:copilot-test:${randomUUID()}:call-1`,
        status: "OPEN", priority: "HIGH", dueAt: now(),
        createdByActorId: admin.actorId, updatedByActorId: admin.actorId,
      } });
      expect((await actions.dailyList(admin, "CALL")).entries.some((item) => item.leadId === phoneLessLeadId)).toBe(false);
    } finally {
      await database.task.deleteMany({ where: { workspaceId, leadId: phoneLessLeadId } });
      await database.lead.delete({ where: { id: phoneLessLeadId } });
    }

    const action: CopilotAction = { kind: "COMPLETE_PROSPECTING_TASKS", items: [{ leadId, taskId: task.id, taskKind: "CALL", result: "NO_ANSWER" }] };
    expect(await actions.preview(admin, action)).toMatchObject({ kind: "COMPLETE_PROSPECTING_TASKS", title: "Concluir tarefas da prospecção" });
    await expect(actions.preview(viewer, action)).rejects.toMatchObject({ code: "COPILOT_DAILY_LIST_STALE" });
    const result = await actions.execute(admin, action, confirmation());
    expect(result).toMatchObject({ targetType: "TaskBatch", result: { completedTaskIds: [task.id], leadCount: 1 } });
    expect(await database.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "COMPLETED", result: "NO_ANSWER", assigneeMemberId: admin.memberId });
    expect(await database.activity.count({ where: { workspaceId, leadId, type: "TASK", description: "NO_ANSWER" } })).toBeGreaterThan(0);
    expect(await database.auditLog.count({ where: { workspaceId, action: "task.completed", entityId: task.id } })).toBe(1);
  });

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

  it("não confirma uma despesa usando lançamento direto que ocupou a mesma chave sem recibo Copilot", async () => {
    const action = expense();
    const expectedPreview = await actions.preview(admin, action);
    const key = confirmation();
    const existing = await finance.command(admin, {
      action: "CREATE_ENTRY", direction: "EXPENSE", categoryId, financialAccountId,
      description: "Lançamento direto com outros valores", amountCents: "2500",
      competenceAt: now().toISOString(), dueAt: now().toISOString(), status: "PLANNED",
      idempotencyKey: key.idempotencyKey,
    }) as { id: string };
    const count = await database.financialEntry.count({ where: { workspaceId } });
    await expect(actions.execute(admin, action, { ...key, expectedPreview })).rejects.toMatchObject({ code: "COPILOT_ACTION_REPLAY_CONFLICT" });
    expect(await database.financialEntry.count({ where: { workspaceId } })).toBe(count);
    expect(await database.financialEntry.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ amountCents: 2500n, status: "PLANNED", description: "Lançamento direto com outros valores" });
    expect(await database.auditLog.count({ where: { workspaceId, action: "ai.copilot.action.executed", metadata: { path: ["idempotencyKey"], equals: key.idempotencyKey } } })).toBe(0);
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
    const batch = await database.aIAssistantProposal.create({ data: { ...base, type: "COMPLETE_PROSPECTING_TASKS", status: "PUBLISHED", requestFingerprint: "f".repeat(64), publishedTargetType: "TaskBatch", publishedTargetId: randomUUID() } });
    expect(batch.type).toBe("COMPLETE_PROSPECTING_TASKS");
    await database.aIAssistantProposal.delete({ where: { id: batch.id } });
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

  it("localiza cliente e lead antigos pelo nome além da primeira página sem expor outro escopo", async () => {
    const original = await database.lead.findUniqueOrThrow({ where: { id: leadId } });
    const leadIds = Array.from({ length: 105 }, () => randomUUID());
    const accountIds = Array.from({ length: 105 }, () => randomUUID());
    const targetAccountId = randomUUID();
    try {
      await database.lead.createMany({ data: leadIds.map((id, index) => ({ ...original, id, contactId: null, normalizedPhone: null, normalizedEmail: null, fullName: `Amostra recente ${index}`, nextActionTaskId: null, nextActionAt: null, nextActionDescription: null, createdAt: new Date(now().getTime() + 60_000), updatedAt: now() })) });
      await database.account.createMany({ data: [...accountIds.map((id, index) => ({ id, workspaceId, name: `Amostra recente ${index}`, normalizedName: `amostra recente ${index}`, origin: "MANUAL" as const, createdByActorId: admin.actorId, updatedByActorId: admin.actorId })), { id: targetAccountId, workspaceId, name: "Zeta Distante", normalizedName: "zeta distante", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId }] });
      await database.lead.update({ where: { id: leadId }, data: { fullName: "Zeta Distante", updatedAt: new Date("2020-01-01"), nextActionAt: new Date("2030-01-01") } });
      const recent = await actions.options(admin);
      expect(recent.customers.some((item) => item.id === targetAccountId)).toBe(false);
      expect(recent.leads.some((item) => item.id === leadId)).toBe(false);
      const found = await actions.options(admin, 'Crie uma tarefa para "Zeta Distante"');
      expect(found.leads).toContainEqual({ id: leadId, name: "Zeta Distante" });
      expect(found.customers.map((item) => item.id)).toContain(targetAccountId);
      const denied = await actions.options(viewer, 'Atualize "Zeta Distante"');
      expect(denied.leads).toEqual([]);
      expect(denied.customers).toEqual([]);
      const foreign = await actions.options({ ...admin, workspaceId: randomUUID() }, 'Atualize "Zeta Distante"');
      expect(foreign.leads).toEqual([]);
      expect(foreign.customers).toEqual([]);
      const context = await loadCopilotContext(admin, 'Detalhes do cliente "Zeta Distante"', now());
      const clients = context.sources.find((item) => item.key === "clientes")?.data as { clients: Array<{ id: string }> };
      expect(clients.clients.map((item) => item.id)).toContain(targetAccountId);
    } finally {
      await database.lead.update({ where: { id: leadId }, data: { fullName: original.fullName, nextActionAt: original.nextActionAt, updatedAt: original.updatedAt } });
      await database.lead.deleteMany({ where: { workspaceId, id: { in: leadIds } } });
      await database.account.deleteMany({ where: { workspaceId, id: { in: [...accountIds, targetAccountId] } } });
    }
  });

  it("inclui cobranças, receita, onboarding e agenda canônicos com cobertura e permissões explícitas", async () => {
    const data = await loadCopilotContext(admin, "Resumo geral do sistema", now());
    expect(data.sources.map((item) => item.key)).toEqual(expect.arrayContaining(["cobrancas", "receita", "onboarding", "agenda"]));
    for (const key of ["cobrancas", "receita", "onboarding", "agenda"]) expect(data.sources.find((item) => item.key === key)?.data).toHaveProperty("coverage");
    const grants = await database.rolePermission.findMany({ where: { workspaceId, roleId: viewer.roleId, permission: { key: { in: [PermissionKeys.ONBOARDING_READ, PermissionKeys.MEETINGS_READ] } } } });
    try {
      await database.rolePermission.deleteMany({ where: { workspaceId, id: { in: grants.map((item) => item.id) } } });
      const denied = await loadCopilotContext(viewer, "Resumo geral do sistema", now());
      expect(denied.unavailable).toEqual(expect.arrayContaining(["cobrancas", "receita", "onboarding", "agenda"]));
      expect(denied.sources.some((item) => ["cobrancas", "receita", "onboarding", "agenda"].includes(item.key))).toBe(false);
    } finally { await database.rolePermission.createMany({ data: grants }); }
    expect(JSON.stringify(data, (_key, value) => typeof value === "bigint" ? value.toString() : value).length).toBeLessThan(70_000);
  });

  it("monta o resumo operacional do dia com prioridades e agenda autorizadas", async () => {
    const data = await loadCopilotContext(admin, "Faça meu resumo do dia e indique a próxima ação", now());
    const operation = data.sources.find((item) => item.key === "operacao_diaria")?.data as {
      dailyProduction: Record<string, unknown>;
      priorities: unknown[];
      coverage: string;
    };
    const agenda = data.sources.find((item) => item.key === "agenda")?.data as {
      meetings: unknown[];
      coverage: string;
    };

    expect(operation.dailyProduction).toBeTruthy();
    expect(operation.priorities).toBeInstanceOf(Array);
    expect(operation.coverage).toContain("escopo");
    expect(agenda.meetings).toBeInstanceOf(Array);
    expect(agenda.coverage).toContain("Dia atual");
  });

  it("expõe comparação comercial, forecast persistido e briefings sem inventar dados", async () => {
    const sales = await loadCopilotContext(admin, "Explique a queda nas vendas e mostre a previsão de fechamento", now());
    const indicators = sales.sources.find((item) => item.key === "indicadores_vendas")?.data as {
      comparisons: unknown[];
      comparisonPeriod: unknown;
      coverage: string;
    };
    const forecast = sales.sources.find((item) => item.key === "forecast")?.data as {
      current: unknown;
      candidates: unknown[];
      definitions: unknown;
    };

    expect(indicators.comparisons).toBeInstanceOf(Array);
    expect(indicators.comparisonPeriod).toBeTruthy();
    expect(indicators.coverage).toContain("não provam causa");
    expect(forecast).toHaveProperty("current");
    expect(forecast.candidates).toBeInstanceOf(Array);
    expect(forecast.definitions).toBeTruthy();

    const meetings = await loadCopilotContext(admin, "Prepare o briefing das próximas reuniões", now());
    const agenda = meetings.sources.find((item) => item.key === "agenda")?.data as { briefings: unknown[]; coverage: string };
    expect(agenda.briefings).toBeInstanceOf(Array);
    expect(agenda.coverage).toContain("3 primeiras reuniões autorizadas");
  });
});


describe("ações por conversa entre módulos", () => {
  it("cadastra lead no pipeline solicitado, preserva contato, inicializa tarefas e move a etapa uma vez", async () => {
    const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" } } } });
    const action: CopilotAction = { kind: "CREATE_LEAD", pipelineId: pipeline.id, fullName: "Lead Conversa Novo", phone: "+5511987623412", email: "conversa@example.test", organizationName: "Empresa Conversa", sourceKey: "manual", priorityBandCode: "P2" };
    const preview = await actions.preview(admin, action);
    expect(await database.lead.count({ where: { workspaceId, fullName: action.fullName } })).toBe(0);
    const confirmationInput = { ...confirmation(), expectedPreview: preview };
    const created = await actions.execute(admin, action, confirmationInput);
    expect((await actions.execute(admin, action, confirmationInput)).targetId).toBe(created.targetId);
    const lead = await database.lead.findUniqueOrThrow({ where: { id: created.targetId } });
    expect(lead.pipelineId).toBe(pipeline.id); expect(lead.normalizedEmail).toBe(action.email);
    expect(await database.task.count({ where: { workspaceId, leadId: lead.id } })).toBeGreaterThan(0);
    await expect(actions.preview(admin, action)).rejects.toMatchObject({ code: "COPILOT_DUPLICATE_LEAD" });
    const target = pipeline.stages.find(stage => stage.leadStageCode === "TRYING_CONTACT")!;
    const move: CopilotAction = { kind: "MOVE_LEAD", leadId: lead.id, targetStageId: target.id, expectedUpdatedAt: lead.updatedAt.toISOString(), reason: "Iniciar contato solicitado na conversa" };
    const before = await actions.preview(admin, move);
    expect((await database.lead.findUniqueOrThrow({ where: { id: lead.id } })).currentStageId).toBe(lead.currentStageId);
    const moveConfirmation = { ...confirmation(), expectedPreview: before };
    await actions.execute(admin, move, moveConfirmation); await actions.execute(admin, move, moveConfirmation);
    expect((await database.lead.findUniqueOrThrow({ where: { id: lead.id } })).currentStageId).toBe(target.id);
    await expect(actions.preview(admin, move)).rejects.toMatchObject({ code: "COPILOT_STALE_LEAD" });
    await expect(actions.preview(admin, { ...move, leadId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("cria cliente sem inventar venda e repete a confirmação sem duplicar", async () => {
    const action: CopilotAction = { kind: "CREATE_CUSTOMER", name: "Cliente cadastrado pelo chat", segment: "UNKNOWN", size: "UNKNOWN" };
    const preview = await actions.preview(admin, action); const key = { ...confirmation(), expectedPreview: preview };
    const created = await actions.execute(admin, action, key); await actions.execute(admin, action, key);
    expect(await database.account.count({ where: { workspaceId, name: action.name } })).toBe(1);
    expect(await database.opportunity.count({ where: { workspaceId, accountId: created.targetId } })).toBe(0);
    await expect(actions.preview(viewer, action)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("registra entrada avulsa e preserva cobranças/MRR; exige recebimento real", async () => {
    const category = await finance.command(admin, { action: "CREATE_CATEGORY", key: "conversa_receita", name: "Receita avulsa", kind: "INCOME" }) as { id: string };
    const action: CopilotAction = { ...expense(), kind: "CREATE_INCOME", categoryId: category.id, description: "Recebimento avulso confirmado" } as CopilotAction;
    const preview = await actions.preview(admin, action); const key = { ...confirmation(), expectedPreview: preview };
    const result = await actions.execute(admin, action, key); await actions.execute(admin, action, key);
    expect(await database.financialEntry.findUniqueOrThrow({ where: { id: result.targetId } })).toMatchObject({ direction: "INCOME", status: "SETTLED", amountCents: 15000n });
    await expect(actions.preview(admin, { ...action, categoryId } as CopilotAction)).rejects.toMatchObject({ code: "COPILOT_ACTION_INVALID" });
    await expect(actions.preview(viewer, action)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cria indicador persistido com métrica oficial e não aceita fórmula inventada", async () => {
    const choices = await actions.options(admin);
    const metric = choices.metrics!.find(item => item.id === "cash.received")!;
    const action: CopilotAction = { kind: "CREATE_INDICATOR", name: "Caixa do mês no chat", metricKey: metric.id, dateBasis: metric.dateBases[0]!, period: "MONTH" };
    const preview = await actions.preview(admin, action); const key = { ...confirmation(), expectedPreview: preview };
    const result = await actions.execute(admin, action, key); await actions.execute(admin, action, key);
    expect(await database.analyticsWidget.count({ where: { workspaceId, dashboardId: result.targetId, metricId: metric.id } })).toBe(1);
    await expect(actions.preview(admin, { ...action, metricKey: "invented.metric" })).rejects.toThrow();
    await expect(actions.preview(viewer, action)).rejects.toMatchObject({ statusCode: 403 });
  });
});
