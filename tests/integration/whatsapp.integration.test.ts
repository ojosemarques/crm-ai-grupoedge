import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createWhatsAppBackfillService } from "@/modules/integrations/application/whatsapp-backfill-service";
import { createWhatsAppService } from "@/modules/integrations/application/whatsapp-service";
import { createWhatsAppWebhookWorkerService } from "@/modules/integrations/application/whatsapp-webhook-worker-service";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { WHATSAPP_LOCAL_PROVIDER_KEY, WHATSAPP_POLICY_SOURCE_URL, WHATSAPP_PROVIDER_KEY } from "@/modules/integrations/domain/whatsapp-contracts";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-44 integration test requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const now = new Date("2046-04-20T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let system: ServiceActorContext;
let sourceKey: string;
let knownPhone: string;
let knownLeadId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local")]);
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" }, orderBy: { createdAt: "asc" } });
  system = { workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key };
  sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } })).key;
  const created = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now }).intake({ channel: "MANUAL", idempotencyKey: "crm44-known-contact-fixture", fullName: "Contato conhecido CRM-44", phone: "11 99999-0001", email: "crm44-known@example.test", sourceKey, rawPayload: { fixture: "crm44" } }, system);
  if (created.outcome === "REJECTED") throw new Error(created.code);
  knownLeadId = created.leadId;
  knownPhone = (await database.contactPoint.findFirstOrThrow({ where: { workspaceId, contact: { leads: { some: { id: knownLeadId } } }, type: "PHONE", deletedAt: null } })).normalizedValue!;
});
afterAll(async () => database.$disconnect());

function webhookPayload(phoneNumberId: string, eventId: string) {
  return { object: "whatsapp_business_account", entry: [{ id: "123456789", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, messages: [{ from: "5511999990001", id: eventId, timestamp: "2410513200", type: "text", text: { body: "Olá" } }] } }] }] };
}

describe("CRM-44 WhatsApp local e fronteira Cloud API", () => {
  it("isola RBAC e expõe somente prontidão local sem credenciais", async () => {
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver(), now: () => now });
    await expect(service.screen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.screen(admin)).resolves.toMatchObject({
      externalEgress: false, externalValidation: false, activationBlocked: true, policyEligibility: "INELIGIBLE",
      decision: { status: "INELIGIBLE", sourceUrl: WHATSAPP_POLICY_SOURCE_URL, alternativeChannel: "PHONE", alternativeStatus: "AUTHORIZED", paritySeal: false },
      economics: { rateLimit: { status: "EXTERNAL_BLOCKED", valuePerMinute: null }, cost: { status: "EXTERNAL_BLOCKED", amountMicros: null } },
      windowMetrics: { open: 0, expired: 0, withoutInbound: 0 },
      killSwitch: { engaged: true, mode: "LOCAL_SIMULATOR", label: "Egress externo bloqueado" },
      profile: { operatingMode: "LOCAL_SIMULATOR", secretReferences: { accessToken: false, appSecret: false, verifyToken: false } },
    });
  });

  it("registra decisão de inelegibilidade com fonte, alternativa e auditoria sem liberar egress", async () => {
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver(), now: () => now });
    await expect(service.recordPolicyDecision(admin, {
      decision: "ELIGIBLE",
      scope: "Escopo comercial da Politizai relacionado ao ecossistema político.",
      rationale: "Não existe evidência externa que autorize esta decisão.",
      sourceUrl: WHATSAPP_POLICY_SOURCE_URL,
      sourceObservedAt: "2026-09-30T03:00:00.000Z",
      reviewTrigger: "Reavaliar somente após confirmação escrita da Meta ou mudança oficial da política.",
      alternativeChannel: "PHONE",
      alternativeStatus: "AUTHORIZED",
      alternativeDetail: "Contato humano manual por telefone, registrado no CRM e sem automação externa.",
    })).rejects.toThrow();
    const result = await service.recordPolicyDecision(admin, {
      decision: "INELIGIBLE",
      scope: "CRM comercial e serviços da Politizai para gabinetes, mandatos, campanhas e ecossistema político.",
      rationale: "A política oficial vigente veda entidades não governamentais que prestam serviços relacionados a política, candidatos, campanhas e soluções eleitorais.",
      sourceUrl: WHATSAPP_POLICY_SOURCE_URL,
      sourceObservedAt: "2026-09-30T03:00:00.000Z",
      reviewTrigger: "Reavaliar somente após confirmação escrita da Meta ou mudança oficial da política.",
      alternativeChannel: "PHONE",
      alternativeStatus: "AUTHORIZED",
      alternativeDetail: "Contato humano manual por telefone, registrado no CRM e sem automação ou provider externo implícito.",
    });
    expect(result).toMatchObject({ decision: "INELIGIBLE", externalEgress: false, paritySeal: false, operatingMode: "LOCAL_SIMULATOR" });
    expect(await database.auditLog.count({ where: { workspaceId, action: "integration.whatsapp.policy_decided", entityId: result.profileId } })).toBe(1);
    expect(await database.whatsAppPolicyDecision.count({ where: { workspaceId, profileId: result.profileId } })).toBe(2);
    const decision = await database.whatsAppPolicyDecision.findFirstOrThrow({ where: { workspaceId, profileId: result.profileId }, orderBy: { createdAt: "desc" } });
    await expect(database.whatsAppPolicyDecision.update({ where: { id: decision.id }, data: { rationale: "mutação indevida" } })).rejects.toThrow(/append-only/);
    await expect(database.whatsAppPolicyDecision.delete({ where: { id: decision.id } })).rejects.toThrow(/append-only/);
    await expect(service.recordPolicyDecision(admin, {
      decision: "PENDING_POLICY_REVIEW",
      scope: decision.scope,
      rationale: "Tentativa de rebaixar a decisão formal.",
      sourceUrl: WHATSAPP_POLICY_SOURCE_URL,
      sourceObservedAt: "2026-09-30T03:00:00.000Z",
      reviewTrigger: decision.reviewTrigger,
      alternativeChannel: "PHONE",
      alternativeStatus: "AUTHORIZED",
      alternativeDetail: decision.alternativeChannelDetail,
    })).rejects.toMatchObject({ code: "WHATSAPP_POLICY_DECISION_IMMUTABLE" });
  });

  it("registra inbound atomicamente, preserva owner/fila, abre janela e é idempotente", async () => {
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver(), now: () => now });
    const eventId = "wa-local-inbound-fixture-001";
    const result = await service.simulateInbound(admin, { externalEventId: eventId, address: knownPhone, body: "Quero conversar", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    expect(result).toMatchObject({ outcome: "ATTACHED", externalEgress: false, serviceWindowExpiresAt: "2046-04-21T15:00:00.000Z" });
    const repeated = await service.simulateInbound(admin, { externalEventId: eventId, address: knownPhone, body: "Quero conversar", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    expect(repeated).toMatchObject({ outcome: "IDEMPOTENT", messageId: result.messageId });
    if (!result.conversationId) throw new Error("A simulação inbound deve retornar uma conversa canônica.");
    const conversation = await database.conversation.findUniqueOrThrow({ where: { id: result.conversationId }, include: { queue: true } });
    expect(conversation.channel).toBe("WHATSAPP");
    expect(conversation.assigneeMemberId ?? conversation.queueId).toBeTruthy();
    expect(conversation.lastCustomerInboundAt?.toISOString()).toBe(now.toISOString());
    expect(conversation.serviceWindowExpiresAt?.toISOString()).toBe("2046-04-21T15:00:00.000Z");
    expect(await database.message.count({ where: { workspaceId, externalMessageId: eventId } })).toBe(1);
    expect(await database.job.count({ where: { workspaceId, idempotencyKey: `whatsapp-webhook:${eventId}`, status: "SUCCEEDED" } })).toBe(1);
  });

  it("aplica opt-out e encaminha identidade desconhecida explicitamente à Fila Geral", async () => {
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver(), now: () => now });
    const unknown = await service.simulateInbound(admin, { externalEventId: "wa-local-optout-fixture-002", address: "+5511988887777", body: "Não me contate", occurredAt: now.toISOString(), scenario: "OPT_OUT" });
    expect(unknown.outcome).toBe("REVIEW_REQUIRED");
    if (!unknown.conversationId) throw new Error("Uma identidade ambígua deve ser encaminhada para uma conversa em revisão.");
    const conversation = await database.conversation.findUniqueOrThrow({ where: { id: unknown.conversationId }, include: { queue: true } });
    expect(conversation.assigneeMemberId).toBeNull();
    expect(conversation.queue?.isGeneral).toBe(true);
    expect(await database.messageIdentityReview.count({ where: { workspaceId, messageId: unknown.messageId, status: "OPEN" } })).toBe(1);

    const point = await database.contactPoint.findFirstOrThrow({ where: { workspaceId, type: "PHONE", normalizedValue: knownPhone, deletedAt: null } });
    await service.simulateInbound(admin, { externalEventId: "wa-local-optout-fixture-003", address: knownPhone, body: "SAIR", occurredAt: now.toISOString(), scenario: "OPT_OUT" });
    await expect(database.contactPoint.findUniqueOrThrow({ where: { id: point.id } })).resolves.toMatchObject({ doNotContact: true });
  });

  it("preserva status fora de ordem e eventos desconhecidos como revisão", async () => {
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver(), now: () => now });
    const conversation = await database.conversation.findFirstOrThrow({ where: { workspaceId, channel: "WHATSAPP" } });
    const message = await database.message.create({ data: { workspaceId, conversationId: conversation.id, senderActorId: admin.actorId, direction: "OUTBOUND", type: "TEXT", status: "SENT", body: "Fixture", bodyHash: "fixture", providerKey: WHATSAPP_LOCAL_PROVIDER_KEY, externalMessageId: "wamid.local.status.fixture", idempotencyKey: "wa-status-message-fixture", clientCorrelationId: "wa-status-message-fixture", isSimulated: true, simulationLabel: "Fixture local da CRM-44; nenhum provider externo foi acionado.", occurredAt: now, sentAt: now } });
    await service.simulateStatus(admin, { messageId: message.id, externalEventId: "wa-status-delivered-fixture", status: "delivered", occurredAt: "2046-04-20T15:01:00.000Z", transient: false });
    await service.simulateStatus(admin, { messageId: message.id, externalEventId: "wa-status-sent-late-fixture", status: "sent", occurredAt: "2046-04-20T15:00:30.000Z", transient: false });
    await service.simulateStatus(admin, { messageId: message.id, externalEventId: "wa-status-unknown-fixture", status: "unknown", occurredAt: "2046-04-20T15:02:00.000Z", transient: false });
    await expect(database.message.findUniqueOrThrow({ where: { id: message.id } })).resolves.toMatchObject({ status: "DELIVERED", deliveredAt: new Date("2046-04-20T15:01:00.000Z") });
    await expect(database.whatsAppConnectionProfile.findFirstOrThrow({ where: { workspaceId } })).resolves.toMatchObject({ lastStatusAt: new Date("2046-04-20T15:01:00.000Z") });
    expect(await database.whatsAppEventReview.count({ where: { workspaceId, messageId: message.id, status: "OPEN" } })).toBe(2);
    const repeated = await service.simulateStatus(admin, { messageId: message.id, externalEventId: "wa-status-delivered-fixture", status: "delivered", occurredAt: "2046-04-20T15:01:00.000Z", transient: false });
    expect(repeated.idempotent).toBe(true);
  });

  it("valida challenge, assinatura, tenant e cria receipt/job sem processar inline", async () => {
    const secret = "fixture-app-secret";
    const verifyToken = "fixture-verify-token";
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver({ WHATSAPP_APP_SECRET: secret, WHATSAPP_VERIFY_TOKEN: verifyToken }), now: () => now });
    const profile = await database.whatsAppConnectionProfile.findFirstOrThrow({ where: { workspaceId }, include: { connection: true } });
    await database.whatsAppConnectionProfile.update({ where: { id: profile.id }, data: { operatingMode: "EXTERNAL_DISABLED", policyEligibility: "ELIGIBLE", phoneNumberId: "987654321", businessAccountId: "123456789" } });
    await database.integrationSecretReference.updateMany({ where: { workspaceId, connectionId: profile.connectionId, alias: { in: ["app-secret", "verify-token"] } }, data: { present: true } });
    await expect(service.verifyWebhookChallenge(profile.webhookKey, "subscribe", verifyToken, "challenge-001")).resolves.toBe("challenge-001");
    await expect(service.verifyWebhookChallenge(profile.webhookKey, "subscribe", "wrong", "challenge-001")).resolves.toBeNull();
    const raw = Buffer.from(JSON.stringify(webhookPayload("987654321", "wamid.webhook.fixture.001")));
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    await expect(service.acceptWebhook(profile.webhookKey, raw, "sha256=invalid")).rejects.toMatchObject({ code: "WHATSAPP_SIGNATURE_INVALID" });
    const accepted = await service.acceptWebhook(profile.webhookKey, raw, signature);
    expect(accepted).toMatchObject({ accepted: 1, duplicates: 0 });
    await expect(service.acceptWebhook(profile.webhookKey, raw, signature)).resolves.toMatchObject({ accepted: 0, duplicates: 1 });
    expect(await database.webhookInbox.count({ where: { workspaceId, connectionId: profile.connectionId, providerEventId: "wamid.webhook.fixture.001", status: "VERIFIED" } })).toBe(1);
    expect(await database.job.count({ where: { workspaceId, idempotencyKey: "whatsapp-process:wamid.webhook.fixture.001", status: "PENDING" } })).toBe(1);
    const worker = createWhatsAppWebhookWorkerService({ database, now: () => now, backoffBaseSeconds: 1 });
    await expect(worker.processNext("crm44-integration-worker")).resolves.toMatchObject({ status: "SUCCEEDED", idempotent: false });
    expect(await database.webhookInbox.count({ where: { workspaceId, connectionId: profile.connectionId, providerEventId: "wamid.webhook.fixture.001", status: "PROCESSED" } })).toBe(1);
    expect(await database.message.count({ where: { workspaceId, providerKey: WHATSAPP_PROVIDER_KEY, externalMessageId: "wamid.webhook.fixture.001" } })).toBe(1);
    expect(await database.job.count({ where: { workspaceId, idempotencyKey: "whatsapp-process:wamid.webhook.fixture.001", status: "SUCCEEDED" } })).toBe(1);
    const wrongTenant = Buffer.from(JSON.stringify(webhookPayload("555555555", "wamid.webhook.fixture.002")));
    const wrongSignature = `sha256=${createHmac("sha256", secret).update(wrongTenant).digest("hex")}`;
    await expect(service.acceptWebhook(profile.webhookKey, wrongTenant, wrongSignature)).rejects.toMatchObject({ code: "WHATSAPP_TENANT_MISMATCH" });
  });

  it("reagenda falha transitória com backoff e encerra em dead-letter no limite", async () => {
    const profile = await database.whatsAppConnectionProfile.findFirstOrThrow({ where: { workspaceId } });
    const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
    const inbox = await database.webhookInbox.create({ data: { workspaceId, connectionId: profile.connectionId, providerEventId: "wamid.webhook.retry.fixture", eventType: "whatsapp.message.received", contractVersion: "whatsapp-cloud-api/1.0", payloadHash: "retry-payload-hash", nonceHash: "retry-nonce-hash", payloadSizeBytes: 100, payload: { kind: "MESSAGE", eventId: "wamid.webhook.retry.fixture", phoneNumberId: "987654321", businessAccountId: "123456789", from: "5511999990001", occurredAt: now.toISOString(), messageType: "TEXT", body: "Retry fixture", replyToExternalMessageId: null, optOut: false, media: null, reviewReason: null }, dataClass: "CONTACT_DATA", signatureStatus: "VERIFIED", externalOccurredAt: now, receivedAt: now, status: "VERIFIED", correlationId: "whatsapp:retry-fixture" } });
    const job = await database.job.create({ data: { workspaceId, type: "WEBHOOK", status: "PENDING", idempotencyKey: "whatsapp-process:wamid.webhook.retry.fixture", priority: 90, runAt: now, maxAttempts: 2, payload: { inboxId: inbox.id, profileId: randomUUID(), provider: WHATSAPP_PROVIDER_KEY }, createdByActorId: actor.id, updatedByActorId: actor.id } });
    const worker = createWhatsAppWebhookWorkerService({ database, now: () => now, backoffBaseSeconds: 1 });
    const firstAttempt = await worker.processNext("crm44-retry-worker");
    const firstJob = await database.job.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, attempts: true, maxAttempts: true, errorCode: true } });
    expect({ result: firstAttempt, job: firstJob }).toMatchObject({ result: { status: "RETRY_PENDING" }, job: { status: "PENDING", attempts: 1, maxAttempts: 2, errorCode: "INTEGRATION_UNEXPECTED_FAILURE" } });
    await database.job.update({ where: { id: job.id }, data: { runAt: now } });
    await expect(worker.processNext("crm44-retry-worker")).resolves.toMatchObject({ status: "DEAD_LETTER" });
    await expect(database.job.findUniqueOrThrow({ where: { id: job.id } })).resolves.toMatchObject({ status: "FAILED", attempts: 2 });
    await expect(database.webhookInbox.findUniqueOrThrow({ where: { id: inbox.id } })).resolves.toMatchObject({ status: "DEAD_LETTER", attempts: 2 });
    expect(await database.integrationDeliveryAttempt.count({ where: { workspaceId, inboxId: inbox.id } })).toBe(2);
    const service = createWhatsAppService({ database, secrets: new EphemeralSecretResolver(), now: () => now });
    await expect(service.replayWebhook(viewer, { inboxId: inbox.id, reason: "Tentativa sem permissão" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.replayWebhook(admin, { inboxId: inbox.id, reason: "Reprocessamento autorizado no teste da CRM-44." })).resolves.toMatchObject({ status: "PENDING", idempotent: false });
    await expect(database.job.findUniqueOrThrow({ where: { id: job.id } })).resolves.toMatchObject({ status: "PENDING", attempts: 2, maxAttempts: 4 });
  });

  it("executa backfill de janela em dry-run e modo idempotente sem inferir fatos ausentes", async () => {
    const base = await database.lead.findUniqueOrThrow({ where: { id: knownLeadId }, include: { contact: { include: { points: { where: { type: "PHONE", deletedAt: null }, take: 1 } } } } });
    const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
    const occurredAt = new Date("2046-04-19T12:00:00.000Z");
    const profile = await database.whatsAppConnectionProfile.findFirstOrThrow({ where: { workspaceId } });
    const conversation = await database.conversation.create({ data: { workspaceId, contactId: base.contactId, contactPointId: base.contact?.points[0]?.id ?? null, leadId: base.id, accountId: base.accountId, connectionId: profile.connectionId, assigneeMemberId: base.ownerMemberId, queueId: base.ownerMemberId ? null : base.queueId, channel: "WHATSAPP", status: "PENDING_INTERNAL", priority: base.priority, externalThreadId: "whatsapp-backfill-fixture", openedAt: occurredAt, createdByActorId: actor.id, updatedByActorId: actor.id } });
    await database.message.create({ data: { workspaceId, conversationId: conversation.id, senderActorId: actor.id, direction: "INBOUND", type: "TEXT", status: "RECEIVED", body: "Mensagem histórica", bodyHash: "historical-fixture", providerKey: WHATSAPP_PROVIDER_KEY, externalMessageId: "wamid.backfill.fixture", idempotencyKey: "whatsapp-backfill-message-fixture", clientCorrelationId: "whatsapp-backfill-fixture", occurredAt, receivedAt: occurredAt } });
    const service = createWhatsAppBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    await expect(service.run(admin, { mode: "DRY_RUN", runKey: "crm44:backfill:dry:fixture" })).resolves.toMatchObject({ status: "SUCCEEDED", updatedCount: 0, idempotent: false });
    await expect(database.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).resolves.toMatchObject({ lastCustomerInboundAt: null });
    const executed = await service.run(admin, { mode: "EXECUTE", runKey: "crm44:backfill:execute:fixture" });
    expect(executed).toMatchObject({ status: "SUCCEEDED", idempotent: false });
    expect(executed.updatedCount).toBeGreaterThanOrEqual(1);
    await expect(database.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).resolves.toMatchObject({ lastCustomerInboundAt: occurredAt, serviceWindowExpiresAt: new Date("2046-04-20T12:00:00.000Z") });
    await expect(service.run(admin, { mode: "EXECUTE", runKey: "crm44:backfill:execute:fixture" })).resolves.toMatchObject({ idempotent: true });
  });
});
