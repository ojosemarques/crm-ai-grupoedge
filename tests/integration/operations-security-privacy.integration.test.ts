import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOperationsBackfillService } from "@/modules/operations/application/operations-backfill-service";
import { createOperationsService } from "@/modules/operations/application/operations-service";
import { TELEMETRY_CONTRACT_VERSION } from "@/modules/operations/domain/operations-contracts";
import { ensurePrivacyFoundation } from "@/modules/privacy/application/privacy-foundation";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { createSharedRateLimiter } from "@/shared/core/http/request-hardening";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-62 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-62 requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2026-09-13T18:00:00.000Z");
const service = createOperationsService({ database, authorization, now: () => clock });
let workspaceId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let closer: AuthenticatedContext;
let leadId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, manager, viewer, closer] = await Promise.all([context("admin@demo.politizai.local"), context("gestor@demo.politizai.local"), context("viewer@demo.politizai.local"), context("closer1@demo.politizai.local")]);
  const operationsRead = await database.permission.findUniqueOrThrow({ where: { key: "operations.read" } });
  await database.rolePermission.create({ data: { workspaceId, roleId: viewer.roleId, permissionId: operationsRead.id, scope: "WORKSPACE", createdByActorId: admin.actorId } });
  await database.$transaction((tx) => ensurePrivacyFoundation(tx, workspaceId, admin.actorId));
  const [source, pipeline, queue] = await Promise.all([
    database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } }),
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null } }),
    database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } }),
  ]);
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: pipeline.id, leadStageCode: "NEW", deletedAt: null } });
  const contact = await database.contact.create({ data: { workspaceId, preferredName: "Titular CRM-62", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const lead = await database.lead.create({ data: { workspaceId, contactId: contact.id, sourceId: source.id, latestSourceId: source.id, pipelineId: pipeline.id, currentStageId: stage.id, queueId: queue.id, routingQueueId: queue.id, fullName: "Titular CRM-62", slaStartedAt: clock, slaDueAt: clock, lastActivityAt: clock, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  leadId = lead.id;
});

afterAll(async () => database.$disconnect());

describe("CRM-62 observabilidade, segurança e privacidade operacional", () => {
  it("compartilha limite entre instâncias e resolve concorrência atomicamente", async () => {
    const namespace = "prod09:multi-instance";
    const subject = "203.0.113.44";
    const observedAt = new Date("2026-09-14T19:00:00.000Z");
    const left = createSharedRateLimiter(database, () => observedAt);
    const right = createSharedRateLimiter(database, () => observedAt);

    const results = await Promise.all([
      left.consume(namespace, subject, { limit: 2, windowMs: 60_000 }),
      right.consume(namespace, subject, { limit: 2, windowMs: 60_000 }),
      left.consume(namespace, subject, { limit: 2, windowMs: 60_000 }),
    ]);
    expect(results.filter((item) => item.allowed)).toHaveLength(2);
    expect(results.filter((item) => !item.allowed)).toHaveLength(1);

    const stored = await database.requestRateLimit.findFirstOrThrow({ where: { namespace } });
    expect(stored.requestCount).toBe(3);
    expect(stored.subjectHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.subjectHash).not.toContain(subject);

    await right.clear(namespace, subject);
    expect(await database.requestRateLimit.count({ where: { namespace } })).toBe(0);
  });

  it("persiste telemetria versionada com redaction central e labels allowlisted", async () => {
    const result = await service.recordTelemetry(admin, { contractVersion: TELEMETRY_CONTRACT_VERSION, kind: "TRACE", operation: "api.crm62.test", outcome: "SUCCESS", durationMs: 120, correlationId: "crm62:telemetry:001", labels: { route: "/api/operations", method: "GET", status_class: "2xx" }, metadata: { email: "titular@example.invalid", password: "segredo", safe: "local" }, occurredAt: clock });
    const stored = await database.telemetryRecord.findUniqueOrThrow({ where: { id: result.id } });
    expect(stored.metadata).toEqual({ email: "[REMOVIDO]", password: "[REMOVIDO]", safe: "local" });
    await expect(service.recordTelemetry(admin, { contractVersion: TELEMETRY_CONTRACT_VERSION, kind: "METRIC", operation: "api.invalid", outcome: "SUCCESS", correlationId: "crm62:telemetry:002", labels: { email: "x@example.invalid" }, occurredAt: clock })).rejects.toThrow("TELEMETRY_LABEL_NOT_ALLOWED");
  });

  it("calcula SLO e cria alerta deduplicado com cooldown mesmo sob concorrência", async () => {
    await database.job.create({ data: { workspaceId, type: "NOTIFICATION", status: "PENDING", idempotencyKey: "crm62:stale-job", runAt: new Date(clock.getTime() - 10 * 60_000), payload: { local: true }, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const [left, right] = await Promise.all([service.evaluateAlerts(manager, "crm62:alerts:001"), service.evaluateAlerts(manager, "crm62:alerts:001")]);
    expect(left.results.length + right.results.length).toBeGreaterThan(0);
    expect(await database.observabilityAlert.count({ where: { workspaceId, dedupKey: "jobs-stale:active" } })).toBe(1);
    expect(await database.observabilityAlert.count({ where: { workspaceId, dedupKey: "worker-stale:active" } })).toBe(1);
    const screen = await service.getScreen(manager, { page: 1, pageSize: 10, tab: "observability" });
    expect(screen.slos.some((item) => item.key === "api-availability" && item.result?.total === 1)).toBe(true);
    expect(screen.externalEgress).toBe(false);
    expect(screen.runtime.worker.state).toBe("STOPPED");
    expect(screen.runtime.jobs.pending).toBeGreaterThan(0);
    expect(screen.pagination).toMatchObject({ page: 1, pageSize: 10 });
  });

  it("conduz alerta e incidente com idempotência, concorrência e timeline append-only", async () => {
    const alert = await database.observabilityAlert.findFirstOrThrow({ where: { workspaceId, status: "OPEN" } });
    const [first, replay] = await Promise.all([
      service.createIncident(manager, { alertId: alert.id, title: "Fila local atrasada", impact: "Processamento operacional degradado.", owner: "Operações", reason: "Triagem humana confirmou impacto.", idempotencyKey: "crm62:incident:001" }),
      service.createIncident(manager, { alertId: alert.id, title: "Fila local atrasada", impact: "Processamento operacional degradado.", owner: "Operações", reason: "Triagem humana confirmou impacto.", idempotencyKey: "crm62:incident:001" }),
    ]);
    expect(replay.id).toBe(first.id);
    const investigating = await service.transitionIncident(manager, { incidentId: first.id, toStatus: "INVESTIGATING", note: "Investigação iniciada pelo gestor.", revision: first.revision });
    expect(investigating.status).toBe("INVESTIGATING");
    const event = await database.operationalIncidentEvent.findFirstOrThrow({ where: { workspaceId, incidentId: first.id } });
    await expect(database.operationalIncidentEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });

  it("governa DSR e destruição em dry-run respeitando identidade, hold e fatos imutáveis", async () => {
    const category = await database.dataCategory.findFirstOrThrow({ where: { workspaceId, active: true } });
    const [request, replay] = await Promise.all([
      service.createDsr(manager, { leadId, type: "DELETION", categoryIds: [category.id], reason: "Solicitação registrada para validação de identidade.", idempotencyKey: "crm62:dsr:001" }),
      service.createDsr(manager, { leadId, type: "DELETION", categoryIds: [category.id], reason: "Solicitação registrada para validação de identidade.", idempotencyKey: "crm62:dsr:001" }),
    ]);
    expect(replay.id).toBe(request.id);
    const preview = await service.previewDestruction(manager, { requestId: request.id, reason: "Avaliação de impacto antes de qualquer destruição.", idempotencyKey: "crm62:destruction:001" });
    expect(preview.status).toBe("BLOCKED");
    expect(preview.blockerCodes).toContain("IDENTITY_NOT_VERIFIED");
    expect(preview.blockerCodes).toContain("IMMUTABLE_COMMERCIAL_AND_AUDIT_FACTS");
    const event = await database.dataSubjectRequestEvent.findFirstOrThrow({ where: { workspaceId, requestId: request.id } });
    await expect(database.dataSubjectRequestEvent.update({ where: { id: event.id }, data: { reason: "reescrita" } })).rejects.toThrow(/append-only/);
  });

  it("executa checkpoint idempotente e bloqueia viewer e outro workspace", async () => {
    const [job, replay] = await Promise.all([
      service.runRetentionCheckpoint(manager, { idempotencyKey: "crm62:retention:001", batchSize: 50 }),
      service.runRetentionCheckpoint(manager, { idempotencyKey: "crm62:retention:001", batchSize: 50 }),
    ]);
    expect(replay.id).toBe(job.id);
    expect(job.result).toMatchObject({ destructiveExecution: false });
    const observerScreen = await service.getScreen(viewer);
    expect(observerScreen.privacy).toBeNull();
    expect(observerScreen.security).toBeNull();
    await expect(service.getScreen(closer)).rejects.toThrow();
    await expect(service.getScreen({ ...manager, workspaceId: randomUUID() })).rejects.toThrow();
    const integrity = await service.auditIntegrity(workspaceId);
    expect(integrity).toMatchObject({ valid: true, orphanActors: 0, immutableTriggers: 2 });
  });

  it("faz backfill conservador de eventos DSR e limpa o replay por idempotência", async () => {
    const lead = await database.lead.findUniqueOrThrow({ where: { id: leadId }, select: { contactId: true } });
    const legacy = await database.dataSubjectRequest.create({ data: { workspaceId, contactId: lead.contactId!, type: "ACCESS", status: "IN_REVIEW", receivedChannel: "OTHER", verificationStatus: "VERIFIED", verificationMethod: "desafio local", verificationReference: "referência minimizada", verifiedAt: new Date(clock.getTime() - 43_200_000), ownerMemberId: manager.memberId, reason: "Registro anterior à timeline CRM-62.", requestedAt: new Date(clock.getTime() - 86_400_000), dueAt: new Date(clock.getTime() + 86_400_000), createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const backfill = createOperationsBackfillService({ database, authorization, now: () => clock });
    const dryRun = await backfill.run(admin, { mode: "DRY_RUN", batchSize: 100 });
    expect(dryRun).toMatchObject({ candidateCount: 1, createdCount: 0, destructive: false });
    expect(await database.dataSubjectRequestEvent.count({ where: { requestId: legacy.id } })).toBe(0);
    const executed = await backfill.run(admin, { mode: "EXECUTE", batchSize: 100 });
    expect(executed).toMatchObject({ candidateCount: 1, createdCount: 1, destructive: false });
    const replay = await backfill.run(admin, { mode: "EXECUTE", batchSize: 100 });
    expect(replay).toMatchObject({ candidateCount: 0, createdCount: 0, destructive: false });
  });
});
