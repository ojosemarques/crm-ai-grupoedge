import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createGovernedAgentService } from "@/modules/ai-agents/application/governed-agent-service";
import { createOutboundCampaignService } from "@/modules/campaigns/application/outbound-campaign-service";
import { createOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createTransactionalCheckoutService } from "@/modules/payments/application/transactional-checkout-service";
import { CHECKOUT_CONTRACT_VERSION, signCheckoutWebhook } from "@/modules/payments/domain/transactional-checkout-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedOmnichannelDemoData } from "@/modules/settings/application/omnichannel-demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Stage 19 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 19 requires an ephemeral schema.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2059-07-15T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let campaignLeadId: string;
let campaignAddress: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  await seedOmnichannelDemoData(database, clock);
  admin = await context("admin@demo.politizai.local");
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" }, orderBy: { createdAt: "asc" } });
  const system = { workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key } satisfies ServiceActorContext;
  const intake = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({ channel: "MANUAL", idempotencyKey: "stage19:campaign:lead", fullName: "Resposta de campanha Stage 19", phone: "+5511988801901", sourceKey: "manual", rawPayload: { fixture: "stage19" } }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  campaignLeadId = intake.leadId;
  const lead = await database.lead.findUniqueOrThrow({ where: { id: campaignLeadId } });
  campaignAddress = (await database.contactPoint.findFirstOrThrow({ where: { workspaceId, contactId: lead.contactId!, type: "PHONE" } })).normalizedValue;
});

afterAll(async () => database.$disconnect());

describe("Etapa 19 — jornadas completas complementares", () => {
  it("liga campanha, resposta recebida e handoff humano sem perder o contato", async () => {
    const campaignService = createOutboundCampaignService({ database, now: () => clock });
    const campaign = await campaignService.create(admin, { name: "Campanha Stage 19", channel: "SMS", providerMode: "LOCAL_SIMULATOR", purposeKey: "legacy-commercial-contact", templateBody: "Olá {{nome}}", segment: { leadIds: [campaignLeadId], csvAddresses: [], sourceIds: [], tagIds: [], offerIds: [], fields: {} }, postActions: { tagIds: [], taskTitle: "Tratar resposta da campanha" }, windowStartMinute: 0, windowEndMinute: 1440, timeZone: "America/Sao_Paulo", maxRecipients: 1, unitCostCents: 7 });
    const preview = await campaignService.preview(admin, campaign.id);
    await campaignService.approve(admin, campaign.id, preview.snapshotHash, "Público e custo aprovados para a prova integrada.");
    await campaignService.start(admin, campaign.id);
    await expect(campaignService.processNext(admin, campaign.id, "ACCEPT")).resolves.toMatchObject({ status: "ACCEPTED", externalEgress: false });

    const inbox = createOmnichannelService({ database, authorization, now: () => new Date(clock.getTime() + 1_000) });
    const inbound = await inbox.receiveLocal(admin, { externalEventId: "stage19:campaign:reply", channel: "INTERNAL_SIMULATOR", address: campaignAddress, body: "Quero falar com uma pessoa sobre a proposta.", occurredAt: new Date(clock.getTime() + 1_000).toISOString(), scenario: "RECEIVED" });
    const conversation = await database.conversation.findUniqueOrThrow({ where: { id: inbound.conversationId! } });
    const queue = await database.queue.create({ data: { workspaceId, key: `stage19-handoff-${randomUUID()}`, name: "Handoff Stage 19", conversationServiceType: "SPECIALIST", conversationSlaSeconds: 900, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    await inbox.command(admin, { action: "TRANSFER", conversationId: conversation.id, memberId: null, queueId: queue.id, reason: "Resposta da campanha requer atendimento humano.", expectedRevision: conversation.revision });
    await expect(database.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).resolves.toMatchObject({ leadId: campaignLeadId, queueId: queue.id, serviceType: "SPECIALIST" });
    expect(await database.conversationAssignmentHistory.count({ where: { workspaceId, conversationId: conversation.id, newQueueId: queue.id } })).toBe(1);
  });

  it("transfere uma conversa do agente para humano e impede resposta concorrente", async () => {
    const agents = createGovernedAgentService({ database, authorization, now: () => clock });
    const conversation = await database.conversation.create({ data: { workspaceId, assigneeMemberId: admin.memberId, channel: "INTERNAL_SIMULATOR", subject: "Agente para humano Stage 19", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const definition = { instructions: "Use somente a base aprovada e transfira baixa confiança ao humano.", tone: "CONSULTATIVE", audience: "Equipe comercial", offerScope: "Catálogo ativo", model: "local-deterministic-v1", budgetCents: 0, maxInputTokens: 1200, maxOutputTokens: 500, allowedDataFields: ["conversation.messages", "catalog.active_products"], allowedTools: ["SEARCH_APPROVED_KB", "REQUEST_HANDOFF", "PROPOSE_SENSITIVE_ACTION"], knowledge: { title: "Base Stage 19", content: "A solução comercial ativa atende operação, diagnóstico e proposta. Decisões comerciais exigem confirmação humana.", sourceReference: "stage19://approved" } } as const;
    const agent = await agents.command(admin, { action: "CREATE_AGENT", payload: { name: "Agente Stage 19", objective: "Responder com fonte e transferir para humano.", definition } }) as { id: string };
    await agents.command(admin, { action: "EVALUATE", payload: { agentId: agent.id } });
    await agents.command(admin, { action: "PUBLISH", payload: { agentId: agent.id, reason: "Gates revisados para a jornada Stage 19." } });
    const turn = await agents.command(admin, { action: "START_CONVERSATION", payload: { agentId: agent.id, conversationId: conversation.id, idempotencyKey: "stage19:agent:turn", message: "Como a solução comercial atende minha operação?" } }) as { status: string };
    expect(turn.status).toBe("RESPONDED");
    await expect(agents.command(admin, { action: "HUMAN_REPLY", payload: { conversationId: conversation.id, reason: "Pessoa assumiu o atendimento no inbox." } })).resolves.toEqual({ paused: true, concurrentAgentMessageAllowed: false });
    await expect(agents.command(admin, { action: "START_CONVERSATION", payload: { agentId: agent.id, conversationId: conversation.id, idempotencyKey: "stage19:agent:blocked", message: "Nova mensagem" } })).rejects.toMatchObject({ code: "CONVERSATION_LEASE_CONFLICT" });
  });

  it("reconcilia checkout, pagamento e reembolso com replay idempotente", async () => {
    const product = await database.product.create({ data: { workspaceId, sku: "STAGE19-CHECKOUT", name: "Produto transacional Stage 19", kind: "PRODUCT", audience: "INDIVIDUAL", availability: "AVAILABLE", revenueCategory: "SOFTWARE", salesGateProfile: "STANDARD", listPriceCents: 19_900n, active: true, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const checkouts = createTransactionalCheckoutService({ database, now: () => clock });
    const created = await checkouts.create(admin, { productId: product.id, paymentMethod: "PIX", sourceType: "API", sourceId: "stage19-order", idempotencyKey: "stage19:checkout:create" });
    const signed = (eventType: string, eventId: string, nonce: string, providerSequence: number) => {
      const body = JSON.stringify({ contractVersion: CHECKOUT_CONTRACT_VERSION, workspaceId, eventId, nonce, eventType, providerSequence, occurredAt: new Date(clock.getTime() + providerSequence * 1_000).toISOString(), externalCheckoutId: created.checkout.externalCheckoutId, productId: product.id, paymentMethod: "PIX", amountCents: 19_900, currency: "BRL" });
      const timestamp = clock.toISOString();
      return { rawBody: Buffer.from(body), timestamp, signature: signCheckoutWebhook(timestamp, body, { NODE_ENV: "test" }) };
    };
    const purchase = signed("PURCHASE_CONFIRMED", "stage19.purchase", "stage19_purchase_nonce", 1);
    await expect(checkouts.ingestSignedWebhook(purchase.rawBody, purchase.timestamp, purchase.signature)).resolves.toMatchObject({ status: "PURCHASED", idempotent: false });
    await expect(checkouts.ingestSignedWebhook(purchase.rawBody, purchase.timestamp, purchase.signature)).resolves.toMatchObject({ idempotent: true });
    const refund = signed("PURCHASE_REFUNDED", "stage19.refund", "stage19_refund_nonce", 2);
    await expect(checkouts.ingestSignedWebhook(refund.rawBody, refund.timestamp, refund.signature)).resolves.toMatchObject({ status: "REFUNDED", idempotent: false });
    await expect(checkouts.detail(admin, created.checkout.id)).resolves.toMatchObject({ cash: { grossCents: 19_900n, refundedCents: 19_900n, netCents: 0n } });
    expect(await database.transactionalCheckoutEvent.count({ where: { workspaceId, checkoutId: created.checkout.id, providerEventId: { not: null } } })).toBe(2);
  });
});
