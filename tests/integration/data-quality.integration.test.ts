import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createDataQualityService } from "@/modules/data-quality/application/data-quality-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-61 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-61 requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2026-09-13T18:00:00.000Z");
const service = createDataQualityService({ database, authorization, now: () => clock });
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let sourceContactId: string;
let survivorContactId: string;
let movedLeadId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local")]);
  const ids = [randomUUID(), randomUUID()].sort(); sourceContactId = ids[0]!; survivorContactId = ids[1]!;
  await database.contact.createMany({ data: [
    { id: sourceContactId, workspaceId, preferredName: "Pessoa Origem CRM61", jobTitle: "Direção", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId },
    { id: survivorContactId, workspaceId, preferredName: "Pessoa Sobrevivente CRM61", origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId },
  ] });
  await database.contactPoint.createMany({ data: [
    { id: randomUUID(), workspaceId, contactId: sourceContactId, type: "EMAIL", originalValue: "crm61@example.invalid", normalizedValue: "crm61@example.invalid", verificationStatus: "VERIFIED", verifiedAt: clock, quality: "VALID", source: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId },
    { id: randomUUID(), workspaceId, contactId: survivorContactId, type: "EMAIL", originalValue: "crm61@example.invalid", normalizedValue: "crm61@example.invalid", verificationStatus: "VERIFIED", verifiedAt: clock, quality: "VALID", source: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId },
  ] });
  const [source, pipeline, queue] = await Promise.all([
    database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } }),
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null } }),
    database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null } }),
  ]);
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: pipeline.id, leadStageCode: "NEW", deletedAt: null } });
  const lead = await database.lead.create({ data: { workspaceId, contactId: sourceContactId, sourceId: source.id, latestSourceId: source.id, pipelineId: pipeline.id, currentStageId: stage.id, queueId: queue.id, routingQueueId: queue.id, fullName: "Lead relacional CRM-61", slaStartedAt: clock, slaDueAt: clock, lastActivityAt: clock, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  movedLeadId = lead.id;
});

afterAll(async () => database.$disconnect());

describe("CRM-61 qualidade, reconciliação e merge", () => {
  it("executa dry-run sem ocorrências e execução idempotente com regra versionada", async () => {
    const before = await database.dataQualityIssue.count({ where: { workspaceId } });
    const dry = await service.runScan(admin, { mode: "DRY_RUN", idempotencyKey: "crm61:test:dry:001" });
    expect(dry.detectedCount).toBeGreaterThan(0);
    expect(await database.dataQualityIssue.count({ where: { workspaceId } })).toBe(before);
    const [run, replay] = await Promise.all([
      service.runScan(admin, { mode: "EXECUTE", idempotencyKey: "crm61:test:scan:001" }),
      service.runScan(admin, { mode: "EXECUTE", idempotencyKey: "crm61:test:scan:001" }),
    ]);
    expect(replay.id).toBe(run.id);
    expect(await database.dataQualityRuleVersion.count({ where: { workspaceId, status: "ACTIVE" } })).toBe(7);
    expect(await database.duplicateCandidate.count({ where: { workspaceId, entityType: "CONTACT", status: "OPEN" } })).toBeGreaterThan(0);
    expect(await database.dataReconciliationResult.count({ where: { workspaceId } })).toBeGreaterThan(0);
  });

  it("mantém eventos e reconciliações append-only e bloqueia mutação sem permissão", async () => {
    const issue = await database.dataQualityIssue.findFirstOrThrow({ where: { workspaceId, status: "OPEN" } });
    await expect(service.issueAction(viewer, { issueId: issue.id, action: "RESOLVE", reason: "Tentativa sem autorização", expectedRevision: issue.revision })).rejects.toThrow();
    const updated = await service.issueAction(admin, { issueId: issue.id, action: "COMMENT", reason: "Evidência revisada manualmente.", expectedRevision: issue.revision });
    expect(updated.revision).toBe(issue.revision + 1);
    const event = await database.dataQualityIssueEvent.findFirstOrThrow({ where: { workspaceId, issueId: issue.id } });
    await expect(database.dataQualityIssueEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    const reconciliation = await database.dataReconciliationResult.findFirstOrThrow({ where: { workspaceId } });
    await expect(database.dataReconciliationResult.update({ where: { id: reconciliation.id }, data: { summary: "reescrita" } })).rejects.toThrow(/append-only/);
  });

  it("faz preview, seleção campo a campo, merge transacional e rollback pelo ledger", async () => {
    const candidate = await database.duplicateCandidate.findFirstOrThrow({ where: { workspaceId, entityType: "CONTACT", leftEntityId: sourceContactId, rightEntityId: survivorContactId } });
    const preview = await service.buildPreview(admin, { candidateId: candidate.id, survivorEntityId: survivorContactId });
    expect(preview.blockers).toEqual([]);
    expect(preview.relationships.leads).toBe(1);
    const planned = await service.createMergePlan(admin, { candidateId: candidate.id, survivorEntityId: survivorContactId, reason: "Identidade confirmada pela revisão operacional.", previewFingerprint: preview.previewFingerprint, decisions: [{ fieldPath: "jobTitle", strategy: "SOURCE" }] });
    expect(planned.plan.status).toBe("READY");
    const [applied, applyReplay] = await Promise.all([
      service.applyMerge(admin, { mergePlanId: planned.plan.id, expectedRevision: planned.plan.revision, idempotencyKey: "crm61:test:merge:001", confirmation: "CONFIRMAR MERGE" }),
      service.applyMerge(admin, { mergePlanId: planned.plan.id, expectedRevision: planned.plan.revision, idempotencyKey: "crm61:test:merge:001", confirmation: "CONFIRMAR MERGE" }),
    ]);
    expect(applied.type).toBe("APPLY");
    expect(applyReplay.id).toBe(applied.id);
    expect(await database.lead.findUniqueOrThrow({ where: { id: movedLeadId } })).toMatchObject({ contactId: survivorContactId });
    expect(await database.contact.findUniqueOrThrow({ where: { id: sourceContactId } })).toMatchObject({ status: "MERGED", mergedIntoContactId: survivorContactId });
    expect((await database.contact.findUniqueOrThrow({ where: { id: survivorContactId } })).jobTitle).toBe("Direção");
    const plan = await database.mergePlan.findUniqueOrThrow({ where: { id: planned.plan.id } });
    const [rollback, rollbackReplay] = await Promise.all([
      service.rollbackMerge(admin, { mergePlanId: plan.id, expectedRevision: plan.revision, idempotencyKey: "crm61:test:rollback:001", reason: "Reversão controlada para validar o ledger.", confirmation: "CONFIRMAR REVERSÃO" }),
      service.rollbackMerge(admin, { mergePlanId: plan.id, expectedRevision: plan.revision, idempotencyKey: "crm61:test:rollback:001", reason: "Reversão controlada para validar o ledger.", confirmation: "CONFIRMAR REVERSÃO" }),
    ]);
    expect(rollback.type).toBe("ROLLBACK");
    expect(rollbackReplay.id).toBe(rollback.id);
    expect(await database.lead.findUniqueOrThrow({ where: { id: movedLeadId } })).toMatchObject({ contactId: sourceContactId });
    expect(await database.contact.findUniqueOrThrow({ where: { id: sourceContactId } })).toMatchObject({ status: "ACTIVE", mergedIntoContactId: null });
    expect(await database.mergeExecution.count({ where: { workspaceId, mergePlanId: plan.id } })).toBe(2);
  });

  it("isola workspace e bloqueia merge quando há contrato histórico", async () => {
    await expect(service.getScreen({ ...admin, workspaceId: randomUUID() }, {})).rejects.toThrow();
    const contract = await database.commercialContract.findFirst({ where: { workspaceId } });
    if (!contract) return;
    const otherContact = await database.contact.findFirstOrThrow({ where: { workspaceId, id: { not: contract.primaryContactId }, status: "ACTIVE" } });
    const ids = [contract.primaryContactId, otherContact.id].sort();
    const candidate = await database.duplicateCandidate.create({ data: { id: randomUUID(), workspaceId, entityType: "CONTACT", leftEntityId: ids[0]!, rightEntityId: ids[1]!, fingerprint: randomUUID(), strength: "POSSIBLE", confidenceBps: 6000, evidence: { reasonCode: "TEST" }, detectedAt: clock, lastDetectedAt: clock } });
    const preview = await service.buildPreview(admin, { candidateId: candidate.id, survivorEntityId: otherContact.id });
    if (candidate.leftEntityId === contract.primaryContactId || candidate.rightEntityId === contract.primaryContactId) expect(preview.blockers.length).toBeGreaterThan(0);
  });
});
