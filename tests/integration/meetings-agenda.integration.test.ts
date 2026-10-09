import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for meeting tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 24 }) });
const authorization = createAuthorizationService({ database });
let clock = new Date("2035-02-10T15:00:00.000Z");
let workspaceId: string;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;
let adminContext: AuthenticatedContext;
let systemContext: ServiceActorContext;
let closer1Id: string;
let closer2Id: string;
let sequence = 90_000_000;

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
    select: {
      id: true,
      userId: true,
      roleId: true,
      user: { select: { displayName: true } },
      role: { select: { key: true, name: true } },
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

async function contextByMember(memberId: string) {
  const member = await database.workspaceMember.findUniqueOrThrow({
    where: { id: memberId },
    select: { user: { select: { normalizedEmail: true } } },
  });
  return humanContext(member.user.normalizedEmail);
}

function meetings(overrides: Readonly<{ beforeCommit?: () => Promise<void> }> = {}) {
  return createMeetingService({ database, authorization, now: () => clock, ...overrides });
}

async function qualifyLead(label: string) {
  sequence += 1;
  const result = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
    channel: "MANUAL",
    idempotencyKey: `crm15:${label}:${randomUUID()}`,
    fullName: `${label} ${randomUUID().slice(0, 8)}`,
    phone: `+55119${sequence.toString().slice(-8)}`,
    jobTitle: "Gestor público",
    organizationName: "Organização fictícia",
    city: "São Paulo",
    stateCode: "SP",
    interestSummary: "Preciso organizar o processo comercial permanente.",
    budgetCents: 150_000,
    sourceKey: "manual",
    priorityBandCode: "P1",
    rawPayload: { test: "crm15", label },
  }, systemContext);
  if (result.outcome === "REJECTED") throw new Error(result.code);
  const service = createPreSalesPipelineService({ database, authorization, now: () => clock });
  const stages = await database.pipelineStage.findMany({
    where: { workspaceId, pipeline: { entityType: "LEAD", isDefault: true }, deletedAt: null },
    select: { id: true, leadStageCode: true },
  });
  const byCode = new Map(stages.map((stage) => [stage.leadStageCode, stage.id]));
  let state = await service.getLeadState(managerContext, { leadId: result.leadId });
  await service.transition(managerContext, {
    leadId: result.leadId,
    targetStageId: byCode.get("IN_QUALIFICATION"),
    expectedUpdatedAt: state.updatedAt,
    reason: "Correção gerencial para preparar cenário de reunião.",
    origin: "PIPELINE_LIST",
    managerCorrection: true,
    confirmed: true,
  });
  await createPactoQualificationService({ database, authorization, now: () => clock }).validate(managerContext, {
    leadId: result.leadId,
    expectedRevision: 0,
    dimensions: pactoDimensions.map((dimension) => ({
      dimension,
      status: "POSITIVE" as const,
      evidence: `Evidência nas palavras do lead para ${dimension}`,
      origin: "SDR" as const,
    })),
  });
  state = await service.getLeadState(managerContext, { leadId: result.leadId });
  await service.transition(managerContext, {
    leadId: result.leadId,
    targetStageId: byCode.get("QUALIFIED"),
    expectedUpdatedAt: state.updatedAt,
    reason: "PACTO validado e lead pronto para o closer.",
    origin: "PIPELINE_LIST",
    managerCorrection: false,
    confirmed: true,
  });
  const lead = await database.lead.findUniqueOrThrow({
    where: { id: result.leadId },
    select: { ownerMemberId: true },
  });
  if (!lead.ownerMemberId) throw new Error("Lead de teste ficou sem SDR.");
  return { leadId: result.leadId, sdrContext: await contextByMember(lead.ownerMemberId) };
}

async function schedule(
  leadId: string,
  context: AuthenticatedContext,
  startsAtLocal: string,
  closerId = closer1Id,
) {
  return meetings().schedule(context, {
    leadId,
    closerId,
    title: `Diagnóstico ${leadId.slice(0, 8)}`,
    startsAtLocal,
    durationMinutes: 30,
    observation: "Reunião interna de demonstração.",
  });
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  workspaceId = seed.workspaceId;
  const system = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
  systemContext = { workspaceId, actorId: system.id, actorKey: "system", actorType: "SYSTEM" };
  [managerContext, viewerContext, adminContext] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    humanContext("admin@demo.politizai.local"),
  ]);
  const closers = await database.workspaceMember.findMany({
    where: { workspaceId, teamMemberships: { some: { function: "CLOSER", deletedAt: null } } },
    orderBy: { user: { normalizedEmail: "asc" } },
    select: { id: true },
  });
  closer1Id = closers[0]!.id;
  closer2Id = closers[1]!.id;
});

afterAll(async () => database.$disconnect());

describe("agenda interna e reuniões", () => {
  it("agenda reunião para lead novo sem resumo, detalhes ou PACTO", async () => {
    sequence += 1;
    const created = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
      channel: "MANUAL",
      idempotencyKey: `meeting-without-qualification:${randomUUID()}`,
      fullName: `Lead sem detalhes ${randomUUID().slice(0, 8)}`,
      phone: `+55119${sequence.toString().slice(-8)}`,
      sourceKey: "manual",
      priorityBandCode: "P3",
      rawPayload: { test: "meeting-without-qualification" },
    }, systemContext);
    if (created.outcome === "REJECTED") throw new Error(created.code);

    const before = await meetings().getLeadMeetings(managerContext, { leadId: created.leadId });
    const agenda = await meetings().getAgenda(managerContext, { view: "day", date: "2035-02-11" });
    expect(before.canSchedule).toBe(true);
    expect(agenda.leadOptions.map((lead) => lead.id)).toContain(created.leadId);

    const scheduled = await schedule(created.leadId, managerContext, "2035-02-11T15:00");
    const stored = await database.lead.findUniqueOrThrow({
      where: { id: created.leadId },
      include: { currentStage: true, qualification: true },
    });
    expect(scheduled.meetingId).toBeTruthy();
    expect(stored.interestSummary).toBeNull();
    expect(stored.qualification).toBeNull();
    expect(stored.currentStage.leadStageCode).toBe("MEETING_SCHEDULED");
    expect(await database.commercialMetricFact.count({
      where: { workspaceId, leadId: created.leadId, eventType: "MEETING_SCHEDULED", reversedAt: null },
    })).toBe(1);
  });

  it("agenda de forma atômica, cria tarefa, atualiza pipeline, timeline e auditoria", async () => {
    const lead = await qualifyLead("CRM15 agendamento");
    const before = await meetings().getLeadMeetings(lead.sdrContext, { leadId: lead.leadId });
    const agenda = await meetings().getAgenda(lead.sdrContext, { view: "day", date: "2035-02-11" });
    expect(before.canSchedule).toBe(true);
    expect(before.closerOptions).toHaveLength(2);
    expect(agenda.canFilterCloser).toBe(false);
    expect(agenda.closerOptions).toHaveLength(0);
    expect(agenda.schedulingCloserOptions).toHaveLength(2);
    const result = await schedule(lead.leadId, lead.sdrContext, "2035-02-11T09:30", closer2Id);
    const [meeting, task, storedLead, stage, history, activities, audit] = await Promise.all([
      database.meeting.findUniqueOrThrow({ where: { id: result.meetingId } }),
      database.task.findFirstOrThrow({ where: { workspaceId, meetingId: result.meetingId } }),
      database.lead.findUniqueOrThrow({ where: { id: lead.leadId } }),
      database.stageHistory.findFirstOrThrow({ where: { workspaceId, leadId: lead.leadId, exitedAt: null } }),
      database.meetingHistory.findMany({ where: { workspaceId, meetingId: result.meetingId } }),
      database.activity.findMany({ where: { workspaceId, leadId: lead.leadId, meetingId: result.meetingId } }),
      database.auditLog.findMany({ where: { workspaceId, entityId: result.meetingId, action: "meeting.scheduled" } }),
    ]);
    expect(meeting).toMatchObject({
      startsAt: new Date("2035-02-11T12:30:00.000Z"),
      durationMinutes: 30,
      timeZone: "America/Sao_Paulo",
      status: "SCHEDULED",
    });
    expect(task).toMatchObject({ kind: "MEETING", status: "OPEN", assigneeMemberId: closer2Id });
    expect(storedLead).toMatchObject({ status: "QUALIFIED" });
    expect(storedLead.nextActionTaskId).not.toBeNull();
    expect(stage.transitionOrigin).toBe("MEETING");
    expect(history).toHaveLength(1);
    expect(activities).toHaveLength(1);
    expect(audit).toHaveLength(1);
  });

  it("rejeita conflito e serializa duas entradas simultâneas", async () => {
    const first = await qualifyLead("CRM15 conflito A");
    const second = await qualifyLead("CRM15 conflito B");
    const results = await Promise.allSettled([
      schedule(first.leadId, managerContext, "2035-02-11T11:00"),
      schedule(second.leadId, managerContext, "2035-02-11T11:00"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "MEETING_TIME_CONFLICT" },
    });
    expect(await database.meeting.count({
      where: { workspaceId, ownerMemberId: closer1Id, startsAt: new Date("2035-02-11T14:00:00.000Z") },
    })).toBe(1);
  });

  it("confirma, remarca e preserva cada horário no histórico append-only", async () => {
    const lead = await qualifyLead("CRM15 remarcação");
    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-12T09:00", closer2Id);
    await meetings().act(managerContext, { action: "CONFIRM", meetingId: scheduled.meetingId, expectedRevision: 1 });
    const rescheduled = await meetings().act(managerContext, {
      action: "RESCHEDULE",
      meetingId: scheduled.meetingId,
      expectedRevision: 2,
      startsAtLocal: "2035-02-12T10:00",
      durationMinutes: 40,
      reason: "Lead pediu um horário mais tarde.",
    });
    expect(rescheduled).toMatchObject({ status: "SCHEDULED", revision: 3, startsAt: "2035-02-12T13:00:00.000Z" });
    const history = await database.meetingHistory.findMany({
      where: { workspaceId, meetingId: scheduled.meetingId },
      orderBy: { meetingRevision: "asc" },
    });
    expect(history.map((item) => item.action)).toEqual(["SCHEDULED", "CONFIRMED", "RESCHEDULED"]);
    expect(history[2]).toMatchObject({
      previousStartsAt: new Date("2035-02-12T12:00:00.000Z"),
      newStartsAt: new Date("2035-02-12T13:00:00.000Z"),
    });
    expect(await database.task.findFirstOrThrow({ where: { workspaceId, meetingId: scheduled.meetingId } })).toMatchObject({ dueAt: new Date("2035-02-12T13:00:00.000Z") });
    await expect(database.meetingHistory.update({
      where: { id: history[0]!.id },
      data: { reason: "Tentativa de apagar o fato" },
    })).rejects.toThrow(/append-only/);
  });

  it("liga reunião e próxima ação à oportunidade aberta", async () => {
    const lead = await qualifyLead("CRM09 oportunidade");
    const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" }, take: 1 } } });
    const stage = pipeline.stages[0]!;
    const opportunity = await database.opportunity.create({ data: { workspaceId, leadId: lead.leadId, pipelineId: pipeline.id, currentStageId: stage.id, ownerMemberId: closer1Id, name: "Oportunidade Stage09", interestDescription: "Diagnóstico comercial da Etapa 09", status: "OPEN", amountCents: 100_000n, probabilityBps: 1_000, createdByActorId: managerContext.actorId, updatedByActorId: managerContext.actorId } });
    const result = await schedule(lead.leadId, managerContext, "2035-02-19T09:00");
    const [meeting, task, activity, projected] = await Promise.all([
      database.meeting.findUniqueOrThrow({ where: { id: result.meetingId } }),
      database.task.findFirstOrThrow({ where: { workspaceId, meetingId: result.meetingId } }),
      database.activity.findFirstOrThrow({ where: { workspaceId, meetingId: result.meetingId } }),
      database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } }),
    ]);
    expect(meeting.opportunityId).toBe(opportunity.id);
    expect(task.opportunityId).toBe(opportunity.id);
    expect(activity.opportunityId).toBe(opportunity.id);
    expect(projected).toMatchObject({ nextActionTaskId: task.id, nextActionAt: meeting.startsAt, nextActionDescription: task.title });
  });

  it("protege transcrição por consentimento, política, retenção e permissão própria", async () => {
    const lead = await qualifyLead("CRM09 transcrição");
    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-21T09:00");
    await expect(meetings().recordTranscript(adminContext, { meetingId: scheduled.meetingId, transcriptText: "Texto sensível da reunião sem consentimento válido.", summary: "Resumo sensível.", policyVersion: "meeting-transcript-policy/v1", consentConfirmed: false, consentEvidence: "Consentimento recusado pelo participante.", consentRecordedAt: clock.toISOString(), retentionUntil: "2036-02-20T15:00:00.000Z" })).rejects.toThrow();
    const recorded = await meetings().recordTranscript(adminContext, { meetingId: scheduled.meetingId, transcriptText: "Texto sensível da reunião autorizado pelo participante.", summary: "Resumo autorizado da conversa.", policyVersion: "meeting-transcript-policy/v1", consentConfirmed: true, consentEvidence: "Consentimento verbal registrado no início da reunião.", consentRecordedAt: clock.toISOString(), retentionUntil: "2036-02-20T15:00:00.000Z" });
    expect(recorded).toMatchObject({ version: 1, externalRecording: false });
    const restricted = await meetings().getBriefing(viewerContext, { meetingId: scheduled.meetingId });
    expect(restricted.transcript).toMatchObject({ status: "RESTRICTED", visible: false, canManage: false, transcriptText: null, summary: null });
    const visible = await meetings().getBriefing(adminContext, { meetingId: scheduled.meetingId });
    expect(visible.transcript).toMatchObject({ status: "AVAILABLE", visible: true, canManage: true, transcriptText: "Texto sensível da reunião autorizado pelo participante.", summary: "Resumo autorizado da conversa.", policyVersion: "meeting-transcript-policy/v1" });
    expect(await database.auditLog.count({ where: { workspaceId, action: "meeting.transcript.read", entityId: recorded.artifactId } })).toBe(1);
    await expect(database.meetingTranscriptArtifact.update({ where: { id: recorded.artifactId }, data: { summary: "Mutação indevida" } })).rejects.toThrow(/append-only/);
    await expect(database.meetingTranscriptArtifact.delete({ where: { id: recorded.artifactId } })).rejects.toThrow(/append-only/);
  });

  it("registra comparecimento e cria a próxima ação explícita", async () => {
    const lead = await qualifyLead("CRM15 show");
    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-13T09:00");
    clock = new Date("2035-02-13T13:00:00.000Z");
    const result = await meetings().act(managerContext, {
      action: "ATTENDED",
      meetingId: scheduled.meetingId,
      expectedRevision: 1,
      outcome: "Reunião realizada e diagnóstico aprofundado.",
      nextAction: { title: "Enviar resumo da reunião", dueAtLocal: "2035-02-13T14:00" },
    });
    expect(result.status).toBe("COMPLETED");
    const [meetingTask, leadTask] = await Promise.all([
      database.task.findFirstOrThrow({ where: { workspaceId, meetingId: scheduled.meetingId } }),
      database.task.findFirstOrThrow({ where: { workspaceId, leadId: lead.leadId, title: "Enviar resumo da reunião" } }),
    ]);
    expect(meetingTask).toMatchObject({ status: "COMPLETED", completedAt: clock });
    expect(leadTask).toMatchObject({ status: "OPEN", dueAt: new Date("2035-02-13T17:00:00.000Z") });
  });

  it("diferencia cancelamento e no-show e mantém acompanhamento", async () => {
    clock = new Date("2035-02-14T12:00:00.000Z");
    const cancelledLead = await qualifyLead("CRM15 cancelamento");
    const cancelled = await schedule(cancelledLead.leadId, managerContext, "2035-02-15T09:00", closer2Id);
    await meetings().act(managerContext, {
      action: "CANCEL",
      meetingId: cancelled.meetingId,
      expectedRevision: 1,
      reason: "Lead cancelou antes da reunião.",
      nextAction: { title: "Entender possibilidade de remarcação", dueAtLocal: "2035-02-15T11:00" },
    });
    const cancelledRow = await database.meeting.findUniqueOrThrow({ where: { id: cancelled.meetingId } });
    expect(cancelledRow).toMatchObject({ status: "CANCELLED", completedAt: null, noShowAt: null });

    const noShowLead = await qualifyLead("CRM15 no-show");
    const noShow = await schedule(noShowLead.leadId, managerContext, "2035-02-15T10:00", closer2Id);
    clock = new Date("2035-02-15T14:00:00.000Z");
    await meetings().act(managerContext, {
      action: "NO_SHOW",
      meetingId: noShow.meetingId,
      expectedRevision: 1,
      reason: "Lead não entrou na sala no horário combinado.",
      nextAction: { title: "Tentar recuperar no-show", dueAtLocal: "2035-02-15T13:00" },
    });
    const noShowRow = await database.meeting.findUniqueOrThrow({ where: { id: noShow.meetingId } });
    expect(noShowRow).toMatchObject({ status: "NO_SHOW", completedAt: null, cancelledAt: null, noShowAt: clock });
  });

  it("aplica escopo de closer e gestor e bloqueia mutação do visualizador", async () => {
    clock = new Date("2035-02-16T12:00:00.000Z");
    const lead = await qualifyLead("CRM15 permissões");
    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-17T09:00", closer1Id);
    const closer1 = await contextByMember(closer1Id);
    const closer2 = await contextByMember(closer2Id);
    const ownAgenda = await meetings().getAgenda(closer1, { view: "day", date: "2035-02-17" });
    expect(ownAgenda.meetings.map((meeting) => meeting.id)).toContain(scheduled.meetingId);
    expect(ownAgenda.canFilterCloser).toBe(false);
    expect(ownAgenda.closerOptions).toEqual([{ id: closer1Id, name: expect.any(String) }]);
    expect(ownAgenda.schedulingCloserOptions).toEqual([{ id: closer1Id, name: expect.any(String) }]);
    const otherAgenda = await meetings().getAgenda(closer2, { view: "day", date: "2035-02-17" });
    expect(otherAgenda.meetings.map((meeting) => meeting.id)).not.toContain(scheduled.meetingId);
    const managerAgenda = await meetings().getAgenda(managerContext, { view: "week", date: "2035-02-17", closerId: closer1Id });
    expect(managerAgenda.meetings.map((meeting) => meeting.id)).toContain(scheduled.meetingId);
    expect(managerAgenda.canFilterCloser).toBe(true);
    expect(managerAgenda.closerOptions).toEqual(managerAgenda.schedulingCloserOptions);
    const viewerAgenda = await meetings().getAgenda(viewerContext, { view: "day", date: "2035-02-17" });
    expect(viewerAgenda.meetings.find((meeting) => meeting.id === scheduled.meetingId)?.canWrite).toBe(false);
    await expect(meetings().act(viewerContext, {
      action: "CONFIRM",
      meetingId: scheduled.meetingId,
      expectedRevision: 1,
    })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("limita o vendedor à própria agenda também no card do lead e no servidor", async () => {
    clock = new Date("2035-02-17T15:00:00.000Z");
    const lead = await qualifyLead("CRM15 escopo do vendedor");
    await database.lead.update({ where: { id: lead.leadId }, data: { ownerMemberId: closer1Id } });
    const closer = await contextByMember(closer1Id);
    const leadAgenda = await meetings().getLeadMeetings(closer, { leadId: lead.leadId });
    expect(leadAgenda.closerOptions).toEqual([{ id: closer1Id, name: expect.any(String) }]);
    await expect(schedule(lead.leadId, closer, "2035-02-18T09:00", closer2Id)).rejects.toMatchObject({
      code: "MEETING_OWNER_SCOPE_DENIED",
    });
    await expect(schedule(lead.leadId, closer, "2035-02-18T09:00", closer1Id)).resolves.toMatchObject({
      meetingId: expect.any(String),
    });
  });

  it("marca horário passado sem resultado como pendência e entrega briefing persistido", async () => {
    clock = new Date("2035-02-18T12:00:00.000Z");
    const lead = await qualifyLead("CRM15 briefing");
    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-18T10:00", closer1Id);
    clock = new Date("2035-02-18T14:30:00.000Z");
    const closer = await contextByMember(closer1Id);
    const agenda = await meetings().getAgenda(closer, { view: "day", date: "2035-02-18" });
    expect(agenda.meetings.find((meeting) => meeting.id === scheduled.meetingId)?.operationalStatus).toBe("PENDING_STATUS");
    const briefing = await meetings().getBriefing(closer, { meetingId: scheduled.meetingId });
    expect(briefing).toMatchObject({
      painInLeadWords: expect.stringContaining("AFFLICTION"),
      decisionMaker: expect.stringContaining("DECISION"),
      capacity: expect.stringContaining("CAPACITY"),
      urgency: expect.stringContaining("OPPORTUNITY_NOW"),
    });
    expect(briefing.pacto).toHaveLength(5);
    expect(briefing.recentHistory.length).toBeGreaterThan(0);
  });

  it("faz rollback completo quando a transação falha", async () => {
    clock = new Date("2035-02-19T12:00:00.000Z");
    const lead = await qualifyLead("CRM15 rollback");
    await expect(meetings({ beforeCommit: async () => { throw new Error("falha controlada crm15"); } }).schedule(managerContext, {
      leadId: lead.leadId,
      closerId: closer1Id,
      title: "Reunião que deve reverter",
      startsAtLocal: "2035-02-20T09:00",
      durationMinutes: 30,
    })).rejects.toThrow("falha controlada crm15");
    expect(await database.meeting.count({ where: { workspaceId, leadId: lead.leadId } })).toBe(0);
    expect(await database.task.count({ where: { workspaceId, leadId: lead.leadId, kind: "MEETING" } })).toBe(0);
    const stored = await database.lead.findUniqueOrThrow({ where: { id: lead.leadId }, include: { currentStage: true } });
    expect(stored.currentStage.leadStageCode).toBe("QUALIFIED");
    expect(await database.auditLog.count({ where: { workspaceId, action: "meeting.scheduled", changes: { path: ["leadId"], equals: lead.leadId } } })).toBe(0);
  });

  it("exibe e aceita vendedor legado sem equipe na Agenda", async () => {
    clock = new Date("2035-02-20T12:00:00.000Z");
    const role = await database.role.findFirstOrThrow({
      where: { workspaceId, key: "closer", deletedAt: null },
    });
    const email = `legacy-closer-${randomUUID()}@meeting.test`;
    const user = await database.user.create({
      data: { email, normalizedEmail: email, displayName: "Vendedor legado da agenda" },
    });
    const member = await database.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        roleId: role.id,
        status: "ACTIVE",
        joinedAt: clock,
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
    });
    sequence += 1;
    const lead = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
      channel: "MANUAL",
      idempotencyKey: `legacy-closer-agenda:${randomUUID()}`,
      fullName: `Lead do vendedor legado ${randomUUID().slice(0, 8)}`,
      phone: `+55119${sequence.toString().slice(-8)}`,
      sourceKey: "manual",
      priorityBandCode: "P3",
      rawPayload: { test: "legacy-closer-agenda" },
    }, systemContext);
    if (lead.outcome === "REJECTED") throw new Error(lead.code);

    const agenda = await meetings().getAgenda(adminContext, { view: "day", date: "2035-02-21" });
    expect(agenda.closerOptions).toContainEqual({ id: member.id, name: "Vendedor legado da agenda" });
    await expect(schedule(lead.leadId, adminContext, "2035-02-21T10:00", member.id)).resolves.toMatchObject({
      meetingId: expect.any(String),
    });
  });
});
