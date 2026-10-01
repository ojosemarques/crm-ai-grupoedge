import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import {
  createLifecycleAutomationScanner,
  publishOpportunityClosedInTransaction,
} from "@/modules/automations/application/lifecycle-automation-scheduler";
import { createNotificationService } from "@/modules/automations/application/notification-service";
import { createAutomationObservabilityService } from "@/modules/automations/application/automation-observability-service";
import { createAutomationWorkerService } from "@/modules/automations/application/automation-worker-service";
import { createDefaultAutomationActionRegistry } from "@/modules/automations/application/predefined-entry-automation-actions";
import {
  LifecycleAutomationKeys,
  predefinedLifecycleAutomations,
} from "@/modules/automations/domain/predefined-lifecycle-automations";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-23 tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 24 }) });
const authorization = createAuthorizationService({ database });
let now = new Date("2048-01-05T12:00:00.000Z");
let workspaceId: string;
let manager: AuthenticatedContext;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let closer: AuthenticatedContext;
let system: ServiceActorContext;

function uniquePhone(label: string) {
  const suffix = (
    BigInt(`0x${createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex").slice(0, 12)}`) %
    100_000_000n
  ).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
    select: {
      id: true,
      userId: true,
      roleId: true,
      role: { select: { key: true, name: true } },
      user: { select: { displayName: true } },
    },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
    select: { id: true },
  });
  return Object.freeze({
    sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai",
    userId: member.userId, memberId: member.id, actorId: actor.id,
    roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name,
    displayName: member.user.displayName,
  });
}

function services() {
  const engine = createAutomationEngineService({ database, authorization, now: () => new Date(now) });
  const worker = createAutomationWorkerService({
    database,
    actionExecutor: createDefaultAutomationActionRegistry(),
    now: () => new Date(now),
    lockTimeoutSeconds: 30,
    backoffBaseSeconds: 5,
  });
  return {
    engine,
    worker,
    intake: createLeadIntakeService({ database, authorization, now: () => new Date(now), automationPublisher: engine }),
    history: createOperationalHistoryService({ database, authorization, now: () => new Date(now), automationPublisher: engine }),
    pipeline: createPreSalesPipelineService({ database, authorization, now: () => new Date(now), automationPublisher: engine }),
    meetings: createMeetingService({ database, authorization, now: () => new Date(now), automationPublisher: engine }),
    notifications: createNotificationService({ database, now: () => new Date(now) }),
    observability: createAutomationObservabilityService({ database, authorization, now: () => new Date(now) }),
    scanner: createLifecycleAutomationScanner({ database, publish: engine.publish, now: () => new Date(now) }),
  };
}

async function drain(worker: ReturnType<typeof createAutomationWorkerService>, label: string) {
  const results = [];
  for (let index = 0; index < 300; index += 1) {
    const result = await worker.processNext(`crm23-${label}`);
    if (result.status === "IDLE") return results;
    results.push(result);
  }
  throw new Error("Worker não ficou ocioso dentro do limite do teste CRM-23.");
}

async function createLead(label: string, contactPreference: "UNKNOWN" | "DO_NOT_CONTACT" = "UNKNOWN") {
  const result = await services().intake.intake({
    channel: "MANUAL",
    idempotencyKey: `crm23:${label}:${randomUUID()}`,
    fullName: `Lead CRM-23 ${label} ${randomUUID().slice(0, 6)}`,
    phone: uniquePhone(label),
    jobTitle: "Gestor",
    organizationName: "Organização fictícia",
    city: "São Paulo",
    stateCode: "SP",
    interestSummary: "Precisa estruturar a operação comercial permanente.",
    budgetCents: 250_000,
    ...(contactPreference === "DO_NOT_CONTACT" ? { doNotContact: true } : {}),
    sourceKey: "manual",
    priorityBandCode: "P2",
    rawPayload: { test: "crm23", label },
  }, system);
  if (result.outcome === "REJECTED") throw new Error(result.code);
  return result.leadId;
}

async function qualifyLead(label: string) {
  const local = services();
  const leadId = await createLead(label);
  const stageRows = await database.pipelineStage.findMany({
    where: { workspaceId, pipeline: { entityType: "LEAD", isDefault: true }, deletedAt: null },
    select: { id: true, leadStageCode: true },
  });
  const stage = new Map(stageRows.map((row) => [row.leadStageCode, row.id]));
  let state = await local.pipeline.getLeadState(manager, { leadId });
  await local.pipeline.transition(manager, {
    leadId,
    targetStageId: stage.get("IN_QUALIFICATION"),
    expectedUpdatedAt: state.updatedAt,
    reason: "Preparar qualificação automatizada do cenário CRM-23.",
    origin: "PIPELINE_LIST",
    managerCorrection: true,
    confirmed: true,
  });
  await createPactoQualificationService({ database, authorization, now: () => new Date(now) }).validate(manager, {
    leadId,
    expectedRevision: 0,
    dimensions: pactoDimensions.map((dimension) => ({
      dimension,
      status: "POSITIVE" as const,
      evidence: `Evidência confirmada para ${dimension}.`,
      origin: "SDR" as const,
    })),
  });
  state = await local.pipeline.getLeadState(manager, { leadId });
  await local.pipeline.transition(manager, {
    leadId,
    targetStageId: stage.get("QUALIFIED"),
    expectedUpdatedAt: state.updatedAt,
    reason: "PACTO validado e pronto para agenda.",
    origin: "PIPELINE_LIST",
    managerCorrection: false,
    confirmed: true,
  });
  return leadId;
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  workspaceId = seeded.workspaceId;
  const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
  system = { workspaceId, actorId: systemActor.id, actorKey: "system", actorType: "SYSTEM" };
  [manager, admin, viewer, closer] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("admin@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    humanContext("closer1@demo.politizai.local"),
  ]);
});

afterAll(async () => {
  now = new Date("2050-01-01T12:00:00.000Z");
  await drain(services().worker, "cleanup");
  await database.lead.updateMany({
    where: {
      workspaceId,
      fullName: { startsWith: "Lead CRM-23" },
      deletedAt: null,
    },
    data: {
      deletedAt: now,
      updatedByActorId: system.actorId,
    },
  });
  await database.$disconnect();
});

describe("CRM-23 — cadências, reuniões, estagnação e encerramento", () => {
  it("semeia as 12 regras, preserva status e protege a gestão/observabilidade", async () => {
    const rules = await database.automationRule.findMany({ where: { workspaceId, isPredefined: true } });
    expect(rules).toHaveLength(12);
    expect(predefinedLifecycleAutomations).toHaveLength(7);
    const lifecycleRule = rules.find((rule) => rule.key === LifecycleAutomationKeys.NO_ANSWER)!;
    await expect(services().engine.changeRuleStatus(viewer, {
      ruleId: lifecycleRule.id, status: "PAUSED", reason: "Tentativa sem permissão.",
    })).rejects.toBeInstanceOf(AccessDeniedError);
    await services().engine.changeRuleStatus(admin, {
      ruleId: lifecycleRule.id, status: "PAUSED", reason: "Pausa autorizada para validar preservação do seed.",
    });
    await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
    expect((await database.automationRule.findUniqueOrThrow({ where: { id: lifecycleRule.id } })).status).toBe("PAUSED");
    await services().engine.changeRuleStatus(admin, {
      ruleId: lifecycleRule.id, status: "ACTIVE", reason: "Retomada autorizada do teste.",
    });
    await expect(services().observability.getOverview(viewer, {})).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("agenda a sequência visual por canal, não duplica a cadência e respeita o fuso", async () => {
    now = new Date("2048-01-05T12:00:00.000Z");
    const local = services();
    const leadId = await createLead("cadência");
    await drain(local.worker, "entry-cadence");
    const activity = await local.history.recordActivity(manager, {
      leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Ligação não atendida",
      observation: "Primeira tentativa sem conexão.",
      nextTask: { title: "Retomar contato amanhã", kind: "CALL", priority: "HIGH", dueAt: new Date(now.getTime() + 86_400_000) },
    });
    const runs = await database.automationRun.findMany({
      where: { workspaceId, leadId, rule: { key: LifecycleAutomationKeys.NO_ANSWER } },
      orderBy: { job: { runAt: "asc" } },
      include: { job: true },
    });
    expect(runs).toHaveLength(5);
    expect(runs.map((run) => run.job!.runAt.toISOString())).toEqual([
      "2048-01-06T12:00:00.000Z", "2048-01-07T12:00:00.000Z", "2048-01-08T12:00:00.000Z",
      "2048-01-10T12:00:00.000Z", "2048-01-12T12:00:00.000Z",
    ]);
    await local.history.recordActivity(manager, {
      leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Nova ligação não atendida",
      nextTask: { title: "Novo retorno controlado", kind: "CALL", priority: "HIGH", dueAt: new Date(now.getTime() + 2 * 86_400_000) },
    });
    expect(await database.automationRun.count({ where: { workspaceId, leadId, rule: { key: LifecycleAutomationKeys.NO_ANSWER } } })).toBe(5);
    now = new Date("2048-01-06T12:00:01.000Z");
    await drain(local.worker, "cadence-d1");
    expect(await database.message.count({ where: { workspaceId, automationRun: { leadId, rule: { key: LifecycleAutomationKeys.NO_ANSWER } }, isSimulated: true } })).toBe(1);
    expect(await database.activity.count({ where: { workspaceId, leadId, automationRunId: { not: null }, subject: { startsWith: "Automação: cadência" } } })).toBe(1);
    await expect(database.task.findFirstOrThrow({ where: { workspaceId, leadId, title: { contains: "enviar WhatsApp" } } })).resolves.toMatchObject({ kind: "MESSAGE" });
    expect(activity.type).toBe("CALL_UNANSWERED");
  });

  it("encerra contatos de cadência no opt-out sem criar mensagem incompatível", async () => {
    now = new Date("2048-01-10T12:00:00.000Z");
    const local = services();
    const leadId = await createLead("opt-out");
    await drain(local.worker, "opt-out-entry");
    await local.history.recordActivity(manager, {
      leadId, type: "CALL_UNANSWERED", direction: "OUTBOUND",
      subject: "Tentativa registrada antes da revisão do opt-out",
      nextTask: {
        title: "Retomar contato antes da revisão do opt-out",
        kind: "CALL",
        priority: "HIGH",
        dueAt: new Date(now.getTime() + 86_400_000),
      },
    });
    await database.lead.update({
      where: { id: leadId },
      data: {
        contactPreference: "DO_NOT_CONTACT",
        contactPreferenceUpdatedAt: now,
        updatedByActorId: manager.actorId,
      },
    });
    now = new Date("2048-01-11T12:00:01.000Z");
    await drain(local.worker, "opt-out");
    const runs = await database.automationRun.findMany({ where: { workspaceId, leadId, rule: { key: LifecycleAutomationKeys.NO_ANSWER } } });
    expect(runs.filter((run) => run.status === "SUCCEEDED")).toHaveLength(1);
    expect(runs.filter((run) => run.status === "CANCELLED")).toHaveLength(4);
    expect(await database.message.count({ where: { workspaceId, automationRun: { leadId, rule: { key: LifecycleAutomationKeys.NO_ANSWER } } } })).toBe(0);
  });

  it("revalida o qualificado e persiste briefing e sugestão de agenda", async () => {
    now = new Date("2048-02-01T12:00:00.000Z");
    const local = services();
    const leadId = await qualifyLead("qualificado");
    now = new Date(now.getTime() + 5);
    await drain(local.worker, "qualified");
    const run = await database.automationRun.findFirstOrThrow({ where: { workspaceId, leadId, rule: { key: LifecycleAutomationKeys.QUALIFIED } } });
    expect(run.status).toBe("SUCCEEDED");
    const activity = await database.activity.findFirstOrThrow({ where: { workspaceId, leadId, automationRunId: run.id } });
    expect(activity.subject).toContain("briefing");
    expect(activity.newValues).toMatchObject({ agendaSuggested: true });
  });

  it("agenda lembretes, cancela a revisão anterior e prepara recuperação de no-show", async () => {
    now = new Date("2048-02-01T12:00:00.000Z");
    const local = services();
    const leadId = await qualifyLead("reunião");
    await drain(local.worker, "meeting-qualified");
    const scheduled = await local.meetings.schedule(manager, {
      leadId,
      closerId: closer.memberId,
      title: "Diagnóstico de CRM-23",
      startsAtLocal: "2048-02-03T09:00",
      durationMinutes: 30,
      observation: "Reunião local sem integração externa.",
    });
    expect(await database.automationRun.count({ where: { workspaceId, meetingId: scheduled.meetingId, rule: { key: LifecycleAutomationKeys.MEETING_SCHEDULED }, status: "PENDING" } })).toBe(3);
    const rescheduled = await local.meetings.act(manager, {
      action: "RESCHEDULE",
      meetingId: scheduled.meetingId,
      expectedRevision: scheduled.revision,
      startsAtLocal: "2048-02-04T09:00",
      durationMinutes: 40,
      reason: "Novo horário confirmado com o lead.",
    });
    expect(await database.automationRun.count({ where: { workspaceId, meetingId: scheduled.meetingId, rule: { key: LifecycleAutomationKeys.MEETING_SCHEDULED }, status: "CANCELLED" } })).toBe(3);
    expect(await database.automationRun.count({ where: { workspaceId, meetingId: scheduled.meetingId, rule: { key: LifecycleAutomationKeys.MEETING_SCHEDULED }, status: "PENDING" } })).toBe(3);
    now = new Date("2048-02-03T12:00:01.000Z");
    await drain(local.worker, "meeting-24h");
    expect(await database.notification.count({ where: { workspaceId, automationRun: { meetingId: scheduled.meetingId }, type: "MEETING_REMINDER" } })).toBe(1);
    now = new Date("2048-02-04T12:01:00.000Z");
    const noShow = await local.meetings.act(manager, {
      action: "NO_SHOW",
      meetingId: scheduled.meetingId,
      expectedRevision: rescheduled.revision,
      reason: "Lead não compareceu no horário confirmado.",
      nextAction: { title: "Recuperar no-show", dueAtLocal: "2048-02-05T09:00" },
    });
    await drain(local.worker, "meeting-no-show");
    expect(noShow.status).toBe("NO_SHOW");
    const recoveryRun = await database.automationRun.findFirstOrThrow({ where: { workspaceId, meetingId: scheduled.meetingId, rule: { key: LifecycleAutomationKeys.NO_SHOW } } });
    expect(recoveryRun.status).toBe("SUCCEEDED");
    expect(await database.message.count({ where: { workspaceId, automationRunId: recoveryRun.id, isSimulated: true } })).toBe(1);
    expect(await database.task.count({ where: { workspaceId, leadId, title: "Recuperar no-show", status: "OPEN" } })).toBe(1);
  });

  it("detecta lead parado e ausência de próxima ação uma vez e mantém o histórico reconciliável", async () => {
    now = new Date("2048-02-01T12:00:00.000Z");
    const local = services();
    const leadId = await createLead("saúde");
    const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "automation:local" } });
    await database.task.updateMany({ where: { workspaceId, leadId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED", updatedByActorId: actor.id } });
    await database.lead.update({ where: { id: leadId }, data: { nextActionTaskId: null, nextActionAt: null, nextActionDescription: null, updatedByActorId: actor.id } });
    now = new Date("2048-03-10T12:00:00.000Z");
    const first = await local.scanner.scanDue();
    const replay = await local.scanner.scanDue();
    expect(first.published).toBeGreaterThanOrEqual(2);
    expect(replay.published).toBe(0);
    expect(await database.automationRun.count({
      where: {
        workspaceId,
        leadId,
        rule: { key: { in: [LifecycleAutomationKeys.STAGNANT, LifecycleAutomationKeys.NO_NEXT_ACTION] } },
      },
    })).toBe(2);
    await drain(local.worker, "health");
    expect(await database.activity.count({ where: { workspaceId, leadId, subject: { in: ["Automação: lead parado detectado", "Automação: erro sem próxima ação"] } } })).toBe(2);
    const overview = await local.observability.getOverview(manager, { leadId, status: "SUCCEEDED" });
    const healthRuleIds = new Set(
      overview.rules
        .filter((rule) => rule.key === LifecycleAutomationKeys.STAGNANT || rule.key === LifecycleAutomationKeys.NO_NEXT_ACTION)
        .map((rule) => rule.id),
    );
    expect(overview.recentRuns.filter((run) => run.leadId === leadId && healthRuleIds.has(run.automationRuleId))).toHaveLength(2);
  });

  it("exige perda persistida e prepara handoff somente no ganho", async () => {
    now = new Date("2048-04-01T12:00:00.000Z");
    const local = services();
    async function createClosed(status: "WON" | "LOST") {
      const leadId = await createLead(`closure-${status}`);
      const [pipeline, stage, product, reason] = await Promise.all([
        database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true } }),
        database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: status, deletedAt: null } }),
        database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
        database.lossReason.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
      ]);
      const opportunity = await database.opportunity.create({
        data: {
          workspaceId, leadId, pipelineId: pipeline.id, currentStageId: stage.id,
          ownerMemberId: closer.memberId, productId: product.id, name: `Oportunidade ${status}`,
          status, amountCents: 500_000, mrrCents: 50_000, tcvCents: 500_000,
          probabilityBps: status === "WON" ? 10_000 : 0, closedAt: now,
          lossReasonId: status === "LOST" ? reason.id : null,
          outcomeReasonCode: status === "LOST" ? reason.name : "Ganho confirmado",
          createdByActorId: manager.actorId, updatedByActorId: manager.actorId,
          createdAt: now, updatedAt: now,
        },
      });
      await database.$transaction((transaction) => publishOpportunityClosedInTransaction(transaction, local.engine, {
        workspaceId, leadId, opportunityId: opportunity.id, status,
        occurredAt: now, actorId: manager.actorId,
      }));
      await drain(local.worker, `closure-${status}`);
      return { leadId, opportunityId: opportunity.id };
    }
    const lost = await createClosed("LOST");
    const won = await createClosed("WON");
    expect(await database.customerHandoff.count({ where: { workspaceId, opportunityId: lost.opportunityId } })).toBe(0);
    const handoff = await database.customerHandoff.findFirstOrThrow({ where: { workspaceId, opportunityId: won.opportunityId } });
    expect(handoff.reason).toContain("futura");
    expect(await database.activity.count({ where: { workspaceId, leadId: { in: [lost.leadId, won.leadId] }, automationRunId: { not: null } } })).toBeGreaterThanOrEqual(2);
  });

  it("expõe falha/retry e isola leitura e baixa de notificações pelo destinatário", async () => {
    now = new Date("2048-05-01T12:00:00.000Z");
    const local = services();
    const leadId = await createLead("retry");
    await drain(local.worker, "retry-entry");
    await local.engine.publish({
      workspaceId,
      triggerType: "LEAD_QUALIFIED",
      idempotencyKey: `crm23-invalid-qualified:${leadId}`,
      occurredAt: now,
      maxAttempts: 2,
      payload: { eventType: "LEAD_QUALIFIED", leadId },
    });
    const first = await local.worker.processNext("crm23-retry-1");
    expect(first.status).toBe("RETRY_SCHEDULED");
    now = new Date(now.getTime() + 6_000);
    const second = await local.worker.processNext("crm23-retry-2");
    expect(second.status).toBe("FAILED");
    const failed = await local.observability.getOverview(manager, { leadId, status: "FAILED" });
    expect(failed.recentRuns[0]).toMatchObject({ errorCode: "PACTO_REQUIRED" });

    const managerNotifications = await local.notifications.list(manager, { status: "UNREAD" });
    const target = managerNotifications.notifications[0];
    expect(target).toBeDefined();
    if (!target) throw new Error("Notificação de teste não encontrada.");
    await expect(local.notifications.markRead(viewer, { notificationId: target.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await local.notifications.markRead(manager, { notificationId: target.id })).changed).toBe(true);
    expect((await local.notifications.markRead(manager, { notificationId: target.id })).changed).toBe(false);
  });

  it("executa horário, texto, responsável, movimentação e interrupção configurados", async () => {
    now = new Date("2048-06-01T11:00:00.000Z");
    const local = services();
    const leadId = await createLead("cadência configurável");
    await drain(local.worker, "configured-entry");
    const [leadBefore, settings, targetStage] = await Promise.all([
      database.lead.findUniqueOrThrow({ where: { id: leadId }, select: { fullName: true, currentStageId: true } }),
      database.commercialSettingsVersion.findFirstOrThrow({ where: { workspaceId }, orderBy: { revision: "desc" } }),
      database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipeline: { entityType: "LEAD", isDefault: true }, leadStageCode: "TRYING_CONTACT", deletedAt: null } }),
    ]);
    await database.commercialSettingsVersion.create({
      data: {
        workspaceId,
        revision: settings.revision + 1,
        pactoMinimumInvestigatedDimensions: settings.pactoMinimumInvestigatedDimensions,
        defaultMeetingDurationMinutes: settings.defaultMeetingDurationMinutes,
        distributionStrategy: settings.distributionStrategy,
        maxOpenLeadsPerSdr: settings.maxOpenLeadsPerSdr,
        leadStagnationDays: settings.leadStagnationDays,
        leadWithoutActivityDays: settings.leadWithoutActivityDays,
        cadenceTemplateKey: "FIRST_CONTACT",
        cadenceStopOnReply: true,
        cadenceStopOnMeetingScheduled: true,
        cadenceStopOnStageChange: true,
        createdByActorId: admin.actorId,
        cadence: { create: [
          { attemptNumber: 1, dayOffset: 0, action: "WHATSAPP", timeOfDay: "09:15", message: "Olá, {nome}. Mensagem configurada.", assigneeMemberId: closer.memberId, targetStageId: targetStage.id },
          { attemptNumber: 2, dayOffset: 1, action: "CALL", timeOfDay: "10:00", message: "Esta tarefa deve ser interrompida pela mudança de etapa." },
        ] },
      },
    });
    await database.workspace.update({ where: { id: workspaceId }, data: { commercialSettingsRevision: settings.revision + 1 } });
    await local.history.recordActivity(manager, {
      leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Iniciar cadência configurável",
      nextTask: { title: "Retorno controlado", kind: "CALL", priority: "HIGH", dueAt: new Date(now.getTime() + 86_400_000) },
    });
    const expectedFirstRun = parseWorkspaceLocalDateTime("2048-06-01T09:15", "America/Sao_Paulo");
    const scheduled = await database.automationRun.findMany({ where: { workspaceId, leadId, rule: { key: LifecycleAutomationKeys.NO_ANSWER } }, include: { job: true }, orderBy: { job: { runAt: "asc" } } });
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]!.job!.runAt).toEqual(expectedFirstRun);
    now = new Date(expectedFirstRun.getTime() + 1_000);
    await drain(local.worker, "configured-first-step");
    const task = await database.task.findFirstOrThrow({ where: { workspaceId, leadId, automationRunId: scheduled[0]!.id } });
    expect(task).toMatchObject({ assigneeMemberId: closer.memberId, kind: "MESSAGE" });
    expect(task.description).toContain(`Olá, ${leadBefore.fullName}. Mensagem configurada.`);
    expect((await database.lead.findUniqueOrThrow({ where: { id: leadId } })).currentStageId).toBe(targetStage.id);
    now = parseWorkspaceLocalDateTime("2048-06-02T10:01", "America/Sao_Paulo");
    await drain(local.worker, "configured-stopped-step");
    expect(await database.task.count({ where: { workspaceId, leadId, automationRunId: scheduled[1]!.id } })).toBe(0);
    expect((await database.automationRun.findUniqueOrThrow({ where: { id: scheduled[1]!.id } })).outputPayload).toMatchObject({ skipped: true, reason: "LEAD_STAGE_CHANGED" });
  });
});
