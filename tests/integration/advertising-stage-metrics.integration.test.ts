import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createRealtimeDashboardService } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";
import { readRealtimeDashboardFacts, realtimeActivityFact } from "@/modules/realtime-dashboard/application/realtime-dashboard-facts";
import { advertisingAssignedMeetings, advertisingLeadArrivals } from "@/modules/realtime-dashboard/domain/realtime-advertising-metrics";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { recordCommercialMetricCorrectionInTransaction, recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required");
const db = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const authorization = createAuthorizationService({ database: db });
let clock = new Date("2026-10-28T15:00:00Z"), context: AuthenticatedContext, closerId: string, pipelineId: string;
let sequence = 67000000;
const stages = new Map<string, string>();
const meetings = () => createMeetingService({ database: db, authorization, now: () => clock });
const realtime = () => createRealtimeDashboardService({ database: db, authorization, now: () => new Date(clock.getTime() + 1000) });
async function newLead() {
  const result = await createLeadIntakeService({ database: db, authorization, now: () => clock }).intake({ channel: "MANUAL", idempotencyKey: randomUUID(), fullName: `Fluxo anúncios ${++sequence}`, phone: `+55119${sequence}`, sourceKey: "manual", pipelineId, priorityBandCode: "P3", rawPayload: { test: "stage-metrics" } }, context);
  if (result.outcome === "REJECTED") throw new Error(result.code);
  await db.lead.update({ where: { id: result.leadId }, data: { ownerMemberId: closerId, queueId: null } });
  return result.leadId;
}
async function move(leadId: string, code: string, beforeCommit?: () => Promise<void>) {
  clock = new Date(clock.getTime() + 1000);
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  return createPreSalesPipelineService({ database: db, authorization, now: () => clock, ...(beforeCommit ? { beforeCommit } : {}) }).transition(context, { leadId, targetStageId: stages.get(code)!, expectedUpdatedAt: lead.updatedAt.toISOString(), origin: "PIPELINE_BOARD", reason: `Resultado confirmado: ${code}` });
}
async function balance(leadId: string, eventType: "MEETING_SCHEDULED" | "MEETING_COMPLETED" | "MEETING_NO_SHOW") {
  return (await db.commercialMetricFact.aggregate({ where: { workspaceId: context.workspaceId, leadId, eventType }, _sum: { quantity: true } }))._sum.quantity ?? 0;
}

beforeAll(async () => {
  const { workspaceId } = await seedDemoDatabase(db, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" });
  const member = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId, role: { key: "administrator" } }, include: { user: true, role: true } });
  const actor = await db.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId } });
  context = { workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, sessionId: randomUUID(), roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const closer = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId, role: { key: "closer" } } });
  closerId = closer.id;
  await ensureAdvertisingPipeline(db, workspaceId, actor.id);
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Anúncios" }, include: { stages: true } });
  pipelineId = pipeline.id;
  for (const stage of pipeline.stages) if (stage.leadStageCode) stages.set(stage.leadStageCode, stage.id);
});
afterAll(() => db.$disconnect());

it("retira os fatos do teste excluído sem diminuir as entradas reais do Tempo Real", async () => {
  const from = new Date(clock);
  const testLeadId = await newLead();
  const realLeadId = await newLead();
  const to = new Date(clock.getTime() + 1000);
  const before = await readRealtimeDashboardFacts(db, context.workspaceId, from, to, "ADVERTISING");
  expect(advertisingLeadArrivals(before.factRows.map(realtimeActivityFact)).has(testLeadId)).toBe(true);
  expect(advertisingLeadArrivals(before.factRows.map(realtimeActivityFact)).has(realLeadId)).toBe(true);
  const originals = await db.commercialMetricFact.findMany({ where: { workspaceId: context.workspaceId, leadId: testLeadId } });
  await db.$transaction(async transaction => {
    await transaction.lead.update({ where: { id: testLeadId }, data: { deletedAt: clock } });
    for (const fact of originals) await recordCommercialMetricCorrectionInTransaction(transaction, {
      workspaceId: context.workspaceId, leadId: testLeadId, eventKey: `${fact.eventKey}:test-removal:reversal:v1`,
      eventType: fact.eventType, sourceEntityType: fact.sourceEntityType, sourceEntityId: fact.sourceEntityId,
      occurredAt: fact.occurredAt, pipelineId: fact.pipelineId, creditedMemberId: fact.creditedMemberId,
      quantity: -fact.quantity, correctionOfFactId: fact.id, reversalReason: "Exclusão do teste.",
    });
  });
  const after = await readRealtimeDashboardFacts(db, context.workspaceId, from, to, "ADVERTISING");
  const arrivals = advertisingLeadArrivals(after.factRows.map(realtimeActivityFact));
  expect.soft(arrivals.has(testLeadId)).toBe(false);
  expect.soft(arrivals.has(realLeadId)).toBe(true);
  expect.soft(after.factRows.some(fact => fact.leadId === testLeadId)).toBe(false);
});

it("movimento manual registra agendamento, no-show, realização e proposta sem duplicar resultados", async () => {
  const leadId = await newLead();
  const activeBefore = (await realtime().screen(context, "PROSPECTING")).snapshot.today.totals;
  const before = (await realtime().screen(context, "ADVERTISING")).snapshot.today.totals;
  await move(leadId, "MEETING_SCHEDULED");
  expect(await balance(leadId, "MEETING_SCHEDULED")).toBe(1);
  await move(leadId, "MEETING_NO_SHOW");
  expect(await balance(leadId, "MEETING_NO_SHOW")).toBe(1);
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(0);
  await move(leadId, "MEETING_COMPLETED");
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
  expect(await balance(leadId, "MEETING_NO_SHOW")).toBe(0);
  await move(leadId, "PROPOSAL");
  await move(leadId, "MEETING_COMPLETED");
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
  const after = (await realtime().screen(context, "ADVERTISING")).snapshot.today.totals;
  expect(after.meetingsScheduled - before.meetingsScheduled).toBe(1);
  expect(after.meetingsCompleted - before.meetingsCompleted).toBe(1);
  expect((await realtime().screen(context, "PROSPECTING")).snapshot.today.totals).toEqual(activeBefore);
  expect(await db.activity.count({ where: { leadId, type: "STAGE_CHANGE" } })).toBe(5);
  expect(await db.auditLog.count({ where: { workspaceId: context.workspaceId, entityId: leadId, action: "lead.stage.transitioned" } })).toBe(5);
});

it("card de reunião vinculada atualiza agenda, tarefa e métricas atomicamente", async () => {
  const leadId = await newLead();
  const saved = await meetings().schedule(context, { leadId, closerId, title: "Diagnóstico vinculado", startsAtLocal: "2026-10-28T09:00", durationMinutes: 30 });
  await expect(move(leadId, "MEETING_COMPLETED", async () => { throw new Error("rollback resultado"); })).rejects.toThrow("rollback resultado");
  expect(await db.meeting.findUniqueOrThrow({ where: { id: saved.meetingId } })).toMatchObject({ status: "SCHEDULED", revision: 1 });
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(0);
  await move(leadId, "MEETING_COMPLETED");
  expect(await db.meeting.findUniqueOrThrow({ where: { id: saved.meetingId } })).toMatchObject({ status: "COMPLETED", revision: 2 });
  expect(await db.task.findUniqueOrThrow({ where: { id: saved.taskId } })).toMatchObject({ status: "COMPLETED" });
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
  await move(leadId, "PROPOSAL");
  await move(leadId, "MEETING_COMPLETED");
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
  await move(leadId, "MEETING_NO_SHOW");
  expect(await db.meeting.findUniqueOrThrow({ where: { id: saved.meetingId } })).toMatchObject({ status: "NO_SHOW", revision: 3, completedAt: null });
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(0);
  expect(await balance(leadId, "MEETING_NO_SHOW")).toBe(1);
});

it("proposta isolada não inventa realização nem venda e Cliente exige fechamento integrado", async () => {
  const leadId = await newLead();
  await move(leadId, "PROPOSAL");
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(0);
  await expect(move(leadId, "CLIENT")).rejects.toMatchObject({ code: "INTEGRATED_SALE_REQUIRED" });
  expect(await db.commercialMetricFact.count({ where: { leadId, eventType: "SALE_WON" } })).toBe(0);
});

it("vínculo posterior à Agenda preserva a data e o autor do agendamento e atribui a meta ao vendedor", async () => {
  const leadId = await newLead();
  await db.lead.update({ where: { id: leadId }, data: { ownerMemberId: context.memberId } });
  await move(leadId, "MEETING_SCHEDULED");
  const bookingDate = clock;
  clock = new Date(clock.getTime() + 86_400_000);
  await meetings().schedule(context, { leadId, closerId, title: "Agenda após card", startsAtLocal: "2026-10-28T09:00", durationMinutes: 30 });
  expect(await balance(leadId, "MEETING_SCHEDULED")).toBe(1);
  const facts = await db.commercialMetricFact.findMany({ where: { leadId, eventType: "MEETING_SCHEDULED" } });
  expect(facts.filter(row => row.creditedMemberId === context.memberId).reduce((sum, row) => sum + row.quantity, 0)).toBe(1);
  expect(facts.filter(row => row.meetingOwnerMemberIdAtEvent === closerId).reduce((sum, row) => sum + row.quantity, 0)).toBe(1);
  expect(facts.filter(row => row.occurredAt.getTime() > bookingDate.getTime()).reduce((sum, row) => sum + row.quantity, 0)).toBe(0);
  const snapshot = (await realtime().screen(context, "ADVERTISING")).snapshot;
  const canonical = await readRealtimeDashboardFacts(db, context.workspaceId, new Date(snapshot.week.period.from), new Date(snapshot.week.period.to), "ADVERTISING");
  expect(advertisingAssignedMeetings(canonical.factRows.filter(row => row.leadId === leadId).map(realtimeActivityFact), closerId)).toBe(1);
  await move(leadId, "MEETING_COMPLETED");
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
});

it("fechamento integrado cria uma única venda e mantém a reunião realizada nas métricas de Anúncios", async () => {
  await db.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8"));
  const leadId = await newLead();
  const booked = await meetings().schedule(context, { leadId, closerId, title: "Reunião antes da venda", startsAtLocal: "2026-10-28T09:00", durationMinutes: 30 });
  await move(leadId, "MEETING_COMPLETED");
  const completedAt = (await db.meeting.findUniqueOrThrow({ where: { id: booked.meetingId } })).completedAt!;
  await move(leadId, "PROPOSAL");
  const active = (await realtime().screen(context, "PROSPECTING")).snapshot.week.totals;
  const before = (await realtime().screen(context, "ADVERTISING")).snapshot.week.totals;
  const sale = createSaleCompletionService({ database: db, now: () => clock });
  const command = { leadId, sellerMemberId: closerId, totalCents: "100000", upfrontCents: "0", installmentCents: "100000", installmentCount: 1, paymentPlan: "CARD_INSTALLMENTS", paymentCondition: "Parcela única", confirmed: true, idempotencyKey: randomUUID() };
  const result = await sale.completeLeadSale(context, command);
  expect((await sale.completeLeadSale(context, command)).replayed).toBe(true);
  expect(await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { currentStage: true } })).toMatchObject({ status: "CONVERTED", currentStage: { leadStageCode: "CLIENT" } });
  expect(await db.commercialMetricFact.count({ where: { leadId, eventType: "SALE_WON" } })).toBe(1);
  const after = (await realtime().screen(context, "ADVERTISING")).snapshot.week.totals;
  expect(after.sales - before.sales).toBe(1);
  expect(BigInt(after.salesValueCents) - BigInt(before.salesValueCents)).toBe(100000n);
  expect(after.meetingsCompleted).toBe(before.meetingsCompleted);
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
  expect((await realtime().screen(context, "PROSPECTING")).snapshot.week.totals).toEqual(active);
  expect(result.opportunityId).toBeTruthy();
  clock = new Date(clock.getTime() + 86_400_000);
  const meeting = await db.meeting.findUniqueOrThrow({ where: { id: booked.meetingId } });
  await meetings().act(context, { action: "EDIT", meetingId: meeting.id, expectedRevision: meeting.revision, title: "Resumo revisado após venda", startsAtLocal: "2026-10-28T09:00", durationMinutes: 30, status: "COMPLETED", observation: null, outcome: "Somente revisão do resumo da reunião", reason: "Corrigir o resumo sem alterar a data de realização." });
  expect(await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { currentStage: true } })).toMatchObject({ status: "CONVERTED", currentStage: { leadStageCode: "CLIENT" } });
  expect(await db.task.findUniqueOrThrow({ where: { id: booked.taskId } })).toMatchObject({ completedAt });
  const sameDay = await db.commercialMetricFact.aggregate({ where: { leadId, eventType: "MEETING_COMPLETED", occurredAt: completedAt }, _sum: { quantity: true } });
  expect(sameDay._sum.quantity).toBe(1);
});

it("não realiza reunião futura e rejeita versão desatualizada ou outro tenant sem gravação parcial", async () => {
  const leadId = await newLead();
  const saved = await meetings().schedule(context, { leadId, closerId, title: "Reunião futura", startsAtLocal: "2035-10-28T09:00", durationMinutes: 30 });
  await expect(move(leadId, "MEETING_COMPLETED")).rejects.toMatchObject({ code: "MEETING_NOT_STARTED" });
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(0);
  expect(await db.meeting.findUniqueOrThrow({ where: { id: saved.meetingId } })).toMatchObject({ status: "SCHEDULED", revision: 1 });
  const past = await newLead();
  await meetings().schedule(context, { leadId: past, closerId, title: "Reunião com concorrência", startsAtLocal: "2026-10-28T09:00", durationMinutes: 30 });
  const command = { leadId: past, targetStageId: stages.get("MEETING_COMPLETED")!, expectedUpdatedAt: "2020-01-01T00:00:00Z", origin: "PIPELINE_BOARD" };
  const service = createPreSalesPipelineService({ database: db, authorization, now: () => clock });
  await expect(service.transition(context, command)).rejects.toMatchObject({ code: "LEAD_VERSION_CONFLICT" });
  await expect(service.transition({ ...context, workspaceId: randomUUID() }, command)).rejects.toBeDefined();
  expect(await balance(past, "MEETING_COMPLETED")).toBe(0);
});

it("não duplica realização retroativa já registrada no histórico de atividades", async () => {
  const leadId = await newLead();
  const activity = await db.activity.create({ data: { workspaceId: context.workspaceId, leadId, type: "MEETING", result: "COMPLETED", subject: "Realização retroativa confirmada", occurredAt: clock, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
  await db.$transaction(tx => recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `activity:${activity.id}:meeting_completed:v1`, eventType: "MEETING_COMPLETED", occurredAt: clock, sourceEntityType: "Activity", sourceEntityId: activity.id, activityId: activity.id, leadId, pipelineId, creditedMemberId: closerId }));
  await move(leadId, "MEETING_COMPLETED");
  expect(await balance(leadId, "MEETING_COMPLETED")).toBe(1);
});
