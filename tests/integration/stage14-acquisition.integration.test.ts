import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAcquisitionConnectionService } from "@/modules/acquisition-api/application/acquisition-connection-service";
import { createAcquisitionWebhookService } from "@/modules/acquisition-api/application/acquisition-webhook-service";
import { createConversionFeedbackService } from "@/modules/conversion-feedback/application/conversion-feedback-service";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Stage 14 integration tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 14 integration tests require an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const now = new Date("2048-06-01T15:00:00.000Z");
const formSecret = "stage14-form-secret-used-only-in-memory";
const metaSecret = "stage14-meta-secret-used-only-in-memory";
const secrets = new EphemeralSecretResolver({
  ACQUISITION_STAGE14_FORM_SECRET: formSecret,
  META_ADS_STAGE14_WEBHOOK_SECRET: metaSecret,
  META_ADS_STAGE14_VERIFY_TOKEN: "stage14-meta-verify-token",
  META_ADS_STAGE14_ENRICHMENT_TOKEN: "stage14-meta-enrichment-token",
});
const authorization = createAuthorizationService({ database });
const intake = createLeadIntakeService({ database, authorization, now: () => now });
const connections = createAcquisitionConnectionService(database, secrets);
const webhooks = createAcquisitionWebhookService({ database, secrets, intake, now: () => now, fetcher: fetch });

let admin: AuthenticatedContext;
let sourceKey: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspace: { slug: "politizai" }, user: { normalizedEmail: email } },
    include: { workspace: true, user: true, role: true },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

function formSignature(rawBody: string, timestamp: string) {
  return createHmac("sha256", formSecret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function metaSignature(rawBody: string) {
  return `sha256=${createHmac("sha256", metaSecret).update(rawBody).digest("hex")}`;
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  admin = await context("admin@demo.politizai.local");
  sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, deletedAt: null }, orderBy: { createdAt: "asc" } })).key;
});

afterAll(async () => database.$disconnect());

describe("Etapa 14 — aquisição integrada", () => {
  it("deduplica replay e ignora evento fora de ordem sem criar outro lead ou venda", async () => {
    const key = `stage14-form-${randomUUID().slice(0, 8)}`;
    const configured = await connections.configure(admin, {
      key,
      displayName: "Formulário integrado etapa 14",
      provider: "FORM",
      sourceKey,
      secretReferenceKey: "ACQUISITION_STAGE14_FORM_SECRET",
      mapping: { fullName: "lead.name", phone: "lead.phone", email: "lead.email", consent: "lead.consent", utmSource: "tracking.utmSource" },
      definition: { name: "Formulário integrado etapa 14" },
    });
    await connections.command(admin, { action: "ACTIVATE", connectionId: configured.id, revision: 1 });

    const submissionId = `submission-${randomUUID()}`;
    const eventId = `event-${randomUUID()}`;
    const timestamp = now.toISOString();
    const rawBody = JSON.stringify({
      eventId,
      submissionId,
      occurredAt: "2048-06-01T14:59:00.000Z",
      lead: { name: "Lead integrado etapa 14", phone: "+5511999981414", email: "stage14@example.test", consent: "sim" },
      tracking: { utmSource: "integration-test" },
    });
    const headers = { timestamp, signature: formSignature(rawBody, timestamp) };

    const first = await webhooks.receive({ workspaceSlug: admin.workspaceSlug, connectionKey: key, rawBody, headers });
    const replay = await webhooks.receive({ workspaceSlug: admin.workspaceSlug, connectionKey: key, rawBody, headers });
    expect(first).toMatchObject({ status: "PROCESSED", idempotentReplay: false, leadId: expect.any(String) });
    expect(replay).toMatchObject({ inboxId: first.inboxId, status: "PROCESSED", idempotentReplay: true });

    const beforeOlder = await database.lead.count({ where: { workspaceId: admin.workspaceId } });
    const olderBody = JSON.stringify({
      eventId: `event-${randomUUID()}`,
      submissionId,
      occurredAt: "2048-05-31T14:59:00.000Z",
      lead: { name: "Nome antigo que não pode vencer", phone: "+5511999981414", email: "old-stage14@example.test" },
    });
    const older = await webhooks.receive({
      workspaceSlug: admin.workspaceSlug,
      connectionKey: key,
      rawBody: olderBody,
      headers: { timestamp, signature: formSignature(olderBody, timestamp) },
    });
    expect(older).toMatchObject({ status: "IGNORED", reason: "OUT_OF_ORDER" });
    expect(await database.lead.count({ where: { workspaceId: admin.workspaceId } })).toBe(beforeOlder);
    expect(await database.webhookInbox.count({ where: { workspaceId: admin.workspaceId, connectionId: configured.id } })).toBe(2);
    expect(await database.externalObjectMapping.count({ where: { workspaceId: admin.workspaceId, connectionId: configured.id, externalId: submissionId } })).toBe(1);
    expect(await database.outboxEvent.count({ where: { workspaceId: admin.workspaceId, connectionId: configured.id, correlationId: eventId } })).toBe(1);
  });

  it("versiona, restaura o mapeamento e revoga todas as credenciais da conexão", async () => {
    const key = `stage14-rollback-${randomUUID().slice(0, 8)}`;
    const configured = await connections.configure(admin, {
      key,
      displayName: "Rollback integrado etapa 14",
      provider: "FORM",
      sourceKey,
      secretReferenceKey: "ACQUISITION_STAGE14_FORM_SECRET",
      mapping: { fullName: "lead.name", phone: "lead.phone" },
    });
    const activated = await connections.command(admin, { action: "ACTIVATE", connectionId: configured.id, revision: 1 });
    const updated = await connections.command(admin, { action: "UPDATE_MAPPING", connectionId: configured.id, revision: activated.revision, mapping: { fullName: "person.fullName", phone: "person.mobile", email: "person.email" } });
    const rolledBack = await connections.command(admin, { action: "ROLLBACK_MAPPING", connectionId: configured.id, revision: updated.revision, targetVersion: 1, reason: "Ensaio integrado de rollback" });

    const versions = await database.integrationFieldMappingVersion.findMany({ where: { workspaceId: admin.workspaceId, connectionId: configured.id, objectType: "lead" }, orderBy: { version: "asc" } });
    expect(versions.map(({ version, active }) => ({ version, active }))).toEqual([{ version: 1, active: true }, { version: 2, active: true }, { version: 3, active: true }]);
    expect(versions[2]?.mapping).toEqual(versions[0]?.mapping);
    expect(versions[1]?.mapping).not.toEqual(versions[2]?.mapping);

    const revoked = await connections.command(admin, { action: "REVOKE", connectionId: configured.id, revision: rolledBack.revision, reason: "Ensaio integrado de revogação" });
    expect(revoked).toMatchObject({ status: "PAUSED", enabled: false });
    expect(await database.integrationSecretReference.count({ where: { workspaceId: admin.workspaceId, connectionId: configured.id, present: true, disabledAt: null } })).toBe(0);
    await expect(database.auditLog.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, entityId: versions[2]!.id, action: "acquisition.mapping.rolled_back", reason: "Ensaio integrado de rollback" } })).resolves.toBeDefined();
    await expect(database.auditLog.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, entityId: configured.id, action: "acquisition.connection.revoked", reason: "Ensaio integrado de revogação" } })).resolves.toBeDefined();

    const blockedBody = JSON.stringify({ eventId: `event-${randomUUID()}`, submissionId: `submission-${randomUUID()}`, occurredAt: now.toISOString(), lead: { name: "Não deve entrar", phone: "+5511999981515" } });
    await expect(webhooks.receive({ workspaceSlug: admin.workspaceSlug, connectionKey: key, rawBody: blockedBody, headers: { timestamp: now.toISOString(), signature: formSignature(blockedBody, now.toISOString()) } })).rejects.toMatchObject({ code: "ACQUISITION_WEBHOOK_NOT_FOUND" });
  });

  it("decompõe lote Meta assinado e persiste cada lead uma única vez", async () => {
    const key = `stage14-meta-${randomUUID().slice(0, 8)}`;
    const configured = await connections.configure(admin, {
      key,
      displayName: "Meta Lead Ads integrada etapa 14",
      provider: "META_LEAD_ADS",
      sourceKey,
      secretReferenceKey: "META_ADS_STAGE14_WEBHOOK_SECRET",
      verificationTokenReferenceKey: "META_ADS_STAGE14_VERIFY_TOKEN",
      enrichmentTokenReferenceKey: "META_ADS_STAGE14_ENRICHMENT_TOKEN",
      mapping: { fullName: "fields.full_name", phone: "fields.phone_number", email: "fields.email" },
    });
    await connections.command(admin, { action: "ACTIVATE", connectionId: configured.id, revision: 1 });

    const firstLeadgenId = `leadgen-${randomUUID()}`;
    const secondLeadgenId = `leadgen-${randomUUID()}`;
    const body = {
      object: "page",
      entry: [{
        id: "page-stage14",
        time: Math.floor(now.getTime() / 1000),
        changes: [
          { field: "leadgen", value: { leadgen_id: firstLeadgenId, created_time: Math.floor(now.getTime() / 1000), field_data: [{ name: "full_name", values: ["Lead Meta Um"] }, { name: "phone_number", values: ["+5511999981616"] }, { name: "email", values: ["meta-one@example.test"] }] } },
          { field: "leadgen", value: { leadgen_id: secondLeadgenId, created_time: Math.floor(now.getTime() / 1000) + 1, field_data: [{ name: "full_name", values: ["Lead Meta Dois"] }, { name: "phone_number", values: ["+5511999981717"] }, { name: "email", values: ["meta-two@example.test"] }] } },
        ],
      }],
    };
    const rawBody = JSON.stringify(body);
    const first = await webhooks.receive({ workspaceSlug: admin.workspaceSlug, connectionKey: key, rawBody, headers: { signature: metaSignature(rawBody) } });
    const replay = await webhooks.receive({ workspaceSlug: admin.workspaceSlug, connectionKey: key, rawBody, headers: { signature: metaSignature(rawBody) } });

    expect(first).toMatchObject({ status: "BATCH_PROCESSED", processed: 2, results: [{ status: "PROCESSED" }, { status: "PROCESSED" }] });
    expect(replay).toMatchObject({ status: "BATCH_PROCESSED", processed: 2, results: [{ idempotentReplay: true }, { idempotentReplay: true }] });
    expect(await database.webhookInbox.count({ where: { workspaceId: admin.workspaceId, connectionId: configured.id } })).toBe(2);
    expect(await database.externalObjectMapping.count({ where: { workspaceId: admin.workspaceId, connectionId: configured.id, externalId: { in: [firstLeadgenId, secondLeadgenId] } } })).toBe(2);
  });

  it("entrega uma conversão Meta elegível uma única vez e persiste o recibo externo", async () => {
    const leadResult = await intake.intake({
      channel: "FORM",
      idempotencyKey: `stage14-capi-lead-${randomUUID()}`,
      formIdentifier: "stage14-capi-fixture",
      fullName: "Lead CAPI integrado",
      phone: "+5511999981818",
      email: "capi-stage14@example.test",
      sourceKey,
      consent: true,
      submittedAt: now,
      rawPayload: { fixture: "stage14-capi" },
      priorityBandCode: "P3",
    }, admin);
    if (leadResult.outcome === "REJECTED") throw new Error(`Fixture CAPI rejeitada: ${leadResult.code}`);
    const lead = await database.lead.findUniqueOrThrow({ where: { id: leadResult.leadId }, select: { id: true, contactId: true } });
    if (!lead.contactId) throw new Error("Fixture CAPI sem contato canônico.");

    const legalBasis = await database.legalBasis.create({ data: {
      workspaceId: admin.workspaceId,
      code: `meta-capi-consent-${randomUUID()}`,
      version: 1,
      basisType: "CONSENT",
      name: "Consentimento Meta CAPI",
      description: "Base legal de teste integrada",
      status: "ACTIVE",
      validFrom: new Date("2048-01-01T00:00:00.000Z"),
      approvalReference: "stage14-integration-fixture",
      approvedByActorId: admin.actorId,
      approvedAt: now,
      createdByActorId: admin.actorId,
    } });
    const purpose = await database.processingPurpose.create({ data: {
      workspaceId: admin.workspaceId,
      code: "marketing-conversion-feedback",
      name: "Feedback de conversão Meta",
      description: "Finalidade explícita para o sinal de conversão",
      active: true,
      createdByActorId: admin.actorId,
      updatedByActorId: admin.actorId,
    } });
    const purposeVersion = await database.purposeVersion.create({ data: {
      workspaceId: admin.workspaceId,
      purposeId: purpose.id,
      legalBasisId: legalBasis.id,
      version: 1,
      description: "Conversão Meta com consentimento explícito",
      audience: "Leads com consentimento",
      allowedChannels: ["OTHER"],
      noticeText: "Uso do evento para mensuração de campanha.",
      noticeVersion: "stage14-v1",
      status: "ACTIVE",
      materiallyChanged: false,
      validFrom: new Date("2048-01-01T00:00:00.000Z"),
      approvedByActorId: admin.actorId,
      approvedAt: now,
      createdByActorId: admin.actorId,
    } });
    await database.consentState.create({ data: {
      workspaceId: admin.workspaceId,
      contactId: lead.contactId,
      purposeId: purpose.id,
      channel: "OTHER",
      state: "GRANTED",
      effectiveFrom: new Date("2048-05-01T00:00:00.000Z"),
      policyVersion: purposeVersion.noticeVersion,
      reasonCode: "EXPLICIT_STAGE14_FIXTURE",
    } });

    const metaConnection = await database.integrationConnection.create({ data: {
      workspaceId: admin.workspaceId,
      key: "meta-ads",
      providerKey: "META_ADS",
      adapterKey: "meta-ads-read-v1",
      displayName: "Meta Ads CAPI fixture",
      environment: "HOMOLOGATION",
      status: "CONNECTED",
      capabilityLevel: "CONNECTED",
      currentConfigVersion: 1,
      enabled: true,
      lastTestedAt: now,
      createdByActorId: admin.actorId,
      updatedByActorId: admin.actorId,
    } });
    await database.integrationConnectionConfigVersion.create({ data: {
      workspaceId: admin.workspaceId,
      connectionId: metaConnection.id,
      version: 1,
      schemaVersion: "1.0",
      config: { graphApiVersion: "v26.0", selectedAccountIds: ["act_123456"], initialSince: "2048-05-01", lookbackDays: 7, pageSize: 100, requestTimeoutMs: 2_000 },
      configHash: "a".repeat(64),
      createdByActorId: admin.actorId,
    } });
    await database.integrationConnectionCapability.create({ data: { workspaceId: admin.workspaceId, connectionId: metaConnection.id, capability: "SYNC_PUSH", enabled: true } });

    let conversion = await database.attributionConversion.findFirst({ where: { workspaceId: admin.workspaceId, leadId: lead.id, kind: "LEAD_RECEIVED", status: "ACTIVE" } });
    conversion ??= await database.attributionConversion.create({ data: {
      workspaceId: admin.workspaceId,
      kind: "LEAD_RECEIVED",
      contactId: lead.contactId,
      leadId: lead.id,
      occurredAt: now,
      sourceEventType: "Stage14CapiIntegration",
      sourceEventId: randomUUID(),
      idempotencyKey: `stage14-capi-conversion-${randomUUID()}`,
      evidenceClass: "DIRECT",
      evidence: { fixture: true },
      correlationId: randomUUID(),
      createdByActorId: admin.actorId,
    } });

    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const conversionService = createConversionFeedbackService({
      database,
      secrets: new EphemeralSecretResolver({ META_ADS_ACCESS_TOKEN: "meta-capi-token-in-memory", META_ADS_DATASET_ID: "123456789" }),
      now: () => now,
      fetcher: async (input, init) => {
        fetchCalls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({ events_received: 1, fbtrace_id: "trace-stage14" });
      },
    });
    const request = { conversionId: conversion.id, eventName: "Lead" as const, idempotencyKey: `meta-conversion-${randomUUID()}` };
    const queued = await conversionService.queueMetaConversion(admin, request);
    const replay = await conversionService.queueMetaConversion(admin, { ...request, idempotencyKey: `meta-conversion-${randomUUID()}` });
    expect(replay).toMatchObject({ id: queued.id, status: "PENDING", idempotentReplay: true });

    await expect(conversionService.processNext("stage14-meta-worker")).resolves.toEqual({ status: "DELIVERED_EXTERNAL", id: queued.id });
    await expect(conversionService.processNext("stage14-meta-worker-replay")).resolves.toEqual({ status: "IDLE" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({ url: "https://graph.facebook.com/v26.0/123456789/events", body: { data: [{ event_id: expect.any(String), event_name: "Lead" }], access_token: "meta-capi-token-in-memory" } });
    expect(await database.outboxEvent.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "DELIVERED_EXTERNAL", attempts: 1, deliveredExternallyAt: now, deliveredLocallyAt: null });
    expect(await database.integrationDeliveryAttempt.findMany({ where: { workspaceId: admin.workspaceId, outboxId: queued.id } })).toEqual([expect.objectContaining({ kind: "OUTBOX", attemptNumber: 1, status: "SUCCEEDED", resultMetadata: { provider: "META", eventsReceived: 1, traceIdPresent: true } })]);
    expect(await database.outboxEvent.count({ where: { workspaceId: admin.workspaceId, aggregateId: conversion.id, eventType: "marketing.meta_conversion.v1" } })).toBe(1);
  });
});
