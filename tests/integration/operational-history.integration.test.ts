import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for operational history tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 20 }),
});
const authorization = createAuthorizationService({ database });
let clock = new Date("2032-07-15T13:00:00.000Z");
let phoneSequence = 10_000_000;
let workspaceId: string;
let systemContext: ServiceActorContext;
let automationContext: ServiceActorContext;
let aiContext: ServiceActorContext;
let adminContext: AuthenticatedContext;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;

function historyService(beforeCommit?: () => Promise<void>) {
  return createOperationalHistoryService({
    database,
    authorization,
    now: () => clock,
    ...(beforeCommit ? { beforeCommit } : {}),
  });
}

function nextPhone() {
  phoneSequence += 1;
  return `+55119${phoneSequence.toString().slice(-8)}`;
}

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const user = await database.user.findUniqueOrThrow({
    where: { normalizedEmail: email },
    select: { id: true, displayName: true },
  });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, userId: user.id, deletedAt: null },
    select: {
      id: true,
      roleId: true,
      role: { select: { key: true, name: true } },
    },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: user.id, type: "HUMAN" },
    select: { id: true },
  });
  return Object.freeze({
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: user.displayName,
  });
}

async function serviceContext(
  key: string,
  actorType: "SYSTEM" | "AUTOMATION" | "AI_AGENT",
): Promise<ServiceActorContext> {
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, key, type: actorType },
    select: { id: true },
  });
  return Object.freeze({
    workspaceId,
    actorId: actor.id,
    actorKey: key,
    actorType,
  });
}

async function createLead(
  receivedAt: Date = clock,
  overrides: Readonly<{
    fullName?: string;
    email?: string;
    jobTitle?: string;
    organizationName?: string;
    city?: string;
    stateCode?: string;
    interestSummary?: string;
    budgetCents?: number;
  }> = {},
) {
  clock = receivedAt;
  const intake = createLeadIntakeService({
    database,
    authorization,
    now: () => clock,
  });
  const result = await intake.intake(
    {
      channel: "MANUAL",
      idempotencyKey: `crm08:${randomUUID()}`,
      fullName: overrides.fullName ?? `Lead CRM-08 ${randomUUID().slice(0, 8)}`,
      phone: nextPhone(),
      ...(overrides.email ? { email: overrides.email } : {}),
      ...(overrides.jobTitle ? { jobTitle: overrides.jobTitle } : {}),
      ...(overrides.organizationName
        ? { organizationName: overrides.organizationName }
        : {}),
      ...(overrides.city ? { city: overrides.city } : {}),
      ...(overrides.stateCode ? { stateCode: overrides.stateCode } : {}),
      ...(overrides.interestSummary
        ? { interestSummary: overrides.interestSummary }
        : {}),
      ...(overrides.budgetCents !== undefined
        ? { budgetCents: overrides.budgetCents }
        : {}),
      sourceKey: "manual",
      priorityBandCode: "P2",
      rawPayload: { test: "operational-history" },
    },
    systemContext,
  );
  if (result.outcome === "REJECTED") {
    throw new Error(`Lead rejeitado: ${result.issues[0]?.message ?? result.code}`);
  }
  return result;
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  workspaceId = seed.workspaceId;
  [systemContext, automationContext, aiContext, adminContext, managerContext, viewerContext] =
    await Promise.all([
      serviceContext("system", "SYSTEM"),
      serviceContext("automation:local", "AUTOMATION"),
      serviceContext("ai:recommendation", "AI_AGENT"),
      humanContext("admin@demo.politizai.local"),
      humanContext("gestor@demo.politizai.local"),
      humanContext("viewer@demo.politizai.local"),
    ]);
});

afterAll(async () => {
  await database.$disconnect();
});

describe("histórico operacional baseado em eventos", () => {
  it("cria e conclui tarefa com resultado, próxima tarefa explícita, timeline e auditoria", async () => {
    const base = new Date("2032-07-15T13:00:00.000Z");
    const lead = await createLead(base);
    const service = historyService();
    clock = new Date(base.getTime() + 60_000);
    const task = await service.createTask(managerContext, {
      leadId: lead.leadId,
      title: "Confirmar contexto",
      description: "Validar o melhor horário com o lead.",
      kind: "FOLLOW_UP",
      priority: "HIGH",
      dueAt: new Date(base.getTime() + 3_600_000),
    });

    clock = new Date(base.getTime() + 120_000);
    const completed = await service.completeTask(managerContext, {
      leadId: lead.leadId,
      taskId: task.id,
      result: "Contexto confirmado com o responsável.",
      nextTask: {
        title: "Retornar com proposta de agenda",
        kind: "CALL",
        priority: "HIGH",
        dueAt: new Date(base.getTime() + 7_200_000),
      },
    });

    const [storedTask, nextTask, taskAudits, taskActivities, metricFacts] = await Promise.all([
      database.task.findUniqueOrThrow({ where: { id: task.id } }),
      database.task.findUniqueOrThrow({ where: { id: completed.nextTaskId! } }),
      database.auditLog.count({
        where: {
          workspaceId,
          entityType: "Task",
          entityId: { in: [task.id, completed.nextTaskId!] },
          action: { in: ["task.created", "task.completed"] },
        },
      }),
      database.activity.count({
        where: { workspaceId, leadId: lead.leadId, type: "TASK" },
      }),
      database.commercialMetricFact.findMany({
        where: { workspaceId, taskId: task.id },
        select: { eventType: true, result: true, creditedMemberId: true, performedByMemberId: true },
      }),
    ]);
    expect(storedTask).toMatchObject({
      status: "COMPLETED",
      result: "Contexto confirmado com o responsável.",
      completedAt: clock,
    });
    expect(nextTask).toMatchObject({
      status: "OPEN",
      title: "Retornar com proposta de agenda",
    });
    expect(taskAudits).toBeGreaterThanOrEqual(3);
    expect(taskActivities).toBe(4);
    expect(metricFacts).toEqual([{
      eventType: "TASK_COMPLETED",
      result: "Contexto confirmado com o responsável.",
      creditedMemberId: managerContext.memberId,
      performedByMemberId: managerContext.memberId,
    }]);
    const summary = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    expect(summary.summary.activities).toMatchObject({
      completedFollowUps: 1,
      completedTasks: 1,
    });

    await expect(
      service.completeTask(managerContext, {
        leadId: lead.leadId,
        taskId: lead.taskId,
        result: "Conclusão indevida",
      }),
    ).rejects.toMatchObject({ code: "CONTACT_ACTIVITY_REQUIRED" });
  });

  it("registra primeira tentativa e resposta apenas uma vez e atualiza o sinal operacional", async () => {
    const base = new Date("2032-07-16T13:00:00.000Z");
    const lead = await createLead(base);
    const service = historyService();
    const firstAttempt = new Date(base.getTime() + 61_900);
    await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Primeira ligação sem atendimento",
      occurredAt: firstAttempt,
      nextTask: {
        title: "Tentar novamente amanhã",
        kind: "FOLLOW_UP",
        priority: "HIGH",
        dueAt: new Date(base.getTime() + 86_400_000),
      },
    });
    await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Segunda ligação sem atendimento",
      occurredAt: new Date(base.getTime() + 120_000),
    });
    const connectedAt = new Date(base.getTime() + 180_500);
    await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "CALL_CONNECTED",
      direction: "OUTBOUND",
      subject: "Ligação atendida",
      occurredAt: connectedAt,
    });
    const inboundAt = new Date(base.getTime() + 200_000);
    await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "MESSAGE_RECEIVED",
      direction: "INBOUND",
      subject: "Lead respondeu",
      occurredAt: inboundAt,
    });

    const [cycle, immediateTask, initialStoredLead] = await Promise.all([
      database.leadSlaCycle.findUniqueOrThrow({ where: { id: lead.slaCycleId } }),
      database.task.findUniqueOrThrow({ where: { id: lead.taskId } }),
      database.lead.findUniqueOrThrow({ where: { id: lead.leadId } }),
    ]);
    expect(cycle).toMatchObject({
      firstHumanAttemptAt: firstAttempt,
      firstHumanAttemptSeconds: 61,
      firstConnectedAt: connectedAt,
      firstResponseTimeSeconds: 180,
    });
    expect(immediateTask).toMatchObject({
      status: "COMPLETED",
      completedAt: firstAttempt,
      result: "Tentativa humana registrada.",
    });
    expect(initialStoredLead).toMatchObject({
      firstRespondedAt: connectedAt,
      lastInboundResponseAt: inboundAt,
      awaitingHumanResponse: true,
    });
    const manualFacts = await database.commercialMetricFact.findMany({
      where: { workspaceId: managerContext.workspaceId, leadId: lead.leadId, sourceEntityType: "Activity" },
      select: { eventType: true, creditedMemberId: true, performedByMemberId: true },
    });
    const manualCallFacts = manualFacts.filter((fact) => fact.eventType.startsWith("CALL_"));
    expect(manualCallFacts).toHaveLength(6);
    expect(manualCallFacts.filter((fact) => fact.eventType === "CALL_ATTEMPTED")).toHaveLength(3);
    expect(manualCallFacts.filter((fact) => fact.eventType === "CALL_UNANSWERED")).toHaveLength(2);
    expect(manualCallFacts.filter((fact) => fact.eventType === "CALL_CONNECTED")).toHaveLength(1);
    expect(manualCallFacts.every((fact) => fact.creditedMemberId === managerContext.memberId && fact.performedByMemberId === managerContext.memberId)).toBe(true);
    expect(manualFacts.filter((fact) => fact.eventType === "INBOUND_MESSAGE_RECEIVED" || fact.eventType === "HUMAN_RESPONSE_CONFIRMED")).toHaveLength(2);

    await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "MESSAGE_SENT",
      direction: "OUTBOUND",
      channel: "INSTAGRAM",
      subject: "Resposta enviada ao lead",
      occurredAt: new Date(base.getTime() + 210_000),
    });
    const manualEmail = await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "EMAIL",
      direction: "OUTBOUND",
      subject: "E-mail enviado ao lead",
      occurredAt: new Date(base.getTime() + 220_000),
    });
    expect(await database.commercialMetricFact.count({
      where: { workspaceId: managerContext.workspaceId, leadId: lead.leadId, sourceEntityType: "Activity", eventType: "EMAIL_SENT" },
    })).toBe(1);
    expect(await database.commercialMetricFact.count({
      where: { workspaceId: managerContext.workspaceId, leadId: lead.leadId, sourceEntityType: "Activity", eventType: "INSTAGRAM_MESSAGE_SENT" },
    })).toBe(1);
    await expect(service.correctActivity(managerContext, {
      leadId: lead.leadId, activityId: manualEmail.id,
      reason: "Resultado do envio incorreto", correctedSubject: "E-mail revisado", correctedResult: "OTHER",
    })).rejects.toMatchObject({ code: "ACTIVITY_RESULT_CORRECTION_UNSUPPORTED" });
    const storedLead = await database.lead.findUniqueOrThrow({
      where: { id: lead.leadId },
    });
    expect(storedLead.awaitingHumanResponse).toBe(false);
  });

  it("registra os tipos principais e identifica atores humano, Sistema, Automação e Agente de IA", async () => {
    const base = new Date("2032-07-17T13:00:00.000Z");
    const lead = await createLead(base);
    const service = historyService();
    const types = [
      "CALL",
      "CALL_CONNECTED",
      "CALL_UNANSWERED",
      "MESSAGE_SENT",
      "MESSAGE_RECEIVED",
      "AUDIO",
      "EMAIL",
      "NOTE",
      "TASK",
      "MEETING",
      "STAGE_CHANGE",
      "RESPONSIBLE_CHANGE",
      "AUTOMATION",
      "AI_ACTION",
      "PROPOSAL",
      "WON",
      "LOST",
    ] as const;

    for (const [index, type] of types.entries()) {
      const actor =
        type === "AUTOMATION"
          ? automationContext
          : type === "AI_ACTION"
            ? aiContext
            : managerContext;
      await service.recordActivity(actor, {
        leadId: lead.leadId,
        type,
        direction:
          type === "MESSAGE_RECEIVED"
            ? "INBOUND"
            : type.startsWith("CALL") || type === "MESSAGE_SENT" || type === "EMAIL"
              ? "OUTBOUND"
              : "INTERNAL",
        ...(type === "CALL" ? { result: "NOT_CONNECTED" } : {}),
        subject: `Evento ${type}`,
        occurredAt: new Date(base.getTime() + (index + 1) * 10_000),
        ...(index === 0
          ? {
              nextTask: {
                title: "Próxima ação após a ligação",
                kind: "FOLLOW_UP",
                priority: "HIGH",
                dueAt: new Date(base.getTime() + 86_400_000),
              },
            }
          : {}),
      });
    }

    clock = new Date(base.getTime() + 300_000);
    const firstPage = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
      pageSize: 5,
    });
    expect(firstPage.timeline).toHaveLength(5);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
      pageSize: 5,
      cursor: firstPage.nextCursor!,
    });
    expect(
      new Set([...firstPage.timeline, ...secondPage.timeline].map(({ id }) => id)).size,
    ).toBe(10);
    for (let index = 1; index < firstPage.timeline.length; index += 1) {
      expect(
        new Date(firstPage.timeline[index - 1]!.occurredAt).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(firstPage.timeline[index]!.occurredAt).getTime(),
      );
    }

    const allActivities = await database.activity.findMany({
      where: { workspaceId, leadId: lead.leadId },
      select: { type: true, createdBy: { select: { type: true } } },
    });
    const storedTypes = new Set(allActivities.map(({ type }) => type));
    expect(firstPage.summary.activities).toMatchObject({
      total: allActivities.length,
      calls: 3,
      connectedCalls: 1,
      messages: 3,
      emails: 1,
      meetings: 1,
    });
    for (const type of types) expect(storedTypes.has(type)).toBe(true);
    expect(new Set(allActivities.map(({ createdBy }) => createdBy.type))).toEqual(
      new Set(["HUMAN", "SYSTEM", "AUTOMATION", "AI_AGENT"]),
    );
  });

  it("preserva o fato original e cria evento corretivo em timeline append-only", async () => {
    const base = new Date("2032-07-18T13:00:00.000Z");
    const lead = await createLead(base);
    const service = historyService();
    const original = await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "NOTE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: "Observação original",
      observation: "Texto que precisa de correção posterior.",
      occurredAt: new Date(base.getTime() + 30_000),
    });
    const originalCount = (await service.getLeadOperations(managerContext, { leadId: lead.leadId })).summary.activities.total;
    clock = new Date(base.getTime() + 60_000);
    const correction = await service.correctActivity(managerContext, {
      leadId: lead.leadId,
      activityId: original.id,
      reason: "Correção solicitada pelo responsável.",
      correctedSubject: "Observação corrigida",
      correctedObservation: "Texto correto preservado em novo evento.",
    });

    const [originalAfter, correctionAfter] = await Promise.all([
      database.activity.findUniqueOrThrow({ where: { id: original.id } }),
      database.activity.findUniqueOrThrow({ where: { id: correction.id } }),
    ]);
    expect(originalAfter).toMatchObject({
      subject: "Observação original",
      description: "Texto que precisa de correção posterior.",
    });
    expect(correctionAfter).toMatchObject({
      result: "CORRECTED",
      correctsActivityId: original.id,
    });
    const operations = await service.getLeadOperations(managerContext, { leadId: lead.leadId });
    expect(operations.summary.activities.total).toBe(originalCount);
    expect(operations.timeline.some((entry) => entry.id === correction.id)).toBe(true);
    await expect(
      database.activity.update({
        where: { id: original.id },
        data: { subject: "Tentativa de reescrita" },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      database.activity.delete({ where: { id: original.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it("reclassifica uma ligação corrigida no ledger sem duplicar tentativas", async () => {
    const base = new Date("2032-07-18T15:00:00.000Z");
    const lead = await createLead(base);
    const service = historyService();
    const original = await service.recordActivity(managerContext, {
      leadId: lead.leadId, type: "CALL", direction: "OUTBOUND", result: "NOT_CONNECTED",
      subject: "Ligação não atendida", occurredAt: new Date(base.getTime() + 30_000),
      nextTask: { title: "Retomar contato", kind: "FOLLOW_UP", priority: "MEDIUM", dueAt: new Date(base.getTime() + 86_400_000) },
    });
    const counts = async () => {
      const rows = await database.commercialMetricFact.groupBy({
        by: ["eventType"],
        where: { workspaceId: managerContext.workspaceId, leadId: lead.leadId, sourceEntityType: "Activity" },
        _sum: { quantity: true },
      });
      return Object.fromEntries(rows.map((row) => [row.eventType, row._sum.quantity ?? 0]));
    };
    expect(await counts()).toMatchObject({ CALL_ATTEMPTED: 1, CALL_UNANSWERED: 1 });
    await service.correctActivity(managerContext, {
      leadId: lead.leadId, activityId: original.id, reason: "Resultado lançado incorretamente",
      correctedSubject: "Ligação atendida", correctedResult: "CONNECTED",
    });
    expect(await counts()).toMatchObject({ CALL_ATTEMPTED: 1, CALL_UNANSWERED: 0, CALL_CONNECTED: 1 });
    expect((await service.getLeadOperations(managerContext, { leadId: lead.leadId })).summary.activities).toMatchObject({ calls: 1, connectedCalls: 1 });
    expect((await database.leadSlaCycle.findUniqueOrThrow({ where: { id: lead.slaCycleId } })).firstConnectedAt).toEqual(new Date(base.getTime() + 30_000));
    expect((await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } })).firstRespondedAt).toEqual(new Date(base.getTime() + 30_000));
    await service.correctActivity(managerContext, {
      leadId: lead.leadId, activityId: original.id, reason: "Cliente confirmou ausência de contato",
      correctedSubject: "Ligação sem atendimento", correctedResult: "NOT_CONNECTED",
    });
    expect(await counts()).toMatchObject({ CALL_ATTEMPTED: 1, CALL_UNANSWERED: 1, CALL_CONNECTED: 0 });
    expect((await service.getLeadOperations(managerContext, { leadId: lead.leadId })).summary.activities).toMatchObject({ calls: 1, connectedCalls: 0 });
    expect((await database.leadSlaCycle.findUniqueOrThrow({ where: { id: lead.slaCycleId } })).firstConnectedAt).toBeNull();
    expect((await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } })).firstRespondedAt).toBeNull();
  });

  it("permite corrigir ligação legada independente e registra a correção no ledger", async () => {
    const base = new Date("2032-07-18T17:00:00.000Z");
    const lead = await createLead(base);
    const original = await database.activity.create({ data: {
      workspaceId: managerContext.workspaceId, leadId: lead.leadId,
      type: "CALL_UNANSWERED", direction: "OUTBOUND", result: "NOT_CONNECTED",
      subject: "Ligação legada sem auditoria", occurredAt: new Date(base.getTime() + 30_000),
      durationSeconds: 90, createdByActorId: managerContext.actorId, updatedByActorId: managerContext.actorId,
    } });
    clock = new Date(base.getTime() + 60_000);
    const correction = await historyService().correctActivity(managerContext, {
      leadId: lead.leadId, activityId: original.id,
      reason: "Resultado histórico conferido", correctedSubject: "Ligação atendida",
      correctedResult: "CONNECTED",
    });
    const facts = await database.commercialMetricFact.groupBy({
      by: ["eventType"],
      where: { workspaceId: managerContext.workspaceId, leadId: lead.leadId, sourceEntityType: "Activity" },
      _sum: { quantity: true },
    });
    expect(Object.fromEntries(facts.map((fact) => [fact.eventType, fact._sum.quantity ?? 0]))).toMatchObject({
      CALL_ATTEMPTED: 1, CALL_UNANSWERED: 0, CALL_CONNECTED: 1,
    });
    expect(await database.commercialMetricFact.count({ where: {
      workspaceId: managerContext.workspaceId, sourceEntityId: correction.id, sourceEntityType: "Activity",
    } })).toBe(4);
    expect((await historyService().getLeadOperations(managerContext, { leadId: lead.leadId })).summary.activities)
      .toMatchObject({ calls: 1, connectedCalls: 1 });
  });

  it("detecta tarefa vencida e lead aberto sem próxima ação, permitindo correção explícita", async () => {
    const base = new Date("2032-07-19T13:00:00.000Z");
    const lead = await createLead(base);
    const service = historyService();
    clock = new Date(base.getTime() + 3_600_000);
    let operations = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    expect(operations.tasks.find(({ id }) => id === lead.taskId)?.overdue).toBe(true);

    await database.task.update({
      where: { id: lead.taskId },
      data: { status: "CANCELLED", updatedByActorId: systemContext.actorId },
    });
    await database.lead.update({
      where: { id: lead.leadId },
      data: {
        nextActionTaskId: null,
        nextActionAt: null,
        nextActionDescription: null,
        updatedByActorId: systemContext.actorId,
      },
    });
    operations = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    expect(operations.lead.nextAction).toBeNull();
    expect(operations.lead.nextActionIssue).toBe("Lead aberto sem próxima ação.");

    await service.recordActivity(managerContext, {
      leadId: lead.leadId,
      type: "NOTE",
      direction: "INTERNAL",
      subject: "Correção da pendência operacional",
      nextTask: {
        title: "Retomar contato",
        kind: "FOLLOW_UP",
        priority: "URGENT",
        dueAt: new Date(base.getTime() + 7_200_000),
      },
    });
    operations = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    expect(operations.lead.nextActionIssue).toBeNull();
    expect(operations.lead.nextAction?.title).toBe("Retomar contato");
  });

  it("aplica permissões no servidor e registra a negativa em auditoria", async () => {
    const lead = await createLead(new Date("2032-07-20T13:00:00.000Z"));
    const service = historyService();

    await expect(
      service.recordActivity(viewerContext, {
        leadId: lead.leadId,
        type: "NOTE",
        direction: "INTERNAL",
        subject: "Tentativa sem permissão",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      service.getLeadOperations(viewerContext, { leadId: lead.leadId }),
    ).resolves.toMatchObject({ lead: { id: lead.leadId } });
    await expect(
      database.auditLog.count({
        where: {
          workspaceId,
          actorId: viewerContext.actorId,
          action: "authorization.denied",
        },
      }),
    ).resolves.toBeGreaterThanOrEqual(1);
  });

  it("reverte tarefa, timeline, projeção e auditoria quando a transação falha", async () => {
    const lead = await createLead(new Date("2032-07-21T13:00:00.000Z"));
    const before = await Promise.all([
      database.task.count({ where: { workspaceId, leadId: lead.leadId } }),
      database.activity.count({ where: { workspaceId, leadId: lead.leadId } }),
      database.auditLog.count({
        where: { workspaceId, entityType: "Task", action: "task.created" },
      }),
    ]);
    const service = historyService(async () => {
      throw new Error("falha injetada antes do commit");
    });

    await expect(
      service.createTask(managerContext, {
        leadId: lead.leadId,
        title: "Tarefa que deve ser revertida",
        kind: "GENERAL",
        priority: "MEDIUM",
        dueAt: new Date(clock.getTime() + 3_600_000),
      }),
    ).rejects.toThrow("falha injetada antes do commit");
    const after = await Promise.all([
      database.task.count({ where: { workspaceId, leadId: lead.leadId } }),
      database.activity.count({ where: { workspaceId, leadId: lead.leadId } }),
      database.auditLog.count({
        where: { workspaceId, entityType: "Task", action: "task.created" },
      }),
    ]);
    expect(after).toEqual(before);
  });

  it("carrega o cartão completo com dados persistidos, capacidades e respostas do formulário", async () => {
    const receivedAt = new Date("2032-07-22T13:00:00.000Z");
    const lead = await createLead(receivedAt, {
      fullName: "Lead cartão completo",
      email: "cartao.completo@example.com",
      jobTitle: "Diretora comercial",
      organizationName: "Organização Exemplo",
      city: "São Paulo",
      stateCode: "SP",
      interestSummary: "Precisa organizar a operação permanente.",
      budgetCents: 850_000,
    });
    clock = new Date(receivedAt.getTime() + 65_000);

    const managerCard = await historyService().getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    const adminCard = await historyService().getLeadOperations(adminContext, {
      leadId: lead.leadId,
    });

    expect(managerCard).toMatchObject({
      timeZone: "America/Sao_Paulo",
      permissions: {
        canWrite: true,
        canManageTasks: true,
        canAssign: true,
        canReadAudit: true,
      },
      lead: {
        fullName: "Lead cartão completo",
        normalizedEmail: "cartao.completo@example.com",
        jobTitle: "Diretora comercial",
        organizationName: "Organização Exemplo",
        city: "São Paulo",
        stateCode: "SP",
        interestSummary: "Precisa organizar a operação permanente.",
        budgetCents: "850000",
        stageName: "Novo",
        priorityCode: "P1",
        sourceName: "Cadastro manual",
        receivedAt: receivedAt.toISOString(),
        sla: {
          policyName: "SLA imediato — 0 minutos",
          elapsedSeconds: 65,
          healthyMaxSeconds: 60,
          attentionMaxSeconds: 180,
        },
      },
      summary: {
        latestSubmission: {
          fullName: "Lead cartão completo",
          interestSummary: "Precisa organizar a operação permanente.",
          budgetCents: "850000",
        },
        missingFields: [],
      },
    });
    expect(managerCard.assignmentTargets.length).toBeGreaterThanOrEqual(1);
    expect(managerCard.lead.normalizedPhone).toMatch(/^\+5511/);
    expect(adminCard.permissions.canReadAudit).toBe(true);

    const viewerCard = await historyService().getLeadOperations(viewerContext, {
      leadId: lead.leadId,
    });
    expect(viewerCard.permissions).toEqual({
      canWrite: false,
      canManageTasks: false,
      canAssign: false,
      canReadAudit: false,
    });
    expect(viewerCard.assignmentTargets).toEqual([]);
  });

  it("edita e limpa campos opcionais explicitamente, preservando timeline e auditoria", async () => {
    const receivedAt = new Date("2032-07-23T13:00:00.000Z");
    const lead = await createLead(receivedAt, {
      fullName: "Lead resumo editável",
      email: "antes@example.com",
      jobTitle: "Assessora",
      organizationName: "Organização anterior",
      city: "Campinas",
      stateCode: "SP",
      interestSummary: "Contexto anterior",
    });
    const service = historyService();
    const before = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    clock = new Date(receivedAt.getTime() + 90_000);

    await service.updateLeadSummary(managerContext, {
      leadId: lead.leadId,
      expectedUpdatedAt: before.lead.updatedAt,
      fullName: "Lead resumo atualizado",
      normalizedEmail: null,
      jobTitle: null,
      organizationName: "Nova organização",
      city: null,
      stateCode: null,
      interestSummary: "Interesse validado por pessoa.",
    });

    const after = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    expect(after.lead).toMatchObject({
      fullName: "Lead resumo atualizado",
      normalizedEmail: null,
      jobTitle: null,
      organizationName: "Nova organização",
      city: null,
      stateCode: null,
      interestSummary: "Interesse validado por pessoa.",
    });
    expect(after.summary.missingFields).toEqual(
      expect.arrayContaining(["E-mail", "Cargo ou atuação", "Cidade", "Estado"]),
    );
    expect(after.timeline[0]).toMatchObject({
      subject: "Resumo do lead atualizado",
      actor: { type: "HUMAN" },
    });
    await expect(
      database.auditLog.count({
        where: {
          workspaceId,
          entityType: "Lead",
          entityId: lead.leadId,
          action: "lead.summary.updated",
        },
      }),
    ).resolves.toBe(1);
  });

  it("rejeita atualização concorrente sem sobrescrever dados mais recentes", async () => {
    const receivedAt = new Date("2032-07-24T13:00:00.000Z");
    const lead = await createLead(receivedAt, { fullName: "Lead concorrente" });
    const service = historyService();
    const snapshot = await service.getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    const common = {
      leadId: lead.leadId,
      expectedUpdatedAt: snapshot.lead.updatedAt,
      normalizedEmail: null,
      jobTitle: null,
      organizationName: null,
      city: null,
      stateCode: null,
      interestSummary: null,
    };
    clock = new Date(receivedAt.getTime() + 1_000);
    await service.updateLeadSummary(managerContext, {
      ...common,
      fullName: "Alteração vencedora",
    });
    clock = new Date(receivedAt.getTime() + 2_000);
    await expect(
      service.updateLeadSummary(managerContext, {
        ...common,
        fullName: "Alteração obsoleta",
      }),
    ).rejects.toMatchObject({ code: "LEAD_VERSION_CONFLICT", statusCode: 409 });
    await expect(
      database.lead.findUniqueOrThrow({ where: { id: lead.leadId } }),
    ).resolves.toMatchObject({ fullName: "Alteração vencedora" });
  });

  it("trata lead excluído logicamente como inexistente", async () => {
    const receivedAt = new Date("2032-07-25T13:00:00.000Z");
    const lead = await createLead(receivedAt);
    await database.lead.update({
      where: { id: lead.leadId },
      data: {
        deletedAt: new Date(receivedAt.getTime() + 1_000),
        updatedByActorId: systemContext.actorId,
      },
    });
    await expect(
      historyService().getLeadOperations(managerContext, { leadId: lead.leadId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("expõe timestamps ISO e timezone do workspace sem reinterpretar o instante", async () => {
    const receivedAt = new Date("2032-07-26T13:00:00.000Z");
    const lead = await createLead(receivedAt);
    clock = new Date(receivedAt.getTime() + 1_000);
    const operations = await historyService().getLeadOperations(managerContext, {
      leadId: lead.leadId,
    });
    expect(operations.timeZone).toBe("America/Sao_Paulo");
    expect(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: operations.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(operations.timeline.at(-1)!.occurredAt)),
    ).toBe("10:00");
  });
});
