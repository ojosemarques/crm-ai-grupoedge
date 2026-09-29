import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createOmnichannelBackfillService } from "@/modules/communications/application/omnichannel-backfill-service";
import { createOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPrivacyService } from "@/modules/privacy/application/privacy-service";
import { DEMO_USERS, seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(databaseUrl, { max: 16 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2046-08-12T15:00:00.000Z");
const service = createOmnichannelService({ database, authorization, now: () => now });
const allowedService = createOmnichannelService({
  database,
  authorization,
  now: () => now,
  evaluatePrivacy: async (tx, input) => {
    const lead = await tx.lead.findFirstOrThrow({ where: { id: input.leadId, workspaceId: input.workspaceId } });
    return {
      outcome: "ALLOW",
      reasonCodes: ["TEST_ACTIVE_POLICY_AND_CONSENT"],
      missingEvidence: [],
      mode: "SHADOW_LOCAL",
      contactId: lead.contactId!,
      contactPointId: input.contactPointId ?? null,
      purpose: null,
      consentState: "GRANTED",
      evaluatedAt: now.toISOString(),
      ruleVersion: "privacy-test-fixture-v1",
      decisionId: null,
    };
  },
});
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let sdr: AuthenticatedContext;
let viewer: AuthenticatedContext;
let system: ServiceActorContext;
let sourceKey: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspace: { slug: "politizai" }, user: { normalizedEmail: email }, status: "ACTIVE", deletedAt: null }, include: { workspace: true, user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

async function intake(phoneSuffix: string) {
  const result = await createLeadIntakeService({ database, authorization, now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `crm43-intake-${phoneSuffix}-${randomUUID()}`, fullName: `Contato omnichannel ${phoneSuffix}`, phone: `11 98888-${phoneSuffix}`, email: `crm43-${phoneSuffix}-${randomUUID()}@example.test`, sourceKey, rawPayload: { fixture: "crm43" } }, system);
  if (result.outcome === "REJECTED") throw new Error(result.code);
  return database.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { contact: { include: { points: true } } } });
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  admin = await context(DEMO_USERS[0].email);
  [manager, sdr, viewer] = await Promise.all([context(DEMO_USERS[1].email), context(DEMO_USERS[2].email), context(DEMO_USERS.at(-1)!.email)]);
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, key: "system" } });
  system = { workspaceId: seeded.workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key };
  sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, deletedAt: null } })).key;
});

afterAll(async () => database.$disconnect());

describe("CRM-43 inbox omnichannel canônico", () => {
  it("resolve identidade exata, atribui explicitamente e recebe uma vez", async () => {
    const lead = await intake("4301");
    const address = lead.contact!.points.find((point) => point.type === "PHONE")!.normalizedValue;
    const eventId = `evt:${randomUUID()}`;
    const payload = { externalEventId: eventId, channel: "INTERNAL_SIMULATOR", address, body: "Mensagem de teste canônica", occurredAt: now.toISOString(), scenario: "RECEIVED" };
    const [first, replay] = await Promise.all([service.receiveLocal(manager, payload), service.receiveLocal(manager, payload)]);
    expect(new Set([first.messageId, replay.messageId]).size).toBe(1);
    expect([first.outcome, replay.outcome]).toEqual(expect.arrayContaining(["ATTACHED", "IDEMPOTENT"]));
    const conversation = await database.conversation.findUniqueOrThrow({ where: { id: first.conversationId! }, include: { assignments: true, messages: { include: { statusEvents: true } } } });
    expect(Boolean(conversation.assigneeMemberId || conversation.queueId)).toBe(true);
    expect(conversation.assignments).toHaveLength(1);
    expect(conversation.messages[0]?.statusEvents).toHaveLength(1);
    expect(conversation.status).toBe("PENDING_INTERNAL");

    const simultaneous = [
      { ...payload, externalEventId: `evt:${randomUUID()}`, body: "Mensagem simultânea A" },
      { ...payload, externalEventId: `evt:${randomUUID()}`, body: "Mensagem simultânea B" },
    ];
    const concurrentResults = await Promise.all(simultaneous.map((item) => service.receiveLocal(manager, item)));
    expect(new Set(concurrentResults.map((item) => item.conversationId))).toEqual(new Set([conversation.id]));
    expect(await database.conversation.count({
      where: { workspaceId: admin.workspaceId, contactPointId: lead.contact!.points.find((point) => point.type === "PHONE")!.id, channel: "INTERNAL_SIMULATOR", deletedAt: null },
    })).toBe(1);
    expect(await database.message.count({ where: { workspaceId: admin.workspaceId, conversationId: conversation.id } })).toBe(3);
  });

  it("não cria lead fora do LeadIntakeService e envia desconhecido à Fila Geral", async () => {
    const before = await database.lead.count({ where: { workspaceId: admin.workspaceId } });
    const result = await service.receiveLocal(manager, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: "+5511990000043", body: "Contato desconhecido", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    expect(result).toMatchObject({ outcome: "REVIEW_REQUIRED", leadId: null });
    expect(await database.lead.count({ where: { workspaceId: admin.workspaceId } })).toBe(before);
    const conversation = await database.conversation.findUniqueOrThrow({ where: { id: result.conversationId! }, include: { queue: true, identityReviews: true } });
    expect(conversation.queue?.isGeneral).toBe(true);
    expect(conversation.identityReviews[0]?.status).toBe("OPEN");
  });

  it("bloqueia saída sem evidência de privacidade e não cria outbox", async () => {
    const lead = await intake("4302");
    const received = await service.receiveLocal(manager, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: lead.contact!.points.find((point) => point.type === "PHONE")!.normalizedValue, body: "Preciso de ajuda", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    const outbound = await service.composeAndEnqueue(manager, { conversationId: received.conversationId!, body: "Resposta local", idempotencyKey: `send:${randomUUID()}`, clientCorrelationId: `correlation:${randomUUID()}` });
    expect(outbound).toMatchObject({ status: "BLOCKED_BY_POLICY", outboxId: null, privacyOutcome: "REVIEW_REQUIRED" });
  });

  it("distingue aceite interno de entrega, tolera evento fora de ordem e deduplica callback", async () => {
    const lead = await intake("4303");
    const point = lead.contact!.points.find((item) => item.type === "PHONE")!;
    const received = await service.receiveLocal(manager, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: point.normalizedValue, body: "Pode responder", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    const key = `send:${randomUUID()}`;
    const outbound = await allowedService.composeAndEnqueue(manager, { conversationId: received.conversationId!, body: "Resposta autorizada", idempotencyKey: key, clientCorrelationId: `correlation:${randomUUID()}` });
    expect(outbound.status).toBe("QUEUED");
    const acceptedId = `callback:${randomUUID()}`;
    await allowedService.simulateDelivery(manager, { messageId: outbound.messageId, scenario: "ACCEPTED", externalEventId: acceptedId });
    expect((await database.message.findUniqueOrThrow({ where: { id: outbound.messageId } })).status).toBe("ACCEPTED_INTERNAL");
    const deliveredId = `callback:${randomUUID()}`;
    await allowedService.simulateDelivery(manager, { messageId: outbound.messageId, scenario: "DELIVERED", externalEventId: deliveredId });
    await allowedService.simulateDelivery(manager, { messageId: outbound.messageId, scenario: "ACCEPTED", externalEventId: `callback:${randomUUID()}` });
    await expect(allowedService.simulateDelivery(manager, { messageId: outbound.messageId, scenario: "DELIVERED", externalEventId: deliveredId })).resolves.toMatchObject({ idempotent: true });
    expect((await database.message.findUniqueOrThrow({ where: { id: outbound.messageId } })).status).toBe("DELIVERED");
    expect(await database.messageStatusEvent.count({ where: { workspaceId: admin.workspaceId, providerKey: "LOCAL_SIMULATOR", externalEventId: deliveredId } })).toBe(1);
  });

  it("cancela retry compatível quando surge opt-out", async () => {
    const lead = await intake("4304");
    const point = lead.contact!.points.find((item) => item.type === "PHONE")!;
    const purpose = await database.purposeVersion.findFirstOrThrow({ where: { workspaceId: admin.workspaceId }, include: { legalBasis: true } });
    const received = await service.receiveLocal(manager, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: point.normalizedValue, body: "Pode responder", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    const message = await allowedService.composeAndEnqueue(manager, { conversationId: received.conversationId!, body: "Resposta que falhará temporariamente", idempotencyKey: `send:${randomUUID()}`, clientCorrelationId: `correlation:${randomUUID()}` });
    expect(message.status).toBe("QUEUED");
    const transient = await allowedService.simulateDelivery(manager, { messageId: message.messageId, scenario: "TRANSIENT_FAILURE", externalEventId: `callback:${randomUUID()}` });
    expect(transient.idempotent).toBe(false);
    await createPrivacyService({ database, now: () => now }).recordConsent(admin, { leadId: lead.id, contactPointId: point.id, purposeVersionId: purpose.id, channel: "OTHER", action: "OPTED_OUT", occurredAt: now, idempotencyKey: `optout:${randomUUID()}`, reason: "Pedido expresso no teste" });
    expect((await database.message.findUniqueOrThrow({ where: { id: message.messageId } })).status).toBe("CANCELLED");
    expect((await database.outboxEvent.findFirstOrThrow({ where: { messageId: message.messageId } })).status).toBe("CANCELLED");
  });

  it("propaga opt-out recebido e cancela a saída pendente do mesmo ponto", async () => {
    const lead = await intake("4305");
    const point = lead.contact!.points.find((item) => item.type === "PHONE")!;
    const received = await service.receiveLocal(manager, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: point.normalizedValue, body: "Início do atendimento", occurredAt: now.toISOString(), scenario: "RECEIVED" });
    const outbound = await allowedService.composeAndEnqueue(manager, { conversationId: received.conversationId!, body: "Resposta pendente", idempotencyKey: `send:${randomUUID()}`, clientCorrelationId: `correlation:${randomUUID()}` });
    await service.receiveLocal(manager, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: point.normalizedValue, body: "Não quero mais receber mensagens", occurredAt: now.toISOString(), scenario: "OPT_OUT" });
    expect((await database.message.findUniqueOrThrow({ where: { id: outbound.messageId } })).status).toBe("CANCELLED");
    expect((await database.contactPoint.findUniqueOrThrow({ where: { id: point.id } })).doNotContact).toBe(true);
    expect((await database.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactPreference).toBe("DO_NOT_CONTACT");
  });

  it("aplica escopo no servidor e protege comandos por revisão otimista", async () => {
    await expect(service.receiveLocal(viewer, { externalEventId: `evt:${randomUUID()}`, channel: "INTERNAL_SIMULATOR", address: "+5511990009999", body: "Sem permissão", occurredAt: now.toISOString(), scenario: "RECEIVED" })).rejects.toBeInstanceOf(AccessDeniedError);
    const screen = await service.getInbox(sdr, { view: "ALL" });
    expect(screen.conversations.every((conversation) => conversation.assignee?.id === sdr.memberId)).toBe(true);
    const viewerScreen = await service.getInbox(viewer, { view: "ALL" });
    expect(viewerScreen.capabilities).toMatchObject({ compose: false, assign: false, manage: false, replay: false, viewSensitive: false });
    expect(viewerScreen.conversations.filter((conversation) => conversation.preview?.body).every((conversation) => conversation.preview?.body === "Conteúdo protegido")).toBe(true);
    const mine = await database.conversation.findFirst({ where: { workspaceId: admin.workspaceId, assigneeMemberId: sdr.memberId, deletedAt: null } });
    if (mine) await expect(service.command(sdr, { action: "RESOLVE", conversationId: mine.id, reason: "Não autorizado", expectedRevision: mine.revision })).rejects.toBeInstanceOf(AccessDeniedError);
    const any = await database.conversation.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, deletedAt: null } });
    await expect(service.command(manager, { action: "RESOLVE", conversationId: any.id, reason: "Atendimento concluído", expectedRevision: any.revision + 1 })).rejects.toMatchObject({ code: "CONVERSATION_CONFLICT" });
  });

  it("mantém fatos append-only e executa backfill conservador com replay idempotente", async () => {
    const event = await database.messageStatusEvent.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } });
    await expect(database.messageStatusEvent.update({ where: { id: event.id }, data: { reasonCode: "reescrita" } })).rejects.toThrow(/append-only/);
    const backfill = createOmnichannelBackfillService({ database, authorization, now: () => now });
    const dry = await backfill.run(admin, { mode: "DRY_RUN", runKey: `crm43:dry:${randomUUID()}` });
    const key = `crm43:execute:${randomUUID()}`;
    const executed = await backfill.run(admin, { mode: "EXECUTE", runKey: key });
    const replay = await backfill.run(admin, { mode: "EXECUTE", runKey: key });
    expect(dry.status).toBe("SUCCEEDED");
    expect(executed.status).toBe("SUCCEEDED");
    expect(replay.idempotent).toBe(true);
    const lead = await database.lead.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, conversations: { some: {} } } });
    await expect(service.getLeadSummary(manager, lead.id)).resolves.toMatchObject({ conversationCount: expect.any(Number), inboundMessageCount: expect.any(Number), outboundMessageCount: expect.any(Number) });
  });
});
