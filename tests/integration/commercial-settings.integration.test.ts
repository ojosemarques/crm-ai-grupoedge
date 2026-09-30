import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createCommercialSettingsService } from "@/modules/settings/application/commercial-settings-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for settings integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 10 }) });
const authorization = createAuthorizationService({ database });

let admin: AuthenticatedContext;
let sdr: AuthenticatedContext;
let workspaceId: string;
let otherWorkspaceId: string;
let leadId: string;
let scoringRuleId: string;

function service(beforeCommit?: () => Promise<void>) {
  return createCommercialSettingsService({ database, authorization, ...(beforeCommit ? { beforeCommit } : {}) });
}

async function createPerson(input: { workspaceId: string; workspaceSlug: string; actorId: string; roleId: string; roleKey: string; label: string }) {
  const suffix = randomUUID();
  const user = await database.user.create({ data: { email: `${input.label}.${suffix}@settings.test`, normalizedEmail: `${input.label}.${suffix}@settings.test`, displayName: input.label } });
  const member = await database.workspaceMember.create({ data: { workspaceId: input.workspaceId, userId: user.id, roleId: input.roleId, status: "ACTIVE", joinedAt: new Date(), createdByActorId: input.actorId, updatedByActorId: input.actorId } });
  const actor = await database.actor.create({ data: { workspaceId: input.workspaceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: input.label } });
  return Object.freeze({ sessionId: randomUUID(), workspaceId: input.workspaceId, workspaceSlug: input.workspaceSlug, userId: user.id, memberId: member.id, actorId: actor.id, roleId: input.roleId, roleKey: input.roleKey, roleName: input.roleKey, displayName: input.label });
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({ data: { slug: `settings-${suffix}`, name: "Configurações isoladas" } });
  workspaceId = workspace.id;
  const system = await database.actor.create({ data: { workspaceId, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  const permission = await database.permission.upsert({ where: { key: PermissionKeys.WORKSPACE_MANAGE }, update: {}, create: { key: PermissionKeys.WORKSPACE_MANAGE, description: "Gerenciar workspace" } });
  const adminRole = await database.role.create({ data: { workspaceId, key: "administrator", name: "Administrador", createdByActorId: system.id, updatedByActorId: system.id } });
  const sdrRole = await database.role.create({ data: { workspaceId, key: "sdr", name: "SDR", createdByActorId: system.id, updatedByActorId: system.id } });
  await database.rolePermission.create({ data: { workspaceId, roleId: adminRole.id, permissionId: permission.id, scope: "WORKSPACE", createdByActorId: system.id } });
  admin = await createPerson({ workspaceId, workspaceSlug: workspace.slug, actorId: system.id, roleId: adminRole.id, roleKey: "administrator", label: "Admin settings" });
  sdr = await createPerson({ workspaceId, workspaceSlug: workspace.slug, actorId: system.id, roleId: sdrRole.id, roleKey: "sdr", label: "SDR settings" });
  await database.commercialSettingsVersion.create({ data: { workspaceId, revision: 1, pactoMinimumInvestigatedDimensions: 5, defaultMeetingDurationMinutes: 30, distributionStrategy: "ROUND_ROBIN", leadStagnationDays: 7, leadWithoutActivityDays: 3, createdByActorId: system.id, cadence: { create: [0, 1, 3].map((dayOffset, index) => ({ attemptNumber: index + 1, dayOffset })) } } });
  const scoring = await database.scoringRuleVersion.create({ data: { workspaceId, key: "test-score", version: 1, algorithmKey: "pacto-weighted-v1", createdByActorId: system.id } });
  scoringRuleId = scoring.id;
  for (const [position, row] of ([
    ["P1", 70, 100, "URGENT", "p1"], ["P2", 40, 69, "HIGH", "p2"], ["P3", 0, 39, "MEDIUM", "p3"],
  ] as const).entries()) {
    const [code, scoreMin, scoreMax, leadPriority, key] = row;
    const policy = await database.slaPolicy.create({ data: { workspaceId, key, name: "SLA imediato — 0 minutos", firstResponseMinutes: 0, warningMinutesBeforeDue: 0, healthyMaxSeconds: 60, attentionMaxSeconds: 180, createdByActorId: system.id, updatedByActorId: system.id } });
    await database.leadPriorityBand.create({ data: { workspaceId, slaPolicyId: policy.id, code, name: code, position, scoreMin, scoreMax, leadPriority, createdByActorId: system.id, updatedByActorId: system.id } });
  }
  const source = await database.leadSource.create({ data: { workspaceId, key: "manual", name: "Manual", type: "MANUAL", createdByActorId: system.id, updatedByActorId: system.id } });
  const pipeline = await database.pipeline.create({ data: { workspaceId, name: "Pré-vendas editável", entityType: "LEAD", isDefault: true, createdByActorId: system.id, updatedByActorId: system.id } });
  const firstStage = await database.pipelineStage.create({ data: { workspaceId, pipelineId: pipeline.id, name: "Novo", position: 0, type: "OPEN", leadStageCode: "NEW", createdByActorId: system.id, updatedByActorId: system.id } });
  const secondStage = await database.pipelineStage.create({ data: { workspaceId, pipelineId: pipeline.id, name: "Contato", position: 1, type: "OPEN", leadStageCode: "TRYING_CONTACT", createdByActorId: system.id, updatedByActorId: system.id } });
  await database.pipelineStageTransition.createMany({ data: [
    { workspaceId, pipelineId: pipeline.id, fromStageId: firstStage.id, toStageId: secondStage.id, createdByActorId: system.id, updatedByActorId: system.id },
    { workspaceId, pipelineId: pipeline.id, fromStageId: secondStage.id, toStageId: firstStage.id, createdByActorId: system.id, updatedByActorId: system.id },
  ] });
  const disqualification = await database.disqualificationReason.create({ data: { workspaceId, key: "legacy", name: "Motivo em uso", position: 0, createdByActorId: system.id, updatedByActorId: system.id } });
  await database.lossReason.create({ data: { workspaceId, key: "lost", name: "Motivo de perda", position: 0, createdByActorId: system.id, updatedByActorId: system.id } });
  const product = await database.product.create({ data: { workspaceId, sku: "TEST-001", name: "Produto teste", listPriceCents: 10_000n, createdByActorId: system.id, updatedByActorId: system.id } });
  await database.offerTemplate.create({ data: { workspaceId, productId: product.id, key: "basic", name: "Plano básico", priceCents: 10_000n, createdByActorId: system.id, updatedByActorId: system.id } });
  const now = new Date("2036-01-01T12:00:00.000Z");
  const lead = await database.lead.create({ data: { workspaceId, sourceId: source.id, pipelineId: pipeline.id, currentStageId: firstStage.id, ownerMemberId: admin.memberId, disqualificationReasonId: disqualification.id, fullName: "Lead histórico", normalizedPhone: `+55119${randomUUID().replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`, status: "DISQUALIFIED", priority: "MEDIUM", slaStartedAt: now, slaDueAt: now, lastActivityAt: now, createdByActorId: system.id, updatedByActorId: system.id } });
  leadId = lead.id;
  await database.leadScore.create({ data: { workspaceId, leadId, scoringRuleVersionId: scoring.id, source: "FORM_PROVISIONAL", priorityBandCode: "P2", score: 50, modelKey: "test", modelVersion: "1", reason: "Histórico", inputSnapshot: {}, calculatedByActorId: system.id } });
  const other = await database.workspace.create({ data: { slug: `settings-other-${suffix}`, name: "Outro workspace" } }); otherWorkspaceId = other.id;
  const otherActor = await database.actor.create({ data: { workspaceId: other.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  await database.product.create({ data: { workspaceId: other.id, sku: "OTHER", name: "Produto externo", listPriceCents: 1n, createdByActorId: otherActor.id, updatedByActorId: otherActor.id } });
}, 30_000);

afterAll(async () => { await database.$disconnect(); });

describe("configurações comerciais seguras", () => {
  it("protege leitura e mutação no servidor", async () => {
    await expect(service().getScreen(admin)).resolves.toMatchObject({ workspace: { id: workspaceId, revision: 1 } });
    await expect(service().getScreen(sdr)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service().apply(sdr, { action: "SET_PRODUCT_ACTIVE", id: randomUUID(), active: false, confirmed: true })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("rejeita faixas, pesos e cadência inválidos antes de persistir", async () => {
    await expect(service().preview(admin, { action: "SAVE_OPERATIONAL_POLICY", expectedRevision: 1, pactoMinimumInvestigatedDimensions: 5, defaultMeetingDurationMinutes: 30, distributionStrategy: "ROUND_ROBIN", maxOpenLeadsPerSdr: null, leadStagnationDays: 7, leadWithoutActivityDays: 3, cadenceDayOffsets: [0, 3, 3] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service().preview(admin, { action: "SAVE_SCORING_SLA", expectedScoringVersion: 1, painMaxPoints: 10, capacityMaxPoints: 10, decisionMaxPoints: 10, intentMaxPoints: 10, contextMaxPoints: 10, partialFactorBasisPoints: 5000, noCapacityPenalty: 30, noPainPenalty: 25, curiosityPenalty: 10, invalidContactPenalty: 100, noDecisionAccessPenalty: 15, capacityFullThresholdCents: "500000", p1Minimum: 70, p2Minimum: 40, healthyMaxSeconds: 60, attentionMaxSeconds: 180 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("versiona regras operacionais, preserva revisão anterior e audita", async () => {
    const command = { action: "SAVE_OPERATIONAL_POLICY", expectedRevision: 1, pactoMinimumInvestigatedDimensions: 4, defaultMeetingDurationMinutes: 40, distributionStrategy: "ROUND_ROBIN", maxOpenLeadsPerSdr: 25, leadStagnationDays: 5, leadWithoutActivityDays: 2, cadenceSteps: [{ dayOffset: 1, action: "WHATSAPP" }, { dayOffset: 2, action: "CALL" }, { dayOffset: 3, action: "EMAIL" }, { dayOffset: 5, action: "WHATSAPP" }, { dayOffset: 7, action: "RECYCLE" }], confirmed: true } as const;
    const result = await service().apply(admin, command);
    expect(result.workspace).toMatchObject({ revision: 2, pactoMinimumInvestigatedDimensions: 4, defaultMeetingDurationMinutes: 40, maxOpenLeadsPerSdr: 25, cadenceDayOffsets: [1, 2, 3, 5, 7], cadenceSteps: command.cadenceSteps });
    await expect(database.commercialSettingsVersion.count({ where: { workspaceId } })).resolves.toBe(2);
    await expect(database.auditLog.count({ where: { workspaceId, action: "settings.operational.versioned" } })).resolves.toBe(1);
  });

  it("cria e edita catálogo com confirmação, isolamento e auditoria", async () => {
    const created = await service().apply(admin, { action: "SAVE_PRODUCT", id: null, expectedUpdatedAt: null, sku: "TEST-NEW", name: "Produto novo", description: null, listPriceCents: "12345", confirmed: true });
    const product = created.products.find((item) => item.sku === "TEST-NEW"); expect(product).toBeDefined();
    const edited = await service().apply(admin, { action: "SAVE_PRODUCT", id: product!.id, expectedUpdatedAt: product!.updatedAt, sku: product!.sku, name: "Produto editado", description: "Descrição", listPriceCents: "15000", confirmed: true });
    expect(edited.products.find((item) => item.catalogItemId === product!.catalogItemId && item.version === 2)).toMatchObject({ name: "Produto editado", listPriceCents: "15000", active: true });
    expect(edited.products.find((item) => item.id === product!.id)).toMatchObject({ version: 1, active: false });
    const foreignProduct = await database.product.findFirstOrThrow({ where: { workspaceId: otherWorkspaceId } });
    await expect(service().apply(admin, { action: "SET_PRODUCT_ACTIVE", id: foreignProduct.id, active: false, confirmed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(database.product.findUniqueOrThrow({ where: { id: foreignProduct.id } })).resolves.toMatchObject({ active: true });
    await expect(database.auditLog.count({ where: { workspaceId, action: { startsWith: "settings.product." } } })).resolves.toBe(2);
  });

  it("inativa motivo em uso sem apagar vínculo histórico", async () => {
    const before = await service().getScreen(admin); const reason = before.disqualificationReasons.find((item) => item.key === "legacy"); expect(reason?.recordsInUse).toBe(1);
    await service().apply(admin, { action: "SET_REASON_ACTIVE", reasonType: "DISQUALIFICATION_REASON", id: reason!.id, active: false, confirmed: true });
    await expect(database.lead.findUniqueOrThrow({ where: { id: leadId } })).resolves.toMatchObject({ disqualificationReasonId: reason!.id });
    await expect(database.disqualificationReason.findUniqueOrThrow({ where: { id: reason!.id } })).resolves.toMatchObject({ active: false, deletedAt: null });
  });

  it("versiona scoring e SLA sem reescrever scores e ciclos históricos", async () => {
    await service().apply(admin, { action: "SAVE_SCORING_SLA", expectedScoringVersion: 1, painMaxPoints: 20, capacityMaxPoints: 35, decisionMaxPoints: 15, intentMaxPoints: 20, contextMaxPoints: 10, partialFactorBasisPoints: 5000, noCapacityPenalty: 35, noPainPenalty: 20, curiosityPenalty: 10, invalidContactPenalty: 100, noDecisionAccessPenalty: 15, capacityFullThresholdCents: "700000", p1Minimum: 75, p2Minimum: 45, healthyMaxSeconds: 45, attentionMaxSeconds: 150, confirmed: true });
    const [oldRule, newRule, historicalScore, policies] = await Promise.all([
      database.scoringRuleVersion.findUniqueOrThrow({ where: { id: scoringRuleId } }), database.scoringRuleVersion.findFirstOrThrow({ where: { workspaceId, active: true } }),
      database.leadScore.findFirstOrThrow({ where: { workspaceId, leadId } }), database.slaPolicy.findMany({ where: { workspaceId }, orderBy: { version: "asc" } }),
    ]);
    expect(oldRule.active).toBe(false); expect(newRule.version).toBe(2); expect(historicalScore.scoringRuleVersionId).toBe(oldRule.id);
    expect(policies.filter((policy) => policy.active)).toHaveLength(3); expect(policies.filter((policy) => policy.version === 2)).toHaveLength(3);
    await expect(database.auditLog.count({ where: { workspaceId, action: "settings.scoring_sla.versioned" } })).resolves.toBe(1);
  });

  it("aplica matriz de transições e mantém rollback atômico", async () => {
    const before = await service().getScreen(admin); const pipeline = before.pipelines[0]!; const transition = pipeline.transitions.find((item) => item.fromName === "Contato")!;
    const reordered = await service().apply(admin, { action: "SAVE_PIPELINE", pipelineId: pipeline.id, expectedUpdatedAt: pipeline.updatedAt, name: "Pipeline configurado", stages: [...pipeline.stages].reverse().map((stage, position) => ({ id: stage.id, name: `${stage.name} editado`, position })), confirmed: true });
    expect(reordered.pipelines.find((item) => item.id === pipeline.id)?.stages.map((stage) => stage.code)).toEqual(["TRYING_CONTACT", "NEW"]);
    await service().apply(admin, { action: "SET_TRANSITION_ACTIVE", transitionId: transition.id, active: false, confirmed: true });
    await expect(database.pipelineStageTransition.findUniqueOrThrow({ where: { id: transition.id } })).resolves.toMatchObject({ active: false });
    const productCount = await database.product.count({ where: { workspaceId } });
    await expect(service(async () => { throw new Error("forced rollback"); }).apply(admin, { action: "SAVE_PRODUCT", id: null, expectedUpdatedAt: null, sku: "ROLLBACK", name: "Não persistir", description: null, listPriceCents: "1", confirmed: true })).rejects.toThrow("forced rollback");
    await expect(database.product.count({ where: { workspaceId } })).resolves.toBe(productCount);
  });
});
