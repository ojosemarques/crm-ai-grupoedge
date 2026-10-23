import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { encryptGoogleCalendarSecret } from "@/modules/integrations/application/google-calendar-crypto";
import { createGoogleCalendarWorkerService } from "@/modules/integrations/application/google-calendar-worker-service";
import { createMeetingPipelineReconciliationService } from "@/modules/meetings/application/meeting-pipeline-reconciliation-service";
import { createMeetingParticipantEmailWorker } from "@/modules/meetings/application/meeting-participant-email-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { summarizeRealtimeDashboardTotals } from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";
import { reconcileStageMeetingBookingInTransaction } from "@/modules/metrics/application/stage-meeting-booking-credit";
import { createCommercialMetricReconciliationService } from "@/modules/metrics/application/commercial-metric-reconciliation-service";
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
    email,
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

async function createActiveProspectingLead(label: string) {
  sequence += 1;
  const [source, pipeline] = await Promise.all([
    database.leadSource.findFirstOrThrow({
      where: { workspaceId, key: "manual", deletedAt: null },
      select: { id: true },
    }),
    database.pipeline.findFirstOrThrow({
      where: { workspaceId, entityType: "LEAD", name: "Prospecção Ativa", deletedAt: null },
      include: {
        stages: {
          where: { stableKey: "active-prospecting.new-lead", deletedAt: null },
          take: 1,
        },
      },
    }),
  ]);
  const stage = pipeline.stages[0];
  if (!stage) throw new Error("Etapa inicial da Prospecção Ativa não encontrada.");
  const lead = await database.lead.create({
    data: {
      workspaceId,
      sourceId: source.id,
      pipelineId: pipeline.id,
      currentStageId: stage.id,
      ownerMemberId: managerContext.memberId,
      fullName: `${label} ${randomUUID().slice(0, 8)}`,
      normalizedPhone: `+55119${sequence.toString().slice(-8)}`,
      slaStartedAt: clock,
      slaDueAt: new Date(clock.getTime() + 60 * 60_000),
      lastActivityAt: clock,
      createdByActorId: managerContext.actorId,
      updatedByActorId: managerContext.actorId,
    },
  });
  await database.stageHistory.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      leadId: lead.id,
      enteredAt: clock,
      enteredByActorId: managerContext.actorId,
      transitionOrigin: "INTAKE",
      transitionReason: "Lead de teste criado na Prospecção Ativa.",
    },
  });
  return { leadId: lead.id, pipelineId: pipeline.id };
}

async function schedule(
  leadId: string,
  context: AuthenticatedContext,
  startsAtLocal: string,
  closerId = closer1Id,
  taskPriority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT",
) {
  return meetings().schedule(context, {
    leadId,
    closerId,
    title: `Diagnóstico ${leadId.slice(0, 8)}`,
    startsAtLocal,
    durationMinutes: 30,
    observation: "Reunião interna de demonstração.",
    ...(taskPriority ? { taskPriority } : {}),
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

  it("permite registrar uma reunião em período anterior", async () => {
    clock = new Date("2035-02-10T15:00:00.000Z");
    const lead = await qualifyLead("CRM15 período anterior");

    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-09T09:00", closer2Id);
    const [meeting, task, agenda] = await Promise.all([
      database.meeting.findUniqueOrThrow({ where: { id: scheduled.meetingId } }),
      database.task.findFirstOrThrow({ where: { workspaceId, meetingId: scheduled.meetingId } }),
      meetings().getAgenda(managerContext, { view: "day", date: "2035-02-09" }),
    ]);

    expect(meeting).toMatchObject({
      startsAt: new Date("2035-02-09T12:00:00.000Z"),
      status: "SCHEDULED",
    });
    expect(task).toMatchObject({ status: "OPEN", dueAt: meeting.startsAt });
    expect(agenda.meetings).toContainEqual(expect.objectContaining({
      id: meeting.id,
      operationalStatus: "PENDING_STATUS",
    }));
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
    const result = await schedule(lead.leadId, lead.sdrContext, "2035-02-11T09:30", closer2Id, "MEDIUM");
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
    expect(task).toMatchObject({ kind: "MEETING", status: "OPEN", assigneeMemberId: closer2Id, priority: "MEDIUM" });
    const updatedAgenda = await meetings().getAgenda(managerContext, { view: "day", date: "2035-02-11" });
    expect(updatedAgenda.meetings).toContainEqual(expect.objectContaining({
      id: result.meetingId,
      leadId: lead.leadId,
      scheduledByName: lead.sdrContext.displayName,
    }));
    const updatedLeadMeetings = await meetings().getLeadMeetings(lead.sdrContext, { leadId: lead.leadId });
    expect(updatedLeadMeetings.meetings).toContainEqual(expect.objectContaining({
      id: result.meetingId,
      scheduledByName: lead.sdrContext.displayName,
    }));
    expect(storedLead).toMatchObject({ status: "QUALIFIED" });
    expect(storedLead.nextActionTaskId).not.toBeNull();
    expect(stage.transitionOrigin).toBe("MEETING");
    expect(history).toHaveLength(1);
    expect(activities).toHaveLength(1);
    expect(audit).toHaveLength(1);
  });

  it("conta uma vez ao mover o card e depois agendar, preservando o crédito original", async () => {
    const lead = await createActiveProspectingLead("Card antes da agenda");
    const pipeline = createPreSalesPipelineService({ database, authorization, now: () => clock });
    const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipeline: { name: "Prospecção Ativa" }, leadStageCode: "MEETING_SCHEDULED" } });
    const state = await pipeline.getLeadState(managerContext, { leadId: lead.leadId });
    await pipeline.transition(managerContext, { leadId: lead.leadId, targetStageId: stage.id, expectedUpdatedAt: state.updatedAt, origin: "PIPELINE_BOARD" });
    const stageFact = await database.commercialMetricFact.findFirstOrThrow({ where: { workspaceId, leadId: lead.leadId, eventType: "MEETING_SCHEDULED" } });
    clock = new Date(clock.getTime() + 86_400_000);
    const result = await schedule(lead.leadId, adminContext, "2035-04-20T09:00");
    const booking = await database.commercialMetricFact.findFirstOrThrow({ where: { workspaceId, meetingId: result.meetingId, eventType: "MEETING_SCHEDULED", correctionOfFactId: null } });
    const facts = await database.commercialMetricFact.findMany({ where: { workspaceId, leadId: lead.leadId, eventType: "MEETING_SCHEDULED" } });
    expect(facts.reduce((sum, fact) => sum + fact.quantity, 0)).toBe(1);
    expect(facts.filter(fact => fact.quantity > 0 && fact.occurredAt.getTime() === stageFact.occurredAt.getTime())).toEqual([stageFact]);
    expect(facts.find(fact => fact.quantity === -1)).toMatchObject({ correctionOfFactId: booking.id, occurredAt: booking.occurredAt, creditedMemberId: booking.creditedMemberId, bookedByMemberId: booking.bookedByMemberId });
    await database.$transaction(tx => reconcileStageMeetingBookingInTransaction(tx, booking));
    expect(await database.commercialMetricFact.count({ where: { workspaceId, leadId: lead.leadId, eventType: "MEETING_SCHEDULED" } })).toBe(facts.length);
    expect(await database.meeting.count({ where: { workspaceId, leadId: lead.leadId } })).toBe(1);
    expect(await database.meeting.findUniqueOrThrow({ where: { id: result.meetingId } })).toMatchObject({ startsAt: new Date("2035-04-20T12:00:00Z"), revision: 1 });
    expect(facts.filter(fact => fact.occurredAt.getTime() === booking.occurredAt.getTime()).reduce((sum, fact) => sum + fact.quantity, 0)).toBe(0);
    const reconciliation = await createCommercialMetricReconciliationService({ database, now: () => clock }).run(adminContext, { runKey: `stage-booking-${randomUUID()}` });
    expect("checks" in reconciliation && reconciliation.checks.find(check => check.sourceEntityType === "MeetingHistory" && check.eventType === "MEETING_SCHEDULED")).toMatchObject({ state: "MATCHED" });
    await meetings().act(managerContext, { meetingId: result.meetingId, expectedRevision: 1, action: "CANCEL", reason: "Cancelamento para validar um novo agendamento legítimo.", nextAction: { title: "Reagendar reunião", dueAtLocal: "2035-02-20T10:00" } });
    await schedule(lead.leadId, managerContext, "2035-04-20T10:00");
    expect((await database.commercialMetricFact.aggregate({ where: { workspaceId, leadId: lead.leadId, eventType: "MEETING_SCHEDULED" }, _sum: { quantity: true } }))._sum.quantity).toBe(2);
  });

  it("preserva os quatro créditos de agendamento após editar três reuniões futuras", async () => {
    clock = new Date("2035-02-10T15:00:00.000Z");
    const meetingIds: string[] = [];
    for (let index = 0; index < 4; index++) {
      const lead = await qualifyLead(`Crédito imutável ${index}`);
      const saved = await schedule(lead.leadId, managerContext, "2035-02-15T10:00", closer1Id);
      meetingIds.push(saved.meetingId);
      if (index < 3) {
        await meetings().act(managerContext, {
          action: "EDIT", meetingId: saved.meetingId, expectedRevision: 1,
          title: `Reunião futura corrigida ${index}`, startsAtLocal: "2035-02-16T11:00", durationMinutes: 30,
          status: "SCHEDULED", observation: "Horário e participantes atualizados.", outcome: null,
          reason: "Correção do horário sem apagar o trabalho de agendamento.",
        });
        await meetings().act(managerContext, { action: "CONFIRM", meetingId: saved.meetingId, expectedRevision: 2 });
      }
    }
    const facts = await database.commercialMetricFact.findMany({ where: { workspaceId, meetingId: { in: meetingIds }, eventType: "MEETING_SCHEDULED" } });
    const totals = summarizeRealtimeDashboardTotals(facts.map((fact) => ({ ...fact, occurredAt: fact.occurredAt.toISOString(), valueCents: fact.valueCents?.toString() ?? null })), [
      { id: managerContext.memberId, name: "Quem agendou" }, { id: closer1Id, name: "Responsável pela reunião" },
    ]);
    expect(totals.meetingsScheduled).toBe(4);
    expect(facts).toHaveLength(4);
    expect(facts.every((fact) => fact.bookedByMemberId === managerContext.memberId && fact.occurredAt.toISOString() === "2035-02-10T15:00:00.000Z")).toBe(true);
  });

  it("enfileira e envia pelo MillionSend o convite e os quatro lembretes do participante", async () => {
    clock = new Date("2035-02-10T15:00:00.000Z");
    const lead = await qualifyLead("CRM participante convidado");
    const participantEmail = "participante@example.test";
    const scheduled = await meetings().schedule(managerContext, {
      leadId: lead.leadId,
      closerId: closer1Id,
      title: "Diagnóstico com participante",
      startsAtLocal: "2035-02-11T09:00",
      durationMinutes: 30,
      observation: "Validação do convite externo.",
      participantEmail: ` ${participantEmail.toUpperCase()} `,
    });
    const meeting = await database.meeting.findUniqueOrThrow({ where: { id: scheduled.meetingId } });
    expect(meeting).toMatchObject({
      participantEmail,
      participantResponseStatus: "NEEDS_ACTION",
      participantResponseUpdatedAt: null,
    });

    const jobs = await database.job.findMany({
      where: {
        workspaceId,
        type: "NOTIFICATION",
        payload: { path: ["kind"], equals: "MEETING_PARTICIPANT_EMAIL_V2" },
        idempotencyKey: { startsWith: `meeting-participant-email:${meeting.id}:r1:` },
      },
      orderBy: { runAt: "asc" },
    });
    expect(jobs).toHaveLength(5);
    expect(jobs.map((job) => job.runAt.toISOString())).toEqual([
      "2035-02-10T15:00:00.000Z",
      "2035-02-11T09:00:00.000Z",
      "2035-02-11T11:00:00.000Z",
      "2035-02-11T11:30:00.000Z",
      "2035-02-11T12:00:00.000Z",
    ]);

    const profile = await database.emailConnectionProfile.findFirstOrThrow({ where: { workspaceId } });
    await database.emailConnectionProfile.update({
      where: { id: profile.id },
      data: {
        operatingMode: "EXTERNAL_READY",
        spfStatus: "VERIFIED_EXTERNAL",
        dkimStatus: "VERIFIED_EXTERNAL",
        dmarcStatus: "VERIFIED_EXTERNAL",
        smtpHost: "smtp.example.test",
        smtpPort: 587,
        validatedAt: clock,
        lastSuccessAt: clock,
      },
    });
    await database.integrationConnection.update({
      where: { id: profile.connectionId },
      data: { enabled: true },
    });
    let sentBody: Record<string, unknown> | null = null;
    let idempotencyKey: string | null = null;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      idempotencyKey = new Headers(init?.headers).get("Idempotency-Key");
      return new Response(JSON.stringify({ id: "millionsend-message-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const worker = createMeetingParticipantEmailWorker({
      database,
      now: () => clock,
      environment: { MILLIONSEND_ENABLED: "true", MILLIONSEND_API_KEY: "ms_integration_test_key" },
      fetchImpl,
    });
    await expect(worker.processNext("meeting-participant-email-test")).resolves.toMatchObject({
      status: "SUCCEEDED",
      emailKind: "INVITATION",
    });
    expect(sentBody).toMatchObject({
      from: profile.senderAddressNormalized,
      to: [participantEmail],
      subject: "Convite: Diagnóstico com participante",
    });
    expect(idempotencyKey).toBe(`meeting-participant-email:${meeting.id}:r1:invitation`);
    await expect(database.job.findUniqueOrThrow({ where: { id: jobs[0]!.id } })).resolves.toMatchObject({
      status: "SUCCEEDED",
      result: expect.objectContaining({ provider: "MILLIONSEND", providerMessageId: "millionsend-message-test" }),
    });
  });

  it("persiste vários convidados, envia individualmente e preserva respostas ao editar", async () => {
    clock = new Date("2035-02-10T15:00:00.000Z");
    const lead = await qualifyLead("CRM múltiplos convidados");
    const input = { leadId: lead.leadId, closerId: closer1Id, title: "Reunião múltiplos convidados", startsAtLocal: "2035-02-12T10:00", durationMinutes: 30,
      participantEmails: [" PRIMEIRO@example.test ", "segundo@example.test", "primeiro@example.test"] };
    await expect(meetings().schedule(viewerContext, input)).rejects.toThrow(AccessDeniedError);
    await expect(meetings().schedule(managerContext, { ...input, participantEmails: ["inválido"] })).rejects.toThrow();
    await expect(meetings().schedule(managerContext, { ...input, participantEmails: Array.from({ length: 21 }, (_, i) => `p${i}@example.test`) })).rejects.toThrow();
    const saved = await meetings().schedule(managerContext, input);
    const guests = () => database.meetingParticipant.findMany({ where: { workspaceId, meetingId: saved.meetingId }, orderBy: { position: "asc" } });
    expect((await guests()).map((guest) => guest.email)).toEqual(["primeiro@example.test", "segundo@example.test"]);
    await expect(database.meetingParticipant.create({ data: { workspaceId: randomUUID(), meetingId: saved.meetingId, email: "outro@example.test", position: 0 } })).rejects.toThrow();
    const jobs = await database.job.findMany({ where: { workspaceId, idempotencyKey: { startsWith: `meeting-participant-email:${saved.meetingId}:r1:` } } });
    expect(jobs).toHaveLength(10);
    for (const email of ["primeiro@example.test", "segundo@example.test"]) {
      const recipientJobs = jobs.filter((job) => (job.payload as { recipientEmail?: string }).recipientEmail === email);
      expect(recipientJobs).toHaveLength(5);
      expect(new Set(recipientJobs.map((job) => job.idempotencyKey)).size).toBe(5);
    }
    const sent: string[][] = [];
    const worker = createMeetingParticipantEmailWorker({ database, now: () => clock,
      environment: { MILLIONSEND_ENABLED: "true", MILLIONSEND_API_KEY: "ms_integration_test_key" },
      fetchImpl: async (_url, init) => {
        sent.push((JSON.parse(String(init?.body)) as { to: string[] }).to);
        return new Response(JSON.stringify({ id: `multi-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    await expect(worker.processNext("multi-1")).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(worker.processNext("multi-2")).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(sent).toEqual(expect.arrayContaining([["primeiro@example.test"], ["segundo@example.test"]]));
    await database.meetingParticipant.updateMany({ where: { workspaceId, meetingId: saved.meetingId, email: "segundo@example.test" }, data: { responseStatus: "ACCEPTED", responseUpdatedAt: clock } });
    const edit = { action: "EDIT", meetingId: saved.meetingId, expectedRevision: 1, title: input.title, startsAtLocal: input.startsAtLocal, durationMinutes: 30,
      status: "SCHEDULED", observation: null, outcome: null, reason: "Atualizar convidados com histórico preservado.", participantEmails: ["segundo@example.test", "terceiro@example.test"] };
    await meetings().act(managerContext, edit);
    expect(await guests()).toMatchObject([{ email: "segundo@example.test", responseStatus: "ACCEPTED" }, { email: "terceiro@example.test", responseStatus: "NEEDS_ACTION" }]);
    expect(await database.meeting.findUniqueOrThrow({ where: { id: saved.meetingId } })).toMatchObject({ participantEmail: "segundo@example.test", participantResponseStatus: "ACCEPTED", revision: 2 });
    expect(await database.job.count({ where: { id: { in: jobs.map((job) => job.id) }, status: "CANCELLED" } })).toBe(8);
    // Older clients editing only the primary participant must not silently delete other guests.
    const { participantEmails: _emails, ...legacyEdit } = edit;
    expect(_emails).toHaveLength(2);
    await meetings().act(managerContext, { ...legacyEdit, expectedRevision: 2, participantEmail: "segundo@example.test" });
    expect((await guests()).map((guest) => guest.email)).toEqual(["segundo@example.test", "terceiro@example.test"]);
    const screen = await meetings().getLeadMeetings(managerContext, { leadId: lead.leadId });
    expect(screen.meetings.find((meeting) => meeting.id === saved.meetingId)?.participants).toMatchObject([{ email: "segundo@example.test", responseStatus: "ACCEPTED" }, { email: "terceiro@example.test", responseStatus: "NEEDS_ACTION" }]);
  });

  it("permite criar, editar e remarcar reuniões no mesmo horário para o mesmo vendedor", async () => {
    const first = await qualifyLead("CRM15 sobreposição A");
    const second = await qualifyLead("CRM15 sobreposição B");
    const third = await qualifyLead("CRM15 sobreposição C");
    const [firstMeeting, secondMeeting] = await Promise.all([
      schedule(first.leadId, managerContext, "2035-02-11T11:00"),
      schedule(second.leadId, managerContext, "2035-02-11T11:00"),
    ]);
    const edited = await meetings().act(managerContext, {
      action: "EDIT",
      meetingId: secondMeeting.meetingId,
      expectedRevision: 1,
      title: "Diagnóstico simultâneo editado",
      startsAtLocal: "2035-02-11T11:00",
      durationMinutes: 30,
      status: "SCHEDULED",
      observation: "Reunião simultânea autorizada.",
      outcome: null,
      reason: "Ajuste dos dados da reunião simultânea.",
    });
    const thirdMeeting = await schedule(third.leadId, managerContext, "2035-02-11T12:00");
    const rescheduled = await meetings().act(managerContext, {
      action: "RESCHEDULE",
      meetingId: thirdMeeting.meetingId,
      expectedRevision: 1,
      startsAtLocal: "2035-02-11T11:00",
      durationMinutes: 30,
      reason: "Remarcação para horário simultâneo autorizada.",
    });

    expect(firstMeeting.meetingId).toBeTruthy();
    expect(edited).toMatchObject({ revision: 2, startsAt: "2035-02-11T14:00:00.000Z" });
    expect(rescheduled).toMatchObject({ revision: 2, startsAt: "2035-02-11T14:00:00.000Z" });
    expect(await database.meeting.count({
      where: { workspaceId, ownerMemberId: closer1Id, startsAt: new Date("2035-02-11T14:00:00.000Z") },
    })).toBe(3);
  });

  it("permite reabrir e remarcar reuniões em período anterior com sobreposição", async () => {
    clock = new Date("2035-02-20T15:00:00.000Z");
    const occupiedLead = await qualifyLead("CRM15 passado ocupado");
    const reopenedLead = await qualifyLead("CRM15 reabertura passada");
    const rescheduledLead = await qualifyLead("CRM15 remarcação passada");
    await schedule(occupiedLead.leadId, managerContext, "2035-02-20T09:00");
    const closed = await schedule(reopenedLead.leadId, managerContext, "2035-02-20T10:00");
    await meetings().act(managerContext, {
      action: "NO_SHOW",
      meetingId: closed.meetingId,
      expectedRevision: 1,
      reason: "Registro encerrado antes da correção.",
      nextAction: { title: "Revisar reunião encerrada", dueAtLocal: "2035-02-20T13:00" },
    });

    const reopened = await meetings().act(managerContext, {
      action: "EDIT",
      meetingId: closed.meetingId,
      expectedRevision: 2,
      title: "Reunião reaberta no período anterior",
      startsAtLocal: "2035-02-20T09:00",
      durationMinutes: 30,
      status: "SCHEDULED",
      observation: "Horário histórico corrigido.",
      outcome: null,
      reason: "Reabertura para corrigir o histórico da agenda.",
    });
    const scheduled = await schedule(rescheduledLead.leadId, managerContext, "2035-02-20T10:30");
    const rescheduled = await meetings().act(managerContext, {
      action: "RESCHEDULE",
      meetingId: scheduled.meetingId,
      expectedRevision: 1,
      startsAtLocal: "2035-02-20T09:00",
      durationMinutes: 30,
      reason: "Correção para horário anterior já ocupado.",
    });

    expect(reopened).toMatchObject({ status: "SCHEDULED", revision: 3, startsAt: "2035-02-20T12:00:00.000Z" });
    expect(rescheduled).toMatchObject({ status: "SCHEDULED", revision: 2, startsAt: "2035-02-20T12:00:00.000Z" });
    expect(await database.meeting.count({
      where: { workspaceId, ownerMemberId: closer1Id, startsAt: new Date("2035-02-20T12:00:00.000Z") },
    })).toBe(3);
  });

  it("move automaticamente leads da Prospecção Ativa conforme o resultado da reunião", async () => {
    clock = new Date("2035-03-01T15:00:00.000Z");
    const attendedLead = await createActiveProspectingLead("CRM agenda reunião feita");
    const noShowLead = await createActiveProspectingLead("CRM agenda no-show");
    const cancelledLead = await createActiveProspectingLead("CRM agenda cancelada");
    const pipeline = createPreSalesPipelineService({ database, authorization, now: () => clock });
    const screen = await pipeline.getScreen(managerContext, { pipelineId: attendedLead.pipelineId });

    expect(screen.stages.map((stage) => stage.name)).toEqual([
      "Novo lead",
      "Abordagem inicial",
      "Cadência ativa",
      "Conversa iniciada",
      "Reunião marcada",
      "Noshow",
      "Reunião feita",
      "Encerrado — sem retorno",
      "Descartado",
    ]);

    const attended = await schedule(attendedLead.leadId, managerContext, "2035-03-01T09:00");
    const noShow = await schedule(noShowLead.leadId, managerContext, "2035-03-01T09:30");
    const cancelled = await schedule(cancelledLead.leadId, managerContext, "2035-03-01T10:00");
    await meetings().act(managerContext, {
      action: "ATTENDED",
      meetingId: attended.meetingId,
      expectedRevision: 1,
      outcome: "Reunião realizada com sucesso.",
      nextAction: { title: "Dar sequência à reunião", dueAtLocal: "2035-03-01T14:00" },
    });
    await meetings().act(managerContext, {
      action: "NO_SHOW",
      meetingId: noShow.meetingId,
      expectedRevision: 1,
      reason: "Lead não compareceu à reunião.",
      nextAction: { title: "Recuperar o no-show", dueAtLocal: "2035-03-01T14:30" },
    });
    await meetings().act(managerContext, {
      action: "CANCEL",
      meetingId: cancelled.meetingId,
      expectedRevision: 1,
      reason: "Reunião cancelada pelo lead.",
      nextAction: { title: "Retomar reunião cancelada", dueAtLocal: "2035-03-01T15:00" },
    });

    const [attendedStage, noShowStage, cancelledStage] = await Promise.all([
      database.lead.findUniqueOrThrow({ where: { id: attendedLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
      database.lead.findUniqueOrThrow({ where: { id: noShowLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
      database.lead.findUniqueOrThrow({ where: { id: cancelledLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
    ]);
    expect(attendedStage.currentStage.stableKey).toBe("active-prospecting.meeting-completed");
    expect(noShowStage.currentStage.stableKey).toBe("active-prospecting.meeting-no-show");
    expect(cancelledStage.currentStage.stableKey).toBe("active-prospecting.meeting-no-show");

    await meetings().act(managerContext, {
      action: "EDIT",
      meetingId: attended.meetingId,
      expectedRevision: 2,
      title: `Diagnóstico ${attendedLead.leadId.slice(0, 8)}`,
      startsAtLocal: "2035-03-01T09:00",
      durationMinutes: 30,
      status: "NO_SHOW",
      observation: "Resultado corrigido na agenda.",
      outcome: "Lead não compareceu à reunião.",
      reason: "Correção do resultado registrado anteriormente.",
    });
    await expect(database.lead.findUniqueOrThrow({
      where: { id: attendedLead.leadId },
      select: { currentStage: { select: { stableKey: true } } },
    })).resolves.toEqual({ currentStage: { stableKey: "active-prospecting.meeting-no-show" } });

    await meetings().act(managerContext, {
      action: "EDIT",
      meetingId: attended.meetingId,
      expectedRevision: 3,
      title: `Diagnóstico ${attendedLead.leadId.slice(0, 8)}`,
      startsAtLocal: "2035-03-01T09:00",
      durationMinutes: 30,
      status: "SCHEDULED",
      observation: "Reunião reaberta na agenda.",
      outcome: null,
      reason: "Reabertura para um novo registro de resultado.",
    });
    await expect(database.lead.findUniqueOrThrow({
      where: { id: attendedLead.leadId },
      select: { currentStage: { select: { stableKey: true } } },
    })).resolves.toEqual({ currentStage: { stableKey: "active-prospecting.meeting-scheduled" } });
  });

  it("reconcilia resultados históricos de reunião sem sobrescrever uma etapa posterior", async () => {
    clock = new Date("2035-03-02T15:00:00.000Z");
    const service = createMeetingPipelineReconciliationService({ database, now: () => clock });
    await expect(service.run(viewerContext, { mode: "DRY_RUN" })).rejects.toMatchObject({ statusCode: 403 });
    const before = await service.run(adminContext, { mode: "DRY_RUN" });
    const attendedLead = await createActiveProspectingLead("CRM agenda histórica realizada");
    const noShowLead = await createActiveProspectingLead("CRM agenda histórica no-show");
    const cancelledLead = await createActiveProspectingLead("CRM agenda histórica cancelada");
    const protectedLead = await createActiveProspectingLead("CRM agenda histórica protegida");
    const scheduled = await Promise.all([
      schedule(attendedLead.leadId, managerContext, "2035-03-02T09:00"),
      schedule(noShowLead.leadId, managerContext, "2035-03-02T09:30"),
      schedule(cancelledLead.leadId, managerContext, "2035-03-02T10:00"),
      schedule(protectedLead.leadId, managerContext, "2035-03-02T10:30"),
    ]);
    const outcomes = ["COMPLETED", "NO_SHOW", "CANCELLED", "COMPLETED"] as const;
    const outcomeAt = new Date(clock.getTime() + 60_000);
    for (const [index, item] of scheduled.entries()) {
      const meeting = await database.meeting.findUniqueOrThrow({ where: { id: item.meetingId } });
      const status = outcomes[index]!;
      await database.meeting.update({
        where: { id: meeting.id },
        data: {
          status,
          revision: 2,
          completedAt: status === "COMPLETED" ? outcomeAt : null,
          cancelledAt: status === "CANCELLED" ? outcomeAt : null,
          noShowAt: status === "NO_SHOW" ? outcomeAt : null,
          updatedAt: outcomeAt,
        },
      });
      await database.meetingHistory.create({
        data: {
          workspaceId,
          meetingId: meeting.id,
          leadId: meeting.leadId,
          ownerMemberId: meeting.ownerMemberId,
          meetingRevision: 2,
          action: status === "COMPLETED" ? "ATTENDED" : status === "CANCELLED" ? "CANCELLED" : "NO_SHOW",
          previousStatus: "SCHEDULED",
          newStatus: status,
          previousStartsAt: meeting.startsAt,
          previousEndsAt: meeting.endsAt,
          newStartsAt: meeting.startsAt,
          newEndsAt: meeting.endsAt,
          reason: status === "COMPLETED" ? null : "Resultado histórico de teste.",
          outcome: "Resultado histórico de teste.",
          occurredAt: outcomeAt,
          recordedByActorId: managerContext.actorId,
          createdAt: outcomeAt,
        },
      });
    }
    clock = new Date(outcomeAt.getTime() + 60_000);
    const protectedState = await createPreSalesPipelineService({ database, authorization, now: () => clock }).getLeadState(managerContext, { leadId: protectedLead.leadId });
    const noShowStage = await database.pipelineStage.findFirstOrThrow({
      where: { workspaceId, pipelineId: protectedLead.pipelineId, stableKey: "active-prospecting.meeting-no-show", deletedAt: null },
      select: { id: true },
    });
    await createPreSalesPipelineService({ database, authorization, now: () => clock }).transition(managerContext, {
      leadId: protectedLead.leadId,
      targetStageId: noShowStage.id,
      expectedUpdatedAt: protectedState.updatedAt,
      reason: "Decisão manual posterior ao resultado histórico.",
      origin: "PIPELINE_BOARD",
      managerCorrection: true,
      confirmed: true,
    });

    const preview = await service.run(adminContext, { mode: "DRY_RUN" });
    expect(preview).toMatchObject({
      eligibleCount: before.eligibleCount + 3,
      protectedByNewerStageCount: before.protectedByNewerStageCount + 1,
    });
    const applied = await service.run(adminContext, { mode: "APPLY" });
    expect(applied.movedCount).toBe(preview.eligibleCount);
    const reconciled = await Promise.all([
      database.lead.findUniqueOrThrow({ where: { id: attendedLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
      database.lead.findUniqueOrThrow({ where: { id: noShowLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
      database.lead.findUniqueOrThrow({ where: { id: cancelledLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
      database.lead.findUniqueOrThrow({ where: { id: protectedLead.leadId }, select: { currentStage: { select: { stableKey: true } } } }),
    ]);
    expect(reconciled.map((item) => item.currentStage.stableKey)).toEqual([
      "active-prospecting.meeting-completed",
      "active-prospecting.meeting-no-show",
      "active-prospecting.meeting-no-show",
      "active-prospecting.meeting-no-show",
    ]);
    await expect(service.run(adminContext, { mode: "APPLY" })).resolves.toMatchObject({ movedCount: 0 });
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

  it("corrige uma reunião encerrada e mantém tarefa, histórico e métricas coerentes", async () => {
    clock = new Date("2035-02-15T12:00:00.000Z");
    const lead = await qualifyLead("CRM15 correção de reunião");
    const scheduled = await schedule(lead.leadId, managerContext, "2035-02-15T11:00", closer2Id);
    clock = new Date("2035-02-15T15:00:00.000Z");
    await meetings().act(managerContext, {
      action: "ATTENDED",
      meetingId: scheduled.meetingId,
      expectedRevision: 1,
      outcome: "Reunião registrada inicialmente como realizada.",
      nextAction: { title: "Enviar material após reunião", dueAtLocal: "2035-02-15T14:00" },
    });

    clock = new Date("2035-02-15T15:30:00.000Z");
    const corrected = await meetings().act(managerContext, {
      action: "EDIT",
      meetingId: scheduled.meetingId,
      expectedRevision: 2,
      title: "Diagnóstico comercial corrigido",
      startsAtLocal: "2035-02-15T11:00",
      durationMinutes: 40,
      status: "NO_SHOW",
      observation: "Lead avisou depois que não conseguiu entrar.",
      outcome: "Ausência confirmada após revisão do registro.",
      reason: "Correção solicitada pelo responsável da reunião.",
    });

    expect(corrected).toMatchObject({ status: "NO_SHOW", revision: 3 });
    const [meeting, meetingTask, history, activities, completedFacts, noShowFacts, audit] = await Promise.all([
      database.meeting.findUniqueOrThrow({ where: { id: scheduled.meetingId } }),
      database.task.findFirstOrThrow({ where: { workspaceId, meetingId: scheduled.meetingId } }),
      database.meetingHistory.findMany({ where: { workspaceId, meetingId: scheduled.meetingId }, orderBy: { meetingRevision: "asc" } }),
      database.activity.findMany({ where: { workspaceId, meetingId: scheduled.meetingId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
      database.commercialMetricFact.aggregate({ where: { workspaceId, meetingId: scheduled.meetingId, eventType: "MEETING_COMPLETED" }, _sum: { quantity: true } }),
      database.commercialMetricFact.aggregate({ where: { workspaceId, meetingId: scheduled.meetingId, eventType: "MEETING_NO_SHOW" }, _sum: { quantity: true } }),
      database.auditLog.findFirst({ where: { workspaceId, entityId: scheduled.meetingId, action: "meeting.corrected" } }),
    ]);
    expect(meeting).toMatchObject({
      title: "Diagnóstico comercial corrigido",
      status: "NO_SHOW",
      durationMinutes: 40,
      observation: "Lead avisou depois que não conseguiu entrar.",
      outcome: "Ausência confirmada após revisão do registro.",
      completedAt: null,
      cancelledAt: null,
      noShowAt: clock,
    });
    expect(meetingTask).toMatchObject({ status: "CANCELLED", completedAt: null });
    expect(history.map((item) => item.action)).toEqual(["SCHEDULED", "ATTENDED", "NO_SHOW"]);
    expect(history[2]).toMatchObject({ previousStatus: "COMPLETED", newStatus: "NO_SHOW", reason: "Correção solicitada pelo responsável da reunião." });
    expect(activities.at(-1)).toMatchObject({ result: "CORRECTED", correctsActivityId: activities.at(-2)?.id });
    expect(completedFacts._sum.quantity).toBe(0);
    expect(noShowFacts._sum.quantity).toBe(1);
    expect(audit).not.toBeNull();
    await expect(meetings().act(managerContext, {
      action: "EDIT",
      meetingId: scheduled.meetingId,
      expectedRevision: 2,
      title: meeting.title,
      startsAtLocal: "2035-02-15T11:00",
      durationMinutes: 40,
      status: "COMPLETED",
      observation: meeting.observation,
      outcome: meeting.outcome,
      reason: "Tentativa com uma revisão já superada.",
    })).rejects.toMatchObject({ code: "MEETING_VERSION_CONFLICT" });
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
    await expect(meetings().act(viewerContext, {
      action: "EDIT",
      meetingId: scheduled.meetingId,
      expectedRevision: 1,
      title: "Alteração não autorizada",
      startsAtLocal: "2035-02-17T09:00",
      durationMinutes: 30,
      status: "SCHEDULED",
      observation: null,
      outcome: null,
      reason: "Tentativa sem permissão de escrita.",
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

  it("permite que Carlos Henrique agende para outro closer sem ampliar outros vendedores", async () => {
    clock = new Date("2035-02-17T16:00:00.000Z");
    const lead = await qualifyLead("CRM15 agenda Carlos Henrique");
    const role = await database.role.findFirstOrThrow({ where: { workspaceId, key: "closer", deletedAt: null } });
    const user = await database.user.create({
      data: {
        email: "carloshenrique@politizai.com",
        normalizedEmail: "carloshenrique@politizai.com",
        displayName: "Carlos Henrique",
      },
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
    await database.actor.create({
      data: { workspaceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: user.displayName },
    });
    await database.lead.update({ where: { id: lead.leadId }, data: { ownerMemberId: member.id } });
    const carlos = await humanContext("carloshenrique@politizai.com");

    const agenda = await meetings().getLeadMeetings(carlos, { leadId: lead.leadId });
    expect(agenda.closerOptions.map((closer) => closer.id)).toEqual(expect.arrayContaining([closer1Id, closer2Id]));
    await expect(schedule(lead.leadId, carlos, "2035-02-18T10:30", closer2Id)).resolves.toMatchObject({
      meetingId: expect.any(String),
    });
  });

  it("pesquisa leads da agenda sem escapar do escopo autorizado", async () => {
    const visible = await qualifyLead(`CRM15 busca agenda ${randomUUID().slice(0, 8)}`);
    const hidden = await qualifyLead(`CRM15 busca oculta ${randomUUID().slice(0, 8)}`);
    const closer = await contextByMember(closer1Id);
    await database.lead.update({ where: { id: visible.leadId }, data: { ownerMemberId: closer1Id } });
    await database.lead.update({ where: { id: hidden.leadId }, data: { ownerMemberId: closer2Id } });

    const results = await meetings().searchLeadOptions(closer, { query: "CRM15 busca" });
    expect(results.map((lead) => lead.id)).toContain(visible.leadId);
    expect(results.map((lead) => lead.id)).not.toContain(hidden.leadId);
    const visiblePhone = (await database.lead.findUniqueOrThrow({ where: { id: visible.leadId }, select: { normalizedPhone: true } })).normalizedPhone!;
    const hiddenPhone = (await database.lead.findUniqueOrThrow({ where: { id: hidden.leadId }, select: { normalizedPhone: true } })).normalizedPhone!;
    const byPhone = await meetings().searchLeadOptions(closer, { query: visiblePhone.slice(-8) });
    expect(byPhone.find((lead) => lead.id === visible.leadId)?.phone).toBe(visiblePhone);
    const hiddenByPhone = await meetings().searchLeadOptions(closer, { query: hiddenPhone.slice(-8) });
    expect(hiddenByPhone.map((lead) => lead.id)).not.toContain(hidden.leadId);
    await expect(meetings().searchLeadOptions(closer, { query: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
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

  it("enfileira sincronização Google ao agendar para um closer conectado", async () => {
    clock = new Date("2035-02-21T15:00:00.000Z");
    const encryptionKey = "integration-google-calendar-push-key-2035";
    const previous = {
      clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      encryptionKey: process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY,
      canonicalUrl: process.env.APP_CANONICAL_URL,
    };
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "integration-client-id-for-google-calendar";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "integration-client-secret-for-google-calendar";
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = encryptionKey;
    process.env.APP_CANONICAL_URL = "https://crm.example.test";
    const lead = await qualifyLead("CRM15 Google conectado");
    const account = await database.googleCalendarAccount.create({
      data: {
        workspaceId,
        memberId: closer1Id,
        googleSubject: `test-${randomUUID()}`,
        googleEmail: "closer@example.test",
        accessTokenCiphertext: encryptGoogleCalendarSecret("token-de-teste", encryptionKey),
        refreshTokenCiphertext: encryptGoogleCalendarSecret("refresh-de-teste", encryptionKey),
        tokenExpiresAt: new Date("2036-03-01T00:00:00.000Z"),
        grantedScopes: ["https://www.googleapis.com/auth/calendar.events"],
        status: "CONNECTED",
        createdByActorId: managerContext.actorId,
        updatedByActorId: managerContext.actorId,
      },
    });
    const result = await meetings().schedule(managerContext, {
      leadId: lead.leadId,
      closerId: closer1Id,
      title: "Reunião Google com participante",
      startsAtLocal: "2035-02-22T10:00",
      durationMinutes: 30,
      participantEmails: ["participante-google@example.test", "segundo-google@example.test"],
    });
    const [link, job] = await Promise.all([
      database.googleCalendarEventLink.findFirst({ where: { workspaceId, meetingId: result.meetingId } }),
      database.job.findFirst({ where: { workspaceId, idempotencyKey: `google-calendar:${result.meetingId}:r1` } }),
    ]);
    expect(link).toMatchObject({ memberId: closer1Id, syncState: "PENDING_PUSH" });
    expect(job).toMatchObject({ type: "GOOGLE_CALENDAR_SYNC", status: "PENDING" });
    try {
      const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        expect(url.searchParams.get("sendUpdates")).toBe("all");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as { attendees?: unknown };
        expect(body.attendees).toEqual([{ email: "participante-google@example.test" }, { email: "segundo-google@example.test" }]);
        return new Response(JSON.stringify({
          id: link!.externalEventId,
          etag: '"google-push-v1"',
          htmlLink: "https://calendar.google.com/calendar/event?eid=linked",
          attendees: [{ email: "participante-google@example.test", responseStatus: "needsAction" }],
          conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/test-link" }] },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      const worker = createGoogleCalendarWorkerService({ database, now: () => clock, fetcher });
      await expect(worker.processNext("google-push-participant-test")).resolves.toMatchObject({ status: "SUCCEEDED" });
      await expect(database.googleCalendarEventLink.findUniqueOrThrow({ where: { id: link!.id } })).resolves.toMatchObject({
        syncState: "SYNCED",
        conferenceUrl: "https://meet.google.com/test-link",
      });
      await expect(database.meeting.findUniqueOrThrow({ where: { id: result.meetingId } })).resolves.toMatchObject({
        participantResponseStatus: "NEEDS_ACTION",
      });
      expect(account.id).toBeTruthy();
    } finally {
      if (previous.clientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID; else process.env.GOOGLE_CALENDAR_CLIENT_ID = previous.clientId;
      if (previous.clientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET; else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = previous.clientSecret;
      if (previous.encryptionKey === undefined) delete process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = previous.encryptionKey;
      if (previous.canonicalUrl === undefined) delete process.env.APP_CANONICAL_URL; else process.env.APP_CANONICAL_URL = previous.canonicalUrl;
    }
  });

  it("importa eventos do Google para a Agenda e aplica exclusões incrementais", async () => {
    clock = new Date("2035-02-23T12:00:00.000Z");
    const encryptionKey = "integration-google-calendar-encryption-key-2035";
    const previous = {
      clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      encryptionKey: process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY,
      canonicalUrl: process.env.APP_CANONICAL_URL,
    };
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "integration-client-id-for-google-calendar";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "integration-client-secret-for-google-calendar";
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = encryptionKey;
    process.env.APP_CANONICAL_URL = "https://crm.example.test";

    try {
      await database.job.updateMany({
        where: { type: "GOOGLE_CALENDAR_SYNC", status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "SUCCEEDED", finishedAt: clock, lockedAt: null, lockedBy: null, lockExpiresAt: null },
      });
      await database.googleCalendarAccount.updateMany({
        where: { status: "CONNECTED" },
        data: { nextPullAt: new Date("2040-01-01T00:00:00.000Z") },
      });
      const account = await database.googleCalendarAccount.create({
        data: {
          workspaceId,
          memberId: closer2Id,
          googleSubject: `pull-test-${randomUUID()}`,
          googleEmail: "closer2@example.test",
          accessTokenCiphertext: encryptGoogleCalendarSecret("access-token", encryptionKey),
          refreshTokenCiphertext: encryptGoogleCalendarSecret("refresh-token", encryptionKey),
          tokenExpiresAt: new Date("2036-01-01T00:00:00.000Z"),
          grantedScopes: ["https://www.googleapis.com/auth/calendar.events"],
          status: "CONNECTED",
          pullEnabled: false,
          nextPullAt: clock,
          createdByActorId: managerContext.actorId,
          updatedByActorId: managerContext.actorId,
        },
      });
      let request = 0;
      const fetcher = async (input: string | URL | Request) => {
        request += 1;
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (request === 1) {
          expect(url.searchParams.get("syncToken")).toBeNull();
          return new Response(JSON.stringify({
            nextSyncToken: "sync-token-1",
            items: [
              {
                id: "external-public-event",
                etag: '"public-v1"',
                status: "confirmed",
                summary: "Evento criado no Google",
                start: { dateTime: "2035-02-23T10:00:00-03:00", timeZone: "America/Sao_Paulo" },
                end: { dateTime: "2035-02-23T11:00:00-03:00", timeZone: "America/Sao_Paulo" },
                creator: { displayName: "Pessoa externa", email: "externa@example.test" },
                htmlLink: "https://calendar.google.com/calendar/event?eid=public",
              },
              {
                id: "external-private-event",
                etag: '"private-v1"',
                status: "confirmed",
                visibility: "private",
                summary: "Assunto particular",
                start: { dateTime: "2035-02-23T12:00:00-03:00", timeZone: "America/Sao_Paulo" },
                end: { dateTime: "2035-02-23T12:30:00-03:00", timeZone: "America/Sao_Paulo" },
              },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        expect(url.searchParams.get("syncToken")).toBe("sync-token-1");
        return new Response(JSON.stringify({
          nextSyncToken: "sync-token-2",
          items: [{ id: "external-public-event", etag: '"public-v2"', status: "cancelled" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      const worker = createGoogleCalendarWorkerService({ database, now: () => clock, fetcher, pullIntervalSeconds: 60 });

      await expect(worker.processNext("google-pull-disabled-test")).resolves.toMatchObject({ status: "IDLE" });
      expect(request).toBe(0);
      await database.googleCalendarAccount.update({ where: { id: account.id }, data: { pullEnabled: true } });
      await expect(worker.processNext("google-pull-test")).resolves.toMatchObject({ status: "PULLED" });
      const agenda = await meetings().getAgenda(adminContext, { view: "day", date: "2035-02-23" });
      expect(agenda.externalEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "Evento criado no Google", scheduledByName: "Pessoa externa" }),
        expect.objectContaining({ title: "Compromisso privado", private: true, externalHtmlLink: null }),
      ]));
      expect(await database.googleCalendarImportedEvent.count({ where: { workspaceId, accountId: account.id, deletedAt: null } })).toBe(2);

      clock = new Date(clock.getTime() + 61_000);
      await expect(worker.processNext("google-pull-test")).resolves.toMatchObject({ status: "PULLED" });
      expect(await database.googleCalendarImportedEvent.findFirstOrThrow({
        where: { workspaceId, accountId: account.id, externalEventId: "external-public-event" },
        select: { deletedAt: true },
      })).toMatchObject({ deletedAt: expect.any(Date) });
    } finally {
      if (previous.clientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID; else process.env.GOOGLE_CALENDAR_CLIENT_ID = previous.clientId;
      if (previous.clientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET; else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = previous.clientSecret;
      if (previous.encryptionKey === undefined) delete process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = previous.encryptionKey;
      if (previous.canonicalUrl === undefined) delete process.env.APP_CANONICAL_URL; else process.env.APP_CANONICAL_URL = previous.canonicalUrl;
    }
  });

  it("aplica no CRM uma alteração feita no Google em reunião vinculada", async () => {
    clock = new Date("2035-02-23T15:00:00.000Z");
    const encryptionKey = "integration-google-calendar-linked-key-2035";
    const previous = {
      clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      encryptionKey: process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY,
      canonicalUrl: process.env.APP_CANONICAL_URL,
    };
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "integration-client-id-for-google-calendar";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "integration-client-secret-for-google-calendar";
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = encryptionKey;
    process.env.APP_CANONICAL_URL = "https://crm.example.test";

    try {
      const link = await database.googleCalendarEventLink.findFirstOrThrow({
        where: { workspaceId, account: { googleEmail: "closer@example.test" } },
        include: { account: true, meeting: true },
      });
      await database.job.updateMany({
        where: { type: "GOOGLE_CALENDAR_SYNC", status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "SUCCEEDED", finishedAt: clock, lockedAt: null, lockedBy: null, lockExpiresAt: null },
      });
      await database.googleCalendarAccount.updateMany({
        where: { status: "CONNECTED" },
        data: { nextPullAt: new Date("2040-01-01T00:00:00.000Z") },
      });
      await database.googleCalendarAccount.update({
        where: { id: link.accountId },
        data: {
          accessTokenCiphertext: encryptGoogleCalendarSecret("linked-access-token", encryptionKey),
          refreshTokenCiphertext: encryptGoogleCalendarSecret("linked-refresh-token", encryptionKey),
          tokenExpiresAt: new Date("2036-01-01T00:00:00.000Z"),
          pullSyncTokenCiphertext: encryptGoogleCalendarSecret("linked-sync-token", encryptionKey),
          pullPageTokenCiphertext: null,
          nextPullAt: clock,
        },
      });
      const fetcher = async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        expect(url.searchParams.get("syncToken")).toBe("linked-sync-token");
        return new Response(JSON.stringify({
          nextSyncToken: "linked-sync-token-2",
          items: [{
            id: link.externalEventId,
            etag: '"linked-v2"',
            status: "confirmed",
            summary: "Título alterado no Google",
            attendees: [{ email: "participante-google@example.test", responseStatus: "accepted" }, { email: "segundo-google@example.test", responseStatus: "declined" }],
            start: { dateTime: "2035-02-24T14:00:00-03:00", timeZone: "America/Sao_Paulo" },
            end: { dateTime: "2035-02-24T14:30:00-03:00", timeZone: "America/Sao_Paulo" },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };

      const worker = createGoogleCalendarWorkerService({ database, now: () => clock, fetcher, pullIntervalSeconds: 60 });
      await expect(worker.processNext("google-linked-pull-test")).resolves.toMatchObject({ status: "PULLED" });
      const updated = await database.meeting.findUniqueOrThrow({ where: { id: link.meetingId } });
      expect(updated).toMatchObject({
        title: "Título alterado no Google",
        revision: link.meeting.revision + 1,
        participantEmail: "participante-google@example.test",
        participantResponseStatus: "ACCEPTED",
        participantResponseUpdatedAt: expect.any(Date),
      });
      expect(updated.startsAt.toISOString()).toBe("2035-02-24T17:00:00.000Z");
      expect(await database.meetingParticipant.findMany({ where: { workspaceId, meetingId: updated.id }, orderBy: { position: "asc" } }))
        .toMatchObject([{ email: "participante-google@example.test", responseStatus: "ACCEPTED" }, { email: "segundo-google@example.test", responseStatus: "DECLINED" }]);
      expect(await database.googleCalendarEventLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({
        externalEtag: '"linked-v2"',
        lastPulledAt: expect.any(Date),
        syncState: "PENDING_PUSH",
      });
    } finally {
      if (previous.clientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID; else process.env.GOOGLE_CALENDAR_CLIENT_ID = previous.clientId;
      if (previous.clientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET; else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = previous.clientSecret;
      if (previous.encryptionKey === undefined) delete process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = previous.encryptionKey;
      if (previous.canonicalUrl === undefined) delete process.env.APP_CANONICAL_URL; else process.env.APP_CANONICAL_URL = previous.canonicalUrl;
    }
  });
});
