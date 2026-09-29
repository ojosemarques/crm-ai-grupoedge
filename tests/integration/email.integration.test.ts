import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { createEmailBackfillService } from "@/modules/integrations/application/email-backfill-service";
import { createEmailMessageWorkerService } from "@/modules/integrations/application/email-message-worker-service";
import { createEmailService } from "@/modules/integrations/application/email-service";
import { localEmailSinkTransport } from "@/modules/integrations/application/email-transport";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPrivacyService } from "@/modules/privacy/application/privacy-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedOmnichannelDemoData } from "@/modules/settings/application/omnichannel-demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-45 integration test requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const now = new Date("2046-05-04T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let system: ServiceActorContext;
let leadId: string;
let emailAddress: string;
let conversationId: string;

function allowedOmnichannel() {
  return createOmnichannelService({
    database,
    authorization: createAuthorizationService({ database }),
    now: () => now,
    evaluatePrivacy: async (tx, input) => {
      const lead = await tx.lead.findFirstOrThrow({ where: { id: input.leadId, workspaceId: input.workspaceId } });
      return { outcome: "ALLOW", reasonCodes: ["TEST_ACTIVE_POLICY_AND_CONSENT"], missingEvidence: [], mode: "SHADOW_LOCAL", contactId: lead.contactId!, contactPointId: input.contactPointId ?? null, purpose: null, consentState: "GRANTED", evaluatedAt: now.toISOString(), ruleVersion: "privacy-test-fixture-v1", decisionId: null };
    },
  });
}

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
  const sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } })).key;
  emailAddress = "crm45.threading@example.test";
  const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now }).intake({ channel: "MANUAL", idempotencyKey: "crm45-known-email-contact", fullName: "Contato conhecido CRM-45", phone: "+55 11 98888-4545", email: emailAddress, sourceKey, rawPayload: { fixture: "crm45" } }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  leadId = intake.leadId;
  const [lead, point, purpose] = await Promise.all([
    database.lead.findUniqueOrThrow({ where: { id: leadId } }),
    database.contactPoint.findFirstOrThrow({ where: { workspaceId, type: "EMAIL", normalizedValue: emailAddress, deletedAt: null } }),
    database.purposeVersion.findFirstOrThrow({ where: { workspaceId, purpose: { code: "legacy-commercial-contact" } }, orderBy: { version: "desc" } }),
  ]);
  if (!lead.contactId) throw new Error("CRM-45 fixture requires canonical Contact.");
  await createPrivacyService({ database, now: () => now }).recordConsent(admin, { leadId, contactPointId: point.id, purposeVersionId: purpose.id, channel: "EMAIL", action: "GRANTED", evidenceReference: "crm45-fixture-explicit-consent", occurredAt: now, idempotencyKey: "crm45-consent-known-email", reason: "Consentimento explícito da fixture local CRM-45." });
});

afterAll(async () => database.$disconnect());

describe("CRM-45 e-mail local, seguro e canônico", () => {
  it("expõe prontidão local honesta, credenciais ausentes e RBAC", async () => {
    const service = createEmailService({ database, now: () => now });
    await expect(service.screen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.screen(admin)).resolves.toMatchObject({ activationStatus: "LOCAL_SIMULATOR", externalEgress: false, externalValidationDeferred: true, profile: { operatingMode: "LOCAL_SINK", spfStatus: "PENDING_EXTERNAL", dkimStatus: "PENDING_EXTERNAL", dmarcStatus: "PENDING_EXTERNAL" } });
  });

  it("recebe e-mail idempotente e encadeia resposta por Message-ID, nunca por assunto", async () => {
    const omnichannel = allowedOmnichannel();
    const service = createEmailService({ database, now: () => now, omnichannel });
    const first = await service.simulateInbound(admin, { externalEventId: "email-inbound-001", from: emailAddress, subject: "Assunto comercial", text: "Gostaria de receber detalhes.", occurredAt: now.toISOString(), messageId: "<customer.001@example.test>", references: [] });
    expect(first).toMatchObject({ outcome: "ATTACHED" });
    conversationId = first.conversationId!;
    const repeated = await service.simulateInbound(admin, { externalEventId: "email-inbound-001", from: emailAddress, subject: "Assunto comercial", text: "Gostaria de receber detalhes.", occurredAt: now.toISOString(), messageId: "<customer.001@example.test>", references: [] });
    expect(repeated).toMatchObject({ outcome: "IDEMPOTENT", messageId: first.messageId });
    const reply = await service.simulateInbound(admin, { externalEventId: "email-inbound-002", from: emailAddress, subject: "Assunto completamente alterado", text: "Esta é a resposta.", occurredAt: "2046-05-04T15:01:00.000Z", messageId: "<customer.002@example.test>", inReplyTo: "<customer.001@example.test>", references: ["<customer.001@example.test>"] });
    expect(reply.conversationId).toBe(conversationId);
    expect(await database.conversation.count({ where: { workspaceId, channel: "EMAIL", messages: { some: { externalMessageId: { in: ["email-inbound-001", "email-inbound-002"] } } } } })).toBe(1);
  });

  it("enfileira, revalida política e aceita somente no sink local sem egress", async () => {
    const omnichannel = allowedOmnichannel();
    const queued = await omnichannel.composeAndEnqueue(admin, { conversationId, subject: "Retorno CRM-45", body: "Resposta segura em ambiente local.", idempotencyKey: "crm45-local-outbound-001", clientCorrelationId: "crm45-local-outbound-001" });
    expect(queued).toMatchObject({ status: "QUEUED", idempotent: false });
    const worker = createEmailMessageWorkerService({ database, transport: localEmailSinkTransport, now: () => now });
    await expect(worker.processNext("crm45-email-worker")).resolves.toMatchObject({ status: "SUCCEEDED", simulated: true, externalEgress: false });
    await expect(database.message.findUniqueOrThrow({ where: { id: queued.messageId } })).resolves.toMatchObject({ status: "PROVIDER_ACCEPTED", isSimulated: true, providerAcceptedAt: now });
    expect(await database.messageStatusEvent.count({ where: { workspaceId, messageId: queued.messageId, status: "PROVIDER_ACCEPTED" } })).toBe(1);
    await expect(worker.processNext("crm45-email-worker")).resolves.toMatchObject({ status: "IDLE" });
  });

  it("faz retry com backoff, cria uma tentativa por execução e encerra em dead-letter", async () => {
    const queued = await allowedOmnichannel().composeAndEnqueue(admin, { conversationId, subject: "Retry controlado CRM-45", body: "Falha determinística somente local.", idempotencyKey: "crm45-local-retry-001", clientCorrelationId: "crm45-local-retry-001" });
    const attempt = await database.messageDeliveryAttempt.findFirstOrThrow({ where: { workspaceId, messageId: queued.messageId } });
    await database.job.update({ where: { id: attempt.jobId! }, data: { maxAttempts: 2 } });
    const failingWorker = createEmailMessageWorkerService({ database, transport: { externalEgress: false, send: async () => { throw new Error("CRM45_LOCAL_TRANSIENT_FAULT"); } }, now: () => now, backoffBaseSeconds: 5 });
    await expect(failingWorker.processNext("crm45-retry-worker")).resolves.toMatchObject({ status: "RETRY_PENDING", delaySeconds: 5 });
    await database.job.update({ where: { id: attempt.jobId! }, data: { runAt: now } });
    await expect(failingWorker.processNext("crm45-retry-worker")).resolves.toMatchObject({ status: "FAILED" });
    await expect(database.job.findUniqueOrThrow({ where: { id: attempt.jobId! } })).resolves.toMatchObject({ status: "FAILED", attempts: 2 });
    await expect(database.outboxEvent.findFirstOrThrow({ where: { workspaceId, messageId: queued.messageId } })).resolves.toMatchObject({ status: "DEAD_LETTER" });
    const attempts = await database.messageDeliveryAttempt.findMany({ where: { workspaceId, messageId: queued.messageId }, orderBy: { attemptNumber: "asc" } });
    expect(attempts).toHaveLength(2);
    expect(attempts.map((item) => item.attemptNumber)).toEqual([1, 2]);
    expect(attempts.every((item) => item.finishedAt !== null)).toBe(true);
  });

  it("hard bounce cria supressão append-only e bloqueia nova saída", async () => {
    const authorization = createAuthorizationService({ database });
    const omnichannel = createOmnichannelService({ database, authorization, now: () => now });
    const service = createEmailService({ database, now: () => now, omnichannel });
    const sent = await database.message.findFirstOrThrow({ where: { workspaceId, conversationId, direction: "OUTBOUND", status: "PROVIDER_ACCEPTED" }, orderBy: { occurredAt: "desc" } });
    await expect(service.simulateStatus(admin, { messageId: sent.id, externalEventId: "email-hard-bounce-001", status: "HARD_BOUNCE", occurredAt: now.toISOString() })).resolves.toMatchObject({ status: "HARD_BOUNCE" });
    expect(await database.emailSuppression.count({ where: { workspaceId, normalizedEmail: emailAddress, action: "APPLIED", reasonCode: "HARD_BOUNCE" } })).toBe(1);
    const blocked = await omnichannel.composeAndEnqueue(admin, { conversationId, subject: "Não deve sair", body: "Bloqueado pela supressão.", idempotencyKey: "crm45-blocked-outbound-002", clientCorrelationId: "crm45-blocked-outbound-002" });
    expect(blocked).toMatchObject({ status: "BLOCKED_BY_POLICY", policyCode: "PRIVACY_DENY" });
    expect(blocked.outboxId).toBeNull();
  });

  it("preserva referência ausente como revisão em vez de unir por assunto", async () => {
    const authorization = createAuthorizationService({ database });
    const omnichannel = createOmnichannelService({ database, authorization, now: () => now });
    const service = createEmailService({ database, now: () => now, omnichannel });
    const result = await service.simulateInbound(admin, { externalEventId: "email-orphan-reply-001", from: "orphan@example.test", subject: "Assunto comercial", text: "Resposta sem referência conhecida.", occurredAt: now.toISOString(), messageId: "<orphan.001@example.test>", inReplyTo: "<unknown.message@example.test>", references: ["<unknown.message@example.test>"] });
    expect(result.conversationId).not.toBe(conversationId);
    expect(await database.emailEventReview.count({ where: { workspaceId, messageId: result.messageId!, status: "OPEN", reasonCode: "THREAD_NOT_FOUND" } })).toBe(1);
  });

  it("backfill é dry-run, executável e idempotente sem inventar destinatário", async () => {
    const legacy = await database.message.create({ data: { workspaceId, conversationId, senderActorId: admin.actorId, direction: "INTERNAL", type: "TEXT", status: "RECEIVED", body: "Registro histórico", bodyHash: "crm45-legacy-hash", providerKey: "LOCAL_SIMULATOR", externalMessageId: "crm45-legacy", idempotencyKey: "crm45-legacy-message", clientCorrelationId: "crm45-legacy", isSimulated: true, simulationLabel: "Fixture local histórica da CRM-45.", occurredAt: now } });
    const backfill = createEmailBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    await expect(backfill.run(admin, { mode: "DRY_RUN", runKey: "crm45:backfill:dry:fixture" })).resolves.toMatchObject({ status: "SUCCEEDED", updatedCount: 0, idempotent: false });
    expect(await database.emailMessageProfile.count({ where: { workspaceId, messageId: legacy.id } })).toBe(0);
    await expect(backfill.run(admin, { mode: "EXECUTE", runKey: "crm45:backfill:execute:fixture" })).resolves.toMatchObject({ status: "SUCCEEDED", idempotent: false });
    expect(await database.emailMessageProfile.count({ where: { workspaceId, messageId: legacy.id } })).toBe(1);
    await expect(backfill.run(admin, { mode: "EXECUTE", runKey: "crm45:backfill:execute:fixture" })).resolves.toMatchObject({ idempotent: true });
  });

  it("mantém ownership canônico do lead na conversa conhecida", async () => {
    const [lead, conversation] = await Promise.all([database.lead.findUniqueOrThrow({ where: { id: leadId } }), database.conversation.findUniqueOrThrow({ where: { id: conversationId } })]);
    expect(conversation.assigneeMemberId ?? conversation.queueId).toBeTruthy();
    expect(conversation.assigneeMemberId).toBe(lead.ownerMemberId);
  });

  it("semeia três cenários de e-mail após normalizar leads legados e permanece idempotente", async () => {
    const sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } })).key;
    const intake = createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    for (const index of [1, 2]) {
      const result = await intake.intake({
        channel: "MANUAL",
        idempotencyKey: `crm45-demo-email-contact-${index}`,
        fullName: `Contato de e-mail ${index}`,
        phone: `+55 11 97777-45${index.toString().padStart(2, "0")}`,
        email: `crm45.demo.${index}@example.test`,
        sourceKey,
        rawPayload: { fixture: "crm45-demo-seed", index },
      }, system);
      expect(result.outcome).not.toBe("REJECTED");
    }

    const first = await seedOmnichannelDemoData(database, now);
    const firstCount = await database.conversation.count({ where: { workspaceId } });
    const repeated = await seedOmnichannelDemoData(database, now);
    const repeatedCount = await database.conversation.count({ where: { workspaceId } });

    expect(first).toMatchObject({ emailConversations: 3, templates: 2 });
    expect(first.conversations).toBeGreaterThanOrEqual(7);
    expect(repeated).toEqual(first);
    expect(repeatedCount).toBe(firstCount);
  });
});
