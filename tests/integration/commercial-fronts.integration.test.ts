import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import { createCommercialFrontSnapshotService } from "@/modules/metrics/application/commercial-front-snapshot-service";
import { createDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createCommercialHistoryService } from "@/modules/activities/application/commercial-history-service";
import { createRelatedCommercialHistoryService } from "@/modules/contacts/application/related-commercial-history-service";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { createUnifiedActivityService } from "@/modules/activities/application/unified-activity-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureProductionFoundation } from "@/modules/settings/application/production-foundation-service";
import { defaultRoleDefinitions } from "@/modules/users/permissions/default-role-definitions";
import { transitionLeadStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2058-05-20T18:00:00.000Z");
const bookedAt = new Date("2058-05-20T12:00:00.000Z");
const completedAt = new Date("2058-05-20T16:00:00.000Z");
const query = { from: "2058-05-20T03:00:00.000Z", to: "2058-05-21T03:00:00.000Z", filters: {} };
let workspaceId: string;
const workspaceSlug = `commercial-fronts-${randomUUID()}`;
let admin: AuthenticatedContext;
let carlos: AuthenticatedContext;
let jhon: AuthenticatedContext;
let ede: AuthenticatedContext;
let ads: { id: string };
let prospecting: { id: string };
let sourceId: string;
const leads: string[] = [];
const metrics = createMetricsService({ database, authorization, now: () => now });

async function context(demoEmail: string): Promise<AuthenticatedContext> {
  const email = demoEmail.replace("@demo.politizai.local", `+${workspaceSlug}@fronts.test`);
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { workspaceId, workspaceSlug, sessionId: randomUUID(), userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName, email };
}

beforeAll(async () => {
  await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" });
  workspaceId = (await database.workspace.create({ data: { slug: workspaceSlug, name: "Frentes — fixture isolada", timeZone: "America/Sao_Paulo" } })).id;
  const system = await database.actor.create({ data: { workspaceId, key: "system", type: "SYSTEM", displayName: "Sistema sintético" } });
  const permissions = new Map((await database.permission.findMany()).map((permission) => [permission.key, permission.id]));
  const roleIds = new Map<string, string>();
  for (const definition of defaultRoleDefinitions) {
    const role = await database.role.create({ data: { workspaceId, key: definition.key, name: definition.name, createdByActorId: system.id, updatedByActorId: system.id } });
    roleIds.set(definition.key, role.id);
    await database.rolePermission.createMany({ data: definition.grants.map(([permission, scope]) => ({ workspaceId, roleId: role.id, permissionId: permissions.get(permission)!, scope, createdByActorId: system.id })) });
  }
  for (const [email, role] of [["admin@demo.politizai.local", "administrator"], ["sdr1@demo.politizai.local", "sdr"], ["closer1@demo.politizai.local", "closer"], ["closer2@demo.politizai.local", "closer"]] as const) {
    const address = email.replace("@demo.politizai.local", `+${workspaceSlug}@fronts.test`);
    const name = email.startsWith("sdr1") ? "Carlos" : email.startsWith("closer1") ? "Jhon" : email.startsWith("closer2") ? "Ede" : "Admin sintético";
    const user = await database.user.create({ data: { email: address, normalizedEmail: address, displayName: name } });
    await database.workspaceMember.create({ data: { workspaceId, userId: user.id, roleId: roleIds.get(role)!, status: "ACTIVE", joinedAt: now, createdByActorId: system.id, updatedByActorId: system.id } });
    await database.actor.create({ data: { workspaceId, userId: user.id, key: `user:${user.id}`, type: "HUMAN", displayName: user.displayName } });
  }
  await ensureProductionFoundation(database, workspaceSlug);
  await database.leadSource.create({ data: { workspaceId, key: "manual", name: "Manual", type: "MANUAL", createdByActorId: system.id, updatedByActorId: system.id } });
  [admin, carlos, jhon, ede] = await Promise.all([context("admin@demo.politizai.local"), context("sdr1@demo.politizai.local"), context("closer1@demo.politizai.local"), context("closer2@demo.politizai.local")]);
  ads = await database.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Anúncios" } });
  prospecting = await database.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Prospecção Ativa" } });
  sourceId = (await database.leadSource.findFirstOrThrow({ where: { workspaceId } })).id;
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: ads.id, leadStageCode: "NEW" } });
  for (let index = 0; index < 30; index++) {
    const contact = await database.contact.create({ data: { workspaceId, preferredName: `Pessoa sintética ${index}`, quality: "CONFIRMED", origin: "LEAD_INTAKE", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const lead = await database.lead.create({ data: { workspaceId, contactId: contact.id, sourceId, pipelineId: ads.id, currentStageId: stage.id, ownerMemberId: carlos.memberId, fullName: `Lead sintético ${index}`, slaStartedAt: bookedAt, slaDueAt: bookedAt, lastActivityAt: bookedAt, createdAt: bookedAt, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    leads.push(lead.id);
    await database.stageHistory.create({ data: { workspaceId, leadId: lead.id, pipelineId: ads.id, stageId: stage.id, enteredAt: bookedAt, enteredByActorId: admin.actorId, transitionOrigin: "INTAKE" } });
    for (const eventType of ["LEAD_CREATED", "LEAD_SUBMISSION_ATTACHED"] as const) await recordCommercialMetricFactInTransaction(database, { workspaceId, eventKey: `fronts:${eventType}:${lead.id}`, eventType, occurredAt: bookedAt, sourceEntityType: "Lead", sourceEntityId: lead.id, leadId: lead.id, contactId: contact.id, pipelineId: ads.id, creditedMemberId: carlos.memberId, leadOwnerMemberIdAtEvent: carlos.memberId });
    if (index >= 10) continue;
    const owner = index < 5 ? jhon : ede;
    const held = index < 3 || (index >= 5 && index < 9);
    const meeting = await database.meeting.create({ data: { workspaceId, leadId: lead.id, ownerMemberId: owner.memberId, title: `Reunião sintética ${index}`, status: held ? "COMPLETED" : "SCHEDULED", completedAt: held ? completedAt : null, startsAt: completedAt, endsAt: new Date(completedAt.getTime() + 1_800_000), durationMinutes: 30, timeZone: "America/Sao_Paulo", createdByActorId: carlos.actorId, updatedByActorId: owner.actorId } });
    await recordCommercialMetricFactInTransaction(database, { workspaceId, eventKey: `fronts:booking:${meeting.id}`, eventType: "MEETING_SCHEDULED", occurredAt: bookedAt, sourceEntityType: "MeetingHistory", sourceEntityId: meeting.id, meetingId: meeting.id, leadId: lead.id, pipelineId: ads.id, bookedByMemberId: carlos.memberId, creditedMemberId: carlos.memberId, meetingOwnerMemberIdAtEvent: owner.memberId });
    if (held) await recordCommercialMetricFactInTransaction(database, { workspaceId, eventKey: `fronts:held:${meeting.id}`, eventType: "MEETING_COMPLETED", occurredAt: completedAt, sourceEntityType: "MeetingHistory", sourceEntityId: meeting.id, meetingId: meeting.id, leadId: lead.id, pipelineId: ads.id, creditedMemberId: owner.memberId, meetingOwnerMemberIdAtEvent: owner.memberId });
  }
}, 60_000);
afterAll(async () => database.$disconnect());

describe("frentes comerciais integradas", () => {
  it("prova Carlos/Jhon/Ede, coortes e três reuniões sem resultado inferido", async () => {
    const result = await metrics.getCommercialFrontSummary(admin, { ...query, filters: { pipelineIds: [ads.id] } });
    expect(result.total).toMatchObject({ entries: 30, participations: 30, uniquePeople: 30, booked: 10, completed: 7, bookingCohort: { numerator: 10, denominator: 30 }, completionCohort: { numerator: 7, denominator: 10 } });
    expect(result.total.members).toEqual(expect.arrayContaining([
      { memberId: carlos.memberId, booked: 10, assigned: 0, completed: 0 },
      { memberId: jhon.memberId, booked: 0, assigned: 5, completed: 3 },
      { memberId: ede.memberId, booked: 0, assigned: 5, completed: 4 },
    ]));
    expect(await database.meeting.count({ where: { workspaceId, leadId: { in: leads }, status: "SCHEDULED" } })).toBe(3);
    const own = await metrics.getCommercialFrontSummary(jhon, { ...query, filters: { pipelineIds: [ads.id] } });
    expect(own.total.members.find((row) => row.memberId === jhon.memberId)).toMatchObject({ assigned: 5, completed: 3 });
    const ownEvidence = await metrics.getCommercialFrontEvidence(jhon, { query: { ...query, filters: { pipelineIds: [ads.id] } }, measure: "assigned", memberId: jhon.memberId });
    expect(ownEvidence.total).toBe(5);
    expect((await metrics.getCommercialFrontEvidence(jhon, { query: { ...query, filters: { pipelineIds: [ads.id] } }, measure: "assigned", memberId: ede.memberId })).total).toBe(0);
    expect((await metrics.getCommercialFrontSummary(admin, { ...query, filters: { pipelineIds: [prospecting.id] } })).total.entries).toBe(0);
  });

  it("isola modo no servidor, preserva datas diferentes e não recredita por owner atual", async () => {
    const dashboard = createDashboardMetricsService({ database, authorization, now: () => now });
    const exact = await dashboard.parseQuery(admin, { mode: "ADVERTISING", preset: "CUSTOM", fromDate: "2058-05-20", toDate: "2058-05-20", from: query.from, to: now.toISOString() });
    expect(exact).toMatchObject({ from: query.from, to: now.toISOString() });
    const explicit = await dashboard.getScreen(admin, { from: "2057-01-03T03:00:00.000Z", to: "2057-01-08T03:00:00.000Z" });
    expect(explicit.query).toMatchObject({ preset: "CUSTOM", fromDate: "2057-01-03", toDate: "2057-01-07" });
    expect(new Date(explicit.comparisonPeriod.from).getTime()).toBeLessThan(new Date(explicit.comparisonPeriod.to).getTime());
    const screen = await dashboard.getScreen(admin, { mode: "ADVERTISING", preset: "TODAY" });
    expect(screen.query.filters.pipelineIds).toEqual([ads.id]);
    expect(screen.commercialSummary?.total.entries).toBe(30);
    const impossible = await dashboard.getScreen(admin, { mode: "ADVERTISING", pipeline: prospecting.id, preset: "TODAY" });
    expect(impossible.commercialSummary?.total.entries).toBe(0);
    await database.lead.update({ where: { id: leads[0]! }, data: { ownerMemberId: ede.memberId } });
    const after = await metrics.getCommercialFrontSummary(admin, { ...query, filters: { pipelineIds: [ads.id] } });
    expect(after.total.members.find((row) => row.memberId === carlos.memberId)?.booked).toBe(10);
    const afterBooking = await metrics.getCommercialFrontSummary(admin, { ...query, from: "2058-05-20T15:00:00.000Z", filters: { pipelineIds: [ads.id] } });
    expect(afterBooking.total).toMatchObject({ booked: 0, completed: 7, completionCohort: { numerator: 0, denominator: 0, rate: null } });
    const rate = await metrics.getIntegratedOverview(admin, { ...query, from: "2058-05-20T15:00:00.000Z", filters: { pipelineIds: [ads.id] } });
    expect(rate.values.find((value) => value.metricId === "conversion.entry_to_meeting")).toMatchObject({ value: null, denominator: 0 });
  });

  it("preserva os dois pipelines, compartilha só contato confirmado e não duplica replay", async () => {
    const intake = createLeadIntakeService({ database, authorization, now: () => now });
    const payload = { channel: "MANUAL", idempotencyKey: `identity:${randomUUID()}`, pipelineId: prospecting.id, fullName: "Contato sintético compartilhado", phone: "+5511998765432", email: "fronts@example.test", sourceKey: "manual", priorityBandCode: "P1", rawPayload: { synthetic: true } };
    const first = await intake.intake(payload, admin);
    if (first.outcome === "REJECTED") throw new Error(first.code);
    const old = await database.lead.findUniqueOrThrow({ where: { id: first.leadId } });
    await database.contact.update({ where: { id: old.contactId! }, data: { quality: "CONFIRMED" } });
    await database.lead.update({ where: { id: old.id }, data: { needsIdentityReview: false } });
    const inboundPayload = { ...payload, idempotencyKey: `identity:${randomUUID()}`, pipelineId: ads.id };
    const inbound = await intake.intake(inboundPayload, admin);
    if (inbound.outcome === "REJECTED") throw new Error(inbound.code);
    expect(inbound.leadId).not.toBe(first.leadId);
    const newLead = await database.lead.findUniqueOrThrow({ where: { id: inbound.leadId } });
    expect(newLead.contactId).toBe(old.contactId);
    expect((await database.lead.findUniqueOrThrow({ where: { id: first.leadId } })).pipelineId).toBe(prospecting.id);
    const replay = await intake.intake(inboundPayload, admin);
    expect(replay.outcome !== "REJECTED" && replay.leadId).toBe(inbound.leadId);
    expect(replay.outcome !== "REJECTED" && replay.submissionId).toBe(inbound.submissionId);
    expect(replay.outcome !== "REJECTED" && replay.idempotentReplay).toBe(true);
    expect(await database.lead.count({ where: { workspaceId, normalizedEmail: "fronts@example.test" } })).toBe(2);
    const history = createRelatedCommercialHistoryService({ database, authorization });
    expect((await history.getHistory(admin, inbound.leadId)).some((row) => row.id === first.leadId && row.confirmed)).toBe(true);
    await expect(history.getHistory({ ...admin, workspaceId: randomUUID() }, inbound.leadId)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("registra tarefa manual, adiamento e reatribuição na timeline comum sem contato fictício", async () => {
    const operations = createOperationalHistoryService({ database, authorization, now: () => now });
    const task = await operations.createTask(admin, { leadId: leads[20]!, title: "Tarefa sintética de Anúncios", kind: "GENERAL", dueAt: new Date("2058-05-21T14:00:00Z") });
    const tasks = await database.task.findMany({ where: { workspaceId, leadId: leads[20]!, title: "Tarefa sintética de Anúncios" } });
    expect(task).toBeDefined();
    const bulk = createUnifiedActivityService({ database, authorization, now: () => now });
    await bulk.bulkCommand(admin, { action: "POSTPONE", taskIds: [tasks[0]!.id], dueAt: new Date("2058-05-22T14:00:00Z") });
    await bulk.bulkCommand(admin, { action: "REASSIGN", taskIds: [tasks[0]!.id], assigneeMemberId: jhon.memberId });
    const history = await createCommercialHistoryService({ database, authorization }).getHistory(admin, { pipelineName: "Anúncios", type: "TASK" });
    expect(history.items.some((row) => row.subject.startsWith("Prazo da tarefa alterado"))).toBe(true);
    expect(history.items.some((row) => row.subject.startsWith("Responsável da tarefa alterado"))).toBe(true);
    expect(await database.commercialMetricFact.count({ where: { workspaceId, leadId: leads[20]!, eventType: "CALL_CONNECTED" } })).toBe(0);
  });

  it("nega agendamento em Anúncios pelo vendedor na fronteira do servidor", async () => {
    await database.lead.update({ where: { id: leads[15]! }, data: { ownerMemberId: jhon.memberId } });
    expect((await createMeetingService({ database, authorization, now: () => now }).getLeadMeetings(jhon, { leadId: leads[15]! })).canSchedule).toBe(false);
    await expect(createMeetingService({ database, authorization, now: () => now }).schedule(jhon, { leadId: leads[15]!, closerId: jhon.memberId, title: "Não deve ser criada", startsAtLocal: "2058-05-22T10:00", durationMinutes: 30 })).rejects.toMatchObject({ statusCode: 403, code: "ADVERTISING_SCHEDULER_REQUIRED" });
    const scheduledStage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: ads.id, leadStageCode: "MEETING_SCHEDULED" } });
    await expect(database.$transaction((tx) => transitionLeadStageInTransaction(tx, jhon, { leadId: leads[15]!, targetStageId: scheduledStage.id, reason: "Atalho não deve contornar a regra", origin: "PIPELINE_BOARD", managerCorrection: false, confirmed: true }, now))).rejects.toMatchObject({ code: "ADVERTISING_SCHEDULER_REQUIRED" });
    expect(await database.meeting.count({ where: { workspaceId, leadId: leads[15]! } })).toBe(0);
  });

  it("recupera frente histórica de venda sem trocar pipeline da oportunidade ou fingerprint; ensaia recuperação", async () => {
    const sales = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY" } });
    const old = await database.commercialMetricFact.create({ data: { workspaceId, eventKey: `legacy-sale:${randomUUID()}`, eventType: "SALE_WON", occurredAt: completedAt, sourceEntityType: "OpportunityOutcomeSnapshot", sourceEntityId: randomUUID(), leadId: leads[0]!, pipelineId: sales.id, valueCents: 12300n, inputFingerprint: "legacy-fixture", safeMetadata: { keep: true } } });
    const service = createCommercialFrontSnapshotService({ database, authorization });
    const dry = await service.run(admin, { mode: "DRY_RUN", batchSize: 500 });
    expect(dry.updated).toBe(0);
    const apply = await service.run(admin, { mode: "APPLY", batchSize: 500, expectedCount: dry.eligibleInBatch });
    expect(apply.updated).toBeGreaterThan(0);
    expect((await service.run(admin, { mode: "APPLY", batchSize: 500, expectedCount: 0 })).updated).toBe(0);
    const untouched = await database.commercialMetricFact.findUniqueOrThrow({ where: { id: old.id } });
    expect(untouched).toMatchObject({ pipelineId: sales.id, inputFingerprint: "legacy-fixture", safeMetadata: { keep: true } });
    const replacement = await database.commercialMetricFact.findUniqueOrThrow({ where: { workspaceId_eventKey: { workspaceId, eventKey: `${old.eventKey}:front-classification:replacement:v1` } } });
    expect(replacement.safeMetadata).toMatchObject({ keep: true, _commercialFrontPipelineId: ads.id });
    const result = await metrics.getIntegratedOverview(admin, { ...query, filters: { pipelineIds: [ads.id] } });
    expect(result.values.find((row) => row.metricId === "sales.won_value")?.value).toBe("12300");
    const global = await database.commercialMetricFact.aggregate({ where: { workspaceId, sourceEntityId: old.sourceEntityId }, _sum: { quantity: true, valueCents: true } });
    expect(global._sum).toEqual({ quantity: 1, valueCents: 12300n });
    await expect(database.commercialMetricFact.update({ where: { id: old.id }, data: { safeMetadata: { keep: false } } })).rejects.toThrow(/append-only/);

  });

  it("ensaia o grant persistido OWN idempotente sem alterar outras permissões", async () => {
    const permission = await database.permission.findUniqueOrThrow({ where: { key: "metrics.read" } });
    await database.rolePermission.delete({ where: { workspaceId_roleId_permissionId: { workspaceId, roleId: jhon.roleId, permissionId: permission.id } } });
    const sql = readFileSync(new URL("../../scripts/sql/grant-closer-metrics-own.sql", import.meta.url), "utf8").replaceAll(":'workspace_id'", "$1");
    const first = await database.$queryRawUnsafe<{ grants_created: bigint; audits_created: bigint }[]>(sql, workspaceId);
    expect(first[0]).toEqual({ grants_created: 1n, audits_created: 1n });
    const second = await database.$queryRawUnsafe<{ grants_created: bigint; audits_created: bigint }[]>(sql, workspaceId);
    expect(second[0]).toEqual({ grants_created: 0n, audits_created: 0n });
    expect((await database.rolePermission.findUniqueOrThrow({ where: { workspaceId_roleId_permissionId: { workspaceId, roleId: jhon.roleId, permissionId: permission.id } } })).scope).toBe("OWN");
  });
});
