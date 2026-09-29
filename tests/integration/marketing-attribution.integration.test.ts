import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const now = new Date("2046-04-20T15:00:00.000Z");
let workspaceId: string; let admin: AuthenticatedContext; let viewer: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local")]);
});
afterAll(() => database.$disconnect());

async function createSubmission(label: string) {
  const source = await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } });
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null } });
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: pipeline.id, type: "OPEN", deletedAt: null }, orderBy: { position: "asc" } });
  const queue = await database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } });
  const contact = await database.contact.create({ data: { workspaceId, preferredName: label, origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const lead = await database.lead.create({ data: { workspaceId, contactId: contact.id, sourceId: source.id, pipelineId: pipeline.id, currentStageId: stage.id, queueId: queue.id, routingQueueId: queue.id, fullName: label, slaStartedAt: now, slaDueAt: now, lastActivityAt: now, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  return database.leadFormSubmission.create({ data: { workspaceId, leadId: lead.id, contactId: contact.id, sourceId: source.id, status: "LINKED", channel: "MANUAL", intakeOutcome: "CREATED", idempotencyKey: `submission-${randomUUID()}`, submittedFullName: label, submittedAt: now, rawPayload: { test: true }, createdByActorId: admin.actorId } });
}

describe("CRM-38 jornada e atribuição multi-touch", () => {
  it("mantém definições/modelos versionados e RBAC granular", async () => {
    const service = createMarketingAttributionService({ database, now: () => now });
    await expect(service.getScreen(viewer)).resolves.toMatchObject({ permissions: { canExecute: false, canManageModels: false, canReview: false } });
    await expect(service.runAttribution(viewer, { modelKey: "linear", periodStart: new Date(now.getTime() - 86_400_000), periodEnd: now, idempotencyKey: `viewer-${randomUUID()}` })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.getScreen({ ...admin, workspaceId: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await database.attributionModel.count({ where: { workspaceId } })).toBe(3);
    expect(await database.attributionModelVersion.count({ where: { workspaceId } })).toBe(3);
  });

  it("calcula first, last e linear com 10.000 bps e replay idempotente", async () => {
    const service = createMarketingAttributionService({ database, now: () => now });
    const submission = await createSubmission("Atribuição completa");
    const conversion = await database.attributionConversion.create({ data: { workspaceId, kind: "LEAD_RECEIVED", leadId: submission.leadId, contactId: submission.contactId, submissionId: submission.id, occurredAt: now, sourceEventType: "IntegrationTest", sourceEventId: randomUUID(), idempotencyKey: `conversion-${randomUUID()}`, evidenceClass: "DIRECT", correlationId: randomUUID(), createdByActorId: admin.actorId } });
    for (const [index, offset] of [2, 1].entries()) await database.marketingTouchpoint.create({ data: { workspaceId, leadId: submission.leadId, contactId: submission.contactId, kind: "AD_CLICK", evidenceClass: "DIRECT", occurredAt: new Date(now.getTime() - offset * 3_600_000), privacyDecision: "ALLOW", attributionEligible: true, idempotencyKey: `touch-${conversion.id}-${index}`, correlationId: conversion.correlationId, createdByActorId: admin.actorId } });
    for (const modelKey of ["first-touch", "last-touch", "linear"] as const) {
      const key = `run-${modelKey}-${randomUUID()}`;
      const result = await service.runAttribution(admin, { modelKey, periodStart: new Date(now.getTime() - 86_400_000), periodEnd: new Date(now.getTime() + 1), idempotencyKey: key });
      const credits = await database.attributionCredit.findMany({ where: { workspaceId, attributionRunId: result.id, conversionId: conversion.id } });
      expect(credits.reduce((sum, credit) => sum + credit.creditBps, 0)).toBe(10_000);
      expect((await service.runAttribution(admin, { modelKey, periodStart: new Date(now.getTime() - 86_400_000), periodEnd: new Date(now.getTime() + 1), idempotencyKey: key })).idempotentReplay).toBe(true);
    }
  });

  it("registra ausência explicitamente e bloqueia mutação de fatos", async () => {
    const service = createMarketingAttributionService({ database, now: () => now });
    const conversion = await database.attributionConversion.create({ data: { workspaceId, kind: "QUALIFIED", occurredAt: new Date(now.getTime() + 10_000), sourceEventType: "IntegrationTestUnknown", sourceEventId: randomUUID(), idempotencyKey: `unknown-${randomUUID()}`, evidenceClass: "DIRECT", correlationId: randomUUID(), createdByActorId: admin.actorId } });
    const run = await service.runAttribution(admin, { modelKey: "last-touch", periodStart: now, periodEnd: new Date(now.getTime() + 20_000), idempotencyKey: `unknown-run-${randomUUID()}` });
    await expect(database.attributionCredit.findFirstOrThrow({ where: { attributionRunId: run.id, conversionId: conversion.id } })).resolves.toMatchObject({ touchpointId: null, coverageState: "UNATTRIBUTED", creditBps: 10_000 });
    await expect(database.attributionConversion.update({ where: { id: conversion.id }, data: { status: "CANCELLED" } })).rejects.toThrow(/append-only/);
  });

  it("faz backfill dry-run, execute e replay sem inventar elegibilidade", async () => {
    const service = createMarketingAttributionService({ database, now: () => now });
    await createSubmission("Backfill conservador");
    const dry = await service.backfill(admin, { mode: "DRY_RUN", limit: 500, idempotencyKey: `dry-${randomUUID()}` });
    expect(dry.candidateCount).toBeGreaterThan(0); expect(dry.createdCount).toBe(0);
    const key = `execute-${randomUUID()}`;
    const executed = await service.backfill(admin, { mode: "EXECUTE", limit: 500, idempotencyKey: key });
    expect(executed.createdCount + executed.existingCount).toBe(executed.candidateCount);
    expect((await service.backfill(admin, { mode: "EXECUTE", limit: 500, idempotencyKey: key })).idempotentReplay).toBe(true);
    const legacy = await database.marketingTouchpoint.findFirstOrThrow({ where: { workspaceId, evidenceClass: "LEGACY_REVIEW_REQUIRED" } });
    expect(legacy).toMatchObject({ privacyDecision: "REVIEW_REQUIRED", attributionEligible: false });
  });
});
