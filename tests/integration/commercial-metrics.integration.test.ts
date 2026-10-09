import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { recordCommercialMetricCorrectionInTransaction, recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createCommercialMetricBackfillService } from "@/modules/metrics/application/commercial-metric-backfill-service";
import { createCommercialMetricReconciliationService } from "@/modules/metrics/application/commercial-metric-reconciliation-service";
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
    const result = await backfill.run(context, { mode: "APPLY", runKey: `commercial-metrics:test:${randomUUID()}`, batchSize: 100 });
    expect(result.status).toBe("COMPLETED");
    expect(result.failedCount).toBe(0);
    const report = await reconciliation.run(context, { runKey: `commercial-metrics:reconcile:${randomUUID()}` });
    expect(report.status).toBe("COMPLETED");
    expect(report.divergentCheckCount).toBe(0);
    expect("checks" in report ? report.checks.length : 0).toBeGreaterThan(30);
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
      }
      for (let index = 0; index < 3; index += 1) {
        const revisionId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${revisionId}:qualified:v1`, eventType: "LEAD_QUALIFIED", occurredAt: from, sourceEntityType: "StageHistory", sourceEntityId: revisionId, leadId: leadIds[index]!, creditedMemberId: context.memberId });
      }
      for (let index = 0; index < 2; index += 1) {
        const meetingId = randomUUID();
        await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${meetingId}:scheduled:v1`, eventType: "MEETING_SCHEDULED", occurredAt: from, sourceEntityType: "MeetingHistory", sourceEntityId: meetingId, meetingId, leadId: leadIds[index]!, creditedMemberId: context.memberId, bookedByMemberId: context.memberId });
        if (index === 0) await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `known:${meetingId}:completed:v1`, eventType: "MEETING_COMPLETED", occurredAt: from, sourceEntityType: "MeetingHistory", sourceEntityId: meetingId, meetingId, leadId: leadIds[index]!, creditedMemberId: context.memberId });
      }
    });
    const overviewStartedAt = performance.now();
    const overview = await metrics.getIntegratedOverview(context, { from: from.toISOString(), to: to.toISOString(), filters: {} });
    expect(performance.now() - overviewStartedAt).toBeLessThan(1_500);
    const value = (metricId: string) => overview.values.find((metric) => metric.metricId === metricId);
    expect(value("work.tasks_completed")?.value).toBe(30);
    expect(value("outreach.calls_attempted")?.value).toBe(15);
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
    expect(value("qualification.leads")?.value).toBe(3);
    expect(value("meetings.scheduled")?.value).toBe(2);
    expect(value("meetings.completed")?.value).toBe(1);
    expect(value("sales.won")?.state).toBe("ZERO");
    expect(value("sales.win_rate")?.state).toBe("NO_DENOMINATOR");
    const drilldownStartedAt = performance.now();
    const drilldown = await metrics.getIntegratedDrilldown(context, { metricId: "outreach.calls_attempted", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(performance.now() - drilldownStartedAt).toBeLessThan(1_000);
    expect(drilldown.records).toHaveLength(15);
    const noAnswerDrilldown = await metrics.getIntegratedDrilldown(context, { metricId: "outreach.calls_no_answer", query: { from: from.toISOString(), to: to.toISOString(), filters: {} }, limit: 20 });
    expect(noAnswerDrilldown.records).toHaveLength(5);
    expect(noAnswerDrilldown.records.every((record) => record.result === "NO_ANSWER")).toBe(true);
  });

  it("corrige por fato compensatório e mantém a tabela append-only", async () => {
    const sourceEntityId = randomUUID();
    const original = await recordCommercialMetricFactInTransaction(database, { workspaceId: context.workspaceId, eventKey: `test:${sourceEntityId}:payment:v1`, eventType: "PAYMENT_CONFIRMED", occurredAt: now, sourceEntityType: "Payment", sourceEntityId, leadId, creditedMemberId: context.memberId, valueCents: 12_500n });
    await recordCommercialMetricCorrectionInTransaction(database, { workspaceId: context.workspaceId, eventKey: `test:${sourceEntityId}:payment-reversal:v1`, eventType: "PAYMENT_REVERSED", occurredAt: now, sourceEntityType: "Payment", sourceEntityId, leadId, creditedMemberId: context.memberId, valueCents: -12_500n, quantity: -1, correctionOfFactId: original.fact.id, reversalReason: "Teste de correção" });
    const balance = await database.commercialMetricFact.aggregate({ where: { workspaceId: context.workspaceId, sourceEntityId }, _sum: { valueCents: true } });
    expect(balance._sum.valueCents).toBe(0n);
    await expect(database.commercialMetricFact.update({ where: { id: original.fact.id }, data: { result: "mutação proibida" } })).rejects.toThrow(/append-only/);
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
