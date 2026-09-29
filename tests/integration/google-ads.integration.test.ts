import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { GoogleAdsReadAdapter } from "@/modules/integrations/application/google-ads-read-adapter";
import { createGoogleAdsService } from "@/modules/integrations/application/google-ads-service";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-41 integration test requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const now = new Date("2046-04-20T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local")]);
});

afterAll(async () => {
  const connection = await database.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId, key: "google-ads" } }, select: { id: true } });
  if (connection) {
    const protectedTriggers = [
      ["marketing_performance_facts", "marketing_facts_append_only"],
      ["integration_delivery_attempts", "integration_delivery_attempts_append_only"],
      ["integration_connection_config_versions", "integration_config_versions_append_only"],
    ] as const;
    for (const [table, trigger] of protectedTriggers) await database.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    try {
      await database.marketingPerformanceFact.deleteMany({ where: { workspaceId, sourceProvider: "GOOGLE_ADS" } });
      await database.integrationSyncCursor.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationDeliveryAttempt.deleteMany({ where: { workspaceId, syncRun: { connectionId: connection.id } } });
      await database.integrationSyncRun.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.externalObjectMapping.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationExternalAccountLink.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationConnectionCapability.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationConnectionConfigVersion.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationSecretReference.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationConnection.delete({ where: { id: connection.id } });
    } finally {
      for (const [table, trigger] of [...protectedTriggers].reverse()) await database.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
    }
  }
  const channel = await database.marketingChannel.findUnique({ where: { workspaceId_key: { workspaceId, key: "google-ads" } }, select: { id: true } });
  if (channel) {
    const campaigns = await database.marketingCampaign.findMany({ where: { workspaceId, channelId: channel.id }, select: { id: true } });
    const adGroups = await database.marketingAdGroup.findMany({ where: { workspaceId, campaignId: { in: campaigns.map((item) => item.id) } }, select: { id: true } });
    const ads = await database.marketingAd.findMany({ where: { workspaceId, adGroupId: { in: adGroups.map((item) => item.id) } }, select: { id: true } });
    await database.marketingCreative.deleteMany({ where: { workspaceId, campaignId: { in: campaigns.map((item) => item.id) } } });
    await database.marketingAd.deleteMany({ where: { workspaceId, id: { in: ads.map((item) => item.id) } } });
    await database.marketingAdGroup.deleteMany({ where: { workspaceId, id: { in: adGroups.map((item) => item.id) } } });
    await database.marketingCampaign.deleteMany({ where: { workspaceId, id: { in: campaigns.map((item) => item.id) } } });
    await database.marketingAdAccount.deleteMany({ where: { workspaceId, channelId: channel.id } });
    await database.marketingChannel.delete({ where: { id: channel.id } });
  }
  await database.$disconnect();
});

const customer = { customerClient: { id: "2222222222", clientCustomer: "customers/2222222222", descriptiveName: "Politizai Google Fixture", currencyCode: "BRL", timeZone: "America/Sao_Paulo", manager: false, level: "1", status: "ENABLED" } };
const baseMetric = { customer: { id: "2222222222", descriptiveName: "Politizai Google Fixture", currencyCode: "BRL", timeZone: "America/Sao_Paulo" }, campaign: { id: "300001", resourceName: "customers/2222222222/campaigns/300001", name: "Campanha Search Fixture", status: "ENABLED", advertisingChannelType: "SEARCH" }, adGroup: { id: "400001", resourceName: "customers/2222222222/adGroups/400001", name: "Grupo Fixture", status: "ENABLED" }, adGroupAd: { resourceName: "customers/2222222222/adGroupAds/400001~500001", status: "ENABLED", ad: { id: "500001", resourceName: "customers/2222222222/ads/500001", name: "Anúncio Fixture", type: "RESPONSIVE_SEARCH_AD" } }, segments: { date: "2046-04-19" }, metrics: { costMicros: "10250000", impressions: "1000", clicks: "50", interactions: "55", conversions: "2.5", conversionsValue: "500.25", allConversions: "3", allConversionsValue: "600", ctr: "0.05", averageCpc: "205000", averageCpm: "10250000" } };

function fixtureAdapter() {
  let costMicros = "10250000";
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const adapter = new GoogleAdsReadAdapter({ sleep: async () => undefined, random: () => 0, fetcher: async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.origin === "https://oauth2.googleapis.com") return Response.json({ access_token: "fixture-google-access-token", token_type: "Bearer", expires_in: 3600 });
    if (url.pathname.endsWith("customers:listAccessibleCustomers")) return Response.json({ resourceNames: ["customers/1111111111"] }, { headers: { "request-id": "accessible-request" } });
    const body = JSON.parse(String(init?.body)) as { query: string };
    if (body.query.includes("FROM customer_client")) return Response.json({ results: [customer] }, { headers: { "request-id": "hierarchy-request" } });
    if (body.query.includes("FROM ad_group_ad_asset_view")) return Response.json({ results: [
      { adGroupAdAssetView: { resourceName: "customers/2222222222/adGroupAdAssetViews/headline", fieldType: "HEADLINE", performanceLabel: "GOOD", enabled: true }, adGroupAd: { resourceName: baseMetric.adGroupAd.resourceName, ad: baseMetric.adGroupAd.ad }, asset: { id: "600001", resourceName: "customers/2222222222/assets/600001", name: "Título Fixture", type: "TEXT" } },
      { adGroupAdAssetView: { resourceName: "customers/2222222222/adGroupAdAssetViews/description", fieldType: "DESCRIPTION", performanceLabel: "BEST", enabled: true }, adGroupAd: { resourceName: baseMetric.adGroupAd.resourceName, ad: baseMetric.adGroupAd.ad }, asset: { id: "600002", resourceName: "customers/2222222222/assets/600002", name: "Descrição Fixture", type: "TEXT" } },
    ] }, { headers: { "request-id": "asset-request" } });
    return Response.json({ results: [{ ...baseMetric, metrics: { ...baseMetric.metrics, costMicros } }] }, { headers: { "request-id": "metrics-request" } });
  } });
  return { adapter, calls, updateCost: (value: string) => { costMicros = value; } };
}

describe("CRM-41 conector Google Ads read-only", () => {
  it("configura por referência, valida RBAC, sincroniza, versiona e mantém cursor commit-safe", async () => {
    const fixture = fixtureAdapter();
    const secrets = new EphemeralSecretResolver({ GOOGLE_ADS_OAUTH_CLIENT_ID: "fixture-client-id", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "fixture-client-secret", GOOGLE_ADS_OAUTH_REFRESH_TOKEN: "fixture-refresh-token" });
    const service = createGoogleAdsService({ database, adapter: fixture.adapter, secrets, now: () => now });

    await expect(service.screen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.configure(viewer, { displayName: "Negada", config: { authStrategy: "OAUTH_REFRESH_TOKEN", initialSince: "2046-04-01" } })).rejects.toBeInstanceOf(AccessDeniedError);

    const configured = await service.configure(admin, { displayName: "Google Ads Fixture", config: { apiVersion: "v25", authStrategy: "OAUTH_REFRESH_TOKEN", loginCustomerId: "1111111111", selectedCustomerIds: ["2222222222"], initialSince: "2046-04-01", lookbackDays: 7, pageSize: 100, requestTimeoutMs: 2_000 } });
    expect(configured).toMatchObject({ status: "DRAFT", credentialsPending: false });
    const secretRows = await database.integrationSecretReference.findMany({ where: { workspaceId, connectionId: configured.id } });
    expect(secretRows.map((item) => item.referenceKey).sort()).toEqual(["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_OAUTH_CLIENT_ID", "GOOGLE_ADS_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_OAUTH_REFRESH_TOKEN", "GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL", "GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY"]);
    expect(JSON.stringify(secretRows)).not.toContain("fixture-refresh-token");

    await expect(service.testConnection(admin)).resolves.toMatchObject({ connected: true, accessibleCustomers: [{ id: "2222222222", manager: false }] });
    expect(await database.integrationExternalAccountLink.count({ where: { workspaceId, connectionId: configured.id } })).toBe(1);

    const first = await service.runSync(admin, { mode: "INITIAL", correlationId: "google-initial-fixture-001" });
    expect(first).toMatchObject({ status: "SUCCEEDED", readCount: 1, createdCount: 1, updatedCount: 0 });
    const fact = await database.marketingPerformanceFact.findFirstOrThrow({ where: { workspaceId, sourceProvider: "GOOGLE_ADS", providerExternalId: "500001" }, orderBy: { revision: "desc" } });
    expect(fact).toMatchObject({ spendCents: 1025n, sourceCostMicros: 10_250_000n, impressions: 1000n, clicks: 50n, providerInteractions: 55n, providerConversionsMicros: 2_500_000n, providerAllConversionsMicros: 3_000_000n, reportedLeads: 0n, reportedPurchases: 0n, reportedRevenueCents: 0n, providerApiVersion: "v25", queryTemplateVersion: "google-ads-gaql/1.0" });
    expect(fact.availableMetrics).toContain("conversionsMicros");
    expect(fact.missingMetrics).toContain("reportedRevenueCents");
    expect(await database.marketingCreative.count({ where: { workspaceId, adId: fact.adId } })).toBe(2);
    expect(await database.externalObjectMapping.count({ where: { workspaceId, connectionId: configured.id } })).toBe(6);
    const cursor = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: configured.id, objectType: "google_ads_daily_insights" } });
    expect(cursor.cursor).toBe("2046-04-20");
    expect(fixture.calls.some(({ url }) => /mutate/i.test(url.pathname))).toBe(false);

    await expect(service.runSync(admin, { mode: "INITIAL", correlationId: "google-initial-fixture-001" })).resolves.toMatchObject({ id: first.id, status: "SUCCEEDED" });
    expect(await database.marketingPerformanceFact.count({ where: { workspaceId, grainKey: fact.grainKey } })).toBe(1);

    fixture.updateCost("12000000");
    const second = await service.runSync(admin, { mode: "INCREMENTAL", correlationId: "google-incremental-fixture-002" });
    expect(second).toMatchObject({ status: "SUCCEEDED", createdCount: 1, updatedCount: 1 });
    const revisions = await database.marketingPerformanceFact.findMany({ where: { workspaceId, grainKey: fact.grainKey }, orderBy: { revision: "asc" } });
    expect(revisions.map((item) => item.spendCents)).toEqual([1025n, 1200n]);
    expect(revisions[1]?.supersedesFactId).toBe(revisions[0]?.id);
    expect(await database.auditLog.count({ where: { workspaceId, action: "integration.google_ads.sync_completed" } })).toBe(2);

    const cursorBeforeFailure = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: configured.id, objectType: "google_ads_daily_insights" } });
    const factCountBeforeFailure = await database.marketingPerformanceFact.count({ where: { workspaceId, sourceProvider: "GOOGLE_ADS" } });
    const failingAdapter = new GoogleAdsReadAdapter({ sleep: async () => undefined, random: () => 0, fetcher: async (input) => new URL(String(input)).origin.includes("oauth2") ? Response.json({ access_token: "fixture-google-access-token", token_type: "Bearer" }) : new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }) });
    const failingService = createGoogleAdsService({ database, adapter: failingAdapter, secrets, now: () => now });
    await expect(failingService.runSync(admin, { mode: "INCREMENTAL", correlationId: "google-failure-fixture-003" })).rejects.toMatchObject({ code: "GOOGLE_TRANSIENT" });
    const cursorAfterFailure = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: configured.id, objectType: "google_ads_daily_insights" } });
    expect(cursorAfterFailure.cursor).toBe(cursorBeforeFailure.cursor);
    expect(await database.marketingPerformanceFact.count({ where: { workspaceId, sourceProvider: "GOOGLE_ADS" } })).toBe(factCountBeforeFailure);
    expect(await database.integrationSyncRun.findFirstOrThrow({ where: { workspaceId, correlationId: "google-failure-fixture-003" } })).toMatchObject({ status: "FAILED", errorClass: "TRANSIENT" });
  });

  it("permanece seguro e sem egress quando as referências estão ausentes", async () => {
    const connection = await database.integrationConnection.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId, key: "google-ads" } } });
    const adapter = new GoogleAdsReadAdapter({ fetcher: async () => { throw new Error("egress should not happen"); } });
    const service = createGoogleAdsService({ database, adapter, secrets: new EphemeralSecretResolver(), now: () => now });
    await service.configure(admin, { displayName: "Google Ads Fixture", revision: connection.revision, config: { apiVersion: "v25", authStrategy: "OAUTH_REFRESH_TOKEN", loginCustomerId: "1111111111", selectedCustomerIds: ["2222222222"], initialSince: "2046-04-01", lookbackDays: 7, pageSize: 100, requestTimeoutMs: 2_000 } });
    await expect(service.testConnection(admin)).rejects.toMatchObject({ code: "GOOGLE_CREDENTIALS_PENDING" });
    await expect(service.screen(admin)).resolves.toMatchObject({ readiness: "EXTERNAL_VALIDATION_DEFERRED", externalValidationDeferred: true });
  });
});
