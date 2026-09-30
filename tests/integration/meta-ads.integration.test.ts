import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { MetaAdsReadAdapter } from "@/modules/integrations/application/meta-ads-read-adapter";
import { createMetaAdsService } from "@/modules/integrations/application/meta-ads-service";
import { createMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-40 integration test requires an ephemeral politizai_test_* schema.");
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
  const connection = await database.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId, key: "meta-ads" } }, select: { id: true } });
  if (connection) {
    const facts = await database.marketingPerformanceFact.findMany({ where: { workspaceId, sourceProvider: "META_ADS" }, select: { id: true } });
    await database.marketingProviderActionFact.deleteMany({ where: { workspaceId, performanceFactId: { in: facts.map((item) => item.id) } } });
    const protectedTriggers = [
      ['marketing_performance_facts', 'marketing_facts_append_only'],
      ['integration_delivery_attempts', 'integration_delivery_attempts_append_only'],
      ['integration_connection_config_versions', 'integration_config_versions_append_only'],
    ] as const;
    for (const [table, trigger] of protectedTriggers) {
      await database.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    }
    try {
      await database.marketingPerformanceFact.deleteMany({ where: { workspaceId, sourceProvider: "META_ADS" } });
      await database.integrationSyncCursor.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationDeliveryAttempt.deleteMany({ where: { workspaceId, syncRun: { connectionId: connection.id } } });
      await database.integrationSyncRun.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.externalObjectMapping.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationConnectionCapability.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationConnectionConfigVersion.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationSecretReference.deleteMany({ where: { workspaceId, connectionId: connection.id } });
      await database.integrationConnection.delete({ where: { id: connection.id } });
    } finally {
      for (const [table, trigger] of [...protectedTriggers].reverse()) {
        await database.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
      }
    }
  }
  const channel = await database.marketingChannel.findUnique({ where: { workspaceId_key: { workspaceId, key: "meta-ads" } }, select: { id: true } });
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

function fixtureAdapter() {
  let spend = "10.25";
  let videoViews = "100";
  const calls: string[] = [];
  const adapter = new MetaAdsReadAdapter({ sleep: async () => undefined, random: () => 0, fetcher: async (input, init) => {
    const url = new URL(String(input)); calls.push(`${init?.method}:${url.pathname}`);
    if (url.pathname.endsWith("/me")) return Response.json({ id: "123456", name: "Conta técnica fixture" });
    if (url.pathname.endsWith("/me/adaccounts")) return Response.json({ data: [{ id: "act_123456", account_id: "123456", name: "Politizai Fixture", account_status: 1, currency: "BRL", timezone_name: "America/Sao_Paulo" }] });
    if (url.pathname.endsWith("/act_123456")) return Response.json({ id: "act_123456", account_id: "123456", name: "Politizai Fixture", account_status: 1, currency: "BRL", timezone_name: "America/Sao_Paulo" });
    if (url.pathname.endsWith("/campaigns")) return Response.json({ data: [{ id: "200001", account_id: "123456", name: "Campanha Fixture", status: "ACTIVE" }] });
    if (url.pathname.endsWith("/adsets")) return Response.json({ data: [{ id: "300001", campaign_id: "200001", name: "Conjunto Fixture", status: "ACTIVE" }] });
    if (url.pathname.endsWith("/ads")) return Response.json({ data: [{ id: "400001", adset_id: "300001", name: "Anúncio Fixture", status: "ACTIVE", creative: { id: "500001", name: "Criativo Fixture" } }] });
    return Response.json({ data: [{ account_id: "123456", account_name: "Politizai Fixture", account_currency: "BRL", campaign_id: "200001", campaign_name: "Campanha Fixture", adset_id: "300001", adset_name: "Conjunto Fixture", ad_id: "400001", ad_name: "Anúncio Fixture", date_start: "2046-04-19", date_stop: "2046-04-19", spend, impressions: "1000", clicks: "100", inline_link_clicks: "80", actions: [{ action_type: "lead", value: "10" }, { action_type: "custom.future_action", value: "2" }, { action_type: "video_view", value: videoViews }], action_values: [{ action_type: "purchase", value: "500.00" }] }] });
  } });
  return { adapter, calls, updateSpend: (value: string) => { spend = value; }, updateVideoViews: (value: string) => { videoViews = value; } };
}

describe("CRM-40 conector Meta Ads read-only", () => {
  it("configura por referência, valida RBAC, sincroniza, versiona e mantém cursor commit-safe", async () => {
    const fixture = fixtureAdapter();
    const service = createMetaAdsService({ database, adapter: fixture.adapter, secrets: new EphemeralSecretResolver({ META_ADS_ACCESS_TOKEN: "fixture-only", META_ADS_APP_SECRET: "fixture-secret-only" }), now: () => now });
    await expect(service.screen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.configure(viewer, { displayName: "Negada", config: { graphApiVersion: "v26.0", selectedAccountIds: [], initialSince: "2046-04-01" } })).rejects.toBeInstanceOf(AccessDeniedError);
    const configured = await service.configure(admin, { displayName: "Meta Ads Fixture", config: { graphApiVersion: "v26.0", selectedAccountIds: ["act_123456"], initialSince: "2046-04-01", lookbackDays: 7, pageSize: 100, requestTimeoutMs: 2_000 } });
    expect(configured).toMatchObject({ status: "DRAFT", credentialsPending: false });
    const secretRows = await database.integrationSecretReference.findMany({ where: { workspaceId, connectionId: configured.id } });
    expect(secretRows.map((item) => item.referenceKey).sort()).toEqual(["META_ADS_ACCESS_TOKEN", "META_ADS_APP_SECRET"]);
    expect(JSON.stringify(secretRows)).not.toContain("fixture-only");
    await expect(service.testConnection(admin)).resolves.toMatchObject({ connected: true, accessibleAccounts: [{ id: "act_123456" }] });

    const first = await service.runSync(admin, { mode: "INITIAL", correlationId: "meta-initial-fixture-001" });
    expect(first).toMatchObject({ status: "SUCCEEDED", readCount: 1, createdCount: 1, updatedCount: 0 });
    const fact = await database.marketingPerformanceFact.findFirstOrThrow({ where: { workspaceId, sourceProvider: "META_ADS", providerExternalId: "400001" }, orderBy: { revision: "desc" } });
    expect(fact).toMatchObject({ spendCents: 1025n, impressions: 1000n, clicks: 100n, reach: 0n, reportedLeads: 10n, reportedRevenueCents: 50000n, providerApiVersion: "v26.0" });
    expect(fact.availableMetrics).toContain("spendCents");
    expect(fact.missingMetrics).toContain("reach");
    expect(await database.marketingProviderActionFact.count({ where: { workspaceId, performanceFactId: fact.id, classification: "UNKNOWN" } })).toBe(1);
    expect(await database.externalObjectMapping.count({ where: { workspaceId, connectionId: configured.id } })).toBe(5);
    const cursor = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: configured.id, objectType: "meta_ads_daily_insights" } });
    expect(cursor.cursor).toBe("2046-04-20");
    expect(fixture.calls.every((call) => call.startsWith("GET:https://graph.facebook.com") === false && call.startsWith("GET:/v26.0/"))).toBe(true);

    await expect(service.runSync(admin, { mode: "INITIAL", correlationId: "meta-initial-fixture-001" })).resolves.toMatchObject({ id: first.id, status: "SUCCEEDED" });
    expect(await database.marketingPerformanceFact.count({ where: { workspaceId, grainKey: fact.grainKey } })).toBe(1);

    fixture.updateSpend("12.00");
    const second = await service.runSync(admin, { mode: "INCREMENTAL", correlationId: "meta-incremental-fixture-002" });
    expect(second).toMatchObject({ status: "SUCCEEDED", createdCount: 1, updatedCount: 1 });
    const revisions = await database.marketingPerformanceFact.findMany({ where: { workspaceId, grainKey: fact.grainKey }, orderBy: { revision: "asc" } });
    expect(revisions.map((item) => item.spendCents)).toEqual([1025n, 1200n]);
    expect(revisions[1]?.supersedesFactId).toBe(revisions[0]?.id);
    expect(await database.auditLog.count({ where: { workspaceId, action: "integration.meta_ads.sync_completed" } })).toBe(2);

    const media = createMediaPerformanceService({ database, now: () => now });
    const beforeVideoChange = await media.getScreen(admin, { periodStart: "2046-04-19", periodEnd: "2046-04-19" });
    expect(beforeVideoChange.mediaBreakdown.creative.find((row) => row.label === "Criativo Fixture")).toMatchObject({ videoViews3s: 100, hookImpressions: 1000, hookRateBps: 1000 });

    fixture.updateVideoViews("300");
    const videoOnlySync = await service.runSync(admin, { mode: "INCREMENTAL", correlationId: "meta-video-only-fixture-004" });
    expect(videoOnlySync).toMatchObject({ status: "SUCCEEDED", createdCount: 1, updatedCount: 1, ignoredCount: 0 });
    const videoRevision = await database.marketingPerformanceFact.findFirstOrThrow({ where: { workspaceId, grainKey: fact.grainKey }, orderBy: { revision: "desc" } });
    expect(videoRevision).toMatchObject({ revision: 3, spendCents: 1200n, impressions: 1000n, supersedesFactId: revisions[1]!.id });
    expect(videoRevision.sourceEvidence).toMatchObject({ videoMetricVersion: "meta-3s-v1", videoViews3s: "300" });
    expect(await database.marketingProviderActionFact.findUniqueOrThrow({ where: { workspaceId_performanceFactId_actionType: { workspaceId, performanceFactId: videoRevision.id, actionType: "count:video_view" } } })).toMatchObject({ value: 300n });
    const afterVideoChange = await media.getScreen(admin, { periodStart: "2046-04-19", periodEnd: "2046-04-19" });
    expect(afterVideoChange.mediaBreakdown.creative.find((row) => row.label === "Criativo Fixture")).toMatchObject({ videoViews3s: 300, hookImpressions: 1000, hookRateBps: 3000, hookCoverageBps: 10000 });

    // A new synchronization with the same payload must not create another revision.
    expect(await service.runSync(admin, { mode: "INCREMENTAL", correlationId: "meta-video-unchanged-fixture-005" })).toMatchObject({ status: "SUCCEEDED", createdCount: 0, updatedCount: 0, ignoredCount: 1 });
    expect(await service.runSync(admin, { mode: "INCREMENTAL", correlationId: "meta-video-only-fixture-004" })).toMatchObject({ id: videoOnlySync.id, status: "SUCCEEDED" });
    expect(await database.marketingPerformanceFact.count({ where: { workspaceId, grainKey: fact.grainKey } })).toBe(3);

    const cursorBeforeFailure = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: configured.id, objectType: "meta_ads_daily_insights" } });
    const factCountBeforeFailure = await database.marketingPerformanceFact.count({ where: { workspaceId, sourceProvider: "META_ADS" } });
    const failingAdapter = new MetaAdsReadAdapter({ sleep: async () => undefined, random: () => 0, fetcher: async () => new Response(JSON.stringify({ error: { code: 2, is_transient: true } }), { status: 500 }) });
    const failingService = createMetaAdsService({ database, adapter: failingAdapter, secrets: new EphemeralSecretResolver({ META_ADS_ACCESS_TOKEN: "fixture-only" }), now: () => now });
    await expect(failingService.runSync(admin, { mode: "INCREMENTAL", correlationId: "meta-failure-fixture-003" })).rejects.toMatchObject({ code: expect.stringContaining("META_TRANSIENT") });
    const cursorAfterFailure = await database.integrationSyncCursor.findFirstOrThrow({ where: { workspaceId, connectionId: configured.id, objectType: "meta_ads_daily_insights" } });
    expect(cursorAfterFailure.cursor).toBe(cursorBeforeFailure.cursor);
    expect(await database.marketingPerformanceFact.count({ where: { workspaceId, sourceProvider: "META_ADS" } })).toBe(factCountBeforeFailure);
    expect(await database.integrationSyncRun.findFirstOrThrow({ where: { workspaceId, correlationId: "meta-failure-fixture-003" } })).toMatchObject({ status: "FAILED", errorClass: "TRANSIENT" });

    const connection = await database.integrationConnection.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId, key: "meta-ads" } } });
    const noCredentialAdapter = new MetaAdsReadAdapter({ fetcher: async () => { throw new Error("egress should not happen"); } });
    const noCredentialService = createMetaAdsService({ database, adapter: noCredentialAdapter, secrets: new EphemeralSecretResolver(), now: () => now });
    await noCredentialService.configure(admin, { displayName: "Meta Ads Fixture", revision: connection.revision, config: { graphApiVersion: "v26.0", selectedAccountIds: ["act_123456"], initialSince: "2046-04-01", lookbackDays: 7, pageSize: 100, requestTimeoutMs: 2_000 } });
    await expect(noCredentialService.testConnection(admin)).rejects.toMatchObject({ code: "META_CREDENTIALS_PENDING" });
    await expect(noCredentialService.screen(admin)).resolves.toMatchObject({ readiness: "PENDING_CREDENTIALS", externalValidation: false });
  });
});
