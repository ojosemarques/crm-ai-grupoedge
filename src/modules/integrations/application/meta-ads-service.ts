import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { MetaAdsReadAdapter, metaAdsReadAdapter, type MetaAdsCredentials, type MetaAdsSyncPayload } from "@/modules/integrations/application/meta-ads-read-adapter";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import {
  META_ADS_ACCESS_TOKEN_ALIAS,
  META_ADS_ACCESS_TOKEN_REFERENCE,
  META_ADS_ADAPTER_KEY,
  META_ADS_APP_SECRET_ALIAS,
  META_ADS_APP_SECRET_REFERENCE,
  META_ADS_PROVIDER_KEY,
  classifyMetaAction,
  decimalStringToMinorUnits,
  integerMetric,
  metaActionMoneyValue,
  metaActionValue,
  metaVideoComparable,
  metaAdsConfigurationSchema,
  metaAdsConfigureSchema,
  normalizeMetaMediaStatus,
  type MetaAdsConfiguration,
  type MetaAdsFailure,
  type MetaAdsInsight,
} from "@/modules/integrations/domain/meta-ads-contracts";
import { canonicalJson, redactSensitive, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; adapter: MetaAdsReadAdapter; secrets: SecretResolver; now: () => Date }>;
const CONNECTION_KEY = "meta-ads";
const OBJECT_TYPE = "meta_ads_daily_insights";
const json = (value: unknown) => JSON.parse(JSON.stringify(redactSensitive(value))) as Prisma.InputJsonValue;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId };
}

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function startInstant(date: string): Date { return new Date(`${date}T00:00:00-03:00`); }
function endInstant(date: string): Date { return new Date(`${date}T23:59:59.999-03:00`); }

function connectionState(connection: {
  id: string; displayName: string; status: string; capabilityLevel: string; revision: number; enabled: boolean;
  lastTestedAt: Date | null; lastSucceededAt: Date | null; lastErroredAt: Date | null;
  currentErrorClass: string | null; currentErrorCode: string | null; currentErrorMessage: string | null;
  secrets: readonly { alias: string; present: boolean; version: number }[];
}) {
  return {
    id: connection.id, displayName: connection.displayName, status: connection.status,
    capabilityLevel: connection.capabilityLevel, revision: connection.revision, enabled: connection.enabled,
    lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
    lastSucceededAt: connection.lastSucceededAt?.toISOString() ?? null,
    lastErroredAt: connection.lastErroredAt?.toISOString() ?? null,
    error: connection.currentErrorCode ? { classification: connection.currentErrorClass, code: connection.currentErrorCode, message: connection.currentErrorMessage } : null,
    credentials: {
      accessTokenReferencePresent: connection.secrets.some((item) => item.alias === META_ADS_ACCESS_TOKEN_ALIAS && item.present),
      appSecretReferencePresent: connection.secrets.some((item) => item.alias === META_ADS_APP_SECRET_ALIAS && item.present),
    },
  };
}

function errorStatus(failure: MetaAdsFailure): "AWAITING_CREDENTIAL" | "NEEDS_ATTENTION" | "DEGRADED" | "CONFIG_ERROR" {
  if (failure.code === "META_CREDENTIALS_PENDING") return "AWAITING_CREDENTIAL";
  if (["AUTHENTICATION", "PERMISSION", "ACCOUNT_INACCESSIBLE"].includes(failure.classification)) return "NEEDS_ATTENTION";
  if (["CONFIGURATION", "INVALID_PAYLOAD"].includes(failure.classification)) return "CONFIG_ERROR";
  return "DEGRADED";
}

async function audit(tx: Tx, context: AuthenticatedContext, input: Readonly<{ action: string; entityId: string; requestId?: string; changes?: unknown }>) {
  await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.action, entityType: "IntegrationConnection", entityId: input.entityId, requestId: input.requestId ?? null, changes: input.changes === undefined ? Prisma.JsonNull : json(input.changes) } });
}

function configJson(config: MetaAdsConfiguration): Prisma.InputJsonValue { return json(config); }

function accountStatus(value: number | undefined): "ACTIVE" | "PAUSED" | "REVIEW_REQUIRED" {
  if (value === 1) return "ACTIVE";
  if (value === 2 || value === 3 || value === 101) return "PAUSED";
  return "REVIEW_REQUIRED";
}

function metricBundle(insight: MetaAdsInsight) {
  const raw = {
    spendCents: insight.spend === undefined ? null : decimalStringToMinorUnits(insight.spend),
    impressions: integerMetric(insight.impressions),
    reach: integerMetric(insight.reach),
    clicks: integerMetric(insight.clicks),
    linkClicks: integerMetric(insight.inline_link_clicks) ?? metaActionValue(insight.actions, ["link_click"]),
    landingPageViews: metaActionValue(insight.actions, ["landing_page_view"]),
    reportedLeads: metaActionValue(insight.actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]),
    reportedPurchases: metaActionValue(insight.actions, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]),
    reportedRevenueCents: metaActionMoneyValue(insight.action_values, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]),
  };
  const availableMetrics = Object.entries(raw).filter(([, value]) => value !== null).map(([key]) => key);
  const missingMetrics = Object.entries(raw).filter(([, value]) => value === null).map(([key]) => key);
  return { values: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value ?? 0n])) as Record<keyof typeof raw, bigint>, availableMetrics, missingMetrics };
}

function factHash(input: Readonly<Record<string, unknown>>) { return createHash("sha256").update(canonicalJson(input)).digest("hex"); }

function metricComparable(input: Readonly<{ values: Record<string, bigint>; availableMetrics: string[]; missingMetrics: string[] }>) {
  return {
    ...Object.fromEntries(Object.entries(input.values).map(([key, value]) => [key, value.toString()])),
    availableMetrics: [...input.availableMetrics].sort(),
    missingMetrics: [...input.missingMetrics].sort(),
  };
}

export function createMetaAdsService(options: Options) {
  const authorization = getAuthorizationService();
  const authorize = (context: AuthenticatedContext, permission: PermissionKey) => authorization.assertAuthorized(context, permission, resource(context));
  const include = { secrets: { where: { disabledAt: null }, orderBy: { version: "desc" as const } } } as const;

  async function findConnection(context: AuthenticatedContext) {
    return options.database.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: CONNECTION_KEY } }, include });
  }

  async function credentialsOrFail(connection: NonNullable<Awaited<ReturnType<typeof findConnection>>>): Promise<MetaAdsCredentials> {
    const tokenReference = connection.secrets.find((item) => item.alias === META_ADS_ACCESS_TOKEN_ALIAS);
    const appSecretReference = connection.secrets.find((item) => item.alias === META_ADS_APP_SECRET_ALIAS);
    const accessToken = tokenReference ? await options.secrets.resolve(tokenReference.referenceKey) : null;
    const appSecret = appSecretReference ? await options.secrets.resolve(appSecretReference.referenceKey) : null;
    if (!accessToken) fail("A referência server-side do token Meta ainda não está disponível.", "META_CREDENTIALS_PENDING", 409);
    return { accessToken, appSecret };
  }

  async function currentConfig(connection: NonNullable<Awaited<ReturnType<typeof findConnection>>>): Promise<MetaAdsConfiguration> {
    const version = await options.database.integrationConnectionConfigVersion.findUnique({ where: { workspaceId_connectionId_version: { workspaceId: connection.workspaceId, connectionId: connection.id, version: connection.currentConfigVersion } } });
    if (!version) fail("A configuração versionada da Meta não foi encontrada.", "META_CONFIG_NOT_FOUND");
    return metaAdsConfigurationSchema.parse(version.config);
  }

  async function screen(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_READ);
    await authorize(context, PermissionKeys.MARKETING_MEDIA_READ);
    const connection = await findConnection(context);
    const suggestedInitialSince = subtractDays(localDate(options.now()), 30);
    if (!connection) return { readiness: "NOT_CONFIGURED" as const, connection: null, config: null, accounts: [], runs: [], latestCursor: null, missingInformation: ["Configuração da conexão", "Referência server-side do token Meta"], externalValidation: false, suggestedInitialSince };
    const channel = await options.database.marketingChannel.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: "meta-ads" } }, select: { id: true } });
    const [config, accounts, runs, cursor] = await Promise.all([
      currentConfig(connection),
      channel ? options.database.marketingAdAccount.findMany({ where: { workspaceId: context.workspaceId, channelId: channel.id, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, key: true, name: true, currency: true, timeZone: true, status: true, updatedAt: true } }) : Promise.resolve([]),
      options.database.integrationSyncRun.findMany({ where: { workspaceId: context.workspaceId, connectionId: connection.id, objectType: OBJECT_TYPE }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, correlationId: true, executionMode: true, windowStart: true, windowEnd: true, readCount: true, createdCount: true, updatedCount: true, ignoredCount: true, failedCount: true, errorClass: true, errorCode: true, errorMessage: true, startedAt: true, finishedAt: true } }),
      options.database.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: connection.id, direction: "PULL", objectType: OBJECT_TYPE } } }),
    ]);
    const state = connectionState(connection);
    const missingInformation = [!state.credentials.accessTokenReferencePresent ? "Referência server-side do token Meta" : null, config.selectedAccountIds.length === 0 ? "Seleção explícita de conta de anúncios" : null].filter((item): item is string => Boolean(item));
    const readiness = connection.status === "AWAITING_CREDENTIAL" ? "PENDING_CREDENTIALS" as const : connection.status;
    return { readiness, connection: state, config, accounts: accounts.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString(), selected: config.selectedAccountIds.includes(item.key) })), runs: runs.map((run) => ({ ...run, windowStart: run.windowStart?.toISOString() ?? null, windowEnd: run.windowEnd?.toISOString() ?? null, startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null })), latestCursor: cursor ? { watermark: cursor.watermark?.toISOString() ?? null, updatedAt: cursor.updatedAt.toISOString() } : null, missingInformation, externalValidation: connection.capabilityLevel === "CONNECTED", suggestedInitialSince };
  }

  async function configure(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    await authorize(context, PermissionKeys.INTEGRATIONS_SECRETS_MANAGE);
    const input = metaAdsConfigureSchema.parse(raw);
    const accessPresent = Boolean(await options.secrets.resolve(META_ADS_ACCESS_TOKEN_REFERENCE));
    const appSecretPresent = Boolean(await options.secrets.resolve(META_ADS_APP_SECRET_REFERENCE));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-ads-config:${context.workspaceId}`}, 0))`;
      const existing = await tx.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: CONNECTION_KEY } } });
      if (existing && input.revision !== existing.revision) fail("A conexão Meta foi alterada por outra pessoa. Atualize a página.", "META_REVISION_CONFLICT");
      const version = existing ? existing.currentConfigVersion + 1 : 1;
      const config = options.adapter.validateConfiguration(input.config);
      const serialized = configJson(config);
      const connection = existing
        ? await tx.integrationConnection.update({ where: { id: existing.id }, data: { displayName: input.displayName, currentConfigVersion: version, revision: { increment: 1 }, status: accessPresent ? "DRAFT" : "AWAITING_CREDENTIAL", capabilityLevel: "IMPLEMENTED", enabled: false, currentErrorClass: accessPresent ? null : "CONFIGURATION", currentErrorCode: accessPresent ? null : "META_CREDENTIALS_PENDING", currentErrorMessage: accessPresent ? null : "A referência server-side do token Meta ainda não está disponível.", updatedByActorId: context.actorId } })
        : await tx.integrationConnection.create({ data: { workspaceId: context.workspaceId, key: CONNECTION_KEY, providerKey: META_ADS_PROVIDER_KEY, adapterKey: META_ADS_ADAPTER_KEY, displayName: input.displayName, environment: "SANDBOX", status: accessPresent ? "DRAFT" : "AWAITING_CREDENTIAL", capabilityLevel: "IMPLEMENTED", enabled: false, currentErrorClass: accessPresent ? null : "CONFIGURATION", currentErrorCode: accessPresent ? null : "META_CREDENTIALS_PENDING", currentErrorMessage: accessPresent ? null : "A referência server-side do token Meta ainda não está disponível.", createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, version, schemaVersion: "meta-ads-read/1.0", config: serialized, configHash: sha256(canonicalJson(serialized)), createdByActorId: context.actorId } });
      await tx.integrationConnectionCapability.createMany({ data: ["SYNC_PULL", "OBJECT_MAPPING"].map((capability) => ({ workspaceId: context.workspaceId, connectionId: connection.id, capability: capability as "SYNC_PULL" | "OBJECT_MAPPING" })), skipDuplicates: true });
      for (const reference of [{ alias: META_ADS_ACCESS_TOKEN_ALIAS, referenceKey: META_ADS_ACCESS_TOKEN_REFERENCE, present: accessPresent }, { alias: META_ADS_APP_SECRET_ALIAS, referenceKey: META_ADS_APP_SECRET_REFERENCE, present: appSecretPresent }]) {
        const current = await tx.integrationSecretReference.findFirst({ where: { workspaceId: context.workspaceId, connectionId: connection.id, alias: reference.alias, disabledAt: null }, orderBy: { version: "desc" } });
        if (!current) await tx.integrationSecretReference.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, ...reference, createdByActorId: context.actorId } });
        else if (current.present !== reference.present) await tx.integrationSecretReference.update({ where: { id: current.id }, data: { present: reference.present } });
      }
      await audit(tx, context, { action: existing ? "integration.meta_ads.configuration_versioned" : "integration.meta_ads.created", entityId: connection.id, changes: { configVersion: version, graphApiVersion: config.graphApiVersion, selectedAccountCount: config.selectedAccountIds.length, accessTokenReferencePresent: accessPresent, appSecretReferencePresent: appSecretPresent, readOnly: true } });
      return { id: connection.id, revision: connection.revision, status: connection.status, capabilityLevel: connection.capabilityLevel, credentialsPending: !accessPresent };
    }, { isolationLevel: "Serializable" });
  }

  async function persistFailure(context: AuthenticatedContext, connectionId: string, failure: MetaAdsFailure, requestId?: string) {
    const now = options.now();
    await options.database.$transaction(async (tx) => {
      await tx.integrationConnection.update({ where: { id: connectionId }, data: { status: errorStatus(failure), enabled: false, lastErroredAt: now, currentErrorClass: failure.classification, currentErrorCode: failure.code, currentErrorMessage: failure.safeMessage, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await audit(tx, context, { action: "integration.meta_ads.failed", entityId: connectionId, ...(requestId ? { requestId } : {}), changes: { classification: failure.classification, code: failure.code, retryAfterSeconds: failure.retryAfterSeconds ?? null, secretIncluded: false } });
    });
  }

  async function testConnection(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
    const connection = await findConnection(context);
    if (!connection) fail("Configure a conexão Meta Ads antes de testar.", "META_CONNECTION_NOT_CONFIGURED", 404);
    const config = await currentConfig(connection);
    let credentials: MetaAdsCredentials;
    try { credentials = await credentialsOrFail(connection); }
    catch (error) { const failure = { classification: "CONFIGURATION", code: "META_CREDENTIALS_PENDING", safeMessage: "A referência server-side do token Meta ainda não está disponível." } as const; await persistFailure(context, connection.id, failure); throw error; }
    try {
      const result = await options.adapter.testConnection(config, credentials);
      const selected = new Set(config.selectedAccountIds);
      if ([...selected].some((id) => !result.accounts.some((account) => account.id === id))) throw new Error("SELECTED_ACCOUNT_INACCESSIBLE");
      const now = options.now();
      await options.database.$transaction(async (tx) => {
        const channel = await tx.marketingChannel.upsert({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: "meta-ads" } }, create: { workspaceId: context.workspaceId, key: "meta-ads", name: "Meta Ads", createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: {} });
        for (const account of result.accounts) {
          const internal = await tx.marketingAdAccount.upsert({ where: { workspaceId_channelId_key: { workspaceId: context.workspaceId, channelId: channel.id, key: account.id } }, create: { workspaceId: context.workspaceId, channelId: channel.id, key: account.id, name: account.name, currency: account.currency ?? "BRL", timeZone: account.timezone_name ?? "America/Sao_Paulo", status: accountStatus(account.account_status), createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { name: account.name, currency: account.currency ?? "BRL", timeZone: account.timezone_name ?? "America/Sao_Paulo", status: accountStatus(account.account_status), updatedByActorId: context.actorId } });
          await tx.externalObjectMapping.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: context.workspaceId, connectionId: connection.id, externalObjectType: "meta_ad_account", externalId: account.id } }, create: { workspaceId: context.workspaceId, connectionId: connection.id, externalObjectType: "meta_ad_account", externalId: account.id, internalEntityType: "MARKETING_AD_ACCOUNT", internalEntityId: internal.id, externalVersion: config.graphApiVersion, externalHash: factHash({ id: account.id, name: account.name }), firstRecognizedAt: now, lastRecognizedAt: now, createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { lastRecognizedAt: now, externalVersion: config.graphApiVersion, updatedByActorId: context.actorId } });
        }
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", capabilityLevel: "CONNECTED", enabled: true, lastTestedAt: now, lastSucceededAt: now, lastErroredAt: null, currentErrorClass: null, currentErrorCode: null, currentErrorMessage: null, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await audit(tx, context, { action: "integration.meta_ads.connection_tested", entityId: connection.id, changes: { accessibleAccountCount: result.accounts.length, selectedAccountCount: selected.size, graphApiVersion: config.graphApiVersion, requestCount: result.requestCount, readOnly: true, secretIncluded: false } });
      });
      return { connected: true as const, accessibleAccounts: result.accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency ?? null, timeZone: account.timezone_name ?? null })), graphApiVersion: config.graphApiVersion };
    } catch (error) {
      const failure = error instanceof Error && error.message === "SELECTED_ACCOUNT_INACCESSIBLE" ? { classification: "ACCOUNT_INACCESSIBLE", code: "META_SELECTED_ACCOUNT_INACCESSIBLE", safeMessage: "Uma conta selecionada não está acessível para esta credencial." } as const : options.adapter.classifyError(error);
      await persistFailure(context, connection.id, failure);
      fail(failure.safeMessage, failure.code, failure.classification === "AUTHENTICATION" ? 401 : failure.classification === "PERMISSION" ? 403 : 409);
    }
  }

  async function persistHierarchy(tx: Tx, context: AuthenticatedContext, connectionId: string, config: MetaAdsConfiguration, payload: MetaAdsSyncPayload) {
    const now = options.now();
    const channel = await tx.marketingChannel.upsert({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: "meta-ads" } }, create: { workspaceId: context.workspaceId, key: "meta-ads", name: "Meta Ads", createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: {} });
    const accountByExternal = new Map<string, { id: string; currency: string; timeZone: string }>();
    for (const row of payload.hierarchy.accounts) {
      const item = await tx.marketingAdAccount.upsert({ where: { workspaceId_channelId_key: { workspaceId: context.workspaceId, channelId: channel.id, key: row.id } }, create: { workspaceId: context.workspaceId, channelId: channel.id, key: row.id, name: row.name, currency: row.currency ?? "BRL", timeZone: row.timezone_name ?? "America/Sao_Paulo", status: accountStatus(row.account_status), createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { name: row.name, currency: row.currency ?? "BRL", timeZone: row.timezone_name ?? "America/Sao_Paulo", status: accountStatus(row.account_status), updatedByActorId: context.actorId } });
      accountByExternal.set(row.id.slice(4), item);
      await map(tx, context, connectionId, "meta_ad_account", row.id, "MARKETING_AD_ACCOUNT", item.id, config.graphApiVersion, now);
    }
    const campaignByExternal = new Map<string, { id: string }>();
    for (const row of payload.hierarchy.campaigns) {
      const accountExternalId = row.account_id ?? payload.insights.find((item) => item.campaign_id === row.id)?.account_id;
      const account = accountExternalId ? accountByExternal.get(accountExternalId) : undefined;
      const item = await tx.marketingCampaign.upsert({ where: { workspaceId_channelId_key: { workspaceId: context.workspaceId, channelId: channel.id, key: row.id } }, create: { workspaceId: context.workspaceId, channelId: channel.id, adAccountId: account?.id ?? null, key: row.id, name: row.name, status: normalizeMetaMediaStatus(row.status), startsAt: row.start_time ? new Date(row.start_time) : null, endsAt: row.stop_time ? new Date(row.stop_time) : null, createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { name: row.name, status: normalizeMetaMediaStatus(row.status), startsAt: row.start_time ? new Date(row.start_time) : null, endsAt: row.stop_time ? new Date(row.stop_time) : null, ...(account ? { adAccountId: account.id } : {}), updatedByActorId: context.actorId } });
      campaignByExternal.set(row.id, item); await map(tx, context, connectionId, "meta_campaign", row.id, "MARKETING_CAMPAIGN", item.id, config.graphApiVersion, now);
    }
    const adSetByExternal = new Map<string, { id: string }>();
    for (const row of payload.hierarchy.adSets) {
      const campaign = campaignByExternal.get(row.campaign_id); if (!campaign) continue;
      const item = await tx.marketingAdGroup.upsert({ where: { workspaceId_campaignId_key: { workspaceId: context.workspaceId, campaignId: campaign.id, key: row.id } }, create: { workspaceId: context.workspaceId, campaignId: campaign.id, key: row.id, name: row.name, status: normalizeMetaMediaStatus(row.status), createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { name: row.name, status: normalizeMetaMediaStatus(row.status), updatedByActorId: context.actorId } });
      adSetByExternal.set(row.id, item); await map(tx, context, connectionId, "meta_adset", row.id, "MARKETING_AD_GROUP", item.id, config.graphApiVersion, now);
    }
    const adByExternal = new Map<string, { id: string }>();
    const creativeByAdExternal = new Map<string, { id: string }>();
    for (const row of payload.hierarchy.ads) {
      const adSet = adSetByExternal.get(row.adset_id); if (!adSet) continue;
      const item = await tx.marketingAd.upsert({ where: { workspaceId_adGroupId_key: { workspaceId: context.workspaceId, adGroupId: adSet.id, key: row.id } }, create: { workspaceId: context.workspaceId, adGroupId: adSet.id, key: row.id, name: row.name, status: normalizeMetaMediaStatus(row.status), createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { name: row.name, status: normalizeMetaMediaStatus(row.status), updatedByActorId: context.actorId } });
      adByExternal.set(row.id, item); await map(tx, context, connectionId, "meta_ad", row.id, "MARKETING_AD", item.id, config.graphApiVersion, now);
      if (row.creative) {
        const campaignExternal = payload.insights.find((insight) => insight.ad_id === row.id)?.campaign_id; const campaign = campaignExternal ? campaignByExternal.get(campaignExternal) : undefined;
        if (campaign) { const creative = await tx.marketingCreative.upsert({ where: { workspaceId_campaignId_key: { workspaceId: context.workspaceId, campaignId: campaign.id, key: row.creative.id } }, create: { workspaceId: context.workspaceId, campaignId: campaign.id, adId: item.id, key: row.creative.id, name: row.creative.name ?? `Criativo ${row.creative.id}`, createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { adId: item.id, name: row.creative.name ?? `Criativo ${row.creative.id}`, updatedByActorId: context.actorId } }); creativeByAdExternal.set(row.id, creative); await map(tx, context, connectionId, "meta_creative", row.creative.id, "MARKETING_CREATIVE", creative.id, config.graphApiVersion, now); }
      }
    }
    return { channel, accountByExternal, campaignByExternal, adSetByExternal, adByExternal, creativeByAdExternal };
  }

  async function map(tx: Tx, context: AuthenticatedContext, connectionId: string, externalObjectType: string, externalId: string, internalEntityType: "MARKETING_AD_ACCOUNT" | "MARKETING_CAMPAIGN" | "MARKETING_AD_GROUP" | "MARKETING_AD" | "MARKETING_CREATIVE", internalEntityId: string, apiVersion: string, now: Date) {
    await tx.externalObjectMapping.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: context.workspaceId, connectionId, externalObjectType, externalId } }, create: { workspaceId: context.workspaceId, connectionId, externalObjectType, externalId, internalEntityType, internalEntityId, externalVersion: apiVersion, externalHash: factHash({ externalId, internalEntityId }), firstRecognizedAt: now, lastRecognizedAt: now, createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { internalEntityType, internalEntityId, externalVersion: apiVersion, lastRecognizedAt: now, version: { increment: 1 }, updatedByActorId: context.actorId } });
  }

  async function runSync(context: AuthenticatedContext, input: Readonly<{ mode: "INITIAL" | "INCREMENTAL"; correlationId: string }>) {
    await authorize(context, PermissionKeys.INTEGRATIONS_EXECUTE);
    await authorize(context, PermissionKeys.MARKETING_MEDIA_IMPORT);
    const connection = await findConnection(context); if (!connection) fail("Configure a conexão Meta Ads antes de sincronizar.", "META_CONNECTION_NOT_CONFIGURED", 404);
    if (!connection.enabled || connection.status !== "CONNECTED" || connection.capabilityLevel !== "CONNECTED") fail("Teste e conecte a conta Meta antes de sincronizar.", "META_CONNECTION_NOT_READY");
    const config = await currentConfig(connection); if (config.selectedAccountIds.length === 0) fail("Selecione ao menos uma conta de anúncios acessível.", "META_ACCOUNT_SELECTION_REQUIRED", 422);
    const credentials = await credentialsOrFail(connection);
    const existing = await options.database.integrationSyncRun.findUnique({ where: { workspaceId_connectionId_direction_objectType_correlationId: { workspaceId: context.workspaceId, connectionId: connection.id, direction: "PULL", objectType: OBJECT_TYPE, correlationId: input.correlationId } } });
    if (existing?.status === "SUCCEEDED") return existing;
    const cursor = await options.database.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: connection.id, direction: "PULL", objectType: OBJECT_TYPE } } });
    const until = localDate(options.now());
    const watermarkDate = cursor?.watermark ? localDate(cursor.watermark) : null;
    const since = input.mode === "INITIAL" || !watermarkDate ? config.initialSince : subtractDays(watermarkDate, config.lookbackDays);
    const run = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-ads-sync:${context.workspaceId}:${connection.id}`}, 0))`;
      const running = await tx.integrationSyncRun.findFirst({ where: { workspaceId: context.workspaceId, connectionId: connection.id, objectType: OBJECT_TYPE, status: "RUNNING" } });
      if (running) fail("Já existe uma sincronização Meta em andamento.", "META_SYNC_ALREADY_RUNNING");
      const created = existing ? await tx.integrationSyncRun.update({ where: { id: existing.id }, data: { status: "RUNNING", attempts: { increment: 1 }, errorClass: null, errorCode: null, errorMessage: null, startedAt: options.now(), finishedAt: null } }) : await tx.integrationSyncRun.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, direction: "PULL", objectType: OBJECT_TYPE, status: "RUNNING", previousCursor: cursor?.cursor ?? null, windowStart: startInstant(since), windowEnd: endInstant(until), attempts: 1, correlationId: input.correlationId, executionMode: input.mode, requestedByActorId: context.actorId, startedAt: options.now() } });
      await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: "SYNCING", revision: { increment: 1 }, updatedByActorId: context.actorId } });
      return created;
    }, { isolationLevel: "Serializable" });
    try {
      const payload = await options.adapter.pull(config, credentials, { since, until });
      return await options.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-ads-sync:${context.workspaceId}:${connection.id}`}, 0))`;
        const current = await tx.integrationSyncRun.findUniqueOrThrow({ where: { id: run.id } });
        if (current.status === "SUCCEEDED") return current;
        const hierarchy = await persistHierarchy(tx, context, connection.id, config, payload);
        let createdCount = 0; let updatedCount = 0; let ignoredCount = 0; let rowNumber = 0;
        for (const insight of payload.insights) {
          rowNumber += 1;
          const account = hierarchy.accountByExternal.get(insight.account_id); const campaign = hierarchy.campaignByExternal.get(insight.campaign_id); const adSet = hierarchy.adSetByExternal.get(insight.adset_id); const ad = hierarchy.adByExternal.get(insight.ad_id); const creative = hierarchy.creativeByAdExternal.get(insight.ad_id);
          if (!account || !campaign || !adSet || !ad) { ignoredCount += 1; continue; }
          const metrics = metricBundle(insight); const currency = insight.account_currency ?? account.currency;
          const grainKey = [META_ADS_PROVIDER_KEY, insight.account_id, insight.campaign_id, insight.adset_id, insight.ad_id, insight.date_start, currency].join("|");
          const videoMetrics = metaVideoComparable(insight.actions);
          const comparable = { ...metricComparable(metrics), ...videoMetrics };
          const previous = await tx.marketingPerformanceFact.findFirst({ where: { workspaceId: context.workspaceId, grainKey }, orderBy: { revision: "desc" } });
          const previousComparable = previous ? metricComparable({ values: { spendCents: previous.spendCents, impressions: previous.impressions, reach: previous.reach, clicks: previous.clicks, linkClicks: previous.linkClicks, landingPageViews: previous.landingPageViews, reportedLeads: previous.reportedLeads, reportedPurchases: previous.reportedPurchases, reportedRevenueCents: previous.reportedRevenueCents }, availableMetrics: previous.availableMetrics, missingMetrics: previous.missingMetrics }) : null;
          const previousEvidence = previous?.sourceEvidence as { videoMetricVersion?: string; videoViews3s?: string | null } | null;
          const previousWithVideo = previousComparable ? { ...previousComparable, videoMetricVersion: previousEvidence?.videoMetricVersion ?? null, videoViews3s: previousEvidence?.videoViews3s ?? null } : null;
          if (previousWithVideo && factHash(previousWithVideo) === factHash(comparable)) { ignoredCount += 1; continue; }
          const fact = await tx.marketingPerformanceFact.create({ data: { workspaceId: context.workspaceId, importRunId: null, integrationSyncRunId: run.id, channelId: hierarchy.channel.id, adAccountId: account.id, campaignId: campaign.id, adGroupId: adSet.id, adId: ad.id, creativeId: creative?.id ?? null, granularity: "DAILY", grainKey, revision: (previous?.revision ?? 0) + 1, supersedesFactId: previous?.id ?? null, periodStart: startInstant(insight.date_start), periodEnd: endInstant(insight.date_stop), timeZone: account.timeZone, currency, ...metrics.values, sourceRowNumber: rowNumber, sourceProvider: META_ADS_PROVIDER_KEY, providerApiVersion: config.graphApiVersion, providerExternalId: insight.ad_id, availableMetrics: metrics.availableMetrics, missingMetrics: metrics.missingMetrics, collectedAt: options.now(), sourceEvidence: json({ ...videoMetrics, syncRunId: run.id, graphApiVersion: config.graphApiVersion, accountExternalId: insight.account_id, campaignExternalId: insight.campaign_id, adSetExternalId: insight.adset_id, adExternalId: insight.ad_id, availableMetrics: metrics.availableMetrics, missingMetrics: metrics.missingMetrics, rawPayloadPersisted: false }), createdByActorId: context.actorId } });
          const actions = [...(insight.actions ?? []).map((item) => ({ ...item, kind: "count" as const })), ...(insight.action_values ?? []).map((item) => ({ ...item, kind: "value_cents" as const }))];
          const groupedActions = new Map<string, { providerActionType: string; kind: "count" | "value_cents"; value: bigint }>();
          for (const action of actions) {
            const actionType = `${action.kind}:${action.action_type}`;
            const value = action.kind === "count" ? integerMetric(action.value) ?? 0n : decimalStringToMinorUnits(action.value);
            const previousAction = groupedActions.get(actionType);
            groupedActions.set(actionType, { providerActionType: action.action_type, kind: action.kind, value: (previousAction?.value ?? 0n) + value });
          }
          if (groupedActions.size) await tx.marketingProviderActionFact.createMany({ data: [...groupedActions.entries()].map(([actionType, action]) => ({ workspaceId: context.workspaceId, performanceFactId: fact.id, actionType, classification: classifyMetaAction(action.providerActionType), value: action.value, sourceEvidence: json({ providerActionType: action.providerActionType, valueKind: action.kind, graphApiVersion: config.graphApiVersion }) })) });
          createdCount += 1; if (previous) updatedCount += 1;
        }
        const finishedAt = options.now();
        const updated = await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", candidateCursor: until, watermark: endInstant(until), readCount: payload.insights.length, createdCount, updatedCount, ignoredCount, finishedAt } });
        await tx.integrationSyncCursor.upsert({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: connection.id, direction: "PULL", objectType: OBJECT_TYPE } }, create: { workspaceId: context.workspaceId, connectionId: connection.id, direction: "PULL", objectType: OBJECT_TYPE, cursor: until, watermark: endInstant(until), lastSyncRunId: run.id, updatedByActorId: context.actorId }, update: { cursor: until, watermark: endInstant(until), lastSyncRunId: run.id, version: { increment: 1 }, updatedByActorId: context.actorId } });
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: context.workspaceId, kind: "SYNC", syncRunId: run.id, attemptNumber: run.attempts, status: "SUCCEEDED", startedAt: run.startedAt ?? finishedAt, finishedAt, resultMetadata: json({ graphApiVersion: config.graphApiVersion, requestCount: payload.requestCount, insightCount: payload.insights.length, createdCount, updatedCount, ignoredCount, readOnly: true, secretIncluded: false }) } });
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", capabilityLevel: "CONNECTED", enabled: true, lastSucceededAt: finishedAt, lastErroredAt: null, currentErrorClass: null, currentErrorCode: null, currentErrorMessage: null, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await audit(tx, context, { action: "integration.meta_ads.sync_completed", entityId: connection.id, requestId: input.correlationId, changes: { runId: run.id, mode: input.mode, since, until, graphApiVersion: config.graphApiVersion, selectedAccountCount: config.selectedAccountIds.length, readCount: payload.insights.length, createdCount, updatedCount, ignoredCount, rawPayloadPersisted: false, automaticAttribution: false } });
        return updated;
      }, { isolationLevel: "Serializable", timeout: 30_000 });
    } catch (error) {
      const failure = options.adapter.classifyError(error); const finishedAt = options.now();
      await options.database.$transaction(async (tx) => {
        await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, failedCount: { increment: 1 }, finishedAt } });
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: context.workspaceId, kind: "SYNC", syncRunId: run.id, attemptNumber: run.attempts, status: "FAILED", errorClass: failure.classification, errorCode: failure.code, errorMessage: failure.safeMessage, retryAfterSeconds: failure.retryAfterSeconds ?? null, startedAt: run.startedAt ?? finishedAt, finishedAt } });
      });
      await persistFailure(context, connection.id, failure, input.correlationId);
      fail(failure.safeMessage, failure.code, failure.classification === "AUTHENTICATION" ? 401 : failure.classification === "PERMISSION" ? 403 : 409);
    }
  }

  async function setPaused(context: AuthenticatedContext, revision: number, paused: boolean) {
    await authorize(context, PermissionKeys.INTEGRATIONS_MANAGE);
    const connection = await findConnection(context); if (!connection) fail("Conexão Meta não encontrada.", "META_CONNECTION_NOT_CONFIGURED", 404);
    if (connection.revision !== revision) fail("A conexão Meta foi alterada por outra pessoa. Atualize a página.", "META_REVISION_CONFLICT");
    if (!paused && !connection.lastSucceededAt) fail("Teste de conexão aprovado é obrigatório antes de retomar.", "META_CONNECTION_TEST_REQUIRED");
    return options.database.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: paused ? "PAUSED" : "CONNECTED", enabled: !paused, disabledAt: paused ? options.now() : null, revision: { increment: 1 }, updatedByActorId: context.actorId }, include });
      await audit(tx, context, { action: paused ? "integration.meta_ads.paused" : "integration.meta_ads.resumed", entityId: connection.id, changes: { enabled: !paused } });
      return connectionState(updated);
    });
  }

  return Object.freeze({ screen, configure, testConnection, runSync, setPaused });
}

let service: ReturnType<typeof createMetaAdsService> | undefined;
export function getMetaAdsService() {
  service ??= createMetaAdsService({ database: getDatabaseClient(), adapter: metaAdsReadAdapter, secrets: environmentSecretResolver, now: () => new Date() });
  return service;
}
