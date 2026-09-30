import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOpportunityBulkService } from "@/modules/pipeline-templates/application/opportunity-bulk-service";
import { createPipelineTemplateService } from "@/modules/pipeline-templates/application/pipeline-template-service";
import { createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for pipeline template integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 10 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2038-03-01T12:00:00.000Z");
const templates = createPipelineTemplateService({ database, authorization, now: () => now });
const bulk = createOpportunityBulkService({ database, authorization, now: () => now });

let manager: AuthenticatedContext;
let sellerA: AuthenticatedContext;
let workspaceId: string;
let pipelineId: string;
let firstStageId: string;
let secondStageId: string;
let opportunityA: string;
let opportunityB: string;
let sourceA: string;
let sourceB: string;
let teamA: string;
let teamB: string;
let targetMemberId: string;

async function person(workspaceSlug: string, roleId: string, roleKey: string, actorId: string, label: string) {
  const suffix = randomUUID();
  const user = await database.user.create({ data: { email: `${label}.${suffix}@stage4.test`, normalizedEmail: `${label}.${suffix}@stage4.test`, displayName: label } });
  const member = await database.workspaceMember.create({ data: { workspaceId, userId: user.id, roleId, status: "ACTIVE", joinedAt: now, createdByActorId: actorId, updatedByActorId: actorId } });
  const actor = await database.actor.create({ data: { workspaceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: label } });
  return { context: { sessionId: randomUUID(), workspaceId, workspaceSlug, userId: user.id, memberId: member.id, actorId: actor.id, roleId, roleKey, roleName: roleKey, displayName: label } satisfies AuthenticatedContext, memberId: member.id };
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({ data: { slug: `stage4-${suffix}`, name: "Stage 4" } });
  workspaceId = workspace.id;
  const system = await database.actor.create({ data: { workspaceId, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  const permissionKeys = [PermissionKeys.WORKSPACE_MANAGE, PermissionKeys.OPPORTUNITIES_READ, PermissionKeys.OPPORTUNITIES_WRITE];
  for (const key of permissionKeys) await database.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
  const managerRole = await database.role.create({ data: { workspaceId, key: "administrator", name: "Gestor", createdByActorId: system.id, updatedByActorId: system.id } });
  const sellerRole = await database.role.create({ data: { workspaceId, key: "closer", name: "Vendedor", createdByActorId: system.id, updatedByActorId: system.id } });
  for (const key of permissionKeys) {
    const permission = await database.permission.findUniqueOrThrow({ where: { key } });
    if (key === PermissionKeys.WORKSPACE_MANAGE) await database.rolePermission.create({ data: { workspaceId, roleId: managerRole.id, permissionId: permission.id, scope: "WORKSPACE", createdByActorId: system.id } });
    else {
      await database.rolePermission.create({ data: { workspaceId, roleId: managerRole.id, permissionId: permission.id, scope: "WORKSPACE", createdByActorId: system.id } });
      await database.rolePermission.create({ data: { workspaceId, roleId: sellerRole.id, permissionId: permission.id, scope: "TEAM", createdByActorId: system.id } });
    }
  }
  manager = (await person(workspace.slug, managerRole.id, "administrator", system.id, "Gestor")).context;
  const seller = await person(workspace.slug, sellerRole.id, "closer", system.id, "Vendedor A"); sellerA = seller.context;
  const target = await person(workspace.slug, sellerRole.id, "closer", system.id, "Destino A"); targetMemberId = target.memberId;
  teamA = (await database.team.create({ data: { workspaceId, name: `Equipe A ${suffix}`, createdByActorId: system.id, updatedByActorId: system.id } })).id;
  teamB = (await database.team.create({ data: { workspaceId, name: `Equipe B ${suffix}`, createdByActorId: system.id, updatedByActorId: system.id } })).id;
  await database.teamMember.createMany({ data: [seller.memberId, target.memberId].map((workspaceMemberId) => ({ workspaceId, teamId: teamA, workspaceMemberId, function: "CLOSER" as const, createdByActorId: system.id, updatedByActorId: system.id })) });
  const queueA = await database.queue.create({ data: { workspaceId, teamId: teamA, key: `qa-${suffix}`, name: "Fila A", isGeneral: true, createdByActorId: system.id, updatedByActorId: system.id } });
  const queueB = await database.queue.create({ data: { workspaceId, teamId: teamB, key: `qb-${suffix}`, name: "Fila B", isGeneral: false, createdByActorId: system.id, updatedByActorId: system.id } });
  sourceA = (await database.leadSource.create({ data: { workspaceId, key: `sa-${suffix}`, name: "Origem A", type: "MANUAL", createdByActorId: system.id, updatedByActorId: system.id } })).id;
  sourceB = (await database.leadSource.create({ data: { workspaceId, key: `sb-${suffix}`, name: "Origem B", type: "MANUAL", createdByActorId: system.id, updatedByActorId: system.id } })).id;
  const pipeline = await database.pipeline.create({ data: { workspaceId, name: "Vendas configurável", entityType: "OPPORTUNITY", isDefault: true, createdByActorId: system.id, updatedByActorId: system.id } }); pipelineId = pipeline.id;
  const first = await database.pipelineStage.create({ data: { workspaceId, pipelineId, name: "Agendada", position: 0, type: "OPEN", opportunityStageCode: "MEETING_SCHEDULED", createdByActorId: system.id, updatedByActorId: system.id } }); firstStageId = first.id;
  const second = await database.pipelineStage.create({ data: { workspaceId, pipelineId, name: "Confirmada", position: 1, type: "OPEN", opportunityStageCode: "OPPORTUNITY_CONFIRMED", createdByActorId: system.id, updatedByActorId: system.id } }); secondStageId = second.id;
  await database.pipelineStage.createMany({ data: [
    ["Realizada", 2, "OPEN", "MEETING_HELD"], ["Proposta", 3, "OPEN", "PROPOSAL"], ["Negociação", 4, "OPEN", "NEGOTIATION"], ["Ganha", 5, "WON", "WON"], ["Perdida", 6, "LOST", "LOST"],
  ].map(([name, position, type, opportunityStageCode]) => ({ workspaceId, pipelineId, name: name as string, position: position as number, type: type as "OPEN" | "WON" | "LOST", opportunityStageCode: opportunityStageCode as "MEETING_HELD" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST", createdByActorId: system.id, updatedByActorId: system.id })) });
  await database.pipelineStageTransition.create({ data: { workspaceId, pipelineId, fromStageId: first.id, toStageId: second.id, createdByActorId: system.id, updatedByActorId: system.id } });
  async function opportunity(sourceId: string, queueId: string, label: string) {
    const lead = await database.lead.create({ data: { workspaceId, sourceId, pipelineId: (await database.pipeline.create({ data: { workspaceId, name: `Lead ${label}`, entityType: "LEAD", isDefault: false, createdByActorId: system.id, updatedByActorId: system.id } })).id, currentStageId: (await database.pipelineStage.create({ data: { workspaceId, pipelineId: (await database.pipeline.findFirstOrThrow({ where: { workspaceId, name: `Lead ${label}` } })).id, name: "Novo", position: 0, type: "OPEN", leadStageCode: "NEW", createdByActorId: system.id, updatedByActorId: system.id } })).id, ownerMemberId: seller.memberId, queueId: null, routingQueueId: queueId, fullName: label, normalizedEmail: `${label}@stage4.test`, status: "OPEN", priority: "MEDIUM", slaStartedAt: now, slaDueAt: now, lastActivityAt: now, createdByActorId: system.id, updatedByActorId: system.id } });
    const created = await database.opportunity.create({ data: { workspaceId, leadId: lead.id, pipelineId, currentStageId: first.id, ownerMemberId: seller.memberId, name: label, interestDescription: "Interesse comercial validado", amountCents: 10_000n, tcvCents: 10_000n, probabilityBps: 5000, createdByActorId: system.id, updatedByActorId: system.id } });
    await database.stageHistory.create({ data: { workspaceId, pipelineId, stageId: first.id, opportunityId: created.id, enteredAt: now, enteredByActorId: system.id } });
    await database.task.create({ data: { workspaceId, leadId: lead.id, opportunityId: created.id, assigneeMemberId: seller.memberId, title: "Próxima ação", dueAt: new Date(now.getTime() + 86_400_000), createdByActorId: system.id, updatedByActorId: system.id } });
    return created.id;
  }
  opportunityA = await opportunity(sourceA, queueA.id, "Negócio A");
  opportunityB = await opportunity(sourceB, queueB.id, "Negócio B");
  await database.pipelineOriginAccessRule.createMany({ data: [
    { workspaceId, sourceId: sourceA, teamId: teamA, canRead: true, canDistribute: true, canReassign: true, canTransition: true, createdByActorId: system.id, updatedByActorId: system.id },
    { workspaceId, sourceId: sourceB, teamId: teamB, canRead: true, canDistribute: true, canReassign: true, canTransition: true, createdByActorId: system.id, updatedByActorId: system.id },
  ] });
}, 30_000);

afterAll(async () => database.$disconnect());

const stages = [
  { stableKey: "scheduled", name: "Agendada", position: 0, type: "OPEN" as const, opportunityStageCode: "MEETING_SCHEDULED" as const, activities: [{ activityType: "CALL", title: "Preparar reunião", script: "Confirmar pauta", dueOffsetDays: 0, position: 0, required: true }], requiredFields: [] },
  { stableKey: "confirmed", name: "Confirmada", position: 1, type: "OPEN" as const, opportunityStageCode: "OPPORTUNITY_CONFIRMED" as const, activities: [], requiredFields: [{ fieldKey: "expectedCloseAt", label: "Previsão de fechamento" }, { fieldKey: "custom:committee", label: "Comitê decisor" }] },
  { stableKey: "held", name: "Realizada", position: 2, type: "OPEN" as const, opportunityStageCode: "MEETING_HELD" as const, activities: [], requiredFields: [] },
  { stableKey: "proposal", name: "Proposta", position: 3, type: "OPEN" as const, opportunityStageCode: "PROPOSAL" as const, activities: [], requiredFields: [] },
  { stableKey: "negotiation", name: "Negociação", position: 4, type: "OPEN" as const, opportunityStageCode: "NEGOTIATION" as const, activities: [], requiredFields: [] },
  { stableKey: "won", name: "Ganha", position: 5, type: "WON" as const, opportunityStageCode: "WON" as const, activities: [], requiredFields: [] },
  { stableKey: "lost", name: "Perdida", position: 6, type: "LOST" as const, opportunityStageCode: "LOST" as const, activities: [], requiredFields: [] },
];

describe("modelos e pipelines configuráveis", () => {
  it("versiona, exige mapeamento, preserva cards e desfaz a última migração", async () => {
    const created = await templates.execute(manager, { action: "SAVE_TEMPLATE", mode: "SAVE_AS_NEW", key: `shared-${randomUUID().slice(0, 8)}`, name: "Modelo compartilhado", entityType: "OPPORTUNITY", changeReason: "Versão inicial", pipelineIds: [pipelineId], stages });
    const version1 = (created as { version: { id: string; version: number; templateId: string } }).version;
    const changed = await templates.execute(manager, { action: "SAVE_TEMPLATE", mode: "UPDATE_SHARED", templateId: version1.templateId, expectedVersion: 1, key: "ignored-on-update", name: "Modelo compartilhado v2", entityType: "OPPORTUNITY", changeReason: "Ajustar fluxo", pipelineIds: [], stages: [{ ...stages[0]!, name: "Contato agendado" }, { ...stages[1]!, name: "Oportunidade validada" }] });
    const version2 = (changed as { version: { id: string } }).version;
    await expect(templates.execute(manager, { action: "PREVIEW_MIGRATION", pipelineId, toTemplateVersionId: version2.id, stageMapping: { [secondStageId]: "confirmed" }, expectedRevision: 1 })).rejects.toMatchObject({ code: "INCOMPLETE_STAGE_MAPPING" });
    const preview = await templates.execute(manager, { action: "PREVIEW_MIGRATION", pipelineId, toTemplateVersionId: version2.id, stageMapping: { [firstStageId]: "scheduled", [secondStageId]: "confirmed" }, expectedRevision: 1 }) as { id: string };
    await templates.execute(manager, { action: "APPLY_MIGRATION", migrationId: preview.id, expectedRevision: 1 });
    const moved = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityA }, include: { currentStage: true } });
    expect(moved.currentStage.name).toBe("Contato agendado");
    await templates.execute(manager, { action: "ROLLBACK_MIGRATION", migrationId: preview.id, expectedRevision: 2, reason: "Reverter com segurança" });
    await expect(database.opportunity.findUniqueOrThrow({ where: { id: opportunityA } })).resolves.toMatchObject({ currentStageId: firstStageId });
    await expect(database.pipelineTemplateMigration.findUniqueOrThrow({ where: { id: preview.id } })).resolves.toMatchObject({ status: "ROLLED_BACK" });
  });

  it("respeita origem/equipe, reatribui em massa e rejeita revisão concorrente", async () => {
    const current = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityA } });
    await expect(bulk.preview(sellerA, { opportunityIds: [opportunityB], action: "REASSIGN", targetId: targetMemberId, reason: "Distribuir carteira", expectedRevisions: [{ id: opportunityB, revision: 1 }] })).rejects.toMatchObject({ code: "ORIGIN_TEAM_DENIED" });
    const preview = await bulk.preview(sellerA, { opportunityIds: [opportunityA], action: "REASSIGN", targetId: targetMemberId, reason: "Distribuir carteira", expectedRevisions: [{ id: opportunityA, revision: current.revision }] });
    const executed = await bulk.execute(sellerA, { operationId: preview.id });
    expect(executed).toMatchObject({ status: "EXECUTED", affectedCount: 1 });
    await expect(database.opportunity.findUniqueOrThrow({ where: { id: opportunityA } })).resolves.toMatchObject({ ownerMemberId: targetMemberId, revision: current.revision + 1 });
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityA } });
    const stale = await bulk.preview(manager, { opportunityIds: [opportunityA], action: "TRANSITION", targetId: secondStageId, reason: "Avanço controlado", expectedRevisions: [{ id: opportunityA, revision: after.revision }] });
    await database.opportunity.update({ where: { id: opportunityA }, data: { revision: { increment: 1 } } });
    await expect(bulk.execute(manager, { operationId: stale.id })).rejects.toMatchObject({ code: "OPPORTUNITY_CHANGED" });
  });

  it("aplica campos obrigatórios comuns e customizados na transição individual", async () => {
    const service = createOpportunityService({ database, authorization, now: () => new Date(now.getTime() + 60_000) });
    const current = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityA } });
    await expect(service.transition(manager, { action: "TRANSITION", opportunityId: opportunityA, targetStageId: secondStageId, expectedRevision: current.revision, reason: "Validar gates do modelo", origin: "OPPORTUNITY_CARD", confirmed: false })).rejects.toMatchObject({ code: "REQUIRED_FIELDS_MISSING" });
    const definition = await database.customFieldDefinition.create({ data: { workspaceId, entityType: "OPPORTUNITY", key: "committee", name: "Comitê decisor", dataType: "TEXT", createdByActorId: manager.actorId, updatedByActorId: manager.actorId } });
    await database.customFieldValue.create({ data: { workspaceId, definitionId: definition.id, entityType: "OPPORTUNITY", entityId: opportunityA, value: "Secretariado", updatedByActorId: manager.actorId } });
    await database.opportunity.update({ where: { id: opportunityA }, data: { expectedCloseAt: new Date("2038-04-01T12:00:00.000Z") } });
    await expect(service.transition(manager, { action: "TRANSITION", opportunityId: opportunityA, targetStageId: secondStageId, expectedRevision: current.revision, reason: "Validar gates do modelo", origin: "OPPORTUNITY_CARD", confirmed: false })).resolves.toMatchObject({ opportunityId: opportunityA, revision: current.revision + 1 });
  });

  it("oculta do vendedor cards e filtros de origem reservados a outra equipe", async () => {
    const service = createOpportunityService({ database, authorization, now: () => now });
    const screen = await service.getPipelineScreen(sellerA, { closerId: "", productId: "", sourceId: "", stageCode: "ALL", from: "", to: "" });
    expect(screen.sourceOptions.map((item) => item.id)).toContain(sourceA);
    expect(screen.sourceOptions.map((item) => item.id)).not.toContain(sourceB);
    expect(screen.stages.flatMap((stage) => stage.opportunities).map((item) => item.id)).not.toContain(opportunityB);
  });
});
