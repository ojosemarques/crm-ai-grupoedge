import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { normalizeChannelAddress, shouldProjectMessageStatus } from "@/modules/communications/domain/omnichannel-contracts";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import {
  WHATSAPP_ADAPTER_KEY,
  WHATSAPP_CONTRACT_VERSION,
  WHATSAPP_LOCAL_PROVIDER_KEY,
  WHATSAPP_MAX_WEBHOOK_BYTES,
  WHATSAPP_POLICY_REVIEW_TRIGGER,
  WHATSAPP_POLICY_SOURCE_OBSERVED_AT,
  WHATSAPP_POLICY_SOURCE_URL,
  WHATSAPP_POLITIZAI_INELIGIBILITY_RATIONALE,
  WHATSAPP_POLITIZAI_POLICY_SCOPE,
  WHATSAPP_PROVIDER_KEY,
  WHATSAPP_SECRET_REFERENCES,
  evaluateWhatsAppServiceWindow,
  mapWhatsAppProviderStatus,
  normalizeWhatsAppWebhook,
  verifyWhatsAppChallengeToken,
  verifyWhatsAppSignature,
  whatsAppConfigureLocalSchema,
  whatsAppConfigurationSchema,
  whatsAppLocalInboundSchema,
  whatsAppPolicyDecisionSchema,
  whatsAppStatusSimulationSchema,
  whatsAppWebhookKey,
  type NormalizedWhatsAppEvent,
} from "@/modules/integrations/domain/whatsapp-contracts";
import { cancelPendingOutboundForContactInTransaction } from "@/modules/privacy/application/privacy-service";
import { cancelIncompatibleAccountPlanActionsForLeadInTransaction } from "@/modules/opportunities/application/account-plan-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; secrets: SecretResolver; now: () => Date }>;
const CONNECTION_KEY = "whatsapp-cloud-api";
const SYSTEM_RESOURCE = "IntegrationConnection";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: SYSTEM_RESOURCE, resourceId: context.workspaceId };
}

async function systemFoundation(tx: Tx, workspaceId: string) {
  const [actor, queue] = await Promise.all([
    tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.queue.findFirst({ where: { workspaceId, isGeneral: true, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  if (!actor) fail("Ator Sistema não configurado.", "SYSTEM_ACTOR_MISSING");
  if (!queue) fail("Fila Geral não configurada.", "GENERAL_QUEUE_MISSING");
  return { actor, queue };
}

async function currentProfile(database: PrismaClient, workspaceId: string) {
  return database.whatsAppConnectionProfile.findFirst({
    where: { workspaceId },
    include: {
      connection: { include: { secrets: { where: { disabledAt: null }, orderBy: { version: "desc" } }, configVersions: { orderBy: { version: "desc" }, take: 1 } } },
      policyDecidedBy: { select: { key: true, user: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

function serializeEvent(event: NormalizedWhatsAppEvent) {
  return { ...event, occurredAt: event.occurredAt.toISOString() };
}

export function createWhatsAppService(options: Options) {
  const authorization = getAuthorizationService();
  const authorize = (context: AuthenticatedContext, permission: typeof PermissionKeys.INTEGRATIONS_READ | typeof PermissionKeys.INTEGRATIONS_MANAGE | typeof PermissionKeys.INTEGRATIONS_EXECUTE | typeof PermissionKeys.INTEGRATIONS_REPLAY | typeof PermissionKeys.MESSAGE_TEMPLATES_MANAGE | typeof PermissionKeys.MESSAGES_REPLAY) => authorization.assertAuthorized(context, permission, resource(context));

  async function screen(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_READ);
    const profile = await currentProfile(options.database, context.workspaceId);
    const now = options.now();
    const [conversations, inbound, outbound, pendingWebhooks, openReviews, templates, webhookIssues, reviews, openWindows, expiredWindows, withoutInbound] = await Promise.all([
      options.database.conversation.count({ where: { workspaceId: context.workspaceId, channel: "WHATSAPP", deletedAt: null } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", conversation: { channel: "WHATSAPP" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND", conversation: { channel: "WHATSAPP" } } }),
      profile ? options.database.webhookInbox.count({ where: { workspaceId: context.workspaceId, connectionId: profile.connectionId, status: { in: ["RECEIVED", "VERIFIED", "RETRY_PENDING"] } } }) : Promise.resolve(0),
      options.database.whatsAppEventReview.count({ where: { workspaceId: context.workspaceId, status: "OPEN" } }),
      options.database.messageTemplate.findMany({ where: { workspaceId: context.workspaceId, channel: "WHATSAPP" }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { id: true, name: true, key: true, locale: true, category: true, status: true, providerStatus: true, providerTemplateId: true, providerStatusObservedAt: true, currentVersion: true } }),
      profile ? options.database.webhookInbox.findMany({ where: { workspaceId: context.workspaceId, connectionId: profile.connectionId, status: { in: ["RETRY_PENDING", "DEAD_LETTER", "REJECTED"] } }, orderBy: [{ receivedAt: "desc" }, { id: "asc" }], take: 20, select: { id: true, providerEventId: true, eventType: true, status: true, attempts: true, maxAttempts: true, errorCode: true, errorMessage: true, receivedAt: true, nextRetryAt: true } }) : Promise.resolve([]),
      options.database.whatsAppEventReview.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, kind: true, reasonCode: true, status: true, createdAt: true } }),
      options.database.conversation.count({ where: { workspaceId: context.workspaceId, channel: "WHATSAPP", serviceWindowExpiresAt: { gte: now }, deletedAt: null } }),
      options.database.conversation.count({ where: { workspaceId: context.workspaceId, channel: "WHATSAPP", serviceWindowExpiresAt: { lt: now }, deletedAt: null } }),
      options.database.conversation.count({ where: { workspaceId: context.workspaceId, channel: "WHATSAPP", lastCustomerInboundAt: null, deletedAt: null } }),
    ]);
    const secrets = profile?.connection.secrets ?? [];
    const secretPresence = Object.fromEntries(Object.entries(WHATSAPP_SECRET_REFERENCES).map(([key, reference]) => [key, secrets.some((item) => item.alias === reference.alias && item.present)]));
    const approvedTemplates = templates.filter((template) => template.providerStatus === "APPROVED" && Boolean(template.providerTemplateId)).length;
    const decisionStatus = profile?.policyEligibility ?? "PENDING_POLICY_REVIEW" as const;
    const readiness = [
      { key: "POLICY_ELIGIBILITY", label: "Elegibilidade da Politizai", status: decisionStatus === "INELIGIBLE" ? "FAIL" : "BLOCKED", detail: decisionStatus === "INELIGIBLE" ? "A política oficial vigente veda o escopo documentado da Politizai." : "Decisão formal ainda não registrada." },
      { key: "WABA_TEST_NUMBER", label: "WABA e número de teste", status: profile?.businessAccountId && profile.phoneNumberId ? "NOT_TESTED" : "BLOCKED", detail: profile?.businessAccountId && profile.phoneNumberId ? "IDs configurados sem evidência externa ponta a ponta." : "Nenhum WABA/número externo foi fornecido." },
      { key: "SIGNED_WEBHOOK", label: "Webhook assinado real", status: profile?.lastInboundAt && profile.operatingMode === "EXTERNAL_DISABLED" ? "NOT_TESTED" : "VALIDATED_LOCALLY", detail: "Challenge, HMAC, tenant e replay foram validados somente por fixtures locais." },
      { key: "OPT_IN_OUT", label: "Opt-in e opt-out", status: "VALIDATED_LOCALLY", detail: "Opt-out e supressão são executáveis localmente; opt-in externo não foi homologado." },
      { key: "PROVIDER_TEMPLATES", label: "Templates aprovados", status: approvedTemplates > 0 ? "NOT_TESTED" : "BLOCKED", detail: approvedTemplates > 0 ? "Há estado cadastrado, sem sincronização comprovada com o provider." : "Nenhum template aprovado pelo provider foi comprovado." },
      { key: "RATE_LIMIT_COST", label: "Rate limit e custo", status: "BLOCKED", detail: "Sem conta elegível não existe observação de throughput, Retry-After ou cobrança do provider." },
      { key: "STATUS_RECONCILIATION", label: "Reconciliação de status", status: "VALIDATED_LOCALLY", detail: "Precedência, evento fora de ordem e replay foram validados localmente; falta evidência real." },
      { key: "COEXISTENCE", label: "Coexistência", status: "BLOCKED", detail: "Nenhum modo de coexistência foi contratado ou documentado para esta conta." },
    ] as const;
    return {
      generatedAt: now.toISOString(),
      externalEgress: false as const,
      externalValidation: false as const,
      policyEligibility: decisionStatus,
      activationBlocked: true as const,
      activationBlockReasons: decisionStatus === "INELIGIBLE"
        ? ["A política oficial vigente proíbe a Plataforma do WhatsApp Business para o escopo documentado da Politizai.", "WABA, número, templates, rate limit, custo e coexistência não podem ser homologados enquanto o gate de elegibilidade estiver reprovado."]
        : ["Revisão de elegibilidade da Política de Mensagens do WhatsApp pendente para serviços relacionados a política.", "Credenciais, WABA sandbox, número e templates aprovados não foram fornecidos nem testados."],
      decision: {
        status: decisionStatus,
        scope: profile?.policyDecisionScope ?? null,
        decidedAt: profile?.policyDecidedAt?.toISOString() ?? null,
        decidedBy: profile?.policyDecidedBy?.user?.displayName ?? profile?.policyDecidedBy?.key ?? null,
        sourceUrl: profile?.policySourceUrl ?? null,
        sourceObservedAt: profile?.policySourceObservedAt?.toISOString() ?? null,
        rationale: profile?.policyDecisionRationale ?? null,
        reviewTrigger: profile?.policyReviewTrigger ?? null,
        alternativeChannel: profile?.alternativeChannel ?? null,
        alternativeStatus: profile?.alternativeChannelStatus ?? "NOT_DEFINED",
        alternativeDetail: profile?.alternativeChannelDetail ?? null,
        paritySeal: false as const,
      },
      readiness,
      economics: {
        rateLimit: { status: "EXTERNAL_BLOCKED" as const, valuePerMinute: null, sourceObservedAt: null },
        cost: { status: "EXTERNAL_BLOCKED" as const, currency: null, amountMicros: null, sourceObservedAt: null },
      },
      windowMetrics: { open: openWindows, expired: expiredWindows, withoutInbound },
      killSwitch: {
        engaged: decisionStatus === "INELIGIBLE" || !profile?.connection.enabled || profile?.operatingMode === "PAUSED",
        mode: profile?.operatingMode ?? "EXTERNAL_DISABLED",
        label: profile?.operatingMode === "PAUSED" ? "Pausado" : "Egress externo bloqueado",
      },
      profile: profile ? {
        id: profile.id, connectionId: profile.connectionId, displayName: profile.connection.displayName,
        status: profile.connection.status, capabilityLevel: profile.connection.capabilityLevel, revision: profile.connection.revision,
        operatingMode: profile.operatingMode, graphApiVersion: profile.graphApiVersion, webhookKey: profile.webhookKey,
        phoneNumberConfigured: Boolean(profile.phoneNumberId), businessAccountConfigured: Boolean(profile.businessAccountId),
        displayPhoneMasked: profile.displayPhoneMasked, lastInboundAt: profile.lastInboundAt?.toISOString() ?? null, lastStatusAt: profile.lastStatusAt?.toISOString() ?? null,
        secretReferences: secretPresence,
      } : null,
      metrics: { conversations, inbound, outbound, pendingWebhooks, openReviews },
      templates: templates.map((template) => ({ ...template, providerStatusObservedAt: template.providerStatusObservedAt?.toISOString() ?? null })),
      webhookIssues: webhookIssues.map((item) => ({ ...item, receivedAt: item.receivedAt.toISOString(), nextRetryAt: item.nextRetryAt?.toISOString() ?? null })),
      reviews: reviews.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    };
  }

  async function configureLocal(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const input = whatsAppConfigureLocalSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-config:${context.workspaceId}`}, 0))`;
      const existing = await tx.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: CONNECTION_KEY } } });
      if (existing && input.revision !== undefined && existing.revision !== input.revision) fail("A conexão WhatsApp foi alterada. Atualize a página.", "WHATSAPP_REVISION_CONFLICT");
      const config = whatsAppConfigurationSchema.parse({ graphApiVersion: input.graphApiVersion, businessAccountId: null, businessPortfolioId: null, phoneNumberId: null, displayPhoneMasked: null, timeZone: "America/Sao_Paulo", locale: "pt-BR", operatingMode: "LOCAL_SIMULATOR" });
      const version = existing ? existing.currentConfigVersion + 1 : 1;
      const connection = existing
        ? await tx.integrationConnection.update({ where: { id: existing.id }, data: { displayName: input.displayName, status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true, currentConfigVersion: version, revision: { increment: 1 }, currentErrorClass: null, currentErrorCode: null, currentErrorMessage: null, updatedByActorId: context.actorId } })
        : await tx.integrationConnection.create({ data: { workspaceId: context.workspaceId, key: CONNECTION_KEY, providerKey: WHATSAPP_PROVIDER_KEY, adapterKey: WHATSAPP_ADAPTER_KEY, displayName: input.displayName, environment: "LOCAL", status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, version, schemaVersion: WHATSAPP_CONTRACT_VERSION, config: json(config), configHash: sha256(JSON.stringify(config)), createdByActorId: context.actorId } });
      await tx.integrationConnectionCapability.createMany({ data: ["WEBHOOK_RECEIVE", "SYNC_PUSH", "OBJECT_MAPPING"].map((capability) => ({ workspaceId: context.workspaceId, connectionId: connection.id, capability: capability as "WEBHOOK_RECEIVE" | "SYNC_PUSH" | "OBJECT_MAPPING" })), skipDuplicates: true });
      for (const reference of Object.values(WHATSAPP_SECRET_REFERENCES)) {
        await tx.integrationSecretReference.createMany({ data: [{ workspaceId: context.workspaceId, connectionId: connection.id, alias: reference.alias, referenceKey: reference.referenceKey, present: false, createdByActorId: context.actorId }], skipDuplicates: true });
      }
      const profile = await tx.whatsAppConnectionProfile.upsert({
        where: { workspaceId_connectionId: { workspaceId: context.workspaceId, connectionId: connection.id } },
        create: {
          workspaceId: context.workspaceId, connectionId: connection.id, webhookKey: whatsAppWebhookKey(context.workspaceId), graphApiVersion: input.graphApiVersion,
          operatingMode: "LOCAL_SIMULATOR", policyEligibility: "INELIGIBLE", policyDecisionScope: WHATSAPP_POLITIZAI_POLICY_SCOPE,
          policyDecisionRationale: WHATSAPP_POLITIZAI_INELIGIBILITY_RATIONALE, policySourceUrl: WHATSAPP_POLICY_SOURCE_URL,
          policySourceObservedAt: new Date(WHATSAPP_POLICY_SOURCE_OBSERVED_AT), policyDecidedAt: options.now(), policyDecidedByActorId: context.actorId,
          policyReviewTrigger: WHATSAPP_POLICY_REVIEW_TRIGGER, alternativeChannel: "PHONE", alternativeChannelStatus: "AUTHORIZED",
          alternativeChannelDetail: "Contato humano manual por telefone, com registro da atividade no CRM; sem envio automatizado ou provider externo implícito.",
          createdByActorId: context.actorId, updatedByActorId: context.actorId,
        },
        update: { graphApiVersion: input.graphApiVersion, operatingMode: "LOCAL_SIMULATOR", updatedByActorId: context.actorId },
      });
      const existingDecision = await tx.whatsAppPolicyDecision.findFirst({
        where: { workspaceId: context.workspaceId, profileId: profile.id },
        select: { id: true },
      });
      if (!existingDecision) {
        await tx.whatsAppPolicyDecision.create({ data: {
          workspaceId: context.workspaceId,
          profileId: profile.id,
          eligibility: "INELIGIBLE",
          scope: WHATSAPP_POLITIZAI_POLICY_SCOPE,
          rationale: WHATSAPP_POLITIZAI_INELIGIBILITY_RATIONALE,
          sourceUrl: WHATSAPP_POLICY_SOURCE_URL,
          sourceObservedAt: new Date(WHATSAPP_POLICY_SOURCE_OBSERVED_AT),
          reviewTrigger: WHATSAPP_POLICY_REVIEW_TRIGGER,
          alternativeChannel: "PHONE",
          alternativeChannelStatus: "AUTHORIZED",
          alternativeChannelDetail: "Contato humano manual por telefone, com registro da atividade no CRM; sem envio automatizado ou provider externo implícito.",
          decidedByActorId: context.actorId,
          decidedAt: profile.policyDecidedAt ?? options.now(),
        } });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.whatsapp.local_configured", entityType: "IntegrationConnection", entityId: connection.id, changes: json({ configVersion: version, graphApiVersion: profile.graphApiVersion, operatingMode: profile.operatingMode, policyEligibility: profile.policyEligibility, externalEgress: false, secretsPersisted: false }) } });
      return { connectionId: connection.id, profileId: profile.id, revision: connection.revision, mode: profile.operatingMode, externalEgress: false as const };
    }, { isolationLevel: "Serializable" });
  }

  async function recordPolicyDecision(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const input = whatsAppPolicyDecisionSchema.parse(raw);
    const observedAt = new Date(input.sourceObservedAt);
    if (observedAt > options.now()) fail("A observação da fonte não pode estar no futuro.", "WHATSAPP_POLICY_SOURCE_DATE_INVALID", 422);
    const profile = await currentProfile(options.database, context.workspaceId);
    if (!profile) fail("Configure a fundação local do WhatsApp antes de registrar a decisão.", "WHATSAPP_NOT_CONFIGURED", 404);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-policy:${context.workspaceId}`}, 0))`;
      const lockedProfile = await tx.whatsAppConnectionProfile.findUniqueOrThrow({ where: { id: profile.id } });
      if (lockedProfile.policyEligibility === "INELIGIBLE" && input.decision !== "INELIGIBLE") {
        fail("A decisão formal de inelegibilidade é imutável neste fluxo; reavaliação exige novo processo e evidência externa.", "WHATSAPP_POLICY_DECISION_IMMUTABLE", 409);
      }
      const decidedAt = options.now();
      await tx.whatsAppPolicyDecision.create({ data: {
        workspaceId: context.workspaceId,
        profileId: profile.id,
        eligibility: input.decision,
        scope: input.scope,
        rationale: input.rationale,
        sourceUrl: input.sourceUrl,
        sourceObservedAt: observedAt,
        reviewTrigger: input.reviewTrigger,
        alternativeChannel: input.alternativeChannel,
        alternativeChannelStatus: input.alternativeStatus,
        alternativeChannelDetail: input.alternativeDetail,
        decidedByActorId: context.actorId,
        decidedAt,
      } });
      const updated = await tx.whatsAppConnectionProfile.update({ where: { id: profile.id }, data: {
        policyEligibility: input.decision,
        policyDecisionScope: input.scope,
        policyDecisionRationale: input.rationale,
        policySourceUrl: input.sourceUrl,
        policySourceObservedAt: observedAt,
        policyDecidedAt: decidedAt,
        policyDecidedByActorId: context.actorId,
        policyReviewTrigger: input.reviewTrigger,
        alternativeChannel: input.alternativeChannel,
        alternativeChannelStatus: input.alternativeStatus,
        alternativeChannelDetail: input.alternativeDetail,
        updatedByActorId: context.actorId,
      } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.whatsapp.policy_decided", entityType: "WhatsAppConnectionProfile", entityId: profile.id, origin: "DOMAIN", reason: input.rationale, changes: json({ previousDecision: lockedProfile.policyEligibility, decision: input.decision, scope: input.scope, sourceUrl: input.sourceUrl, sourceObservedAt: input.sourceObservedAt, alternativeChannel: input.alternativeChannel, alternativeStatus: input.alternativeStatus, alternativeDetail: input.alternativeDetail, externalEgress: false }) } });
      return { profileId: updated.id, decision: updated.policyEligibility, decidedAt: updated.policyDecidedAt!.toISOString(), operatingMode: updated.operatingMode, externalEgress: false as const, paritySeal: false as const };
    }, { isolationLevel: "Serializable" });
  }

  async function setPaused(context: AuthenticatedContext, revision: number, paused: boolean) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const profile = await currentProfile(options.database, context.workspaceId);
    if (!profile) fail("Configure o simulador WhatsApp antes de alterar seu estado.", "WHATSAPP_NOT_CONFIGURED", 404);
    if (profile.connection.revision !== revision) fail("A conexão WhatsApp foi alterada. Atualize a página.", "WHATSAPP_REVISION_CONFLICT");
    return options.database.$transaction(async (tx) => {
      const connection = await tx.integrationConnection.update({ where: { id: profile.connectionId }, data: { status: paused ? "PAUSED" : "ACTIVE_LOCAL", enabled: !paused, disabledAt: paused ? options.now() : null, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.whatsAppConnectionProfile.update({ where: { id: profile.id }, data: { operatingMode: paused ? "PAUSED" : "LOCAL_SIMULATOR", updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: paused ? "integration.whatsapp.paused" : "integration.whatsapp.local_resumed", entityType: "IntegrationConnection", entityId: profile.connectionId, changes: json({ enabled: !paused, externalEgress: false }) } });
      return { revision: connection.revision, status: connection.status, externalEgress: false as const };
    });
  }

  async function simulateInbound(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MESSAGES_REPLAY);
    const input = whatsAppLocalInboundSchema.parse(raw);
    const profile = await currentProfile(options.database, context.workspaceId);
    if (!profile || profile.operatingMode !== "LOCAL_SIMULATOR" || !profile.connection.enabled) fail("O simulador WhatsApp local não está ativo.", "WHATSAPP_LOCAL_SIMULATOR_INACTIVE");
    const normalized = normalizeChannelAddress("WHATSAPP", input.address);
    if (!normalized.success) fail("Telefone inválido para o WhatsApp.", "WHATSAPP_ADDRESS_INVALID", 422);
    const occurredAt = new Date(input.occurredAt);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-inbound:${context.workspaceId}:${normalized.hash}`}, 0))`;
      const existing = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId: context.workspaceId, connectionId: profile.connectionId, providerEventId: input.externalEventId } }, include: { message: true } });
      if (existing) return { outcome: "IDEMPOTENT" as const, conversationId: existing.message?.conversationId ?? null, messageId: existing.messageId };
      const foundation = await systemFoundation(tx, context.workspaceId);
      const points = await tx.contactPoint.findMany({ where: { workspaceId: context.workspaceId, normalizedValue: normalized.normalized, type: "PHONE", deletedAt: null }, take: 3, include: { contact: { include: { leads: { where: { deletedAt: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 2 } } } } });
      const exact = points.length === 1 ? points[0] : null;
      const lead = exact?.contact.leads[0] ?? null;
      const ownerMemberId = lead?.ownerMemberId ?? null;
      const queueId = ownerMemberId ? null : lead?.queueId ?? foundation.queue.id;
      let conversation = exact ? await tx.conversation.findFirst({ where: { workspaceId: context.workspaceId, contactPointId: exact.id, channel: "WHATSAPP", status: { notIn: ["CLOSED", "ARCHIVED"] }, deletedAt: null }, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }] }) : null;
      const createdNew = !conversation;
      const latestInboundAt = !conversation?.lastCustomerInboundAt || occurredAt > conversation.lastCustomerInboundAt ? occurredAt : conversation.lastCustomerInboundAt;
      const expiresAt = new Date(latestInboundAt.getTime() + 24 * 60 * 60 * 1_000);
      conversation ??= await tx.conversation.create({ data: { workspaceId: context.workspaceId, contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, accountId: lead?.accountId ?? null, leadId: lead?.id ?? null, connectionId: profile.connectionId, assigneeMemberId: ownerMemberId, queueId, channel: "WHATSAPP", status: "PENDING_INTERNAL", priority: lead?.priority ?? "MEDIUM", externalThreadId: `${WHATSAPP_LOCAL_PROVIDER_KEY}:${normalized.hash}`, firstInboundAt: occurredAt, lastCustomerInboundAt: occurredAt, serviceWindowExpiresAt: expiresAt, waitingSince: occurredAt, openedAt: occurredAt, createdByActorId: foundation.actor.id, updatedByActorId: foundation.actor.id } });
      let participant = await tx.conversationParticipant.findFirst({ where: { workspaceId: context.workspaceId, conversationId: conversation.id, identifierKey: normalized.hash, activeUntil: null } });
      participant ??= await tx.conversationParticipant.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, role: exact ? "CONTACT" : "UNKNOWN_EXTERNAL", contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, identifierKey: normalized.hash, externalAddressMasked: normalized.masked } });
      const message = await tx.message.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, senderActorId: foundation.actor.id, senderParticipantId: participant.id, direction: "INBOUND", type: "TEXT", status: "RECEIVED", body: input.body, bodyHash: sha256(input.body), providerKey: WHATSAPP_LOCAL_PROVIDER_KEY, externalMessageId: input.externalEventId, idempotencyKey: `whatsapp-inbound:${input.externalEventId}`, clientCorrelationId: input.externalEventId, isSimulated: true, simulationLabel: "WhatsApp local simulado; nenhum dado foi enviado à Meta.", occurredAt, receivedAt: now } });
      await tx.messageStatusEvent.create({ data: { workspaceId: context.workspaceId, messageId: message.id, status: "RECEIVED", sequence: 1, source: "LOCAL_SIMULATOR", providerReported: true, providerKey: WHATSAPP_LOCAL_PROVIDER_KEY, externalEventId: input.externalEventId, providerOccurredAt: occurredAt, ingestedAt: now, reasonCode: input.scenario, actorId: foundation.actor.id } });
      const inbox = await tx.webhookInbox.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, providerEventId: input.externalEventId, eventType: "whatsapp.message.received", contractVersion: WHATSAPP_CONTRACT_VERSION, payloadHash: sha256(JSON.stringify({ ...input, address: normalized.hash })), nonceHash: sha256(`whatsapp:${input.externalEventId}`), payloadSizeBytes: Buffer.byteLength(input.body), payload: json({ scenario: input.scenario, addressHash: normalized.hash, externalEgress: false }), dataClass: "CONTACT_DATA", signatureStatus: "VERIFIED", externalOccurredAt: occurredAt, receivedAt: now, status: "PROCESSED", attempts: 1, processedAt: now, correlationId: input.externalEventId, messageId: message.id } });
      await tx.job.create({ data: { workspaceId: context.workspaceId, type: "WEBHOOK", status: "SUCCEEDED", idempotencyKey: `whatsapp-webhook:${input.externalEventId}`, payload: json({ inboxId: inbox.id, messageId: message.id, externalEgress: false }), result: json({ processed: true, mode: "LOCAL_SIMULATOR" }), createdByActorId: foundation.actor.id, updatedByActorId: foundation.actor.id, runAt: now, finishedAt: now, attempts: 1, lastAttemptAt: now } });
      const previousOwnerMemberId = conversation.assigneeMemberId;
      const previousQueueId = conversation.queueId;
      conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { connectionId: profile.connectionId, status: "PENDING_INTERNAL", unreadCount: { increment: 1 }, lastMessageAt: !conversation.lastMessageAt || occurredAt > conversation.lastMessageAt ? occurredAt : conversation.lastMessageAt, lastCustomerInboundAt: latestInboundAt, serviceWindowExpiresAt: expiresAt, waitingSince: !conversation.waitingSince || occurredAt > conversation.waitingSince ? occurredAt : conversation.waitingSince, firstInboundAt: conversation.firstInboundAt && conversation.firstInboundAt < occurredAt ? conversation.firstInboundAt : occurredAt, updatedByActorId: foundation.actor.id, revision: { increment: 1 } } });
      if (createdNew) await tx.conversationAssignmentHistory.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, previousOwnerMemberId: null, previousQueueId: null, newOwnerMemberId: conversation.assigneeMemberId, newQueueId: conversation.queueId, reason: exact ? "WhatsApp vinculado à responsabilidade operacional existente." : "Identidade WhatsApp não resolvida encaminhada à Fila Geral.", actorId: foundation.actor.id, occurredAt: now } });
      if (!lead) await tx.messageIdentityReview.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, messageId: message.id, contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, reason: points.length > 1 ? "MULTIPLE_CONTACT_MATCHES" : exact ? "CONTACT_WITHOUT_LEAD" : "CONTACT_NOT_FOUND", normalizedAddressHash: normalized.hash, channel: "WHATSAPP", evidence: json({ exactMatches: points.length, leadCreated: false, provider: WHATSAPP_LOCAL_PROVIDER_KEY }), createdByActorId: foundation.actor.id } });
      if (lead) {
        await tx.activity.create({ data: { workspaceId: context.workspaceId, leadId: lead.id, messageId: message.id, type: "MESSAGE_RECEIVED", direction: "INBOUND", result: "RECEIVED", subject: "Mensagem recebida no WhatsApp local", description: "Fato canônico simulado, sem egress externo.", occurredAt, createdByActorId: foundation.actor.id, updatedByActorId: foundation.actor.id } });
        await tx.lead.updateMany({ where: { id: lead.id, workspaceId: context.workspaceId, OR: [{ lastInboundResponseAt: null }, { lastInboundResponseAt: { lt: occurredAt } }] }, data: { awaitingHumanResponse: true, lastInboundResponseAt: occurredAt, updatedByActorId: foundation.actor.id } });
        await tx.lead.updateMany({ where: { id: lead.id, workspaceId: context.workspaceId, lastActivityAt: { lt: occurredAt } }, data: { lastActivityAt: occurredAt, updatedByActorId: foundation.actor.id } });
        await cancelIncompatibleAccountPlanActionsForLeadInTransaction(tx, { workspaceId: context.workspaceId, leadId: lead.id, actorId: foundation.actor.id, at: now, event: input.scenario === "OPT_OUT" ? "OPT_OUT" : "RESPONSE" });
        if (input.scenario === "OPT_OUT") {
          await tx.contactPoint.update({ where: { id: exact!.id }, data: { doNotContact: true, updatedByActorId: foundation.actor.id } });
          await tx.lead.updateMany({ where: { workspaceId: context.workspaceId, contactId: exact!.contactId }, data: { contactPreference: "DO_NOT_CONTACT", contactPreferenceUpdatedAt: occurredAt, updatedByActorId: foundation.actor.id } });
          await cancelPendingOutboundForContactInTransaction(tx, { workspaceId: context.workspaceId, contactId: exact!.contactId, contactPointId: exact!.id, actorId: foundation.actor.id, now, reasonCode: "WHATSAPP_INBOUND_OPT_OUT" });
        }
      }
      await tx.whatsAppConnectionProfile.update({ where: { id: profile.id }, data: { lastInboundAt: !profile.lastInboundAt || occurredAt > profile.lastInboundAt ? occurredAt : profile.lastInboundAt, updatedByActorId: foundation.actor.id } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: foundation.actor.id, action: "integration.whatsapp.inbound_local", entityType: "Message", entityId: message.id, origin: "SYSTEM", requestId: input.externalEventId, changes: json({ mode: "LOCAL_SIMULATOR", identity: lead ? "EXACT" : "REVIEW_REQUIRED", optOut: input.scenario === "OPT_OUT", ownerPreserved: previousOwnerMemberId === conversation.assigneeMemberId && previousQueueId === conversation.queueId, externalEgress: false }) } });
      return { outcome: lead ? "ATTACHED" as const : "REVIEW_REQUIRED" as const, conversationId: conversation.id, messageId: message.id, webhookId: inbox.id, serviceWindowExpiresAt: expiresAt.toISOString(), externalEgress: false as const };
    }, { isolationLevel: "Serializable" });
  }

  async function simulateStatus(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MESSAGES_REPLAY);
    const input = whatsAppStatusSimulationSchema.parse(raw);
    const mapped = mapWhatsAppProviderStatus(input.status, input.status === "failed" && !input.transient);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const profile = await tx.whatsAppConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId }, include: { connection: true } });
      if (!profile) fail("WhatsApp não configurado.", "WHATSAPP_NOT_CONFIGURED", 404);
      const message = await tx.message.findFirst({ where: { id: input.messageId, workspaceId: context.workspaceId, conversation: { channel: "WHATSAPP", connectionId: profile.connectionId } } });
      if (!message) fail("Mensagem WhatsApp não encontrada neste workspace.", "WHATSAPP_MESSAGE_NOT_FOUND", 404);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-status:${context.workspaceId}:${message.id}`}, 0))`;
      const currentMessage = await tx.message.findUniqueOrThrow({ where: { id: message.id } });
      const duplicate = await tx.messageStatusEvent.findFirst({ where: { workspaceId: context.workspaceId, providerKey: WHATSAPP_LOCAL_PROVIDER_KEY, externalEventId: input.externalEventId } });
      if (duplicate) return { messageId: message.id, status: duplicate.status, idempotent: true, projected: false };
      if (!mapped.status) {
        await tx.whatsAppEventReview.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, messageId: message.id, kind: "UNKNOWN_EVENT", eventKey: input.externalEventId, reasonCode: mapped.reviewReason ?? "STATUS_UNKNOWN", evidence: json({ providerStatus: input.status, mode: "LOCAL_SIMULATOR" }), createdByActorId: context.actorId } });
        return { messageId: message.id, status: currentMessage.status, idempotent: false, projected: false, reviewRequired: true };
      }
      const occurredAt = new Date(input.occurredAt);
      const projected = shouldProjectMessageStatus(currentMessage.status, mapped.status);
      await tx.messageStatusEvent.create({ data: { workspaceId: context.workspaceId, messageId: message.id, status: mapped.status, sequence: (await tx.messageStatusEvent.count({ where: { workspaceId: context.workspaceId, messageId: message.id } })) + 1, source: "LOCAL_SIMULATOR", providerReported: true, providerKey: WHATSAPP_LOCAL_PROVIDER_KEY, externalEventId: input.externalEventId, providerOccurredAt: occurredAt, ingestedAt: now, reasonCode: input.transient ? "LOCAL_TRANSIENT" : null, actorId: context.actorId } });
      if (projected) await tx.message.update({ where: { id: message.id }, data: { status: mapped.status, lastProviderStatusAt: occurredAt, ...(mapped.status === "SENT" ? { sentAt: occurredAt } : {}), ...(mapped.status === "DELIVERED" ? { deliveredAt: occurredAt } : {}), ...(mapped.status === "READ" ? { readAt: occurredAt } : {}), revision: { increment: 1 } } });
      else if (currentMessage.status !== mapped.status) await tx.whatsAppEventReview.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, messageId: message.id, kind: "STATUS_REGRESSION", eventKey: input.externalEventId, reasonCode: "STATUS_OUT_OF_ORDER", evidence: json({ current: currentMessage.status, received: mapped.status }), createdByActorId: context.actorId } });
      await tx.whatsAppConnectionProfile.updateMany({ where: { id: profile.id, workspaceId: context.workspaceId, OR: [{ lastStatusAt: null }, { lastStatusAt: { lt: occurredAt } }] }, data: { lastStatusAt: occurredAt, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.whatsapp.status_local", entityType: "Message", entityId: message.id, requestId: input.externalEventId, changes: json({ providerStatus: input.status, projected, externalEgress: false }) } });
      return { messageId: message.id, status: mapped.status, idempotent: false, projected };
    }, { isolationLevel: "Serializable" });
  }

  async function verifyWebhookChallenge(webhookKey: string, mode: string | null, suppliedToken: string | null, challenge: string | null) {
    if (mode !== "subscribe" || !suppliedToken || !challenge || !/^[-A-Za-z0-9_.]{1,512}$/.test(challenge)) return null;
    const profile = await options.database.whatsAppConnectionProfile.findUnique({ where: { webhookKey }, include: { connection: { include: { secrets: { where: { alias: WHATSAPP_SECRET_REFERENCES.verifyToken.alias, disabledAt: null }, orderBy: { version: "desc" }, take: 1 } } } } });
    if (!profile || profile.policyEligibility !== "ELIGIBLE" || profile.operatingMode !== "EXTERNAL_DISABLED") return null;
    const reference = profile.connection.secrets[0];
    const expected = reference?.present ? await options.secrets.resolve(reference.referenceKey) : null;
    return expected && verifyWhatsAppChallengeToken(suppliedToken, expected) ? challenge : null;
  }

  async function acceptWebhook(webhookKey: string, rawBody: Buffer, signature: string | null) {
    if (rawBody.byteLength > WHATSAPP_MAX_WEBHOOK_BYTES) fail("Webhook WhatsApp acima do limite.", "WHATSAPP_WEBHOOK_TOO_LARGE", 413);
    const profile = await options.database.whatsAppConnectionProfile.findUnique({ where: { webhookKey }, include: { connection: { include: { secrets: { where: { alias: WHATSAPP_SECRET_REFERENCES.appSecret.alias, disabledAt: null }, orderBy: { version: "desc" }, take: 1 } } } } });
    if (!profile || profile.policyEligibility !== "ELIGIBLE" || profile.operatingMode !== "EXTERNAL_DISABLED" || !profile.phoneNumberId) fail("Endpoint WhatsApp indisponível.", "WHATSAPP_WEBHOOK_UNAVAILABLE", 404);
    const reference = profile.connection.secrets[0];
    const appSecret = reference?.present ? await options.secrets.resolve(reference.referenceKey) : null;
    if (!appSecret || !verifyWhatsAppSignature(rawBody, signature, appSecret)) fail("Assinatura WhatsApp inválida.", "WHATSAPP_SIGNATURE_INVALID", 401);
    let payload: unknown;
    try { payload = JSON.parse(rawBody.toString("utf8")); } catch { fail("Payload WhatsApp inválido.", "WHATSAPP_PAYLOAD_INVALID", 400); }
    const events = normalizeWhatsAppWebhook(payload);
    if (events.some((event) => event.phoneNumberId !== profile.phoneNumberId || (profile.businessAccountId && event.businessAccountId !== profile.businessAccountId))) fail("Evento não pertence a esta conexão.", "WHATSAPP_TENANT_MISMATCH", 403);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const foundation = await systemFoundation(tx, profile.workspaceId);
      let accepted = 0;
      let duplicates = 0;
      for (const event of events) {
        const existing = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId: profile.workspaceId, connectionId: profile.connectionId, providerEventId: event.eventId } } });
        if (existing) { duplicates += 1; continue; }
        const inbox = await tx.webhookInbox.create({ data: { workspaceId: profile.workspaceId, connectionId: profile.connectionId, providerEventId: event.eventId, eventType: event.kind === "MESSAGE" ? "whatsapp.message.received" : "whatsapp.message.status", contractVersion: WHATSAPP_CONTRACT_VERSION, payloadHash: sha256(rawBody), nonceHash: sha256(`${profile.connectionId}:${event.eventId}`), payloadSizeBytes: rawBody.byteLength, payload: json(serializeEvent(event)), dataClass: event.kind === "MESSAGE" ? "CONTACT_DATA" : "OPERATIONAL", signatureStatus: "VERIFIED", externalOccurredAt: event.occurredAt, receivedAt: now, status: "VERIFIED", correlationId: `whatsapp:${event.eventId}` } });
        await tx.job.create({ data: { workspaceId: profile.workspaceId, type: "WEBHOOK", status: "PENDING", idempotencyKey: `whatsapp-process:${event.eventId}`, priority: event.kind === "MESSAGE" ? 90 : 70, runAt: now, payload: json({ inboxId: inbox.id, profileId: profile.id, provider: WHATSAPP_PROVIDER_KEY }), createdByActorId: foundation.actor.id, updatedByActorId: foundation.actor.id } });
        accepted += 1;
      }
      await tx.auditLog.create({ data: { workspaceId: profile.workspaceId, actorId: foundation.actor.id, action: "integration.whatsapp.webhook_accepted", entityType: "IntegrationConnection", entityId: profile.connectionId, origin: "API", changes: json({ accepted, duplicates, signature: "VERIFIED", payloadHash: sha256(rawBody), rawPayloadLogged: false }) } });
      return { accepted, duplicates, correlationId: randomUUID() };
    }, { isolationLevel: "Serializable" });
  }

  async function replayWebhook(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_REPLAY);
    const input = z.object({ inboxId: z.string().uuid(), reason: z.string().trim().min(8).max(500) }).strict().parse(raw);
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const profile = await tx.whatsAppConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "asc" } });
      if (!profile) fail("WhatsApp não configurado.", "WHATSAPP_NOT_CONFIGURED", 404);
      const inbox = await tx.webhookInbox.findFirst({ where: { id: input.inboxId, workspaceId: context.workspaceId, connectionId: profile.connectionId } });
      if (!inbox) fail("Evento WhatsApp não encontrado neste workspace.", "WHATSAPP_WEBHOOK_NOT_FOUND", 404);
      const job = await tx.job.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: `whatsapp-process:${inbox.providerEventId}` } } });
      if (!job) fail("Job do evento WhatsApp não encontrado.", "WHATSAPP_JOB_NOT_FOUND", 404);
      if (job.status === "SUCCEEDED" || inbox.status === "PROCESSED") return { inboxId: inbox.id, jobId: job.id, idempotent: true, status: "PROCESSED" as const };
      if (!(["DEAD_LETTER", "RETRY_PENDING"] as const).includes(inbox.status as "DEAD_LETTER" | "RETRY_PENDING")) fail("Somente evento em retry ou dead-letter pode ser reprocessado.", "WHATSAPP_REPLAY_NOT_ALLOWED");
      await tx.webhookInbox.update({ where: { id: inbox.id }, data: { status: "VERIFIED", nextRetryAt: null, errorClass: null, errorCode: null, errorMessage: null, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      await tx.job.update({ where: { id: job.id }, data: { status: "PENDING", maxAttempts: job.attempts + job.maxAttempts, runAt: now, result: Prisma.JsonNull, lastError: null, errorCode: null, finishedAt: null, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.whatsapp.webhook_replay_requested", entityType: "WebhookInbox", entityId: inbox.id, origin: "DOMAIN", reason: input.reason, changes: json({ previousStatus: inbox.status, attemptsBeforeReplay: inbox.attempts, externalEgress: false }) } });
      return { inboxId: inbox.id, jobId: job.id, idempotent: false, status: "PENDING" as const };
    }, { isolationLevel: "Serializable" });
  }

  async function inspectServiceWindow(context: AuthenticatedContext, conversationId: string) {
    await authorization.assertAuthorized(context, PermissionKeys.INBOX_READ, { workspaceId: context.workspaceId, resourceType: "Conversation", resourceId: conversationId, ownerMemberId: context.memberId });
    const conversation = await options.database.conversation.findFirst({ where: { id: conversationId, workspaceId: context.workspaceId, channel: "WHATSAPP" }, select: { lastCustomerInboundAt: true } });
    if (!conversation) fail("Conversa WhatsApp não encontrada.", "WHATSAPP_CONVERSATION_NOT_FOUND", 404);
    const window = evaluateWhatsAppServiceWindow(conversation.lastCustomerInboundAt, options.now());
    return { open: window.open, expiresAt: window.expiresAt?.toISOString() ?? null, remainingSeconds: window.remainingSeconds };
  }

  return Object.freeze({ screen, configureLocal, recordPolicyDecision, setPaused, simulateInbound, simulateStatus, verifyWebhookChallenge, acceptWebhook, replayWebhook, inspectServiceWindow });
}

let service: ReturnType<typeof createWhatsAppService> | undefined;
export function getWhatsAppService() {
  service ??= createWhatsAppService({ database: getDatabaseClient(), secrets: environmentSecretResolver, now: () => new Date() });
  return service;
}
