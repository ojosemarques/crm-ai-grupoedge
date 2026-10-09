import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for metrics tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const authorization = createAuthorizationService({ database });
const period = {
  from: "2042-01-01T00:00:00.000Z",
  to: "2042-01-11T00:00:00.000Z",
};
const now = new Date(period.to);
let workspaceId: string;
let sourceId: string;
let manager: AuthenticatedContext;
let admin: AuthenticatedContext;
let sdr1: AuthenticatedContext;
let sdr2: AuthenticatedContext;
let viewer: AuthenticatedContext;
let denied: AuthenticatedContext;

function at(value: string): Date {
  return new Date(`2042-01-${value}:00.000Z`);
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

async function createLeadScenario(input: Readonly<{
  label: string;
  receivedAt: Date;
  priority: "P1" | "P2" | "P3";
  automaticSeconds: number;
  attemptSeconds: number | null;
  connectedSeconds: number | null;
  sourceId?: string;
}>) {
  const pipeline = await database.pipeline.findFirstOrThrow({
    where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null },
  });
  const [stage, band, queue, systemActor] = await Promise.all([
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: pipeline.id, leadStageCode: "NEW", deletedAt: null } }),
    database.leadPriorityBand.findFirstOrThrow({ where: { workspaceId, code: input.priority, active: true, deletedAt: null } }),
    database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } }),
    database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } }),
  ]);
  const scenarioSourceId = input.sourceId ?? sourceId;
  const phoneSuffix = (
    BigInt(`0x${createHash("sha256").update(`${scenarioSourceId}:${input.label}`).digest("hex").slice(0, 12)}`)
      % 90_000_000n
      + 10_000_000n
  ).toString();
  return database.$transaction(async (transaction) => {
    const lead = await transaction.lead.create({
      data: {
        workspaceId,
        sourceId: scenarioSourceId,
        latestSourceId: scenarioSourceId,
        pipelineId: pipeline.id,
        currentStageId: stage.id,
        ownerMemberId: sdr1.memberId,
        routingQueueId: queue.id,
        fullName: `Métrica ${input.label}`,
        normalizedPhone: `+55119${phoneSuffix}`,
        status: "OPEN",
        priority: band.leadPriority,
        slaStartedAt: input.receivedAt,
        slaDueAt: input.receivedAt,
        lastActivityAt: input.receivedAt,
        latestSubmissionAt: input.receivedAt,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
        createdAt: input.receivedAt,
        updatedAt: input.receivedAt,
      },
    });
    const submission = await transaction.leadFormSubmission.create({
      data: {
        workspaceId,
        leadId: lead.id,
        sourceId: scenarioSourceId,
        status: "LINKED",
        channel: "MANUAL",
        intakeOutcome: "CREATED",
        idempotencyKey: `crm19:${input.label}:${randomUUID()}`,
        submittedFullName: lead.fullName,
        submittedPhone: lead.normalizedPhone,
        normalizedPhone: lead.normalizedPhone,
        submittedAt: input.receivedAt,
        rawPayload: { test: "crm19", label: input.label },
        createdByActorId: systemActor.id,
        createdAt: input.receivedAt,
      },
    });
    const attemptAt = input.attemptSeconds === null
      ? null
      : new Date(input.receivedAt.getTime() + input.attemptSeconds * 1_000);
    const connectedAt = input.connectedSeconds === null
      ? null
      : new Date(input.receivedAt.getTime() + input.connectedSeconds * 1_000);
    const cycle = await transaction.leadSlaCycle.create({
      data: {
        workspaceId,
        leadId: lead.id,
        submissionId: submission.id,
        priorityBandId: band.id,
        assignedMemberId: sdr1.memberId,
        receivedAt: input.receivedAt,
        assignedAt: input.receivedAt,
        automaticAcknowledgedAt: new Date(input.receivedAt.getTime() + input.automaticSeconds * 1_000),
        firstHumanAttemptAt: attemptAt,
        firstHumanAttemptSeconds: input.attemptSeconds,
        firstConnectedAt: connectedAt,
        firstResponseTimeSeconds: input.connectedSeconds,
        createdByActorId: systemActor.id,
        createdAt: input.receivedAt,
      },
    });
    const task = await transaction.task.create({
      data: {
        workspaceId,
        leadId: lead.id,
        slaCycleId: cycle.id,
        assigneeMemberId: sdr1.memberId,
        title: "Ligar agora",
        kind: "IMMEDIATE_CALL",
        status: attemptAt ? "COMPLETED" : "OPEN",
        priority: band.leadPriority,
        dueAt: input.receivedAt,
        completedAt: attemptAt,
        result: attemptAt ? "Tentativa registrada." : null,
        createdByActorId: systemActor.id,
        updatedByActorId: attemptAt ? sdr1.actorId : systemActor.id,
        createdAt: input.receivedAt,
        updatedAt: attemptAt ?? input.receivedAt,
      },
    });
    await transaction.lead.update({
      where: { id: lead.id },
      data: attemptAt
        ? { lastActivityAt: attemptAt, updatedByActorId: sdr1.actorId, updatedAt: attemptAt }
        : {
            nextActionTaskId: task.id,
            nextActionAt: task.dueAt,
            nextActionDescription: task.title,
            updatedAt: input.receivedAt,
          },
    });
    await transaction.stageHistory.create({
      data: {
        workspaceId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        leadId: lead.id,
        enteredAt: input.receivedAt,
        enteredByActorId: systemActor.id,
        transitionOrigin: "INTAKE",
        createdAt: input.receivedAt,
      },
    });
    return { leadId: lead.id, taskId: task.id, stageId: stage.id, pipelineId: pipeline.id };
  });
}

async function qualifyLead(lead: Awaited<ReturnType<typeof createLeadScenario>>, qualifiedAt: Date) {
  const [qualifiedStage, openHistory] = await Promise.all([
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: lead.pipelineId, leadStageCode: "QUALIFIED", deletedAt: null } }),
    database.stageHistory.findFirstOrThrow({ where: { workspaceId, leadId: lead.leadId, exitedAt: null } }),
  ]);
  await database.$transaction(async (transaction) => {
    await transaction.stageHistory.update({
      where: { id: openHistory.id },
      data: { exitedAt: qualifiedAt, exitedByActorId: sdr1.actorId },
    });
    await transaction.stageHistory.create({
      data: {
        workspaceId,
        pipelineId: lead.pipelineId,
        stageId: qualifiedStage.id,
        leadId: lead.leadId,
        enteredAt: qualifiedAt,
        enteredByActorId: sdr1.actorId,
        transitionOrigin: "LEAD_CARD",
        transitionReason: "Qualificação conhecida do cenário CRM-19.",
        createdAt: qualifiedAt,
      },
    });
    await transaction.lead.update({
      where: { id: lead.leadId },
      data: {
        currentStageId: qualifiedStage.id,
        status: "QUALIFIED",
        updatedByActorId: sdr1.actorId,
        updatedAt: qualifiedAt,
      },
    });
  });
}

async function addMeeting(input: Readonly<{
  leadId: string;
  startsAt: Date;
  status: "COMPLETED" | "NO_SHOW" | "CANCELLED";
  ownerMemberId?: string;
}>) {
  const closer = input.ownerMemberId ?? (await humanContext("closer1@demo.politizai.local")).memberId;
  const scheduledAt = new Date(input.startsAt.getTime() - 2 * 86_400_000);
  const finalAt = new Date(input.startsAt.getTime() + 1_800_000);
  const meeting = await database.meeting.create({
    data: {
      workspaceId,
      leadId: input.leadId,
      ownerMemberId: closer,
      title: `Reunião ${input.status}`,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 1_800_000),
      durationMinutes: 30,
      timeZone: "America/Sao_Paulo",
      cancelledAt: input.status === "CANCELLED" ? finalAt : null,
      completedAt: input.status === "COMPLETED" ? finalAt : null,
      noShowAt: input.status === "NO_SHOW" ? finalAt : null,
      outcome: input.status === "COMPLETED" ? "Reunião realizada." : null,
      revision: 2,
      createdByActorId: manager.actorId,
      updatedByActorId: manager.actorId,
      createdAt: scheduledAt,
      updatedAt: finalAt,
    },
  });
  await database.meetingHistory.createMany({
    data: [
      {
        workspaceId,
        meetingId: meeting.id,
        leadId: input.leadId,
        ownerMemberId: closer,
        meetingRevision: 1,
        action: "SCHEDULED",
        newStatus: "SCHEDULED",
        newStartsAt: input.startsAt,
        newEndsAt: meeting.endsAt,
        occurredAt: scheduledAt,
        recordedByActorId: manager.actorId,
        createdAt: scheduledAt,
      },
      {
        workspaceId,
        meetingId: meeting.id,
        leadId: input.leadId,
        ownerMemberId: closer,
        meetingRevision: 2,
        action: input.status === "COMPLETED" ? "ATTENDED" : input.status,
        previousStatus: "SCHEDULED",
        newStatus: input.status,
        previousStartsAt: input.startsAt,
        previousEndsAt: meeting.endsAt,
        newStartsAt: input.startsAt,
        newEndsAt: meeting.endsAt,
        occurredAt: finalAt,
        recordedByActorId: manager.actorId,
        createdAt: finalAt,
      },
    ],
  });
  return meeting;
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database);
  workspaceId = seeded.workspaceId;
  [manager, admin, sdr1, sdr2, viewer] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("admin@demo.politizai.local"),
    humanContext("sdr1@demo.politizai.local"),
    humanContext("sdr2@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
  ]);
  const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
  const source = await database.leadSource.create({
    data: {
      workspaceId,
      key: `crm19-${randomUUID()}`,
      name: "Fonte isolada CRM-19",
      type: "MANUAL",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  sourceId = source.id;

  const leadA = await createLeadScenario({ label: "A", receivedAt: at("02T12:00"), priority: "P1", automaticSeconds: 2, attemptSeconds: 30, connectedSeconds: 50 });
  const leadB = await createLeadScenario({ label: "B", receivedAt: at("03T12:00"), priority: "P2", automaticSeconds: 70, attemptSeconds: 120, connectedSeconds: 180 });
  const leadC = await createLeadScenario({ label: "C", receivedAt: at("04T12:00"), priority: "P3", automaticSeconds: 200, attemptSeconds: null, connectedSeconds: null });
  await qualifyLead(leadA, at("03T00:00"));
  await qualifyLead(leadB, at("05T00:00"));
  const [disqualifiedStage, disqualificationReason, leadCOpenHistory] = await Promise.all([
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: leadC.pipelineId, leadStageCode: "DISQUALIFIED", deletedAt: null } }),
    database.disqualificationReason.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
    database.stageHistory.findFirstOrThrow({ where: { workspaceId, leadId: leadC.leadId, exitedAt: null } }),
  ]);
  await database.$transaction(async (transaction) => {
    await transaction.stageHistory.update({
      where: { id: leadCOpenHistory.id },
      data: { exitedAt: at("05T06:00"), exitedByActorId: sdr1.actorId },
    });
    await transaction.stageHistory.create({
      data: {
        workspaceId,
        pipelineId: leadC.pipelineId,
        stageId: disqualifiedStage.id,
        leadId: leadC.leadId,
        enteredAt: at("05T06:00"),
        enteredByActorId: sdr1.actorId,
        transitionOrigin: "LEAD_CARD",
        transitionReason: "Desqualificação conhecida do cenário DESIGN-05.",
        createdAt: at("05T06:00"),
      },
    });
    await transaction.lead.update({
      where: { id: leadC.leadId },
      data: {
        currentStageId: disqualifiedStage.id,
        disqualificationReasonId: disqualificationReason.id,
        status: "DISQUALIFIED",
        updatedByActorId: sdr1.actorId,
        updatedAt: at("05T06:00"),
      },
    });
  });
  await database.task.create({
    data: {
      workspaceId,
      leadId: leadA.leadId,
      assigneeMemberId: sdr1.memberId,
      title: "Acompanhar oportunidade",
      kind: "FOLLOW_UP",
      status: "OPEN",
      priority: "HIGH",
      dueAt: at("12T12:00"),
      createdByActorId: sdr1.actorId,
      updatedByActorId: sdr1.actorId,
      createdAt: at("03T00:00"),
      updatedAt: at("03T00:00"),
    },
  });
  await database.activity.createMany({
    data: [
      {
        workspaceId,
        leadId: leadA.leadId,
        type: "CALL",
        direction: "OUTBOUND",
        result: "CONNECTED",
        subject: "Contato recente",
        occurredAt: at("10T12:00"),
        createdByActorId: sdr1.actorId,
        updatedByActorId: sdr1.actorId,
        createdAt: at("10T12:00"),
        updatedAt: at("10T12:00"),
      },
      {
        workspaceId,
        leadId: leadB.leadId,
        type: "CALL",
        direction: "OUTBOUND",
        result: "CONNECTED",
        subject: "Contato antigo",
        occurredAt: at("04T00:00"),
        createdByActorId: sdr1.actorId,
        updatedByActorId: sdr1.actorId,
        createdAt: at("04T00:00"),
        updatedAt: at("04T00:00"),
      },
    ],
  });

  const heldMeeting = await addMeeting({ leadId: leadA.leadId, startsAt: at("06T12:00"), status: "COMPLETED" });
  await addMeeting({ leadId: leadB.leadId, startsAt: at("07T12:00"), status: "NO_SHOW" });
  await addMeeting({ leadId: leadC.leadId, startsAt: at("08T12:00"), status: "CANCELLED" });

  const [pipeline, proposalStage, wonStage, lostStage, product, lossReason, closer] = await Promise.all([
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null } }),
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "PROPOSAL", deletedAt: null } }),
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "WON", deletedAt: null } }),
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "LOST", deletedAt: null } }),
    database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
    database.lossReason.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
    humanContext("closer1@demo.politizai.local"),
  ]);
  const wonAt = at("09T12:00");
  const opportunity = await database.opportunity.create({
    data: {
      workspaceId,
      leadId: leadA.leadId,
      pipelineId: pipeline.id,
      currentStageId: wonStage.id,
      ownerMemberId: closer.memberId,
      productId: product.id,
      name: "Venda conhecida CRM-19",
      status: "WON",
      amountCents: 100_000n,
      mrrCents: 10_000n,
      tcvCents: 120_000n,
      probabilityBps: 10_000,
      closedAt: wonAt,
      createdByActorId: closer.actorId,
      updatedByActorId: closer.actorId,
      createdAt: at("06T12:30"),
      updatedAt: wonAt,
    },
  });
  await database.meeting.update({ where: { id: heldMeeting.id }, data: { opportunityId: opportunity.id } });
  await database.stageHistory.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: proposalStage.id,
      opportunityId: opportunity.id,
      enteredAt: at("07T12:00"),
      exitedAt: wonAt,
      enteredByActorId: closer.actorId,
      exitedByActorId: closer.actorId,
      transitionOrigin: "OPPORTUNITY_CARD",
      transitionReason: "Proposta conhecida do cenário DESIGN-05.",
      createdAt: at("07T12:00"),
    },
  });
  const history = await database.stageHistory.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: wonStage.id,
      opportunityId: opportunity.id,
      enteredAt: wonAt,
      enteredByActorId: closer.actorId,
      transitionOrigin: "OPPORTUNITY_CARD",
      transitionReason: "Ganho conhecido do cenário CRM-19.",
      createdAt: wonAt,
    },
  });
  await database.opportunityOutcomeSnapshot.create({
    data: {
      workspaceId,
      opportunityId: opportunity.id,
      leadId: leadA.leadId,
      stageHistoryId: history.id,
      ownerMemberId: closer.memberId,
      productId: product.id,
      status: "WON",
      amountCents: 100_000n,
      mrrCents: 10_000n,
      tcvCents: 120_000n,
      occurredAt: wonAt,
      createdByActorId: closer.actorId,
      createdAt: wonAt,
    },
  });
  const lostAt = at("08T12:00");
  const lostOpportunity = await database.opportunity.create({
    data: {
      workspaceId,
      leadId: leadB.leadId,
      pipelineId: pipeline.id,
      currentStageId: lostStage.id,
      ownerMemberId: closer.memberId,
      productId: product.id,
      name: "Perda conhecida DESIGN-05",
      status: "LOST",
      lossReasonId: lossReason.id,
      amountCents: 80_000n,
      mrrCents: 8_000n,
      tcvCents: 96_000n,
      probabilityBps: 0,
      closedAt: lostAt,
      outcomeReasonCode: "CENARIO_TESTE",
      createdByActorId: closer.actorId,
      updatedByActorId: closer.actorId,
      createdAt: at("06T13:00"),
      updatedAt: lostAt,
    },
  });
  const lostHistory = await database.stageHistory.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      stageId: lostStage.id,
      opportunityId: lostOpportunity.id,
      enteredAt: lostAt,
      enteredByActorId: closer.actorId,
      transitionOrigin: "OPPORTUNITY_CARD",
      transitionReason: "Perda conhecida do cenário DESIGN-05.",
      createdAt: lostAt,
    },
  });
  await database.opportunityOutcomeSnapshot.create({
    data: {
      workspaceId,
      opportunityId: lostOpportunity.id,
      leadId: leadB.leadId,
      stageHistoryId: lostHistory.id,
      ownerMemberId: closer.memberId,
      productId: product.id,
      status: "LOST",
      lossReasonId: lossReason.id,
      amountCents: 80_000n,
      mrrCents: 8_000n,
      tcvCents: 96_000n,
      occurredAt: lostAt,
      createdByActorId: closer.actorId,
      createdAt: lostAt,
    },
  });

  const deniedWorkspace = await database.workspace.create({
    data: { slug: `metrics-denied-${randomUUID()}`, name: "Workspace sem permissão" },
  });
  const deniedSystem = await database.actor.create({
    data: { workspaceId: deniedWorkspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  const deniedEmail = `denied-${randomUUID()}@local.test`;
  const user = await database.user.create({
    data: { email: deniedEmail, normalizedEmail: deniedEmail, displayName: "Sem métricas" },
  });
  const role = await database.role.create({
    data: { workspaceId: deniedWorkspace.id, key: "denied", name: "Sem métricas", createdByActorId: deniedSystem.id, updatedByActorId: deniedSystem.id },
  });
  const member = await database.workspaceMember.create({
    data: { workspaceId: deniedWorkspace.id, userId: user.id, roleId: role.id, status: "ACTIVE", joinedAt: now, createdByActorId: deniedSystem.id, updatedByActorId: deniedSystem.id },
  });
  const actor = await database.actor.create({
    data: { workspaceId: deniedWorkspace.id, type: "HUMAN", key: "denied", displayName: "Sem métricas", userId: user.id },
  });
  denied = Object.freeze({
    sessionId: randomUUID(), workspaceId: deniedWorkspace.id, workspaceSlug: deniedWorkspace.slug, userId: user.id,
    memberId: member.id, actorId: actor.id, roleId: role.id, roleKey: role.key,
    roleName: role.name, displayName: user.displayName,
  });
});

afterAll(async () => {
  if (workspaceId && sourceId) {
    await database.meeting.updateMany({
      where: { workspaceId, lead: { sourceId } },
      data: { deletedAt: now, updatedAt: now },
    });
    await database.opportunity.updateMany({
      where: { workspaceId, lead: { sourceId } },
      data: { deletedAt: now, updatedAt: now },
    });
    await database.lead.updateMany({
      where: { workspaceId, sourceId },
      data: { deletedAt: now, updatedAt: now },
    });
    await database.leadSource.update({
      where: { id: sourceId },
      data: { deletedAt: now, updatedAt: now },
    });
  }
  await database.$disconnect();
});

function metrics(context: AuthenticatedContext = manager) {
  return createMetricsService({ database, authorization, now: () => now }).getOverview(context, {
    ...period,
    filters: { sourceIds: [sourceId] },
  });
}

function dashboard(context: AuthenticatedContext = manager, input: Record<string, unknown> = {}) {
  return createDashboardMetricsService({ database, authorization, now: () => now }).getScreen(context, {
    preset: "CUSTOM",
    fromDate: "2042-01-01",
    toDate: "2042-01-10",
    source: [sourceId],
    ...input,
  });
}

describe("camada confiável de métricas", () => {
  it("mantém vendedor legado sem equipe visível nos filtros e no desempenho", async () => {
    const [role, systemActor] = await Promise.all([
      database.role.findFirstOrThrow({ where: { workspaceId, key: "closer", deletedAt: null } }),
      database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } }),
    ]);
    const email = `legacy-metrics-${randomUUID()}@metrics.test`;
    const user = await database.user.create({
      data: { email, normalizedEmail: email, displayName: "Vendedor legado dos indicadores" },
    });
    const member = await database.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        roleId: role.id,
        status: "ACTIVE",
        joinedAt: now,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });

    const result = await dashboard(admin);
    expect(result.filterOptions.closers).toContainEqual({ id: member.id, name: "Vendedor legado dos indicadores" });
    expect(result.performance).toContainEqual(expect.objectContaining({
      id: member.id,
      name: "Vendedor legado dos indicadores",
      role: "CLOSER",
      volume: 0,
    }));
  });

  it("reconcilia conversões, cancelamentos, SLAs, estágio, aging e valores conhecidos", async () => {
    const result = await metrics();
    expect(result.period).toEqual({ ...period, interval: "HALF_OPEN", timeZone: "America/Sao_Paulo" });
    expect(result.leadsReceived.value).toBe(3);
    expect(result.attemptRate).toMatchObject({ numerator: 2, denominator: 3, basisPoints: 6667 });
    expect(result.contactRate).toMatchObject({ numerator: 2, denominator: 2, basisPoints: 10_000 });
    expect(result.qualificationOverContact).toMatchObject({ numerator: 2, denominator: 2 });
    expect(result.totalQualificationRate).toMatchObject({ numerator: 2, denominator: 3 });
    expect(result.schedulingRate).toMatchObject({ numerator: 2, denominator: 2 });
    expect(result.showRate).toMatchObject({ numerator: 1, denominator: 2, basisPoints: 5_000 });
    expect(result.noShowRate).toMatchObject({ numerator: 1, denominator: 2, basisPoints: 5_000 });
    expect(result.meetingToSaleRate).toMatchObject({ numerator: 1, denominator: 1 });
    expect(result.leadToSaleRate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(result.automaticSla).toMatchObject({ sampleCount: 3, averageSeconds: 91, medianSeconds: 70, p90Seconds: 200, upTo60Seconds: 1, upTo180Seconds: 2, missingCount: 0 });
    expect(result.humanSla).toMatchObject({ sampleCount: 2, averageSeconds: 75, medianSeconds: 75, p90Seconds: 120, upTo60Seconds: 1, upTo180Seconds: 2, missingCount: 1 });
    expect(result.revenue).toMatchObject({ cents: "100000", numerator: 1, currency: "BRL" });
    expect(result.mrr.cents).toBe("10000");
    expect(result.tcv.cents).toBe("120000");
    expect(result.averageTicket).toMatchObject({ cents: "100000", numeratorCents: "100000", denominator: 1 });
    expect(result.backlog.value).toBe(2);
    expect(result.stalledLeads.value).toBe(1);
    expect(result.leadsWithoutActivity.value).toBe(1);
    expect(result.leadsWithoutNextAction.value).toBe(1);
    const qualifiedTime = result.stageTime.find((metric) => metric.entityType === "LEAD" && metric.stageName === "Qualificado");
    expect(qualifiedTime?.statistics).toMatchObject({ sampleCount: 2, averageSeconds: 604_800, medianSeconds: 604_800, p90Seconds: 691_200 });
  });

  it("mantém valores históricos após a projeção atual da oportunidade mudar", async () => {
    const opportunity = await database.opportunity.findFirstOrThrow({ where: { workspaceId, name: "Venda conhecida CRM-19" } });
    await database.opportunity.update({ where: { id: opportunity.id }, data: { amountCents: 999_999n, mrrCents: 99_999n, tcvCents: 999_999n } });
    const result = await metrics();
    expect(result.revenue.cents).toBe("100000");
    expect(result.mrr.cents).toBe("10000");
    expect(result.tcv.cents).toBe("120000");
  });

  it("aplica filtros compartilhados e prioridade vigente no corte", async () => {
    const result = await createMetricsService({ database, authorization, now: () => now }).getOverview(manager, {
      ...period,
      filters: { sourceIds: [sourceId], priorityCodes: ["P1"] },
    });
    expect(result.leadsReceived.value).toBe(1);
    expect(result.filters.priorityCodes).toEqual(["P1"]);
  });

  it("aplica escopos TEAM e WORKSPACE e mantém indicadores restritos à gestão", async () => {
    expect((await metrics(manager)).scope).toBe("TEAM");
    expect((await metrics(admin)).scope).toBe("WORKSPACE");
    expect((await metrics(sdr1)).scope).toBe("OWN");
    expect((await metrics(sdr2)).scope).toBe("OWN");
    await expect(metrics(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(metrics(denied)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("retorna denominadores explícitos quando não há dados e valida o período", async () => {
    const service = createMetricsService({ database, authorization, now: () => now });
    const empty = await service.getOverview(manager, {
      from: "2041-01-01T00:00:00.000Z",
      to: "2041-01-02T00:00:00.000Z",
      filters: { sourceIds: [sourceId] },
    });
    expect(empty.leadsReceived.value).toBe(0);
    expect(empty.attemptRate).toMatchObject({ numerator: 0, denominator: 0, basisPoints: null, percentage: null });
    expect(empty.averageTicket).toMatchObject({ cents: null, numeratorCents: "0", denominator: 0 });
    await expect(service.getOverview(manager, { from: period.to, to: period.from })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("protege snapshots de fechamento contra update e delete", async () => {
    const snapshot = await database.opportunityOutcomeSnapshot.findFirstOrThrow({ where: { workspaceId } });
    await expect(database.opportunityOutcomeSnapshot.update({ where: { id: snapshot.id }, data: { amountCents: 1n } })).rejects.toThrow(/append-only/);
    await expect(database.opportunityOutcomeSnapshot.delete({ where: { id: snapshot.id } })).rejects.toThrow(/append-only/);
  });

  it("reconcilia KPIs e cada drilldown com a mesma evidência persistida", async () => {
    const result = await dashboard();
    const kpi = Object.fromEntries(result.kpis.map((item) => [item.id, item]));
    expect(kpi.leads).toMatchObject({ value: 3, numerator: 3, denominator: null });
    expect(kpi.attempts).toMatchObject({ value: 2, numerator: 2, denominator: 3 });
    expect(kpi.connected).toMatchObject({ value: 2, numerator: 2, denominator: 2 });
    expect(kpi.qualified).toMatchObject({ value: 2, numerator: 2, denominator: 3 });
    expect(kpi.scheduled).toMatchObject({ value: 2, numerator: 2, denominator: 2 });
    expect(kpi.held).toMatchObject({ value: 1, numerator: 1, denominator: 2 });
    expect(kpi["no-show"]).toMatchObject({ value: 1, numerator: 1, denominator: 2 });
    expect(kpi.opportunities).toMatchObject({ value: 2, numerator: 2 });
    expect(kpi.proposals).toMatchObject({ value: 1, numerator: 1, denominator: 2 });
    expect(kpi.sales).toMatchObject({ value: 1, numerator: 1 });
    expect(kpi.revenue).toMatchObject({ value: "100000", numerator: 1 });
    expect(kpi.mrr).toMatchObject({ value: "10000" });
    expect(kpi.tcv).toMatchObject({ value: "120000" });
    expect(kpi.ticket).toMatchObject({ value: "100000" });
    expect(kpi.sla).toMatchObject({ value: 75, numerator: 2, denominator: 3 });
    expect(kpi.backlog).toMatchObject({ value: 2 });
    expect(kpi.stalled).toMatchObject({ value: 1 });
    expect(kpi["no-next-action"]).toMatchObject({ value: 1 });

    const drilldown = await createDashboardMetricsService({ database, authorization, now: () => now }).getDrilldown(manager, {
      preset: "CUSTOM", fromDate: "2042-01-01", toDate: "2042-01-10", source: [sourceId], view: "kpi.leads",
    });
    expect(drilldown.total).toBe(kpi.leads!.value);
    expect(drilldown.records).toHaveLength(3);
    expect(new Set(drilldown.records.map((item) => item.leadId)).size).toBe(3);
    expect(result.funnel.map((item) => item.value)).toEqual([3, 2, 2, 2, 2, 1]);
    expect(result.fullFunnel.stages.map((item) => [item.id, item.value])).toEqual([
      ["received", 3], ["attempted", 2], ["connected", 2], ["qualified", 2],
      ["meeting", 2], ["opportunity", 2], ["proposal", 1],
    ]);
    expect(result.fullFunnel.outcomes.map((item) => [item.id, item.value, item.branchFrom])).toEqual([
      ["won", 1, "proposal"], ["lost", 0, "proposal"], ["disqualified", 1, "received"],
    ]);
    expect(result.attention.map((item) => item.id)).toEqual([
      "without-next-action", "critical-sla", "stalled-leads", "meetings-without-pacto",
      "stalled-opportunities", "no-show", "automation-errors",
    ]);
    expect(result.attention.find((item) => item.id === "critical-sla")).toMatchObject({ value: 0, severity: "CRITICAL" });
    expect(result.sourceConversion).toEqual(expect.arrayContaining([
      expect.objectContaining({ denominator: 3, value: 1, percentage: 33.33 }),
    ]));
    expect(result.performance.some((item) => item.role === "SDR" && item.volume > 0)).toBe(true);
    expect(result.performance.some((item) => item.role === "CLOSER" && item.meetings > 0)).toBe(true);

    const series = Object.fromEntries(result.timeSeries.map((item) => [item.id, item]));
    expect(series.leads!.granularity).toBe("DAY");
    expect(series.leads!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(3);
    expect(series.attempts!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(2);
    expect(series.opportunities!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(2);
    expect(series.proposals!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
    expect(series.sales!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
    expect(series.losses!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
    expect(series.disqualified!.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
    expect(series.revenue!.points.reduce((sum, point) => sum + BigInt(String(point.value)), 0n)).toBe(100_000n);
    expect(series.mrr!.points.reduce((sum, point) => sum + BigInt(String(point.value)), 0n)).toBe(10_000n);
    const conversion = series["lead-to-sale"]!;
    expect(conversion.points.reduce((sum, point) => sum + Number(point.numerator), 0)).toBe(1);
    expect(conversion.points.reduce((sum, point) => sum + (point.denominator ?? 0), 0)).toBe(3);

    const comparison = Object.fromEntries(result.comparisons.map((item) => [item.id, item]));
    expect(comparison.revenue).toMatchObject({
      current: { value: "100000" }, previous: { value: "0" },
      absoluteDifference: "100000", percentageDifference: null, direction: "UP", interpretation: "POSITIVE",
    });
    expect(comparison["no-show"]).toMatchObject({ direction: "UP", interpretation: "NEGATIVE" });
    expect(comparison.losses).toMatchObject({ direction: "UP", interpretation: "CONTEXT_REQUIRED" });
    expect(comparison["lead-to-sale"]).toMatchObject({
      current: { numerator: 1, denominator: 3 },
      previous: { numerator: 0, denominator: 0, value: null },
      direction: "NOT_COMPARABLE", interpretation: "NOT_ENOUGH_DATA",
    });
  });

  it("aplica filtros compartilhados, períodos civis e estado sem dados", async () => {
    const p1 = await dashboard(manager, { priority: ["P1"] });
    expect(p1.kpis.find((item) => item.id === "leads")?.value).toBe(1);
    expect(p1.query.filters.priorityCodes).toEqual(["P1"]);
    expect(p1.sources).toHaveLength(1);

    const empty = await dashboard(manager, { fromDate: "2041-01-01", toDate: "2041-01-02" });
    expect(empty.hasData).toBe(false);
    expect(empty.kpis.find((item) => item.id === "leads")?.value).toBe(0);
    expect(empty.funnel.every((item) => item.value === 0)).toBe(true);
    expect(empty.timeSeries.find((item) => item.id === "leads")?.points.every((point) => point.value === 0)).toBe(true);
    expect(empty.timeSeries.find((item) => item.id === "lead-to-sale")?.points.every((point) => point.value === null)).toBe(true);
    expect(empty.comparisons.find((item) => item.id === "leads")).toMatchObject({
      current: { value: 0 }, previous: { value: 0 }, direction: "STABLE", interpretation: "NEUTRAL",
    });
    expect(empty.query).toMatchObject({
      from: "2041-01-01T03:00:00.000Z",
      to: "2041-01-03T03:00:00.000Z",
    });

    const service = createDashboardMetricsService({ database, authorization, now: () => now });
    const today = await service.getScreen(manager, { preset: "TODAY", source: [sourceId] });
    expect(today.timeSeries[0]?.granularity).toBe("HOUR");
    const long = await service.getScreen(manager, {
      preset: "CUSTOM", fromDate: "2041-01-01", toDate: "2041-05-31", source: [sourceId],
    });
    expect(long.timeSeries[0]?.granularity).toBe("WEEK");
  });

  it("compara intervalo equivalente com filtros, RBAC e drilldowns dos dois períodos", async () => {
    const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
    const comparisonSource = await database.leadSource.create({
      data: {
        workspaceId,
        key: `design05-comparison-${randomUUID()}`,
        name: "Comparação isolada DESIGN-05",
        type: "MANUAL",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });
    try {
      await createLeadScenario({
        label: `anterior-${randomUUID()}`,
        sourceId: comparisonSource.id,
        receivedAt: new Date("2041-12-25T12:00:00.000Z"),
        priority: "P2", automaticSeconds: 2, attemptSeconds: 45, connectedSeconds: null,
      });
      await createLeadScenario({
        label: `atual-a-${randomUUID()}`,
        sourceId: comparisonSource.id,
        receivedAt: at("02T12:00"),
        priority: "P1", automaticSeconds: 2, attemptSeconds: 30, connectedSeconds: 40,
      });
      await createLeadScenario({
        label: `atual-b-${randomUUID()}`,
        sourceId: comparisonSource.id,
        receivedAt: at("03T12:00"),
        priority: "P2", automaticSeconds: 2, attemptSeconds: null, connectedSeconds: null,
      });
      const service = createDashboardMetricsService({ database, authorization, now: () => now });
      const input = {
        preset: "CUSTOM", fromDate: "2042-01-01", toDate: "2042-01-10",
        source: [comparisonSource.id],
      };
      const result = await service.getScreen(manager, input);
      const leads = result.comparisons.find((item) => item.id === "leads")!;
      expect(result.comparisonPeriod).toMatchObject({
        fromDate: "2041-12-22", toDate: "2041-12-31",
        from: "2041-12-22T03:00:00.000Z", to: "2042-01-01T03:00:00.000Z",
      });
      expect(leads).toMatchObject({
        current: { value: 2, numerator: 2 },
        previous: { value: 1, numerator: 1 },
        absoluteDifference: 1,
        percentageDifference: 100,
        direction: "UP",
        interpretation: "CONTEXT_REQUIRED",
      });
      expect(result.comparisons.find((item) => item.id === "sla-median")).toMatchObject({
        current: { value: 30 }, previous: { value: 45 }, absoluteDifference: -15,
        percentageDifference: -33.33, direction: "DOWN", interpretation: "POSITIVE",
      });
    expect(result.timeSeries.find((item) => item.id === "leads")?.points
      .reduce((sum, point) => sum + Number(point.value), 0)).toBe(2);
      expect(result.previousTimeSeries.find((item) => item.id === "leads")?.points
        .reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);

      const current = await service.getDrilldown(manager, { ...input, view: leads.current.drilldownId });
      const previous = await service.getDrilldown(manager, { ...input, view: leads.previous.drilldownId });
      expect(current.total).toBe(2);
      expect(previous.total).toBe(1);
      expect(previous.drilldown.title).toContain("período anterior");
      expect(previous.period).toMatchObject({ fromDate: "2041-12-22", toDate: "2041-12-31" });

      expect((await service.getScreen(sdr2, input)).overview.scope).toBe("OWN");
    } finally {
      await database.lead.updateMany({
        where: { workspaceId, sourceId: comparisonSource.id },
        data: { deletedAt: now, updatedAt: now },
      });
      await database.leadSource.update({
        where: { id: comparisonSource.id },
        data: { deletedAt: now, updatedAt: now },
      });
    }
  });

  it("mantém o universo do dashboard sob RBAC e não permite drilldown por adivinhação", async () => {
    expect((await dashboard(admin)).overview.scope).toBe("WORKSPACE");
    expect((await dashboard(sdr1)).overview.scope).toBe("OWN");
    expect((await dashboard(sdr2)).overview.scope).toBe("OWN");
    await expect(dashboard(denied)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(createDashboardMetricsService({ database, authorization, now: () => now }).getDrilldown(manager, {
      preset: "CUSTOM", fromDate: "2042-01-01", toDate: "2042-01-10", source: [sourceId], view: "kpi.inexistente",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("mantém resposta operacional com 300 leads sem consultas por linha", async () => {
    const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null } });
    const [stage, band, queue, systemActor] = await Promise.all([
      database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: pipeline.id, leadStageCode: "NEW", deletedAt: null } }),
      database.leadPriorityBand.findFirstOrThrow({ where: { workspaceId, code: "P2", active: true, deletedAt: null } }),
      database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } }),
      database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } }),
    ]);
    const scaleSource = await database.leadSource.create({
      data: {
        workspaceId, key: `crm20-scale-${randomUUID()}`, name: "Escala CRM-20", type: "MANUAL",
        createdByActorId: systemActor.id, updatedByActorId: systemActor.id,
      },
    });
    const createdAt = at("05T12:00");
    const rows = Array.from({ length: 300 }, (_, index) => ({
      leadId: randomUUID(), submissionId: randomUUID(), cycleId: randomUUID(), taskId: randomUUID(),
      phone: `+5511988${index.toString().padStart(6, "0")}`,
    }));
    try {
      await database.$transaction(async (transaction) => {
        await transaction.lead.createMany({ data: rows.map((row, index) => ({
          id: row.leadId, workspaceId, sourceId: scaleSource.id, latestSourceId: scaleSource.id,
          pipelineId: pipeline.id, currentStageId: stage.id, ownerMemberId: sdr1.memberId,
          routingQueueId: queue.id, fullName: `Lead escala ${index + 1}`, normalizedPhone: row.phone,
          status: "OPEN" as const, priority: "MEDIUM" as const, slaStartedAt: createdAt, slaDueAt: createdAt,
          lastActivityAt: createdAt, latestSubmissionAt: createdAt, createdByActorId: systemActor.id,
          updatedByActorId: systemActor.id, createdAt, updatedAt: createdAt,
        })) });
        await transaction.leadFormSubmission.createMany({ data: rows.map((row, index) => ({
          id: row.submissionId, workspaceId, leadId: row.leadId, sourceId: scaleSource.id,
          status: "LINKED" as const, channel: "MANUAL" as const, intakeOutcome: "CREATED" as const,
          idempotencyKey: `crm20-scale:${scaleSource.id}:${index}`, submittedFullName: `Lead escala ${index + 1}`,
          submittedPhone: row.phone, normalizedPhone: row.phone, submittedAt: createdAt,
          rawPayload: { fixture: "crm20-scale", index }, createdByActorId: systemActor.id, createdAt,
        })) });
        await transaction.leadSlaCycle.createMany({ data: rows.map((row) => ({
          id: row.cycleId, workspaceId, leadId: row.leadId, submissionId: row.submissionId,
          priorityBandId: band.id, assignedMemberId: sdr1.memberId, receivedAt: createdAt,
          assignedAt: createdAt, automaticAcknowledgedAt: createdAt, createdByActorId: systemActor.id,
          createdAt,
        })) });
        await transaction.stageHistory.createMany({ data: rows.map((row) => ({
          workspaceId, pipelineId: pipeline.id, stageId: stage.id, leadId: row.leadId,
          enteredAt: createdAt, enteredByActorId: systemActor.id, transitionOrigin: "INTAKE" as const,
          createdAt,
        })) });
        await transaction.task.createMany({ data: rows.map((row) => ({
          id: row.taskId, workspaceId, leadId: row.leadId, slaCycleId: row.cycleId,
          assigneeMemberId: sdr1.memberId, title: "Ligar agora", kind: "IMMEDIATE_CALL" as const,
          status: "OPEN" as const, priority: "MEDIUM" as const, dueAt: createdAt,
          createdByActorId: systemActor.id, updatedByActorId: systemActor.id, createdAt, updatedAt: createdAt,
        })) });
        for (const row of rows) {
          await transaction.lead.update({
            where: { id: row.leadId },
            data: { nextActionTaskId: row.taskId, nextActionAt: createdAt, nextActionDescription: "Ligar agora" },
          });
        }
      });
      const startedAt = performance.now();
      const result = await dashboard(manager, { source: [scaleSource.id] });
      const elapsed = performance.now() - startedAt;
      expect(result.kpis.find((item) => item.id === "leads")?.value).toBe(300);
      expect(result.records.filter((item) => item.entityType === "LEAD")).toHaveLength(300);
      expect(result.sdrPerformance).toMatchObject([{ value: 300, denominator: 300 }]);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      await database.lead.updateMany({ where: { workspaceId, sourceId: scaleSource.id }, data: { deletedAt: now, updatedAt: now } });
      await database.leadSource.update({ where: { id: scaleSource.id }, data: { deletedAt: now, updatedAt: now } });
    }
  }, 20_000);
});
