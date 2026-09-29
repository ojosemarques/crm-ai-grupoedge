import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAuditAdministrationService } from "@/modules/audit/application/audit-administration-service";
import { processViolationTypes } from "@/modules/audit/domain/audit-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-24 tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2050-06-20T15:00:00.000Z");
let workspaceId: string;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let sdr: AuthenticatedContext;
let closer: AuthenticatedContext;
let systemActorId: string;
let sourceId: string;
let leadPipelineId: string;
let opportunityPipelineId: string;
let bandId: string;
let routingQueueId: string;
const leadStages = new Map<string, string>();
const opportunityStages = new Map<string, string>();

function service() {
  return createAuditAdministrationService({ database, authorization, now: () => new Date(now) });
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
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  });
}

async function createLead(input: Readonly<{
  label: string;
  stageCode?: string;
  enteredAt?: Date;
  attemptSeconds?: number | null;
  activeTask?: boolean;
  ownerMemberId?: string;
}>) {
  const receivedAt = input.enteredAt ?? new Date(now.getTime() - 60_000);
  const attemptSeconds = input.attemptSeconds === undefined ? 0 : input.attemptSeconds;
  const activeTask = input.activeTask ?? true;
  const ownerMemberId = input.ownerMemberId ?? sdr.memberId;
  const stageId = leadStages.get(input.stageCode ?? "NEW");
  if (!stageId) throw new Error("Etapa de lead ausente no fixture CRM-24.");
  return database.$transaction(async (transaction) => {
    const lead = await transaction.lead.create({
      data: {
        workspaceId,
        sourceId,
        latestSourceId: sourceId,
        pipelineId: leadPipelineId,
        currentStageId: stageId,
        ownerMemberId,
        routingQueueId,
        fullName: `CRM-24 ${input.label} ${randomUUID().slice(0, 6)}`,
        normalizedPhone: `+55119${randomUUID().replaceAll("-", "").slice(0, 8).replace(/[a-f]/g, "7")}`,
        status: "OPEN",
        priority: "MEDIUM",
        slaStartedAt: receivedAt,
        slaDueAt: receivedAt,
        lastActivityAt: receivedAt,
        latestSubmissionAt: receivedAt,
        createdByActorId: systemActorId,
        updatedByActorId: systemActorId,
        createdAt: receivedAt,
        updatedAt: receivedAt,
      },
    });
    const submission = await transaction.leadFormSubmission.create({
      data: {
        workspaceId,
        leadId: lead.id,
        sourceId,
        status: "LINKED",
        channel: "MANUAL",
        intakeOutcome: "CREATED",
        idempotencyKey: `crm24:${input.label}:${randomUUID()}`,
        submittedFullName: lead.fullName,
        submittedPhone: lead.normalizedPhone,
        normalizedPhone: lead.normalizedPhone,
        submittedAt: receivedAt,
        rawPayload: { test: "crm24", label: input.label },
        createdByActorId: systemActorId,
        createdAt: receivedAt,
      },
    });
    const attemptAt = attemptSeconds === null ? null : new Date(receivedAt.getTime() + attemptSeconds * 1_000);
    const cycle = await transaction.leadSlaCycle.create({
      data: {
        workspaceId,
        leadId: lead.id,
        submissionId: submission.id,
        priorityBandId: bandId,
        assignedMemberId: ownerMemberId,
        receivedAt,
        assignedAt: receivedAt,
        automaticAcknowledgedAt: receivedAt,
        firstHumanAttemptAt: attemptAt,
        firstHumanAttemptSeconds: attemptSeconds,
        createdByActorId: systemActorId,
        createdAt: receivedAt,
      },
    });
    const immediate = await transaction.task.create({
      data: {
        workspaceId,
        leadId: lead.id,
        slaCycleId: cycle.id,
        assigneeMemberId: ownerMemberId,
        title: "Ligar agora",
        kind: "IMMEDIATE_CALL",
        status: attemptAt ? "COMPLETED" : "OPEN",
        priority: "MEDIUM",
        dueAt: receivedAt,
        completedAt: attemptAt,
        result: attemptAt ? "Tentativa registrada." : null,
        createdByActorId: systemActorId,
        updatedByActorId: attemptAt ? sdr.actorId : systemActorId,
        createdAt: receivedAt,
        updatedAt: attemptAt ?? receivedAt,
      },
    });
    let nextTask = attemptAt ? null : immediate;
    if (attemptAt && activeTask) {
      nextTask = await transaction.task.create({
        data: {
          workspaceId,
          leadId: lead.id,
          assigneeMemberId: ownerMemberId,
          title: "Retorno operacional",
          kind: "FOLLOW_UP",
          status: "OPEN",
          priority: "MEDIUM",
          dueAt: new Date(now.getTime() + 3_600_000),
          createdByActorId: systemActorId,
          updatedByActorId: systemActorId,
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
      });
    }
    if (!activeTask && nextTask) {
      await transaction.task.update({
        where: { id: nextTask.id },
        data: { status: "COMPLETED", completedAt: now, result: "Encerrada para cenário sem próxima ação.", updatedByActorId: sdr.actorId, updatedAt: now },
      });
      nextTask = null;
    }
    await transaction.lead.update({
      where: { id: lead.id },
      data: nextTask ? {
        nextActionTaskId: nextTask.id,
        nextActionAt: nextTask.dueAt,
        nextActionDescription: nextTask.title,
        updatedAt: receivedAt,
      } : { nextActionTaskId: null, nextActionAt: null, nextActionDescription: null, updatedAt: now },
    });
    const history = await transaction.stageHistory.create({
      data: {
        workspaceId,
        pipelineId: leadPipelineId,
        stageId,
        leadId: lead.id,
        enteredAt: input.enteredAt ?? receivedAt,
        enteredByActorId: systemActorId,
        transitionOrigin: "SYSTEM",
        transitionReason: "Cenário determinístico CRM-24.",
        createdAt: input.enteredAt ?? receivedAt,
      },
    });
    return { lead, cycle, history };
  });
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  workspaceId = seeded.workspaceId;
  [manager, viewer, sdr, closer] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    humanContext("sdr1@demo.politizai.local"),
    humanContext("closer1@demo.politizai.local"),
  ]);
  const [systemActor, source, band, queue, leadPipeline, opportunityPipeline, stages] = await Promise.all([
    database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } }),
    database.leadSource.findFirstOrThrow({ where: { workspaceId, key: "manual", deletedAt: null } }),
    database.leadPriorityBand.findFirstOrThrow({ where: { workspaceId, code: "P2", active: true, deletedAt: null } }),
    database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } }),
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null } }),
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null } }),
    database.pipelineStage.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, pipelineId: true, leadStageCode: true, opportunityStageCode: true } }),
  ]);
  systemActorId = systemActor.id;
  sourceId = source.id;
  bandId = band.id;
  routingQueueId = queue.id;
  leadPipelineId = leadPipeline.id;
  opportunityPipelineId = opportunityPipeline.id;
  for (const stage of stages) {
    if (stage.leadStageCode) leadStages.set(stage.leadStageCode, stage.id);
    if (stage.opportunityStageCode) opportunityStages.set(stage.opportunityStageCode, stage.id);
  }

  const invalidOwner = await createLead({ label: "responsável inválido", ownerMemberId: viewer.memberId });
  const slowSla = await createLead({ label: "SLA crítico", attemptSeconds: 181 });
  const noAttempt = await createLead({ label: "sem tentativa", attemptSeconds: null });
  const pacto = await createLead({ label: "PACTO incompleto", stageCode: "IN_QUALIFICATION" });
  const stagnant = await createLead({ label: "parado", enteredAt: new Date(now.getTime() - 9 * 86_400_000) });
  const noNext = await createLead({ label: "sem próxima ação", activeTask: false });
  const incoherent = await createLead({ label: "etapa incoerente" });
  const tryingStageId = leadStages.get("TRYING_CONTACT");
  if (!tryingStageId) throw new Error("Etapa TRYING_CONTACT ausente.");
  await database.lead.update({
    where: { id: incoherent.lead.id },
    data: {
      currentStageId: tryingStageId,
      updatedAt: new Date(now.getTime() - 30_000),
    },
  });
  await database.meeting.create({
    data: {
      workspaceId,
      leadId: pacto.lead.id,
      ownerMemberId: closer.memberId,
      title: "Reunião sem briefing CRM-24",
      status: "SCHEDULED",
      startsAt: new Date(now.getTime() + 86_400_000),
      endsAt: new Date(now.getTime() + 86_400_000 + 30 * 60_000),
      durationMinutes: 30,
      timeZone: "America/Sao_Paulo",
      revision: 1,
      createdByActorId: manager.actorId,
      updatedByActorId: manager.actorId,
      createdAt: now,
      updatedAt: now,
    },
  });
  const openOpportunityStageId = opportunityStages.get("MEETING_SCHEDULED");
  const lostStageId = opportunityStages.get("LOST");
  if (!openOpportunityStageId || !lostStageId) throw new Error("Etapas de oportunidade ausentes.");
  const openOpportunity = await database.opportunity.create({
    data: {
      workspaceId,
      leadId: slowSla.lead.id,
      pipelineId: opportunityPipelineId,
      currentStageId: openOpportunityStageId,
      ownerMemberId: closer.memberId,
      name: "Oportunidade sem próxima ação CRM-24",
      interestDescription: "Interesse fictício para teste.",
      status: "OPEN",
      amountCents: 100_000,
      tcvCents: 100_000,
      probabilityBps: 2_500,
      revision: 1,
      createdByActorId: manager.actorId,
      updatedByActorId: manager.actorId,
      createdAt: now,
      updatedAt: now,
    },
  });
  await database.stageHistory.create({
    data: { workspaceId, pipelineId: opportunityPipelineId, stageId: openOpportunityStageId, opportunityId: openOpportunity.id, enteredAt: now, enteredByActorId: manager.actorId, transitionOrigin: "OPPORTUNITY_CARD", transitionReason: "Cenário CRM-24." },
  });
  const deletedReason = await database.lossReason.create({
    data: {
      workspaceId,
      key: `crm24-deleted-${randomUUID()}`,
      name: "Motivo excluído CRM-24",
      position: 999,
      active: false,
      deletedAt: now,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  const lostOpportunity = await database.opportunity.create({
    data: {
      workspaceId,
      leadId: stagnant.lead.id,
      pipelineId: opportunityPipelineId,
      currentStageId: lostStageId,
      ownerMemberId: closer.memberId,
      name: "Perda sem motivo válido CRM-24",
      interestDescription: "Interesse fictício encerrado.",
      status: "LOST",
      amountCents: 0,
      probabilityBps: 0,
      closedAt: now,
      lossReasonId: deletedReason.id,
      revision: 1,
      createdByActorId: manager.actorId,
      updatedByActorId: manager.actorId,
      createdAt: now,
      updatedAt: now,
    },
  });
  await database.stageHistory.create({
    data: { workspaceId, pipelineId: opportunityPipelineId, stageId: lostStageId, opportunityId: lostOpportunity.id, enteredAt: now, enteredByActorId: manager.actorId, transitionOrigin: "OPPORTUNITY_CARD", transitionReason: "Cenário CRM-24." },
  });

  expect(invalidOwner.lead.id).toBeTruthy();
  expect(noAttempt.cycle.firstHumanAttemptAt).toBeNull();
  expect(noNext.lead.id).toBeTruthy();
});

afterAll(async () => {
  await database.$disconnect();
});

describe("CRM-24 — auditoria administrativa e saúde do processo", () => {
  it("nega leitura e mutação a usuário comum sem permissões de auditoria", async () => {
    await expect(service().getScreen(viewer, {})).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service().scan(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("detecta todas as violações determinísticas, persiste evidência e reconcilia dashboard", async () => {
    const first = await service().scan(manager);
    expect(first.created).toBeGreaterThanOrEqual(processViolationTypes.length);
    const rows = await database.processViolation.findMany({ where: { workspaceId }, select: { type: true, evidence: true, evidenceSummary: true } });
    const detected = new Set(rows.map((row) => row.type));
    for (const type of processViolationTypes) expect(detected.has(type)).toBe(true);
    expect(rows.every((row) => row.evidence !== null && row.evidenceSummary.length >= 3)).toBe(true);

    const screen = await service().getScreen(manager, { auditEntityType: "ProcessViolation" });
    expect(screen.reconciliation.stalled.reconciled).toBe(true);
    expect(screen.reconciliation.withoutNextAction.reconciled).toBe(true);
    expect(screen.summary.critical).toBeGreaterThan(0);
    expect(screen.audit.items.length).toBeGreaterThan(0);
    expect(screen.audit.items.every((row) => row.href !== null && /^\/(leads|agenda\/reunioes)\//.test(row.href))).toBe(true);
    expect(screen.audit.items.some((row) => row.href?.startsWith("/leads/") === true)).toBe(true);

    const second = await service().scan(manager);
    expect(second.created).toBe(0);
    expect(second.refreshed).toBeGreaterThan(0);
  });

  it("filtra auditoria por ator, origem, ação, entidade, texto e período sem vazar outro workspace", async () => {
    const otherWorkspace = await database.workspace.create({ data: { slug: `crm24-other-${randomUUID()}`, name: "Outro workspace CRM-24" } });
    const otherActor = await database.actor.create({ data: { workspaceId: otherWorkspace.id, type: "SYSTEM", key: "system", displayName: "Sistema externo CRM-24" } });
    await database.auditLog.create({ data: { workspaceId: otherWorkspace.id, actorId: otherActor.id, action: "crm24.external.hidden", entityType: "Workspace", entityId: otherWorkspace.id, origin: "SYSTEM" } });

    const filtered = await service().getScreen(manager, {
      auditActorType: "SYSTEM",
      auditOrigin: "SYSTEM",
      auditAction: "process_health.violation.detected",
      auditEntityType: "ProcessViolation",
      auditSearch: "process_health",
      auditFrom: "2050-06-20T14:00:00.000Z",
      auditTo: "2050-06-20T16:00:00.000Z",
    });
    expect(filtered.audit.total).toBeGreaterThan(0);
    expect(filtered.audit.items.every((row) => row.actor.type === "SYSTEM" && row.origin === "SYSTEM")).toBe(true);
    expect(filtered.audit.items.some((row) => row.action === "crm24.external.hidden")).toBe(false);

    const hidden = await service().getScreen(manager, { auditSearch: "crm24.external.hidden" });
    expect(hidden.audit.total).toBe(0);
  });

  it("mascara campos sensíveis na resposta administrativa", async () => {
    await database.auditLog.create({
      data: {
        workspaceId,
        actorId: manager.actorId,
        action: "crm24.sensitive.fixture",
        entityType: "Workspace",
        entityId: workspaceId,
        origin: "DOMAIN",
        changes: { before: { email: "pessoa@exemplo.local" }, after: { normalizedPhone: "+5511999999999", status: "OPEN" } },
      },
    });
    const screen = await service().getScreen(manager, { auditAction: "crm24.sensitive.fixture" });
    expect(screen.audit.items[0]?.before).toEqual({ email: "[dado sensível ocultado]" });
    expect(screen.audit.items[0]?.after).toEqual({ normalizedPhone: "[dado sensível ocultado]", status: "OPEN" });
  });

  it("preserva AuditLog e a evidência do achado contra update, delete e truncate", async () => {
    const finding = await database.processViolation.findFirstOrThrow({ where: { workspaceId } });
    const audit = await database.auditLog.findFirstOrThrow({ where: { workspaceId, action: "process_health.violation.detected" } });
    await expect(database.auditLog.update({ where: { id: audit.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(database.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow(/append-only/);
    await expect(database.processViolation.update({ where: { id: finding.id }, data: { title: "Evidência reescrita" } })).rejects.toThrow(/immutable/);
    await expect(database.processViolation.delete({ where: { id: finding.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(database.$executeRawUnsafe('TRUNCATE TABLE "process_violations"')).rejects.toThrow(/cannot be deleted/);
  });

  it("exige reconhecimento, bloqueia falsa correção e resolve sem apagar o fato", async () => {
    const active = await database.processViolation.findFirstOrThrow({ where: { workspaceId, type: "LEAD_WITHOUT_NEXT_ACTION", status: "OPEN" } });
    await expect(service().act(manager, active.id, { action: "RESOLVE", reason: "Tentativa direta.", expectedUpdatedAt: active.updatedAt })).rejects.toMatchObject({ code: "PROCESS_VIOLATION_CONFLICT" });
    await service().act(manager, active.id, { action: "ACKNOWLEDGE", expectedUpdatedAt: active.updatedAt });
    const acknowledged = await database.processViolation.findUniqueOrThrow({ where: { id: active.id } });
    await expect(service().act(manager, active.id, { action: "RESOLVE", reason: "Ainda sem correção.", expectedUpdatedAt: acknowledged.updatedAt })).rejects.toMatchObject({ code: "PROCESS_VIOLATION_CONFLICT" });

    const historical = await database.processViolation.findFirstOrThrow({ where: { workspaceId, type: "SLA_VIOLATED", status: "OPEN" } });
    await service().act(manager, historical.id, { action: "ACKNOWLEDGE", expectedUpdatedAt: historical.updatedAt });
    const historicalAcknowledged = await database.processViolation.findUniqueOrThrow({ where: { id: historical.id } });
    await service().act(manager, historical.id, { action: "RESOLVE", reason: "Violação revisada com o gestor responsável.", expectedUpdatedAt: historicalAcknowledged.updatedAt });
    const resolved = await database.processViolation.findUniqueOrThrow({ where: { id: historical.id } });
    expect(resolved).toMatchObject({ status: "RESOLVED", resolutionReason: "Violação revisada com o gestor responsável." });
    expect(await database.auditLog.count({ where: { workspaceId, entityId: historical.id, action: { in: ["process_health.violation.acknowledged", "process_health.violation.resolved"] } } })).toBe(2);
  });
});
