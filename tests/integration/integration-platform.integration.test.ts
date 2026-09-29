import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { IntegrationAdapterRegistry } from "@/modules/integrations/application/integration-adapter-registry";
import { createIntegrationOutboxWorkerService } from "@/modules/integrations/application/integration-outbox-worker-service";
import { createIntegrationPlatformService, createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { localMockAdapter } from "@/modules/integrations/application/local-mock-adapter";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { createWebhookInboxService } from "@/modules/integrations/application/webhook-inbox-service";
import { signLocalWebhook } from "@/modules/integrations/domain/integration-policy";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const adapters = new IntegrationAdapterRegistry([localMockAdapter]);
const now = new Date("2046-03-10T12:00:00.000Z");
let workspaceId: string; let admin: AuthenticatedContext; let manager: AuthenticatedContext; let viewer: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, manager, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("gestor@demo.politizai.local"), context("viewer@demo.politizai.local")]);
});
afterAll(() => database.$disconnect());

describe("CRM-37 plataforma local de integrações", () => {
  it("aplica RBAC, isolamento e teto VALIDATED_LOCALLY", async () => {
    const service = createIntegrationPlatformService({ database, adapters, now: () => now });
    await expect(service.list(manager)).resolves.toMatchObject({ capabilityCeiling: "VALIDATED_LOCALLY", externalEgress: false });
    await expect(service.list(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.detail({ ...admin, workspaceId: randomUUID() }, randomUUID())).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("recebe webhook HMAC uma vez, rejeita conflito, replay e corpo grande", async () => {
    const platform = createIntegrationPlatformService({ database, adapters, now: () => now });
    let connection = (await platform.list(admin)).connections[0]!;
    await platform.linkSecretReference(admin, { connectionId: connection.id, alias: "webhook-hmac", referenceKey: "LOCAL_MOCK_WEBHOOK_SECRET", present: true });
    await platform.testLocal(admin, connection.id);
    connection = (await platform.list(admin)).connections[0]!;
    const webhook = createWebhookInboxService({ database, adapters, secrets: new EphemeralSecretResolver({ LOCAL_MOCK_WEBHOOK_SECRET: "only-in-memory" }), now: () => now });
    const envelope = { nonce: `nonce-${randomUUID()}`, eventId: `evt-${randomUUID()}`, eventType: "lead.observed", contractVersion: "1.0", occurredAt: now.toISOString(), data: { safe: "value", token: "must-not-persist" } };
    const rawBody = JSON.stringify(envelope); const timestamp = now.toISOString(); const signature = signLocalWebhook("only-in-memory", timestamp, rawBody);
    const [first, second] = await Promise.all([webhook.receive({ workspaceSlug: "politizai", connectionKey: connection.key, rawBody, timestamp, signature }), webhook.receive({ workspaceSlug: "politizai", connectionKey: connection.key, rawBody, timestamp, signature })]);
    expect(new Set([first.id, second.id]).size).toBe(1); expect([first.idempotent, second.idempotent]).toContain(true);
    const stored = await database.webhookInbox.findUniqueOrThrow({ where: { id: first.id } });
    expect(JSON.stringify(stored.payload)).not.toContain("must-not-persist");
    expect(JSON.stringify(await platform.detail(admin, connection.id))).not.toContain("LOCAL_MOCK_WEBHOOK_SECRET");
    await expect(webhook.receive({ workspaceSlug: "politizai", connectionKey: connection.key, rawBody: JSON.stringify({ ...envelope, data: { changed: true } }), timestamp, signature })).rejects.toMatchObject({ code: "WEBHOOK_IDEMPOTENCY_CONFLICT" });
    const invalidEnvelope = { ...envelope, nonce: `nonce-${randomUUID()}`, eventId: `evt-${randomUUID()}` }; const invalidRaw = JSON.stringify(invalidEnvelope);
    await expect(webhook.receive({ workspaceSlug: "politizai", connectionKey: connection.key, rawBody: invalidRaw, timestamp, signature: "00".repeat(32) })).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    expect(await database.webhookInbox.count({ where: { workspaceId, connectionId: connection.id, providerEventId: invalidEnvelope.eventId, status: "REJECTED", payload: { equals: Prisma.JsonNull } } })).toBe(1);
    const replayEnvelope = { ...envelope, eventId: `evt-${randomUUID()}` }; const replayRaw = JSON.stringify(replayEnvelope);
    await expect(webhook.receive({ workspaceSlug: "politizai", connectionKey: connection.key, rawBody: replayRaw, timestamp, signature: signLocalWebhook("only-in-memory", timestamp, replayRaw) })).rejects.toMatchObject({ code: "WEBHOOK_REPLAY_REJECTED" });
    await expect(webhook.receive({ workspaceSlug: "politizai", connectionKey: connection.key, rawBody: "x".repeat(256 * 1024 + 1), timestamp, signature })).rejects.toMatchObject({ code: "WEBHOOK_TOO_LARGE" });
  });

  it("classifica falha, agenda retry e bloqueia outbox pela decisão de privacidade", async () => {
    const platform = createIntegrationPlatformService({ database, adapters, now: () => now });
    const transient = await platform.create(admin, { displayName: "Falha transitória local", key: `transient-${randomUUID().slice(0, 8)}`, config: { mode: "LOCAL_DETERMINISTIC", pageSize: 10, fault: "TRANSIENT" } });
    await database.integrationConnection.update({ where: { id: transient.id }, data: { enabled: true, status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY" } });
    const retryItem = await database.$transaction((tx) => createOutboxEventInTransaction(tx, { workspaceId, connectionId: transient.id, actorId: admin.actorId, eventType: "local.retry", aggregateType: "Test", aggregateId: randomUUID(), correlationId: randomUUID(), idempotencyKey: `retry-${randomUUID()}`, payload: { safe: true } }));
    await database.outboxEvent.update({ where: { id: retryItem.id }, data: { availableAt: new Date("1900-01-01T00:00:00.000Z") } });
    const worker = createIntegrationOutboxWorkerService({ database, adapters, now: () => now });
    await expect(worker.processNext("worker-retry")).resolves.toMatchObject({ id: retryItem.id, status: "RETRY_PENDING" });
    expect((await database.outboxEvent.findUniqueOrThrow({ where: { id: retryItem.id } })).errorClass).toBe("TRANSIENT");

    const source = await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } });
    const pipeline = await database.pipeline.findFirstOrThrow({
      where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null },
    });
    const stage = await database.pipelineStage.findFirstOrThrow({
      where: { workspaceId, pipelineId: pipeline.id, leadStageCode: "NEW", deletedAt: null },
    });
    const queue = await database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } });
    const contact = await database.contact.create({ data: { workspaceId, preferredName: "Privacidade pendente", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const lead = await database.lead.create({ data: { workspaceId, contactId: contact.id, sourceId: source.id, pipelineId: pipeline.id, currentStageId: stage.id, queueId: queue.id, routingQueueId: queue.id, fullName: "Privacidade pendente", slaStartedAt: now, slaDueAt: now, lastActivityAt: now, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const active = (await platform.list(admin)).connections.find((item) => item.key === "local-mock")!;
    const privacyItem = await database.$transaction((tx) => createOutboxEventInTransaction(tx, { workspaceId, connectionId: active.id, actorId: admin.actorId, eventType: "contact.requested", aggregateType: "Lead", aggregateId: lead.id, correlationId: randomUUID(), idempotencyKey: `privacy-${randomUUID()}`, payload: { leadId: lead.id } }));
    await database.outboxEvent.update({ where: { id: privacyItem.id }, data: { availableAt: new Date("1900-01-02T00:00:00.000Z") } });
    await expect(worker.processNext("worker-privacy")).resolves.toMatchObject({ id: privacyItem.id, status: "DEAD_LETTER" });
    expect((await database.outboxEvent.findUniqueOrThrow({ where: { id: privacyItem.id } })).errorClass).toBe("PRIVACY_BLOCKED");
  });

  it("mantém outbox atômica, retry/dead-letter e entrega local idempotente", async () => {
    const platform = createIntegrationPlatformService({ database, adapters, now: () => now });
    const connection = (await platform.list(admin)).connections[0]!;
    await expect(database.$transaction(async (tx) => { await createOutboxEventInTransaction(tx, { workspaceId, connectionId: connection.id, actorId: admin.actorId, eventType: "lead.changed", aggregateType: "Lead", aggregateId: randomUUID(), correlationId: randomUUID(), idempotencyKey: `rollback-${randomUUID()}`, payload: { safe: true } }); throw new Error("rollback"); })).rejects.toThrow("rollback");
    const key = `outbox-${randomUUID()}`;
    const item = await database.$transaction((tx) => createOutboxEventInTransaction(tx, { workspaceId, connectionId: connection.id, actorId: admin.actorId, eventType: "lead.changed", aggregateType: "Lead", aggregateId: randomUUID(), correlationId: randomUUID(), idempotencyKey: key, payload: { safe: true } }));
    await database.outboxEvent.update({ where: { id: item.id }, data: { availableAt: new Date("1900-01-03T00:00:00.000Z") } });
    const worker = createIntegrationOutboxWorkerService({ database, adapters, now: () => now });
    await expect(worker.processNext("worker-crm37")).resolves.toMatchObject({ id: item.id, status: "DELIVERED_LOCAL" });
    await worker.processNext("worker-crm37-second");
    expect(await database.integrationDeliveryAttempt.count({ where: { outboxId: item.id } })).toBe(1);
  });

  it("avança cursor só após sucesso e abre conflito sem sobrescrever mapeamento humano", async () => {
    const service = createIntegrationPlatformService({ database, adapters, now: () => now }); const connection = (await service.list(admin)).connections[0]!;
    const sync = await service.runSync(manager, { connectionId: connection.id, direction: "PULL", objectType: "lead", correlationId: `sync-${randomUUID()}` });
    expect(sync.status).toBe("SUCCEEDED");
    const cursor = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: connection.id, objectType: "lead" } }); expect(cursor.cursor).toBe("25");
    const externalId = `external-${randomUUID()}`;
    const firstLead = await database.contact.create({ data: { workspaceId, preferredName: "Primeiro", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const secondLead = await database.contact.create({ data: { workspaceId, preferredName: "Segundo", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    await service.recognizeMapping(admin, { connectionId: connection.id, externalObjectType: "contact", externalId, internalEntityType: "CONTACT", internalEntityId: firstLead.id });
    const conflict = await service.recognizeMapping(admin, { connectionId: connection.id, externalObjectType: "contact", externalId, internalEntityType: "CONTACT", internalEntityId: secondLead.id });
    expect(conflict.conflict?.status).toBe("OPEN");
    const persisted = await database.externalObjectMapping.findFirstOrThrow({ where: { workspaceId, connectionId: connection.id, externalId } }); expect(persisted.internalEntityId).toBe(firstLead.id);
  });
});
