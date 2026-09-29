import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createTelephonyBackfillService } from "@/modules/integrations/application/telephony-backfill-service";
import { applyTelephonyEventInTransaction, createTelephonyService } from "@/modules/integrations/application/telephony-service";
import { createTelephonyWorkerService } from "@/modules/integrations/application/telephony-worker-service";
import { LocalTelephonySimulatorAdapter } from "@/modules/integrations/application/telephony-transport";
import { signLocalTelephonyCallback } from "@/modules/integrations/domain/telephony-contracts";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-46 integration test requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const now = new Date("2046-06-04T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let sdr1: AuthenticatedContext;
let sdr2: AuthenticatedContext;
let system: ServiceActorContext;
let leadId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, viewer, sdr1, sdr2] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local"), context("sdr1@demo.politizai.local"), context("sdr2@demo.politizai.local")]);
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" }, orderBy: { createdAt: "asc" } });
  system = { workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key };
  const sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } })).key;
  const created = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now }).intake({ channel: "MANUAL", idempotencyKey: "crm46-known-phone-fixture", fullName: "Contato Telefonia CRM-46", phone: "+55 11 97777-4601", email: "crm46.telephony@example.test", sourceKey, rawPayload: { fixture: "crm46" } }, system);
  if (created.outcome === "REJECTED") throw new Error(created.code);
  leadId = created.leadId;
  await database.lead.update({ where: { id: leadId }, data: { ownerMemberId: sdr1.memberId, queueId: null, updatedByActorId: system.actorId } });
});

afterAll(async () => database.$disconnect());

describe("CRM-46 telefonia local determinística", () => {
  it("semeia perfil local sem segredo, egress, gravação ou transcrição", async () => {
    const profile = await database.telephonyConnectionProfile.findFirstOrThrow({ where: { workspaceId }, include: { connection: { include: { secrets: true } } } });
    expect(profile).toMatchObject({ operatingMode: "LOCAL_SIMULATOR", recordingEnabled: false, transcriptionEnabled: false });
    expect(profile.connection).toMatchObject({ environment: "LOCAL", status: "ACTIVE_LOCAL", enabled: true });
    expect(profile.connection.secrets).toHaveLength(0);
    await expect(createTelephonyService({ database, now: () => now }).screen(admin)).resolves.toMatchObject({ externalEgress: false, recordingEnabled: false, transcriptionEnabled: false });
    await expect(createTelephonyService({ database, now: () => now }).startOutbound(viewer, { leadId, scenario: "BUSY", idempotencyKey: "crm46:viewer:denied", correlationId: "crm46:viewer:denied" })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("enfileira atomicamente, preserva atribuição e processa fatos canônicos", async () => {
    const service = createTelephonyService({ database, now: () => now });
    const queued = await service.startOutbound(sdr1, { leadId, scenario: "ANSWERED_COMPLETED", idempotencyKey: "crm46:answered:001", correlationId: "crm46:answered:001" });
    expect(queued).toMatchObject({ status: "QUEUED", jobCreated: true, externalEgress: false });
    if (!queued.callId) throw new Error("A chamada enfileirada deveria possuir callId.");
    const callId = queued.callId;
    const repeated = await service.startOutbound(sdr1, { leadId, scenario: "ANSWERED_COMPLETED", idempotencyKey: "crm46:answered:001", correlationId: "crm46:answered:001" });
    expect(repeated).toMatchObject({ callId, idempotent: true, jobCreated: false });
    const worker = createTelephonyWorkerService({ database, adapter: new LocalTelephonySimulatorAdapter(), now: () => now });
    await expect(worker.processNext("crm46-worker")).resolves.toMatchObject({ status: "SUCCEEDED", callId, externalEgress: false });
    const call = await database.phoneCall.findUniqueOrThrow({
      where: { id: callId },
      include: {
        statusEvents: { orderBy: [{ sequence: "asc" }, { occurredAt: "asc" }, { id: "asc" }] },
        attempts: true,
        activity: true,
        message: true,
      },
    });
    expect(call).toMatchObject({ ownerMemberId: sdr1.memberId, queueId: null, status: "COMPLETED", answeredAt: new Date("2046-06-04T15:00:04.000Z"), completedAt: new Date("2046-06-04T15:01:04.000Z"), durationSeconds: 64, talkDurationSeconds: 60, recordingReference: null, transcriptionReference: null, isSimulated: true });
    expect(call.statusEvents.map((item) => item.status)).toEqual(["QUEUED", "INITIATED", "RINGING", "ANSWERED", "COMPLETED"]);
    expect(call.attempts).toHaveLength(1);
    expect(call.activity).toMatchObject({ type: "CALL_CONNECTED", result: "CONNECTED" });
    expect(call.message.isSimulated).toBe(true);
    const cycle = await database.leadSlaCycle.findFirstOrThrow({ where: { workspaceId, leadId }, orderBy: { receivedAt: "desc" } });
    expect(cycle.firstHumanAttemptAt).toEqual(new Date("2046-06-04T15:00:01.000Z"));
    expect(cycle.firstConnectedAt).toEqual(new Date("2046-06-04T15:00:04.000Z"));
  });

  it("não duplica primeira tentativa e preserva evento atrasado em revisão", async () => {
    const call = await database.phoneCall.findFirstOrThrow({ where: { workspaceId, idempotencyKey: "crm46:answered:001" } });
    const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
    await database.$transaction((tx) => applyTelephonyEventInTransaction(tx, { workspaceId, actorId: actor.id, event: { eventId: "crm46:late:ringing", callId: call.id, status: "RINGING", occurredAt: now, sequence: 99 } }));
    await expect(database.phoneCall.findUniqueOrThrow({ where: { id: call.id } })).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await database.telephonyEventReview.count({ where: { workspaceId, callId: call.id, status: "OPEN", reasonCode: { in: ["LATE_EVENT_TIMESTAMP", "STATUS_REGRESSION"] } } })).toBe(1);
    expect(await database.leadSlaCycle.count({ where: { workspaceId, leadId, firstHumanAttemptAt: { not: null } } })).toBeGreaterThan(0);
  });

  it("aceita callback local assinado uma vez e rejeita assinatura inválida", async () => {
    const service = createTelephonyService({ database, now: () => now });
    const queued = await service.startOutbound(admin, { leadId, scenario: "BUSY", idempotencyKey: "crm46:callback:001", correlationId: "crm46:callback:001" });
    if (!queued.callId) throw new Error("A chamada do callback deveria possuir callId.");
    const rawBody = Buffer.from(JSON.stringify({ eventId: "crm46:callback:event:001", callId: queued.callId, status: "INITIATED", occurredAt: "2046-06-04T15:00:01.000Z", sequence: 2, metadata: { scenario: "BUSY", token: "must-not-persist" } }));
    await expect(service.ingestSignedLocalCallback(workspaceId, rawBody, "0".repeat(64))).rejects.toMatchObject({ code: "TELEPHONY_SIGNATURE_INVALID" });
    const signature = signLocalTelephonyCallback(workspaceId, rawBody);
    await expect(service.ingestSignedLocalCallback(workspaceId, rawBody, signature)).resolves.toMatchObject({ status: "APPLIED" });
    await expect(service.ingestSignedLocalCallback(workspaceId, rawBody, signature)).resolves.toMatchObject({ status: "DUPLICATE" });
    const inbox = await database.webhookInbox.findFirstOrThrow({ where: { workspaceId, providerEventId: "crm46:callback:event:001" } });
    expect(inbox.payload).not.toMatchObject({ metadata: { token: expect.anything() } });
    await expect(createTelephonyService({ database, now: () => new Date("2046-06-04T15:00:02.000Z") }).cancel(admin, queued.callId)).resolves.toMatchObject({ status: "APPLIED", projectedStatus: "CANCELLED" });
  });

  it("registra disposição humana, tarefa explícita e não altera pipeline", async () => {
    const service = createTelephonyService({ database, now: () => now });
    const call = await database.phoneCall.findFirstOrThrow({ where: { workspaceId, idempotencyKey: "crm46:answered:001" } });
    const stageBefore = (await database.lead.findUniqueOrThrow({ where: { id: leadId } })).currentStageId;
    const result = await service.setDisposition(sdr1, { callId: call.id, disposition: "CALLBACK_REQUESTED", note: "Retornar no horário combinado.", expectedRevision: call.revision, nextAction: { title: "Retornar ligação", dueAt: new Date("2046-06-05T15:00:00Z") } });
    expect(result).toMatchObject({ disposition: "CALLBACK_REQUESTED" });
    expect(result.nextTaskId).toBeTruthy();
    await expect(database.phoneCall.findUniqueOrThrow({ where: { id: call.id } })).resolves.toMatchObject({ disposition: "CALLBACK_REQUESTED", dispositionedByActorId: sdr1.actorId });
    expect((await database.lead.findUniqueOrThrow({ where: { id: leadId } })).currentStageId).toBe(stageBefore);
  });

  it("projeta transferência em pernas sem regredir o estado global", async () => {
    const service = createTelephonyService({ database, now: () => now });
    const queued = await service.startOutbound(admin, { leadId, scenario: "MULTI_LEG_TRANSFER", idempotencyKey: "crm46:transfer:001", correlationId: "crm46:transfer:001" });
    if (!queued.callId) throw new Error("A transferência deveria possuir callId.");
    await expect(createTelephonyWorkerService({ database, adapter: new LocalTelephonySimulatorAdapter(), now: () => now }).processNext("crm46-transfer-worker")).resolves.toMatchObject({ status: "SUCCEEDED", callId: queued.callId });
    const call = await database.phoneCall.findUniqueOrThrow({ where: { id: queued.callId }, include: { legs: { orderBy: { sequence: "asc" } }, reviews: true } });
    expect(call).toMatchObject({ status: "COMPLETED", answeredAt: new Date("2046-06-04T15:00:04.000Z"), completedAt: new Date("2046-06-04T15:01:09.000Z") });
    expect(call.legs.map((leg) => ({ role: leg.role, status: leg.status }))).toEqual([
      { role: "CUSTOMER", status: "ANSWERED" },
      { role: "TRANSFER_TARGET", status: "COMPLETED" },
    ]);
    expect(call.reviews).toHaveLength(0);
  });

  it("bloqueia DNC e IDOR antes de criar job", async () => {
    const point = await database.contactPoint.findFirstOrThrow({ where: { workspaceId, contact: { leads: { some: { id: leadId } } }, type: "PHONE", deletedAt: null } });
    await database.contactPoint.update({ where: { id: point.id }, data: { doNotContact: true, updatedByActorId: system.actorId } });
    const before = await database.job.count({ where: { workspaceId, type: "TELEPHONY_CALL" } });
    await expect(createTelephonyService({ database, now: () => now }).startOutbound(sdr1, { leadId, scenario: "BUSY", idempotencyKey: "crm46:dnc:blocked", correlationId: "crm46:dnc:blocked" })).resolves.toMatchObject({ status: "BLOCKED_BY_POLICY", reasonCode: "PRIVACY_DENIED", jobCreated: false });
    await expect(createTelephonyService({ database, now: () => now }).startOutbound(sdr1, { leadId, scenario: "BUSY", idempotencyKey: "crm46:dnc:blocked", correlationId: "crm46:dnc:blocked" })).resolves.toMatchObject({ status: "BLOCKED_BY_POLICY", reasonCode: "PRIVACY_DENIED", idempotent: true, jobCreated: false });
    expect(await database.job.count({ where: { workspaceId, type: "TELEPHONY_CALL" } })).toBe(before);
    expect(await database.auditLog.count({ where: { workspaceId, action: "telephony.call.blocked_by_policy", entityId: leadId, changes: { path: ["idempotencyKey"], equals: "crm46:dnc:blocked" } } })).toBe(1);
    await database.contactPoint.update({ where: { id: point.id }, data: { doNotContact: false, updatedByActorId: system.actorId } });
    await expect(createTelephonyService({ database, now: () => now }).startOutbound(sdr2, { leadId, scenario: "BUSY", idempotencyKey: "crm46:idor:blocked", correlationId: "crm46:idor:blocked" })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("serializa entradas concorrentes pela mesma chave sem duplicar efeitos", async () => {
    const service = createTelephonyService({ database, now: () => now });
    const input = { leadId, scenario: "NO_ANSWER" as const, idempotencyKey: "crm46:concurrent:001", correlationId: "crm46:concurrent:001" };
    const [first, second] = await Promise.all([service.startOutbound(admin, input), service.startOutbound(admin, input)]);
    expect(first.callId).toBe(second.callId);
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
    expect(await database.phoneCall.count({ where: { workspaceId, idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect(await database.job.count({ where: { workspaceId, idempotencyKey: `telephony-job:${input.idempotencyKey}` } })).toBe(1);
    if (!first.callId) throw new Error("A chamada concorrente deveria possuir callId.");
    await createTelephonyService({ database, now: () => now }).cancel(admin, first.callId);
  });

  it("faz retry com backoff e dead-letter deterministicamente", async () => {
    const service = createTelephonyService({ database, now: () => now });
    const transient = await service.startOutbound(admin, { leadId, scenario: "TRANSIENT_FAILURE", idempotencyKey: "crm46:retry:001", correlationId: "crm46:retry:001" });
    if (!transient.callId) throw new Error("A chamada transitória deveria possuir callId.");
    const transientCallId = transient.callId;
    const worker = createTelephonyWorkerService({ database, adapter: new LocalTelephonySimulatorAdapter(), now: () => now, backoffBaseSeconds: 1 });
    await expect(worker.processNext("crm46-retry-worker")).resolves.toMatchObject({ status: "RETRY_PENDING", delaySeconds: 1 });
    let job = await database.job.findFirstOrThrow({ where: { workspaceId, payload: { path: ["callId"], equals: transientCallId } } });
    await database.job.update({ where: { id: job.id }, data: { runAt: now } });
    await expect(worker.processNext("crm46-retry-worker")).resolves.toMatchObject({ status: "RETRY_PENDING", delaySeconds: 2 });
    await database.job.update({ where: { id: job.id }, data: { runAt: now } });
    await expect(worker.processNext("crm46-retry-worker")).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(await database.phoneCallAttempt.count({ where: { workspaceId, callId: transientCallId } })).toBe(3);

    const permanent = await service.startOutbound(admin, { leadId, scenario: "PERMANENT_FAILURE", idempotencyKey: "crm46:dead:001", correlationId: "crm46:dead:001" });
    if (!permanent.callId) throw new Error("A chamada permanente deveria possuir callId.");
    const permanentCallId = permanent.callId;
    await expect(worker.processNext("crm46-dead-worker")).resolves.toMatchObject({ status: "FAILED", code: "TELEPHONY_LOCAL_PERMANENT_FAILURE" });
    job = await database.job.findFirstOrThrow({ where: { workspaceId, payload: { path: ["callId"], equals: permanentCallId } } });
    expect(job.status).toBe("FAILED");
    expect((await database.outboxEvent.findFirstOrThrow({ where: { workspaceId, aggregateId: permanentCallId } })).status).toBe("DEAD_LETTER");
  });

  it("faz backfill conservador em revisão sem inventar ligação", async () => {
    const profile = await database.telephonyConnectionProfile.findFirstOrThrow({ where: { workspaceId } });
    const lead = await database.lead.findUniqueOrThrow({ where: { id: leadId } });
    const conversation = await database.conversation.create({ data: { workspaceId, leadId, contactId: lead.contactId, accountId: lead.accountId, connectionId: profile.connectionId, assigneeMemberId: lead.ownerMemberId, queueId: null, channel: "PHONE", status: "RESOLVED", priority: lead.priority, subject: "Legado", openedAt: now, createdByActorId: system.actorId, updatedByActorId: system.actorId } });
    const message = await database.message.create({ data: { workspaceId, conversationId: conversation.id, senderActorId: system.actorId, direction: "OUTBOUND", type: "CALL_EVENT", status: "DELIVERED", providerKey: "LEGACY_PHONE", idempotencyKey: "crm46:legacy:message", clientCorrelationId: "crm46:legacy:message", isSimulated: true, simulationLabel: "Fixture histórica sem fatos suficientes.", occurredAt: now } });
    const backfill = createTelephonyBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    await expect(backfill.run(admin, { mode: "DRY_RUN", runKey: "crm46:backfill:dry:fixture" })).resolves.toMatchObject({ status: "SUCCEEDED", migratedCount: 0, idempotent: false });
    expect(await database.telephonyBackfillItem.count({ where: { workspaceId, messageId: message.id } })).toBe(0);
    await expect(backfill.run(admin, { mode: "EXECUTE", runKey: "crm46:backfill:execute:fixture" })).resolves.toMatchObject({ status: "SUCCEEDED", reviewCount: 1, idempotent: false });
    expect(await database.telephonyBackfillItem.count({ where: { workspaceId, messageId: message.id, outcome: "REVIEW_REQUIRED" } })).toBe(1);
    await expect(backfill.run(admin, { mode: "EXECUTE", runKey: "crm46:backfill:execute:fixture" })).resolves.toMatchObject({ idempotent: true });
    await expect(backfill.run(admin, { mode: "EXECUTE", runKey: "crm46:backfill:execute:replay" })).resolves.toMatchObject({ status: "SUCCEEDED", existingCount: 1, reviewCount: 0, idempotent: false });
    expect(await database.telephonyBackfillItem.count({ where: { workspaceId, messageId: message.id } })).toBe(1);
  });

  it("protege timeline técnica e supressões como fatos append-only", async () => {
    const event = await database.phoneCallStatusEvent.findFirstOrThrow({ where: { workspaceId } });
    await expect(database.phoneCallStatusEvent.delete({ where: { id: event.id } })).rejects.toMatchObject({ code: "P2039" });
    expect(await database.phoneCallStatusEvent.count({ where: { workspaceId, id: event.id } })).toBe(1);
  });
});
