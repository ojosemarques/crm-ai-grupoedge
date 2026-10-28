import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { calculateRetryDelaySeconds } from "@/modules/integrations/domain/integration-policy";
import { metaAdsConfigurationSchema, META_ADS_ACCESS_TOKEN_REFERENCE } from "@/modules/integrations/domain/meta-ads-contracts";
import { META_CONVERSION_EVENT_TYPE, META_CONVERSION_PURPOSE_CODE, reconciliationQuerySchema } from "@/modules/conversion-feedback/domain/conversion-feedback-contracts";
import { buildMinimizedMetaConversion, metaConversionDeduplicationKey } from "@/modules/conversion-feedback/domain/meta-conversion-policy";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Fetcher = typeof fetch;
type Options = Readonly<{ database: PrismaClient; secrets: SecretResolver; fetcher: Fetcher; now: () => Date }>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: "MarketingConversionFeedback", resourceId: context.workspaceId };
}

async function privacyEvidence(tx: Tx, input: { workspaceId: string; actorId: string; contactId: string; now: Date }) {
  const purpose = await tx.processingPurpose.findFirst({
    where: { workspaceId: input.workspaceId, code: META_CONVERSION_PURPOSE_CODE, active: true },
    select: { id: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, status: true, validFrom: true, validTo: true, allowedChannels: true, legalBasis: { select: { status: true, validFrom: true, validTo: true } } } } },
  });
  const version = purpose?.versions[0] ?? null;
  const consent = purpose ? await tx.consentState.findFirst({
    where: { workspaceId: input.workspaceId, contactId: input.contactId, purposeId: purpose.id, channel: "OTHER", effectiveFrom: { lte: input.now } },
    orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }],
  }) : null;
  const purposeWindowActive = Boolean(version && (!version.validFrom || version.validFrom <= input.now) && (!version.validTo || version.validTo > input.now));
  const basisWindowActive = Boolean(version?.legalBasis && (!version.legalBasis.validFrom || version.legalBasis.validFrom <= input.now) && (!version.legalBasis.validTo || version.legalBasis.validTo > input.now));
  const channelAllowed = version?.allowedChannels.includes("OTHER") === true;
  const allowed = version?.status === "ACTIVE" && version.legalBasis?.status === "ACTIVE" && purposeWindowActive && basisWindowActive && channelAllowed && consent?.state === "GRANTED";
  const reasons = allowed ? ["ACTIVE_PURPOSE", "ACTIVE_LEGAL_BASIS", "EXPLICIT_CONSENT_GRANTED"] : [
    ...(!purpose ? ["PURPOSE_MISSING"] : []),
    ...(version?.status !== "ACTIVE" ? ["PURPOSE_NOT_ACTIVE"] : []),
    ...(version?.legalBasis?.status !== "ACTIVE" ? ["LEGAL_BASIS_NOT_ACTIVE"] : []),
    ...(!purposeWindowActive ? ["PURPOSE_OUTSIDE_VALIDITY_WINDOW"] : []),
    ...(!basisWindowActive ? ["LEGAL_BASIS_OUTSIDE_VALIDITY_WINDOW"] : []),
    ...(!channelAllowed ? ["CHANNEL_NOT_ALLOWED"] : []),
    ...(consent?.state !== "GRANTED" ? ["CONSENT_NOT_GRANTED"] : []),
  ];
  await tx.privacyDecision.create({ data: {
    workspaceId: input.workspaceId, contactId: input.contactId, purposeVersionId: version?.id ?? null,
    channel: "OTHER", intendedAction: "META_CONVERSION_SIGNAL", outcome: allowed ? "ALLOW" : "DENY",
    mode: "ENFORCED", legalBasisStatus: version?.legalBasis?.status ?? null, consentState: consent?.state ?? "UNKNOWN",
    reasonCodes: reasons, missingEvidence: allowed ? [] : reasons, ruleVersion: "stage14-meta-conversion-v1", actorId: input.actorId,
  } });
  return { allowed, purposeVersionId: version?.id ?? null, consentState: consent?.state ?? "UNKNOWN", reasons };
}

async function metaConnection(tx: Tx, workspaceId: string) {
  const connection = await tx.integrationConnection.findUnique({
    where: { workspaceId_key: { workspaceId, key: "meta-ads" } },
    include: {
      configVersions: true,
      secrets: { where: { disabledAt: null } },
      capabilities: { where: { capability: "SYNC_PUSH", enabled: true } },
    },
  });
  if (!connection || !connection.enabled || connection.status !== "CONNECTED" || connection.capabilityLevel !== "CONNECTED" || connection.capabilities.length === 0) {
    fail("Conexão Meta precisa estar validada, ativa e com credencial vigente.", "META_CONVERSION_CONNECTION_NOT_READY");
  }
  return connection;
}

function classifyMetaFailure(response: Response, body: unknown) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const code = typeof error.code === "number" ? error.code : null;
  const transient = response.status === 429 || response.status >= 500 || error.is_transient === true || code === 2 || code === 4 || code === 17 || code === 32;
  return {
    terminal: !transient,
    classification: response.status === 429 ? "RATE_LIMIT" as const : transient ? "TRANSIENT" as const : response.status === 401 ? "AUTHENTICATION" as const : "PERMANENT" as const,
    code: `META_CAPI_${code ?? response.status}`,
    message: transient ? "Falha transitória ao entregar sinal de conversão à Meta." : "A Meta rejeitou o sinal de conversão.",
  };
}

export function createConversionFeedbackService(options: Options) {
  const authorization = getAuthorizationService();
  const authorize = (context: AuthenticatedContext, permission: (typeof PermissionKeys)[keyof typeof PermissionKeys]) => authorization.assertAuthorized(context, permission, resource(context));

  async function validateMetaWriteCapability(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    await authorize(context, PermissionKeys.INTEGRATIONS_SECRETS_MANAGE);
    const connection = await options.database.integrationConnection.findUnique({
      where: { workspaceId_key: { workspaceId: context.workspaceId, key: "meta-ads" } },
      include: { configVersions: true },
    });
    if (!connection || !connection.enabled || connection.status !== "CONNECTED" || connection.capabilityLevel !== "CONNECTED") {
      fail("Conexão Meta de leitura precisa estar homologada antes da escrita.", "META_CONVERSION_CONNECTION_NOT_READY");
    }
    const activeConfig = connection.configVersions.find((version) => version.version === connection.currentConfigVersion);
    if (!activeConfig) fail("Configuração Meta vigente não encontrada.", "META_CONVERSION_CONFIG_NOT_FOUND");
    const config = metaAdsConfigurationSchema.parse(activeConfig.config);
    const token = await options.secrets.resolve(META_ADS_ACCESS_TOKEN_REFERENCE);
    const datasetId = await options.secrets.resolve("META_ADS_DATASET_ID");
    if (!token || !datasetId || !/^[0-9]{3,40}$/.test(datasetId)) fail("Token ou dataset Meta ausente.", "META_CONVERSION_CREDENTIALS_PENDING", 422);
    let response: Response;
    try {
      response = await options.fetcher(`https://graph.facebook.com/${config.graphApiVersion}/${datasetId}?fields=id`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch {
      fail("Não foi possível validar o dataset Meta.", "META_CONVERSION_VALIDATION_NETWORK", 503);
    }
    const body = await response.json().catch(() => ({})) as { id?: unknown };
    if (!response.ok || body.id !== datasetId) fail("Dataset Meta não foi validado para esta credencial.", "META_CONVERSION_DATASET_NOT_VALIDATED", 422);
    await options.database.$transaction(async (tx) => {
      await tx.integrationConnectionCapability.upsert({
        where: { workspaceId_connectionId_capability: { workspaceId: context.workspaceId, connectionId: connection.id, capability: "SYNC_PUSH" } },
        create: { workspaceId: context.workspaceId, connectionId: connection.id, capability: "SYNC_PUSH", enabled: true },
        update: { enabled: true },
      });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.meta_conversion.dataset_access_validated", entityType: "IntegrationConnection", entityId: connection.id, changes: { provider: "META", datasetIdHash: createHash("sha256").update(datasetId).digest("hex"), apiVersion: config.graphApiVersion, writeConfigured: true, writeExternallyValidated: false, externalEgress: true } } });
    });
    return { provider: "META", connectionId: connection.id, capability: "SYNC_PUSH", datasetAccessValidated: true, writeConfigured: true, writeExternallyValidated: false, externalEgress: true };
  }

  async function getReconciliation(context: AuthenticatedContext, raw: unknown = {}) {
    await authorize(context, PermissionKeys.MARKETING_MEDIA_READ);
    const query = reconciliationQuerySchema.parse(raw);
    const end = query.periodEnd ?? options.now();
    const start = query.periodStart ?? new Date(end.getTime() - 30 * 86_400_000);
    if (end <= start) fail("Período inválido.", "CONVERSION_RECONCILIATION_PERIOD_INVALID", 422);
    const [facts, touches, conversions, metaConnectionRow, googleConnection, feedback] = await Promise.all([
      options.database.marketingPerformanceFact.findMany({ where: { workspaceId: context.workspaceId, status: "CONFIRMED", periodStart: { gte: start, lt: end } }, orderBy: [{ grainKey: "asc" }, { revision: "desc" }] }),
      options.database.marketingTouchpoint.findMany({ where: { workspaceId: context.workspaceId, occurredAt: { gte: start, lt: end } }, select: { id: true, sourceId: true, campaignId: true, utmSource: true, utmMedium: true, utmCampaign: true, evidenceClass: true, privacyDecision: true, attributionEligible: true, evidence: true, occurredAt: true } }),
      options.database.attributionConversion.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", occurredAt: { gte: start, lt: end } }, select: { id: true, kind: true, valueCents: true, sourceEventType: true, sourceEventId: true, evidenceClass: true, evidence: true, occurredAt: true } }),
      options.database.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: "meta-ads" } }, select: { status: true, enabled: true, capabilityLevel: true } }),
      options.database.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: "google-ads" } }, select: { status: true, enabled: true, capabilityLevel: true } }),
      options.database.outboxEvent.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, eventType: META_CONVERSION_EVENT_TYPE, createdAt: { gte: start, lt: end } }, _count: { _all: true } }),
    ]);
    const latest = new Map<string, typeof facts[number]>();
    for (const fact of facts) if (!latest.has(fact.grainKey)) latest.set(fact.grainKey, fact);
    const currentFacts = [...latest.values()];
    const spendCents = currentFacts.reduce((sum, fact) => sum + fact.spendCents, 0n);
    const latestAttributionRun = await options.database.attributionRun.findFirst({ where: { workspaceId: context.workspaceId, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }], select: { id: true, modelVersionId: true } });
    const [credits, campaignBridges] = await Promise.all([
      latestAttributionRun ? options.database.attributionCredit.findMany({ where: { workspaceId: context.workspaceId, attributionRunId: latestAttributionRun.id, conversionId: { in: conversions.map((item) => item.id) } }, select: { conversionId: true, touchpointId: true, creditBps: true, coverageState: true, evidence: true } }) : Promise.resolve([]),
      options.database.marketingCampaign.findMany({ where: { workspaceId: context.workspaceId, id: { in: currentFacts.flatMap((fact) => fact.campaignId ? [fact.campaignId] : []) } }, select: { id: true, key: true, name: true, legacyAcquisitionCampaignId: true } }),
    ]);
    const touchById = new Map(touches.map((touch) => [touch.id, touch]));
    const creditByLegacyCampaign = new Map<string, { conversions: Set<string>; creditBps: number; evidence: unknown[] }>();
    for (const credit of credits) {
      const campaignId = credit.touchpointId ? touchById.get(credit.touchpointId)?.campaignId : null;
      if (!campaignId) continue;
      const rollup = creditByLegacyCampaign.get(campaignId) ?? { conversions: new Set<string>(), creditBps: 0, evidence: [] };
      rollup.conversions.add(credit.conversionId); rollup.creditBps += credit.creditBps; rollup.evidence.push(credit.evidence);
      creditByLegacyCampaign.set(campaignId, rollup);
    }
    const reconciliation = campaignBridges.map((campaign) => {
      const campaignFacts = currentFacts.filter((fact) => fact.campaignId === campaign.id);
      const attributed = campaign.legacyAcquisitionCampaignId ? creditByLegacyCampaign.get(campaign.legacyAcquisitionCampaignId) : undefined;
      const campaignTouches = campaign.legacyAcquisitionCampaignId ? touches.filter((touch) => touch.campaignId === campaign.legacyAcquisitionCampaignId) : [];
      return {
        campaign: { id: campaign.id, key: campaign.key, name: campaign.name, legacyAcquisitionCampaignId: campaign.legacyAcquisitionCampaignId },
        utm: [...new Set(campaignTouches.map((touch) => [touch.utmSource, touch.utmMedium, touch.utmCampaign].filter(Boolean).join(" / ")).filter(Boolean))],
        costCents: campaignFacts.reduce((sum, fact) => sum + fact.spendCents, 0n).toString(),
        attributedConversions: attributed?.conversions.size ?? 0,
        totalCreditBps: attributed?.creditBps ?? 0,
        provenance: { performanceFactIds: campaignFacts.map((fact) => fact.id), touchpointIds: campaignTouches.map((touch) => touch.id), attributionRunId: latestAttributionRun?.id ?? null, attributionModelVersionId: latestAttributionRun?.modelVersionId ?? null },
      };
    });
    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      summary: { touchpoints: touches.length, conversions: conversions.length, spendCents: spendCents.toString(), metaFeedback: Object.fromEntries(feedback.map((row) => [row.status, row._count._all])) },
      attribution: touches,
      conversionFacts: conversions.map((item) => ({ ...item, valueCents: item.valueCents?.toString() ?? null })),
      costFacts: currentFacts.map((item) => ({ id: item.id, provider: item.sourceProvider, apiVersion: item.providerApiVersion, externalId: item.providerExternalId, campaignId: item.campaignId, spendCents: item.spendCents.toString(), periodStart: item.periodStart.toISOString(), periodEnd: item.periodEnd.toISOString(), collectedAt: item.collectedAt?.toISOString() ?? null, evidence: item.sourceEvidence })),
      reconciliation,
      providerGates: {
        meta: { importRead: metaConnectionRow?.enabled === true && metaConnectionRow.status === "CONNECTED", conversionWrite: "REQUIRES_ACTIVE_CONNECTION_DATASET_CREDENTIAL_AND_CONSENT" },
        google: { importRead: googleConnection?.enabled === true && googleConnection.status === "CONNECTED", conversionWrite: "BLOCKED_NOT_VALIDATED_IN_TRIAL_OR_API" },
      },
      facts: ["UTM e jornada vêm de touchpoints imutáveis", "Custo vem da revisão vigente de fatos importados", "Conversão vem de eventos canônicos deduplicados"],
      inferences: [] as string[],
      missingInformation: [currentFacts.length === 0 ? "custo importado no período" : null, conversions.length === 0 ? "conversões canônicas no período" : null].filter(Boolean),
    };
  }

  async function queueMetaConversion(context: AuthenticatedContext, raw: { conversionId: string; eventName: "Lead" | "CompleteRegistration" | "Schedule" | "Purchase"; idempotencyKey: string }) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
    await authorize(context, PermissionKeys.MARKETING_MEDIA_RECONCILE);
    return options.database.$transaction(async (tx) => {
      const semanticKey = metaConversionDeduplicationKey({ workspaceId: context.workspaceId, conversionId: raw.conversionId, eventName: raw.eventName });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${semanticKey}, 0))`;
      const replay = await tx.outboxEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: semanticKey } } });
      if (replay) {
        const replayPayload = replay.payload && typeof replay.payload === "object" && !Array.isArray(replay.payload) ? replay.payload as Record<string, unknown> : {};
        if (replay.eventType !== META_CONVERSION_EVENT_TYPE || replay.aggregateId !== raw.conversionId || replayPayload.eventName !== raw.eventName) {
          fail("A chave idempotente já foi usada para outro sinal de conversão.", "META_CONVERSION_IDEMPOTENCY_CONFLICT");
        }
        return { id: replay.id, status: replay.status, idempotentReplay: true };
      }
      const conversion = await tx.attributionConversion.findFirst({ where: { id: raw.conversionId, workspaceId: context.workspaceId, status: "ACTIVE" } });
      if (!conversion?.leadId || !conversion.contactId) fail("Conversão precisa estar vinculada a lead e contato canônicos.", "META_CONVERSION_IDENTITY_MISSING", 422);
      const canonicalEvents: Record<string, readonly string[]> = { LEAD_RECEIVED: ["Lead"], QUALIFIED: ["CompleteRegistration"], MEETING_HELD: ["Schedule"], OPPORTUNITY_CREATED: ["Lead"], WON: ["Purchase"] };
      if (!canonicalEvents[conversion.kind]?.includes(raw.eventName)) fail("O evento Meta não corresponde ao tipo da conversão canônica.", "META_CONVERSION_EVENT_MISMATCH", 422);
      const connection = await metaConnection(tx, context.workspaceId);
      const privacy = await privacyEvidence(tx, { workspaceId: context.workspaceId, actorId: context.actorId, contactId: conversion.contactId, now: options.now() });
      if (!privacy.allowed) return { blockedReason: "META_CONVERSION_CONSENT_REQUIRED" as const };
      const points = await tx.contactPoint.findMany({ where: { workspaceId: context.workspaceId, contactId: conversion.contactId, deletedAt: null, doNotContact: false, type: { in: ["EMAIL", "PHONE"] } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
      const emails = points.filter((point) => point.type === "EMAIL").map((point) => point.normalizedValue);
      const phones = points.filter((point) => point.type === "PHONE").map((point) => point.normalizedValue);
      if (emails.length + phones.length === 0) fail("Nenhuma identidade mínima elegível para hash foi encontrada.", "META_CONVERSION_MATCH_KEY_MISSING", 422);
      const payload = buildMinimizedMetaConversion({ workspaceId: context.workspaceId, conversionId: conversion.id, contactId: conversion.contactId, eventName: raw.eventName, occurredAt: conversion.occurredAt, valueCents: conversion.valueCents, emails, phones, purposeVersionId: privacy.purposeVersionId!, consentState: "GRANTED", evaluatedAt: options.now() });
      const outbox = await createOutboxEventInTransaction(tx, {
        workspaceId: context.workspaceId, connectionId: connection.id, actorId: context.actorId,
        eventType: META_CONVERSION_EVENT_TYPE, aggregateType: "AttributionConversion", aggregateId: conversion.id,
        correlationId: randomUUID(), causationId: conversion.sourceEventId, idempotencyKey: semanticKey,
        payload,
      });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.meta_conversion.queued", entityType: "OutboxEvent", entityId: outbox.id, requestId: raw.idempotencyKey, changes: { conversionId: conversion.id, eventName: raw.eventName, eventId: payload.eventId, identities: { emailHashes: payload.userData.em.length, phoneHashes: payload.userData.ph.length }, rawIdentityPersisted: false } } });
      return { id: outbox.id, status: outbox.status, eventId: payload.eventId, idempotentReplay: false };
    }, { isolationLevel: "Serializable" }).then((result) => {
      if ("blockedReason" in result) fail("Sinal Meta bloqueado: finalidade, base legal e consentimento explícito são obrigatórios.", result.blockedReason, 409);
      return result;
    });
  }

  async function cancelPending(context: AuthenticatedContext, conversionId: string, reason: string) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
    return options.database.$transaction(async (tx) => {
      const changed = await tx.outboxEvent.updateMany({ where: { workspaceId: context.workspaceId, eventType: META_CONVERSION_EVENT_TYPE, aggregateType: "AttributionConversion", aggregateId: conversionId, status: { in: ["PENDING", "RETRY_PENDING"] } }, data: { status: "CANCELLED", nextRetryAt: null, errorClass: "PRIVACY_BLOCKED", errorCode: "META_CONVERSION_CANCELLED", errorMessage: "Sinal cancelado antes do egress." } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.meta_conversion.cancelled", entityType: "AttributionConversion", entityId: conversionId, reason, changes: { cancelledOutboxEvents: changed.count, externalEgress: false } } });
      return { conversionId, cancelled: changed.count };
    });
  }

  async function processNext(workerId: string) {
    const item = await options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "outbox_events" WHERE "eventType" = ${META_CONVERSION_EVENT_TYPE} AND ((("status" IN ('PENDING','RETRY_PENDING')) AND "availableAt" <= ${now} AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= ${now})) OR ("status" = 'PROCESSING' AND "lockExpiresAt" < ${now})) ORDER BY "availableAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return null;
      return tx.outboxEvent.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", attempts: { increment: 1 }, lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + 90_000) } });
    });
    if (!item) return { status: "IDLE" as const };
    const failItem = async (failure: { terminal: boolean; classification: "RATE_LIMIT" | "TRANSIENT" | "AUTHENTICATION" | "PERMANENT" | "CONFIGURATION" | "PRIVACY_BLOCKED"; code: string; message: string; retryAfterSeconds?: number }) => {
      const terminal = failure.terminal || item.attempts >= item.maxAttempts;
      const delay = calculateRetryDelaySeconds(item.attempts, 5, failure.retryAfterSeconds);
      await options.database.$transaction(async (tx) => {
        await tx.outboxEvent.updateMany({ where: { id: item.id, status: "PROCESSING", lockedBy: workerId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", nextRetryAt: terminal ? null : new Date(options.now().getTime() + delay * 1_000), errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.message, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: item.workspaceId, kind: "OUTBOX", outboxId: item.id, attemptNumber: item.attempts, status: terminal ? "DEAD_LETTERED" : "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.message, retryAfterSeconds: terminal ? null : delay, startedAt: item.lockedAt ?? options.now(), finishedAt: options.now() } });
      });
      return { status: terminal ? "DEAD_LETTER" as const : "RETRY_PENDING" as const };
    };
    const conversion = await options.database.attributionConversion.findFirst({ where: { id: item.aggregateId, workspaceId: item.workspaceId, status: "ACTIVE" } });
    if (!conversion?.contactId) return failItem({ terminal: true, classification: "CONFIGURATION", code: "META_CONVERSION_NOT_ACTIVE", message: "Conversão canônica indisponível para entrega." });
    const actor = await options.database.actor.findFirst({ where: { workspaceId: item.workspaceId, type: "SYSTEM" }, select: { id: true } });
    if (!actor) return failItem({ terminal: true, classification: "CONFIGURATION", code: "SYSTEM_ACTOR_MISSING", message: "Ator de sistema ausente." });
    const allowed = await options.database.$transaction((tx) => privacyEvidence(tx, { workspaceId: item.workspaceId, actorId: actor.id, contactId: conversion.contactId!, now: options.now() }));
    if (!allowed.allowed) return failItem({ terminal: true, classification: "PRIVACY_BLOCKED", code: "META_CONVERSION_CONSENT_REVOKED", message: "Entrega bloqueada pela decisão atual de privacidade." });
    const connection = await options.database.integrationConnection.findFirst({ where: { id: item.connectionId ?? "", workspaceId: item.workspaceId, enabled: true, status: "CONNECTED", capabilityLevel: "CONNECTED", capabilities: { some: { capability: "SYNC_PUSH", enabled: true } } }, include: { configVersions: true } });
    const activeConfig = connection?.configVersions.find((version) => version.version === connection.currentConfigVersion);
    if (!connection || !activeConfig) return failItem({ terminal: true, classification: "CONFIGURATION", code: "META_CONVERSION_CONNECTION_REVOKED", message: "Conexão Meta inativa, revogada ou sem capacidade de escrita." });
    const token = await options.secrets.resolve(META_ADS_ACCESS_TOKEN_REFERENCE);
    const datasetId = await options.secrets.resolve("META_ADS_DATASET_ID");
    if (!token || !datasetId || !/^[0-9]{3,40}$/.test(datasetId)) return failItem({ terminal: true, classification: "CONFIGURATION", code: "META_CONVERSION_CREDENTIALS_PENDING", message: "Token ou dataset Meta ausente." });
    const config = metaAdsConfigurationSchema.parse(activeConfig.config);
    const payload = item.payload as Record<string, unknown>;
    const custom = payload.customData as Record<string, unknown>;
    const valueMinor = typeof custom?.valueMinor === "string" ? custom.valueMinor : null;
    const event = { event_name: payload.eventName, event_time: payload.eventTime, event_id: payload.eventId, action_source: payload.actionSource, user_data: payload.userData, custom_data: { currency: "BRL", ...(valueMinor ? { value: Number(valueMinor) / 100 } : {}) } };
    let response: Response;
    let body: unknown;
    try {
      response = await options.fetcher(`https://graph.facebook.com/${config.graphApiVersion}/${datasetId}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [event], access_token: token }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
      body = await response.json().catch(() => ({}));
    } catch {
      return failItem({ terminal: false, classification: "TRANSIENT", code: "META_CAPI_NETWORK", message: "Falha transitória de rede ao entregar sinal Meta." });
    }
    if (!response.ok) {
      const failure = classifyMetaFailure(response, body);
      const retryAfter = Number(response.headers.get("retry-after"));
      return failItem({ ...failure, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.min(retryAfter, 86_400) } : {}) });
    }
    const eventsReceived = (body as { events_received?: unknown }).events_received;
    if (typeof eventsReceived !== "number" || eventsReceived < 1) return failItem({ terminal: false, classification: "TRANSIENT", code: "META_CAPI_EMPTY_RECEIPT", message: "A Meta não confirmou o recebimento do evento." });
    await options.database.$transaction(async (tx) => {
      await tx.outboxEvent.updateMany({ where: { id: item.id, status: "PROCESSING", lockedBy: workerId }, data: { status: "DELIVERED_EXTERNAL", deliveredExternallyAt: options.now(), deliveredLocallyAt: null, lockedAt: null, lockedBy: null, lockExpiresAt: null, nextRetryAt: null, errorClass: null, errorCode: null, errorMessage: null } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: item.workspaceId, kind: "OUTBOX", outboxId: item.id, attemptNumber: item.attempts, status: "SUCCEEDED", startedAt: item.lockedAt ?? options.now(), finishedAt: options.now(), resultMetadata: json({ provider: "META", eventsReceived, traceIdPresent: Boolean((body as { fbtrace_id?: string }).fbtrace_id) }) } });
    });
    return { status: "DELIVERED_EXTERNAL" as const, id: item.id };
  }

  async function googleWriteGate(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_READ);
    return { provider: "GOOGLE_ADS", importRead: "IMPLEMENTED_AND_GATED_BY_CONNECTION", conversionWrite: "BLOCKED_NOT_VALIDATED_IN_TRIAL_OR_API", canQueue: false, missingEvidence: ["Conta de avaliação ou credencial Google Ads com permissão de upload", "Teste real da ação de conversão e deduplicação pelo order_id"], externalEgress: false };
  }

  return Object.freeze({ getReconciliation, validateMetaWriteCapability, queueMetaConversion, cancelPending, processNext, googleWriteGate });
}

let singleton: ReturnType<typeof createConversionFeedbackService> | null = null;
export function getConversionFeedbackService() {
  singleton ??= createConversionFeedbackService({ database: getDatabaseClient(), secrets: environmentSecretResolver, fetcher: fetch, now: () => new Date() });
  return singleton;
}
