import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { recordCommercialMetricCorrectionInTransaction, recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createCommercialMetricBackfillService } from "@/modules/metrics/application/commercial-metric-backfill-service";
import { createCommercialMetricReconciliationService } from "@/modules/metrics/application/commercial-metric-reconciliation-service";
import { createDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for commercial metrics tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Commercial metrics tests require an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2052-04-20T12:00:00.000Z");
const metrics = createMetricsService({ database, authorization, now: () => now });
let context: AuthenticatedContext;
let leadId: string;

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, role: { key: "administrator" }, deletedAt: null }, include: { role: true, user: true, workspace: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, userId: member.userId, type: "HUMAN" } });
  leadId = randomUUID();
  context = { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
});

afterAll(async () => database.$disconnect());

describe("razão comercial integrada", () => {
  it("reconstrói as fontes e persiste reconciliação sem divergência", async () => {
    const backfill = createCommercialMetricBackfillService({ database, now: () => now });
    const reconciliation = createCommercialMetricReconciliationService({ database, now: () => now });
    const source = await database.leadSource.findFirstOrThrow({ where: { workspaceId: context.workspaceId } });
    const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId: context.workspaceId, entityType: "LEAD", stages: { some: { leadStageCode: "QUALIFIED", deletedAt: null } } } });
    const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId: context.workspaceId, pipelineId: pipeline.id } });
    const completedAt = new Date("2052-04-19T12:00:00.000Z");
    const lead = await database.lead.create({ data: {
      workspaceId: context.workspaceId,
      sourceId: source.id,
      pipelineId: pipeline.id,
      currentStageId: stage.id,
      ownerMemberId: context.memberId,
      fullName: "Lead de reconciliação de chamadas",
      slaStartedAt: now,
      slaDueAt: now,
      lastActivityAt: now,
      createdByActorId: context.actorId,
      updatedByActorId: context.actorId,
    } });
    const qualifiedStage = await database.pipelineStage.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, pipelineId: pipeline.id, leadStageCode: "QUALIFIED" },
    });
    const qualificationHistory = await database.stageHistory.create({ data: {
      workspaceId: context.workspaceId, pipelineId: pipeline.id, stageId: qualifiedStage.id,
      leadId: lead.id, enteredAt: completedAt, enteredByActorId: context.actorId,
      transitionOrigin: "LEAD_CARD",
    } });
    await database.lead.update({ where: { id: lead.id }, data: {
      currentStageId: qualifiedStage.id, status: "QUALIFIED", updatedByActorId: context.actorId,
    } });
    await database.task.createMany({ data: ["CALLBACK_REQUESTED", "WHATSAPP_SHARED"].map((result) => ({
      workspaceId: context.workspaceId,
      leadId: lead.id,
      assigneeMemberId: context.memberId,
      title: `Ligação concluída — ${result}`,
      kind: "CALL",
      status: "COMPLETED",
      dueAt: completedAt,
      completedAt,
      result,
      createdByActorId: context.actorId,
      updatedByActorId: context.actorId,
    })) });
    const executor = await database.workspaceMember.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, id: { not: context.memberId }, deletedAt: null },
      select: { id: true, userId: true },
    });
    const executorActor = await database.actor.findFirstOrThrow({ where: { workspaceId: context.workspaceId, userId: executor.userId, type: "HUMAN" } });
    const meeting = await database.meeting.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, ownerMemberId: context.memberId,
      title: "Reunião marcada por outro vendedor", startsAt: new Date(completedAt.getTime() + 86_400_000),
      endsAt: new Date(completedAt.getTime() + 86_400_000 + 1_800_000), durationMinutes: 30,
      timeZone: "America/Sao_Paulo", createdByActorId: executorActor.id, updatedByActorId: executorActor.id,
    } });
    const meetingHistory = await database.meetingHistory.create({ data: {
      workspaceId: context.workspaceId, meetingId: meeting.id, leadId: lead.id,
      ownerMemberId: context.memberId, meetingRevision: 1, action: "SCHEDULED", newStatus: "SCHEDULED",
      newStartsAt: meeting.startsAt, newEndsAt: meeting.endsAt, occurredAt: completedAt,
      recordedByActorId: executorActor.id,
    } });
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId, eventKey: `meeting-history:${meetingHistory.id}:scheduled:v1`,
      eventType: "MEETING_SCHEDULED", occurredAt: completedAt,
      sourceEntityType: "MeetingHistory", sourceEntityId: meetingHistory.id,
      meetingId: meeting.id, leadId: lead.id, creditedMemberId: executor.id,
      performedByMemberId: executor.id, bookedByMemberId: executor.id,
      meetingOwnerMemberIdAtEvent: context.memberId,
    });
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId, eventKey: `meeting-history:${meetingHistory.id}:meeting_scheduled:v1`,
      eventType: "MEETING_SCHEDULED", occurredAt: completedAt,
      sourceEntityType: "MeetingHistory", sourceEntityId: meetingHistory.id,
      meetingId: meeting.id, leadId: lead.id, creditedMemberId: context.memberId,
      performedByMemberId: executor.id, bookedByMemberId: executor.id,
      meetingOwnerMemberIdAtEvent: context.memberId,
    });
    const [opportunityPipeline, product] = await Promise.all([
      database.pipeline.findFirstOrThrow({ where: { workspaceId: context.workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null } }),
      database.product.findFirstOrThrow({ where: { workspaceId: context.workspaceId, active: true, deletedAt: null } }),
    ]);
    const proposalStage = await database.pipelineStage.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, pipelineId: opportunityPipeline.id, opportunityStageCode: "PROPOSAL", deletedAt: null },
    });
    const opportunity = await database.opportunity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, pipelineId: opportunityPipeline.id,
      currentStageId: proposalStage.id, ownerMemberId: context.memberId, productId: product.id,
      name: "Proposta histórica de reconciliação", amountCents: 25_000n, probabilityBps: 5_000,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
      createdAt: completedAt, updatedAt: completedAt,
    } });
    const offer = await database.offer.create({ data: {
      workspaceId: context.workspaceId, opportunityId: opportunity.id, productId: product.id,
      name: "Proposta histórica enviada", unitPriceCents: 25_000n, totalCents: 25_000n,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
      createdAt: completedAt, updatedAt: completedAt,
    } });
    const delegatedTask = await database.task.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, assigneeMemberId: context.memberId,
      title: "Tarefa concluída por outro vendedor", kind: "GENERAL", status: "COMPLETED",
      dueAt: completedAt, completedAt, result: "COMPLETED",
      createdByActorId: context.actorId, updatedByActorId: executorActor.id,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: executorActor.id, action: "task.completed", entityType: "Task",
      entityId: delegatedTask.id, occurredAt: completedAt,
    } });
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId, eventKey: `task:${delegatedTask.id}:completed:v1`, eventType: "TASK_COMPLETED",
      occurredAt: completedAt, sourceEntityType: "Task", sourceEntityId: delegatedTask.id,
      taskId: delegatedTask.id, leadId: lead.id, creditedMemberId: context.memberId,
      performedByMemberId: executor.id, taskKind: "GENERAL", result: "COMPLETED", executionMode: "MANUAL",
    });
    const manualActivity = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "CALL_UNANSWERED", direction: "OUTBOUND", result: "NOT_CONNECTED",
      subject: "Ligação manual anterior ao log integrado", occurredAt: completedAt,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: context.actorId, action: "activity.recorded", entityType: "Activity",
      entityId: manualActivity.id, occurredAt: completedAt,
    } });
    const correction = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "CALL_UNANSWERED", direction: "INTERNAL", result: "CORRECTED",
      subject: "Correção: ligação atendida", description: "Desfecho corrigido após conferência",
      occurredAt: new Date(completedAt.getTime() + 60_000), correctsActivityId: manualActivity.id,
      newValues: { result: "CONNECTED" }, createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: context.actorId, action: "activity.corrected", entityType: "Activity",
      entityId: correction.id, occurredAt: correction.occurredAt,
    } });
    const manualReply = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "MESSAGE_RECEIVED", direction: "INBOUND", result: "RECEIVED",
      subject: "Resposta manual anterior ao log integrado", occurredAt: completedAt,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: context.actorId, action: "activity.recorded", entityType: "Activity",
      entityId: manualReply.id, occurredAt: completedAt,
    } });
    const manualEmail = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "EMAIL", direction: "OUTBOUND", result: "SENT",
      subject: "E-mail manual anterior ao log integrado", occurredAt: completedAt,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: context.actorId, action: "activity.recorded", entityType: "Activity",
      entityId: manualEmail.id, occurredAt: completedAt,
    } });
    const manualInstagram = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "MESSAGE_SENT", direction: "OUTBOUND", result: "SENT",
      subject: "Mensagem manual pelo Instagram", occurredAt: completedAt,
      newValues: { communicationChannel: "INSTAGRAM" },
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: context.actorId, action: "activity.recorded", entityType: "Activity",
      entityId: manualInstagram.id, occurredAt: completedAt,
    } });
    const legacyCall = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "CALL_CONNECTED",
      direction: "OUTBOUND", result: "CONNECTED", subject: "Ligação legada sem evento de auditoria",
      occurredAt: completedAt, durationSeconds: 180,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    const legacyCorrection = await database.activity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, type: "CALL_CONNECTED", direction: "INTERNAL",
      result: "CORRECTED", subject: "Correção da ligação legada", description: "Resultado conferido",
      occurredAt: new Date(completedAt.getTime() + 120_000), correctsActivityId: legacyCall.id,
      newValues: { result: "NOT_CONNECTED" },
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await database.auditLog.create({ data: {
      workspaceId: context.workspaceId, actorId: context.actorId, action: "activity.corrected", entityType: "Activity",
      entityId: legacyCorrection.id, occurredAt: legacyCorrection.occurredAt,
    } });
    const conversation = await database.conversation.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, assigneeMemberId: context.memberId,
      channel: "INTERNAL_SIMULATOR", createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    const firstMessage = await database.message.create({ data: {
      workspaceId: context.workspaceId, conversationId: conversation.id, senderActorId: context.actorId,
      direction: "INBOUND", status: "RECEIVED", occurredAt: completedAt, createdAt: completedAt,
    } });
    const laterMessage = await database.message.create({ data: {
      workspaceId: context.workspaceId, conversationId: conversation.id, senderActorId: context.actorId,
      direction: "INBOUND", status: "RECEIVED",
      occurredAt: new Date(completedAt.getTime() + 60_000), createdAt: new Date(completedAt.getTime() + 60_000),
    } });
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId, eventKey: `lead:${lead.id}:first-human-response:${laterMessage.id}:v1`,
      eventType: "HUMAN_RESPONSE_CONFIRMED", occurredAt: laterMessage.occurredAt,
      sourceEntityType: "Message", sourceEntityId: laterMessage.id,
      messageId: laterMessage.id, leadId: lead.id, creditedMemberId: context.memberId,
      channel: "INTERNAL_SIMULATOR", direction: "INBOUND",
    });
    const result = await backfill.run(context, { mode: "APPLY", runKey: `commercial-metrics:test:${randomUUID()}`, batchSize: 100 });
    expect(result.status).toBe("COMPLETED");
    expect(result.failedCount).toBe(0);
    const repeated = await backfill.run(context, { mode: "APPLY", runKey: `commercial-metrics:repeat:${randomUUID()}`, batchSize: 100 });
    expect(repeated.createdCount).toBe(0);
    expect(repeated.failedCount).toBe(0);
    const firstResponseFacts = await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, leadId: lead.id, sourceEntityType: "Message", eventType: "HUMAN_RESPONSE_CONFIRMED" },
      select: { sourceEntityId: true, quantity: true },
    });
    expect(firstResponseFacts.reduce((sum, fact) => sum + fact.quantity, 0)).toBe(1);
    expect(firstResponseFacts.find((fact) => fact.sourceEntityId === firstMessage.id)?.quantity).toBe(1);
    expect(await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: legacyCall.id },
      select: { eventType: true, creditedMemberId: true, durationSeconds: true },
    }).then((facts) => facts.sort((a, b) => a.eventType.localeCompare(b.eventType)))).toEqual([
      { eventType: "CALL_ATTEMPTED", creditedMemberId: context.memberId, durationSeconds: null },
      { eventType: "CALL_CONNECTED", creditedMemberId: context.memberId, durationSeconds: 180 },
    ]);
    const legacyCorrectionFacts = await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: legacyCorrection.id },
      select: { eventType: true, quantity: true },
    });
    expect(legacyCorrectionFacts).toHaveLength(4);
    expect(legacyCorrectionFacts.find((fact) => fact.eventType === "CALL_CONNECTED")?.quantity).toBe(-1);
    expect(legacyCorrectionFacts.find((fact) => fact.eventType === "CALL_UNANSWERED")?.quantity).toBe(1);
    const delegatedFacts = await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Task", sourceEntityId: delegatedTask.id, eventType: "TASK_COMPLETED" },
      select: { creditedMemberId: true, quantity: true },
    });
    expect(delegatedFacts.filter((fact) => fact.creditedMemberId === context.memberId).reduce((sum, fact) => sum + fact.quantity, 0)).toBe(0);
    expect(delegatedFacts.filter((fact) => fact.creditedMemberId === executor.id).reduce((sum, fact) => sum + fact.quantity, 0)).toBe(1);
    const meetingFacts = await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "MeetingHistory", sourceEntityId: meetingHistory.id, eventType: "MEETING_SCHEDULED" },
      select: { creditedMemberId: true, bookedByMemberId: true, meetingOwnerMemberIdAtEvent: true, quantity: true },
    });
    expect(meetingFacts.filter((fact) => fact.creditedMemberId === context.memberId).reduce((sum, fact) => sum + fact.quantity, 0)).toBe(0);
    expect(meetingFacts.filter((fact) => fact.creditedMemberId === executor.id).reduce((sum, fact) => sum + fact.quantity, 0)).toBe(1);
    expect(meetingFacts.every((fact) => fact.bookedByMemberId === executor.id && fact.meetingOwnerMemberIdAtEvent === context.memberId)).toBe(true);
    expect(await database.commercialMetricFact.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, sourceEntityType: "StageHistory", sourceEntityId: qualificationHistory.id, eventType: "LEAD_QUALIFIED" },
      select: { creditedMemberId: true, leadId: true, quantity: true },
    })).toEqual({ creditedMemberId: context.memberId, leadId: lead.id, quantity: 1 });
    expect(await database.commercialMetricFact.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Offer", sourceEntityId: offer.id, eventType: "PROPOSAL_REACHED" },
      select: { creditedMemberId: true, opportunityId: true, valueCents: true, quantity: true },
    })).toEqual({ creditedMemberId: context.memberId, opportunityId: opportunity.id, valueCents: 25_000n, quantity: 1 });
    expect(await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: manualActivity.id },
      select: { eventType: true, creditedMemberId: true, result: true },
      orderBy: { eventType: "asc" },
    })).toEqual([
      { eventType: "CALL_ATTEMPTED", creditedMemberId: context.memberId, result: "NOT_CONNECTED" },
      { eventType: "CALL_UNANSWERED", creditedMemberId: context.memberId, result: "NO_ANSWER" },
    ]);
    const correctionFacts = await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: correction.id },
      select: { eventType: true, quantity: true, result: true, creditedMemberId: true },
    });
    expect(correctionFacts).toHaveLength(4);
    expect(correctionFacts.every((fact) => fact.creditedMemberId === context.memberId)).toBe(true);
    expect(correctionFacts.find((fact) => fact.eventType === "CALL_UNANSWERED")?.quantity).toBe(-1);
    expect(correctionFacts.find((fact) => fact.eventType === "CALL_CONNECTED")?.quantity).toBe(1);
    expect(await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: manualReply.id },
      select: { eventType: true, creditedMemberId: true },
    }).then((facts) => facts.sort((a, b) => a.eventType.localeCompare(b.eventType)))).toEqual([
      { eventType: "HUMAN_RESPONSE_CONFIRMED", creditedMemberId: context.memberId },
      { eventType: "INBOUND_MESSAGE_RECEIVED", creditedMemberId: context.memberId },
    ]);
    expect(await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: manualEmail.id },
      select: { eventType: true, creditedMemberId: true },
    })).toEqual([{ eventType: "EMAIL_SENT", creditedMemberId: context.memberId }]);
    expect(await database.commercialMetricFact.findMany({
      where: { workspaceId: context.workspaceId, sourceEntityType: "Activity", sourceEntityId: manualInstagram.id },
      select: { eventType: true, creditedMemberId: true },
    })).toEqual([{ eventType: "INSTAGRAM_MESSAGE_SENT", creditedMemberId: context.memberId }]);
    const sourceFiltered = await metrics.getIntegratedOverview(context, {
      from: "2052-04-19T00:00:00.000Z", to: "2052-04-20T00:00:00.000Z", filters: { sourceIds: [source.id] },
    });
    expect(Number(sourceFiltered.values.find((value) => value.metricId === "outreach.calls_attempted")?.value ?? 0)).toBeGreaterThanOrEqual(3);
    const report = await reconciliation.run(context, { runKey: `commercial-metrics:reconcile:${randomUUID()}` });
    expect(report.status).toBe("COMPLETED");
    expect(report.divergentCheckCount, JSON.stringify("checks" in report ? report.checks.filter((check) => check.state === "DIVERGENT") : [])).toBe(0);
    expect("checks" in report ? report.checks.length : 0).toBeGreaterThan(30);
    const quality = await metrics.getIntegratedOverview(context, {
      from: "2052-04-19T00:00:00.000Z", to: "2052-04-20T00:00:00.000Z", filters: {},
    });
    expect(quality.quality.reconciliationState).toBe("AVAILABLE");
    expect(quality.values.find((value) => value.metricId === "outreach.calls_attempted")?.coverageBasisPoints).toBe(10_000);
  }, 60_000);

  it("é idempotente, detecta conflito e participa do rollback transacional", async () => {
    const entityId = randomUUID();
    const input = { workspaceId: context.workspaceId, eventKey: `test:${entityId}:created:v1`, eventType: "TASK_CREATED" as const, occurredAt: now, sourceEntityType: "Task", sourceEntityId: entityId, leadId, creditedMemberId: context.memberId };
    const first = await recordCommercialMetricFactInTransaction(database, input);
    const replay = await recordCommercialMetricFactInTransaction(database, input);
    expect(first.idempotent).toBe(false);
    expect(replay).toMatchObject({ idempotent: true, fact: { id: first.fact.id } });
    await expect(recordCommercialMetricFactInTransaction(database, { ...input, quantity: 2 })).rejects.toMatchObject({ code: "COMMERCIAL_METRIC_FACT_CONFLICT" });

    const rollbackId = randomUUID();
    await expect(database.$transaction(async (tx) => {
      await recordCommercialMetricFactInTransaction(tx, { ...input, eventKey: `test:${rollbackId}:rollback:v1`, sourceEntityId: rollbackId });
      throw new Error("rollback esperado");
    })).rejects.toThrow("rollback esperado");
    expect(await database.commercialMetricFact.count({ where: { workspaceId: context.workspaceId, eventKey: `test:${rollbackId}:rollback:v1` } })).toBe(0);
  });

  it("reconcilia o cenário conhecido de Carlos sem dupla contagem", async () => {
    const from = new Date("2052-04-21T00:00:00.000Z");
    const to = new Date("2052-04-22T00:00:00.000Z");
    const leadIds = Array.from({ length: 20 }, () => randomUUID());
    await database.$transaction(async (tx) => {
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${leadIds[0]}:lead-created:v1`, eventType: "LEAD_CREATED", occurredAt: from, sourceEntityType: "Lead", sourceEntityId: leadIds[0]!, leadId: leadIds[0]! });
      for (let index = 0; index < 30; index += 1) {
        const taskId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${taskId}:task:v1`, eventType: "TASK_COMPLETED", occurredAt: from, sourceEntityType: "Task", sourceEntityId: taskId, taskId, leadId: leadIds[index % leadIds.length]!, creditedMemberId: context.memberId });
      }
      for (let index = 0; index < 15; index += 1) {
        const callId = randomUUID();
        const lead = leadIds[index]!;
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${callId}:attempt:v1`, eventType: "CALL_ATTEMPTED", occurredAt: from, sourceEntityType: "PhoneCall", sourceEntityId: callId, phoneCallId: callId, leadId: lead, creditedMemberId: context.memberId });
        const result = index < 6 ? "CONNECTED" : index < 11 ? "NO_ANSWER" : index < 13 ? "BUSY" : "VOICEMAIL";
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${callId}:result:v1`, eventType: index < 6 ? "CALL_CONNECTED" : "CALL_UNANSWERED", occurredAt: from, sourceEntityType: "PhoneCall", sourceEntityId: callId, phoneCallId: callId, leadId: lead, creditedMemberId: context.memberId, result });
      }
      for (let index = 0; index < 15; index += 1) {
        const messageId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${messageId}:instagram:v1`, eventType: "INSTAGRAM_MESSAGE_SENT", occurredAt: from, sourceEntityType: "Message", sourceEntityId: messageId, messageId, leadId: leadIds[(index + 5) % leadIds.length]!, creditedMemberId: context.memberId, channel: "INSTAGRAM", direction: "OUTBOUND", result: "SENT" });
      }
      for (let index = 0; index < 5; index += 1) {
        const messageId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${messageId}:response:v1`, eventType: "HUMAN_RESPONSE_CONFIRMED", occurredAt: from, sourceEntityType: "Message", sourceEntityId: messageId, messageId, leadId: leadIds[index]!, creditedMemberId: context.memberId, channel: "INSTAGRAM", direction: "INBOUND" });
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${messageId}:inbound:v1`, eventType: "INBOUND_MESSAGE_RECEIVED", occurredAt: from, sourceEntityType: "Message", sourceEntityId: messageId, messageId, leadId: leadIds[index]!, creditedMemberId: context.memberId, channel: "INSTAGRAM", direction: "INBOUND" });
      }
      const sentEmailId = randomUUID();
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${sentEmailId}:sent:v1`, eventType: "EMAIL_SENT", occurredAt: from, sourceEntityType: "ProspectingEmailJob", sourceEntityId: sentEmailId, leadId: leadIds[0]!, creditedMemberId: context.memberId, channel: "EMAIL", direction: "OUTBOUND" });
      const humanEmailReplyId = randomUUID();
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${humanEmailReplyId}:inbound:v1`, eventType: "INBOUND_MESSAGE_RECEIVED", occurredAt: from, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: humanEmailReplyId, leadId: leadIds[0]!, creditedMemberId: context.memberId, channel: "EMAIL", direction: "INBOUND" });
      const automaticEmailReplyId = randomUUID();
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${automaticEmailReplyId}:replied:v1`, eventType: "EMAIL_REPLIED", occurredAt: from, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: automaticEmailReplyId, leadId: leadIds[1]!, creditedMemberId: context.memberId, channel: "EMAIL", direction: "INBOUND" });
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${automaticEmailReplyId}:automatic:v1`, eventType: "AUTO_RESPONSE_RECEIVED", occurredAt: from, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: automaticEmailReplyId, leadId: leadIds[1]!, creditedMemberId: context.memberId, channel: "EMAIL", direction: "INBOUND" });
      for (let index = 0; index < 3; index += 1) {
        const revisionId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${revisionId}:qualified:v1`, eventType: "LEAD_QUALIFIED", occurredAt: from, sourceEntityType: "StageHistory", sourceEntityId: revisionId, leadId: leadIds[index]!, creditedMemberId: context.memberId });
      }
      for (let index = 0; index < 2; index += 1) {
        const meetingId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${meetingId}:scheduled:v1`, eventType: "MEETING_SCHEDULED", occurredAt: from, sourceEntityType: "MeetingHistory", sourceEntityId: meetingId, meetingId, leadId: leadIds[index]!, creditedMemberId: context.memberId, bookedByMemberId: context.memberId });
        if (index === 0) await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${meetingId}:completed:v1`, eventType: "MEETING_COMPLETED", occurredAt: from, sourceEntityType: "MeetingHistory", sourceEntityId: meetingId, meetingId, leadId: leadIds[index]!, creditedMemberId: context.memberId });
      }
      const stageHistoryId = randomUUID();
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${stageHistoryId}:meeting-stage:v1`, eventType: "MEETING_SCHEDULED", occurredAt: from, sourceEntityType: "StageHistory", sourceEntityId: stageHistoryId, leadId: leadIds[2]!, creditedMemberId: context.memberId, bookedByMemberId: context.memberId, result: "STAGE_TRANSITION" });
      const offerId = randomUUID();
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${offerId}:proposal-reached:v1`, eventType: "PROPOSAL_REACHED", occurredAt: from, sourceEntityType: "Offer", sourceEntityId: offerId, leadId: leadIds[0]!, creditedMemberId: context.memberId, valueCents: 25_000n, result: "SENT" });
      const proposalStageId = randomUUID();
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${proposalStageId}:proposal-stage:v1`, eventType: "PROPOSAL_REACHED", occurredAt: from, sourceEntityType: "StageHistory", sourceEntityId: proposalStageId, leadId: leadIds[0]!, creditedMemberId: context.memberId, result: "STAGE_TRANSITION" });
      for (const [result, valueCents] of [["NEW", 1_000n], ["EXPANSION", 500n], ["RENEWAL", 200n]] as const) {
        const movementId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${movementId}:movement:v1`, eventType: "REVENUE_MOVEMENT_POSTED", occurredAt: from, sourceEntityType: "RevenueMovement", sourceEntityId: movementId, leadId: leadIds[0]!, creditedMemberId: context.memberId, result, valueCents });
      }
    });
    const overviewStartedAt = performance.now();
    const overview = await metrics.getIntegratedOverview(context, { from: from.toISOString(), to: to.toISOString(), filters: {} });
    expect(performance.now() - overviewStartedAt).toBeLessThan(1_500);
    const value = (metricId: string) => overview.values.find((metric) => metric.metricId === metricId);
    expect(value("work.tasks_completed")?.value).toBe(30);
    expect(value("contacts.leads_created")?.value).toBe(1);
    expect(value("outreach.calls_attempted")?.value).toBe(15);
    expect(value("outreach.contact_actions")?.value).toBe(31);
    expect(value("outreach.calls_connected")?.value).toBe(6);
    expect(value("outreach.calls_callback_requested")?.value).toBe(0);
    expect(value("outreach.calls_whatsapp_shared")?.value).toBe(0);
    expect(value("outreach.calls_unanswered")?.value).toBe(9);
    expect(value("outreach.calls_no_answer")?.value).toBe(5);
    expect(value("outreach.calls_busy")?.value).toBe(2);
    expect(value("outreach.calls_voicemail")?.value).toBe(2);
    expect(value("outreach.call_connection_rate")?.value).toBe(4_000);
    expect(value("outreach.instagram_messages")?.value).toBe(15);
    expect(value("work.politicians_touched")?.value).toBe(20);
    expect(value("outreach.inbound_responses")?.value).toBe(5);
    expect(value("email.sent")?.value).toBe(1);
    expect(value("email.replied")?.value).toBe(1);
    expect(value("email.reply_rate")?.value).toBe(10_000);
    expect(value("qualification.leads")?.value).toBe(3);
    expect(value("meetings.scheduled")?.value).toBe(2);
    expect(value("meetings.stage_marked")?.value).toBe(1);
    expect(value("meetings.completed")?.value).toBe(1);
    expect(value("sales.proposals")?.value).toBe(1);
    expect(value("revenue.new_mrr")?.value).toBe("1000");
    expect(value("revenue.expansion_mrr")?.value).toBe("500");
    expect(value("revenue.renewals_completed")?.value).toBe(1);
    expect(value("sales.won")?.state).toBe("ZERO");
    expect(value("sales.win_rate")?.state).toBe("NO_DENOMINATOR");
    const drilldownStartedAt = performance.now();
    const drilldown = await metrics.getIntegratedDrilldown(context, { metricId: "outreach.calls_attempted", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(performance.now() - drilldownStartedAt).toBeLessThan(1_000);
    expect(drilldown.records).toHaveLength(15);
    const noAnswerDrilldown = await metrics.getIntegratedDrilldown(context, { metricId: "outreach.calls_no_answer", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(noAnswerDrilldown.records).toHaveLength(5);
    expect(noAnswerDrilldown.records.every((record) => record.result === "NO_ANSWER")).toBe(true);
    const emailReplyDrilldown = await metrics.getIntegratedDrilldown(context, { metricId: "email.replied", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(emailReplyDrilldown.records).toHaveLength(1);
    expect(emailReplyDrilldown.records[0]?.eventType).toBe("INBOUND_MESSAGE_RECEIVED");
    const meetingDrilldown = await metrics.getIntegratedDrilldown(context, { metricId: "meetings.scheduled", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(meetingDrilldown.records).toHaveLength(2);
    const proposalDrilldown = await metrics.getIntegratedDrilldown(context, { metricId: "sales.proposals", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(proposalDrilldown.records).toHaveLength(1);
    const activity = await metrics.getIntegratedActivityFacts(context, { from: from.toISOString(), to: to.toISOString(), filters: {} });
    expect(activity.filter((fact) => fact.eventType === "CALL_ATTEMPTED")).toHaveLength(15);
    expect(activity.filter((fact) => fact.eventType === "MEETING_SCHEDULED" && fact.sourceEntityType === "MeetingHistory")).toHaveLength(2);
    expect(activity.filter((fact) => fact.eventType === "PROPOSAL_REACHED" && fact.sourceEntityType === "Offer")).toHaveLength(1);
    const dashboard = await createDashboardMetricsService({ database, authorization, now: () => now }).getScreen(context, {
      preset: "CUSTOM", fromDate: "2052-04-20", toDate: "2052-04-21",
    });
    expect(dashboard.timeSeries.find((item) => item.id === "scheduled")?.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(2);
    expect(dashboard.timeSeries.find((item) => item.id === "leads")?.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
    expect(dashboard.timeSeries.find((item) => item.id === "calls")?.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(15);
    expect(dashboard.timeSeries.find((item) => item.id === "connected")?.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(6);
    expect(dashboard.timeSeries.find((item) => item.id === "proposals")?.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
    for (const [comparisonId, metricId] of [
      ["leads", "contacts.leads_created"],
      ["connected", "outreach.effective_contacts"],
      ["qualified", "qualification.leads"],
      ["scheduled", "meetings.scheduled"],
      ["proposals", "sales.proposals"],
      ["sales", "sales.won"],
      ["revenue", "sales.won_value"],
    ] as const) {
      const comparison = dashboard.comparisons.find((item) => item.id === comparisonId);
      const integrated = dashboard.integrated.values.find((item) => item.metricId === metricId);
      const seriesTotal = dashboard.timeSeries.find((item) => item.id === comparisonId)?.points.reduce((sum, point) => sum + BigInt(point.value ?? 0), 0n);
      expect(comparison?.current.value).toBe(integrated?.value);
      expect(seriesTotal).toBe(BigInt(integrated?.value ?? 0));
      expect(comparison?.current.drilldownId).toBe(`integrated:${metricId}`);
    }
  });

  it("corrige por fato compensatório e mantém a tabela append-only", async () => {
    const sourceEntityId = randomUUID();
    const original = await recordCommercialMetricFactInTransaction(database, { workspaceId: context.workspaceId, eventKey: `test:${sourceEntityId}:payment:v1`, eventType: "PAYMENT_CONFIRMED", occurredAt: now, sourceEntityType: "Payment", sourceEntityId, leadId, creditedMemberId: context.memberId, valueCents: 12_500n });
    await recordCommercialMetricCorrectionInTransaction(database, { workspaceId: context.workspaceId, eventKey: `test:${sourceEntityId}:payment-reversal:v1`, eventType: "PAYMENT_REVERSED", occurredAt: now, sourceEntityType: "Payment", sourceEntityId, leadId, creditedMemberId: context.memberId, valueCents: -12_500n, quantity: -1, correctionOfFactId: original.fact.id, reversalReason: "Teste de correção" });
    const balance = await database.commercialMetricFact.aggregate({ where: { workspaceId: context.workspaceId, sourceEntityId }, _sum: { valueCents: true } });
    expect(balance._sum.valueCents).toBe(0n);
    await expect(database.commercialMetricFact.update({ where: { id: original.fact.id }, data: { result: "mutação proibida" } })).rejects.toThrow(/append-only/);
  });

  it("atribui o agendamento ao vendedor que registrou a reunião", async () => {
    const owner = await database.workspaceMember.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, id: { not: context.memberId } },
      select: { id: true },
    });
    const occurredAt = new Date("2052-04-23T12:00:00.000Z");
    const meetingId = randomUUID();
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId,
      eventKey: `test:${meetingId}:seller-attribution:v1`,
      eventType: "MEETING_SCHEDULED",
      occurredAt,
      sourceEntityType: "MeetingHistory",
      sourceEntityId: meetingId,
      leadId: randomUUID(),
      creditedMemberId: owner.id,
      bookedByMemberId: context.memberId,
    });
    const stageHistoryId = randomUUID();
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId,
      eventKey: `test:${stageHistoryId}:stage-entry:v1`,
      eventType: "STAGE_ENTERED",
      occurredAt,
      sourceEntityType: "StageHistory",
      sourceEntityId: stageHistoryId,
      leadId: randomUUID(),
      creditedMemberId: owner.id,
      performedByMemberId: context.memberId,
      executionMode: "MANUAL",
    });
    const period = { from: "2052-04-23T00:00:00.000Z", to: "2052-04-24T00:00:00.000Z" };
    const booked = await metrics.getIntegratedOverview(context, { ...period, filters: { sdrMemberIds: [context.memberId] } });
    const owned = await metrics.getIntegratedOverview(context, { ...period, filters: { sdrMemberIds: [owner.id] } });
    expect(booked.values.find((metric) => metric.metricId === "meetings.scheduled")?.value).toBe(1);
    expect(owned.values.find((metric) => metric.metricId === "meetings.scheduled")?.value).toBe(0);
    expect(booked.values.find((metric) => metric.metricId === "funnel.stage_entries")?.value).toBe(1);
    expect(owned.values.find((metric) => metric.metricId === "funnel.stage_entries")?.value).toBe(0);
  });

  it("faz cartões, gráfico e log concordarem sobre vendas e receita", async () => {
    const opportunityId = randomUUID();
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId,
      eventKey: `test:${opportunityId}:sale-won:v1`,
      eventType: "SALE_WON",
      occurredAt: new Date("2052-04-24T12:00:00.000Z"),
      sourceEntityType: "OpportunityOutcomeSnapshot",
      sourceEntityId: opportunityId,
      opportunityId,
      leadId: randomUUID(),
      creditedMemberId: context.memberId,
      valueCents: 25_000n,
    });
    const dashboard = await createDashboardMetricsService({ database, authorization, now: () => now }).getScreen(context, {
      preset: "CUSTOM", fromDate: "2052-04-24", toDate: "2052-04-24",
    });
    const comparison = (id: string) => dashboard.comparisons.find((item) => item.id === id);
    const seriesValue = (id: string) => dashboard.timeSeries.find((item) => item.id === id)?.points.reduce((sum, point) => sum + BigInt(point.value ?? 0), 0n);
    expect(comparison("sales")?.current.value).toBe(1);
    expect(comparison("revenue")?.current.value).toBe("25000");
    expect(comparison("sales")?.current.drilldownId).toBe("integrated:sales.won");
    expect(comparison("revenue")?.current.drilldownId).toBe("integrated:sales.won_value");
    expect(seriesValue("sales")).toBe(1n);
    expect(seriesValue("revenue")).toBe(25_000n);
  });

  it("aplica produto e prioridade ao log e ao gráfico com o mesmo recorte", async () => {
    const existingLead = await database.lead.findFirstOrThrow({ where: { workspaceId: context.workspaceId, fullName: "Lead de reconciliação de chamadas" } });
    const lead = await database.lead.create({ data: {
      workspaceId: context.workspaceId, sourceId: existingLead.sourceId, pipelineId: existingLead.pipelineId,
      currentStageId: existingLead.currentStageId, ownerMemberId: context.memberId,
      fullName: "Lead isolado para filtro de produto", slaStartedAt: now, slaDueAt: now, lastActivityAt: now,
      createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    const products = await database.product.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, take: 2, orderBy: { id: "asc" } });
    const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId: context.workspaceId, entityType: "OPPORTUNITY", deletedAt: null }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" }, take: 1 } } });
    expect(products).toHaveLength(2);
    await database.leadScore.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, source: "HUMAN_OVERRIDE", priorityBandCode: "P1", score: 90,
      currentRevision: 1, modelKey: "filter-parity", modelVersion: "1", reason: "Teste de filtro", inputSnapshot: {},
      calculatedByActorId: context.actorId, calculatedAt: new Date("2052-04-19T12:00:00.000Z"),
    } });
    await database.opportunity.create({ data: {
      workspaceId: context.workspaceId, leadId: lead.id, pipelineId: pipeline.id, currentStageId: pipeline.stages[0]!.id,
      ownerMemberId: context.memberId, productId: products[0]!.id, name: "Oportunidade de filtro", amountCents: 10_000n,
      probabilityBps: 1_000, createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    const eventId = randomUUID();
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId, eventKey: `filter:${eventId}:call:v1`, eventType: "CALL_ATTEMPTED",
      occurredAt: new Date("2052-04-25T12:00:00.000Z"), sourceEntityType: "FilterParityFixture", sourceEntityId: eventId,
      leadId: lead.id, creditedMemberId: context.memberId,
    });
    const period = { from: "2052-04-25T00:00:00.000Z", to: "2052-04-26T00:00:00.000Z" };
    const count = async (priorityCodes: ("P1" | "P2")[], productIds: string[]) => {
      const overview = await metrics.getIntegratedOverview(context, { ...period, filters: { priorityCodes, productIds } });
      return overview.values.find((metric) => metric.metricId === "outreach.calls_attempted")?.value;
    };
    expect(await count(["P1"], [products[0]!.id])).toBe(1);
    expect(await count(["P2"], [products[0]!.id])).toBe(0);
    expect(await count(["P1"], [products[1]!.id])).toBe(0);
    const records = await metrics.getIntegratedDrilldown(context, {
      metricId: "outreach.calls_attempted", query: { ...period, filters: { priorityCodes: ["P1"], productIds: [products[0]!.id] } }, limit: 10,
    });
    expect(records.records.some((record) => record.sourceEntityId === eventId)).toBe(true);
    const dashboard = await createDashboardMetricsService({ database, authorization, now: () => now }).getScreen(context, {
      preset: "CUSTOM", fromDate: "2052-04-25", toDate: "2052-04-25", priority: ["P1"], product: [products[0]!.id],
    });
    expect(dashboard.integrated.values.find((metric) => metric.metricId === "outreach.calls_attempted")?.value).toBe(1);
    expect(dashboard.timeSeries.find((item) => item.id === "calls")?.points.reduce((sum, point) => sum + Number(point.value), 0)).toBe(1);
  });

  it("não revela vendedor fora do escopo próprio na tabela de performance", async () => {
    const seller = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: context.workspaceId, user: { normalizedEmail: "sdr1@demo.politizai.local" } }, include: { role: true, user: true } });
    const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: context.workspaceId, userId: seller.userId, type: "HUMAN" } });
    const sellerContext: AuthenticatedContext = {
      ...context, sessionId: randomUUID(), userId: seller.userId, memberId: seller.id, actorId: actor.id,
      roleId: seller.roleId, roleKey: seller.role.key, roleName: seller.role.name, displayName: seller.user.displayName,
    };
    const eventId = randomUUID();
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: context.workspaceId, eventKey: `scope:${eventId}:call:v1`, eventType: "CALL_ATTEMPTED",
      occurredAt: new Date("2052-04-26T12:00:00.000Z"), sourceEntityType: "ScopeFixture", sourceEntityId: eventId,
      leadId: randomUUID(), creditedMemberId: context.memberId, leadOwnerMemberIdAtEvent: seller.id,
    });
    const screen = await createDashboardMetricsService({ database, authorization, now: () => now }).getScreen(sellerContext, {
      preset: "CUSTOM", fromDate: "2052-04-26", toDate: "2052-04-26",
    });
    expect(screen.overview.scope).toBe("OWN");
    expect(screen.integrated.values.find((metric) => metric.metricId === "outreach.calls_attempted")?.value).toBe(1);
    expect(screen.sellerActivity.every((row) => row.id === seller.id)).toBe(true);
  });

  it("expõe estados zero e sem denominador com drill-down seguro", async () => {
    const overview = await metrics.getIntegratedOverview(context, { from: "2052-04-20T00:00:00.000Z", to: "2052-04-21T00:00:00.000Z", filters: {} });
    expect(overview.values.find((metric) => metric.metricId === "outreach.call_connection_rate")?.state).toBe("NO_DENOMINATOR");
    const cash = overview.values.find((metric) => metric.metricId === "cash.received");
    expect(cash?.value).toBe("0");
    const drilldown = await metrics.getIntegratedDrilldown(context, { metricId: "cash.received", query: { from: "2052-04-20T00:00:00.000Z", to: "2052-04-21T00:00:00.000Z", filters: {} }, limit: 10 });
    expect(drilldown.records.every((record) => !("body" in record))).toBe(true);
  });
});
