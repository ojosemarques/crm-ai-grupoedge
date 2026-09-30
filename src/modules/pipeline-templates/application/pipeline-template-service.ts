import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { pipelineTemplateCommandSchema, type SaveTemplateCommand } from "@/modules/pipeline-templates/domain/pipeline-template-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "assertAuthorized">;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;

function fail(code: string, message: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function lock(transaction: Prisma.TransactionClient, key: string): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function closeOpenHistory(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  card: { leadId: string } | { opportunityId: string },
  actorId: string,
  requestedAt: Date,
): Promise<Date> {
  const history = await transaction.stageHistory.findFirst({ where: { workspaceId, ...card, exitedAt: null }, orderBy: { enteredAt: "desc" } });
  const effectiveAt = history && requestedAt <= history.enteredAt ? new Date(history.enteredAt.getTime() + 1) : requestedAt;
  if (history) await transaction.stageHistory.update({ where: { id: history.id }, data: { exitedAt: effectiveAt, exitedByActorId: actorId } });
  return effectiveAt;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createPipelineTemplateService(options: Options) {
  async function manage(context: AuthenticatedContext): Promise<void> {
    await options.authorization.assertAuthorized(context, PermissionKeys.WORKSPACE_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "PipelineTemplate",
    });
  }

  async function getScreen(context: AuthenticatedContext) {
    await manage(context);
    const workspaceId = context.workspaceId;
    const [groups, rules, templates, pipelines, migrations, sources, teams, offerTemplates] = await Promise.all([
      options.database.pipelineOriginGroup.findMany({ where: { workspaceId }, include: { sources: true }, orderBy: { name: "asc" } }),
      options.database.pipelineOriginAccessRule.findMany({ where: { workspaceId }, orderBy: [{ sourceId: "asc" }, { teamId: "asc" }] }),
      options.database.pipelineTemplate.findMany({ where: { workspaceId, archivedAt: null }, include: { versions: { include: { stages: { include: { activities: { orderBy: { position: "asc" } }, requiredFields: true }, orderBy: { position: "asc" } } }, orderBy: { version: "desc" } } }, orderBy: { name: "asc" } }),
      options.database.pipeline.findMany({ where: { workspaceId, deletedAt: null }, include: { templateApplication: true, stages: { where: { deletedAt: null }, orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
      options.database.pipelineTemplateMigration.findMany({ where: { workspaceId }, include: { fromVersion: true, toVersion: true }, orderBy: { createdAt: "desc" }, take: 50 }),
      options.database.leadSource.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, key: true, name: true, type: true }, orderBy: { name: "asc" } }),
      options.database.team.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      options.database.offerTemplate.findMany({ where: { workspaceId, active: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    return {
      originGroups: groups.map((group) => ({ ...group, sources: group.sources.map((item) => sourceById.get(item.sourceId)).filter(Boolean) })),
      accessRules: rules,
      templates: templates.map((template) => ({ ...template, latestVersion: template.versions[0] ?? null })),
      pipelines: pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name, entityType: pipeline.entityType, updatedAt: pipeline.updatedAt, stages: pipeline.stages, application: pipeline.templateApplication })),
      migrations: migrations.map((migration) => ({ ...migration, fromVersion: migration.fromVersion.version, toVersion: migration.toVersion.version, affectedCount: Array.isArray(migration.affectedCards) ? migration.affectedCards.length : 0 })),
      sources,
      teams,
      offerTemplates,
    };
  }

  async function createVersion(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: SaveTemplateCommand) {
    let templateId = command.templateId ?? null;
    let nextVersion = 1;
    let previousVersionId: string | null = null;
    if (command.mode === "SAVE_AS_NEW" || !templateId) {
      const created = await transaction.pipelineTemplate.create({ data: { workspaceId: context.workspaceId, key: command.key, name: command.name, entityType: command.entityType, createdByActorId: context.actorId } });
      templateId = created.id;
    } else {
      await lock(transaction, `pipeline-template:${context.workspaceId}:${templateId}`);
      const template = await transaction.pipelineTemplate.findFirst({ where: { id: templateId, workspaceId: context.workspaceId, archivedAt: null }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      if (!template) fail("NOT_FOUND", "Modelo não encontrado.", 404);
      if (template.entityType !== command.entityType) fail("ENTITY_TYPE_MISMATCH", "O tipo do modelo não pode ser alterado.");
      const latest = template.versions[0];
      if (!latest || command.expectedVersion !== latest.version) fail("TEMPLATE_CHANGED", "O modelo mudou. Recarregue antes de salvar.");
      nextVersion = latest.version + 1;
      previousVersionId = latest.id;
    }
    const version = await transaction.pipelineTemplateVersion.create({ data: { workspaceId: context.workspaceId, templateId, previousVersionId, version: nextVersion, name: command.name, changeReason: command.changeReason, createdByActorId: context.actorId } });
    for (const stageInput of [...command.stages].sort((a, b) => a.position - b.position)) {
      const stage = await transaction.pipelineTemplateStage.create({ data: { workspaceId: context.workspaceId, templateVersionId: version.id, stableKey: stageInput.stableKey, name: stageInput.name, position: stageInput.position, type: stageInput.type, leadStageCode: stageInput.leadStageCode ?? null, opportunityStageCode: stageInput.opportunityStageCode ?? null } });
      if (stageInput.activities.length) await transaction.pipelineTemplateActivityDefinition.createMany({ data: stageInput.activities.map((activity) => ({ workspaceId: context.workspaceId, templateVersionId: version.id, stageId: stage.id, activityType: activity.activityType, title: activity.title, script: activity.script ?? null, dueOffsetDays: activity.dueOffsetDays, position: activity.position, required: activity.required })) });
      if (stageInput.requiredFields.length) await transaction.pipelineRequiredField.createMany({ data: stageInput.requiredFields.map((field) => ({ workspaceId: context.workspaceId, templateVersionId: version.id, stageId: stage.id, offerTemplateId: field.offerTemplateId ?? null, fieldKey: field.fieldKey, label: field.label })) });
    }
    await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "pipeline_template.version.created", entityType: "PipelineTemplateVersion", entityId: version.id, reason: command.changeReason, changes: asJson({ templateId, version: nextVersion, mode: command.mode }) } });
    return version;
  }

  async function saveTemplate(context: AuthenticatedContext, command: SaveTemplateCommand) {
    return options.database.$transaction(async (transaction) => {
      const version = await createVersion(transaction, context, command);
      if (command.pipelineIds.length) {
        const pipelines = await transaction.pipeline.findMany({ where: { workspaceId: context.workspaceId, id: { in: [...new Set(command.pipelineIds)] }, entityType: command.entityType, deletedAt: null }, select: { id: true } });
        if (pipelines.length !== new Set(command.pipelineIds).size) fail("PIPELINE_NOT_FOUND", "Um pipeline selecionado não existe ou é incompatível.", 404);
        for (const pipeline of pipelines) await transaction.pipelineTemplateApplication.upsert({ where: { pipelineId: pipeline.id }, create: { workspaceId: context.workspaceId, pipelineId: pipeline.id, templateVersionId: version.id, editMode: "SHARED", appliedByActorId: context.actorId }, update: { editMode: "SHARED", appliedByActorId: context.actorId } });
      }
      const pendingApplications = command.mode === "UPDATE_SHARED" ? await transaction.pipelineTemplateApplication.findMany({ where: { workspaceId: context.workspaceId, editMode: "SHARED", templateVersion: { templateId: version.templateId }, NOT: { templateVersionId: version.id } }, select: { pipelineId: true, revision: true } }) : [];
      return { version, pendingApplications };
    });
  }

  async function copyTemplate(context: AuthenticatedContext, command: Extract<ReturnType<typeof pipelineTemplateCommandSchema.parse>, { action: "COPY_TEMPLATE" }>) {
    return options.database.$transaction(async (transaction) => {
      await lock(transaction, `pipeline:${context.workspaceId}:${command.pipelineId}`);
      const [source, pipeline] = await Promise.all([
        transaction.pipelineTemplateVersion.findFirst({ where: { id: command.sourceTemplateVersionId, workspaceId: context.workspaceId }, include: { template: true, stages: { include: { activities: true, requiredFields: true }, orderBy: { position: "asc" } } } }),
        transaction.pipeline.findFirst({ where: { id: command.pipelineId, workspaceId: context.workspaceId, deletedAt: null }, include: { templateApplication: true } }),
      ]);
      if (!source || !pipeline) fail("NOT_FOUND", "Modelo ou pipeline não encontrado.", 404);
      if (source.template.entityType !== pipeline.entityType) fail("ENTITY_TYPE_MISMATCH", "Modelo incompatível com o pipeline.");
      if (command.expectedRevision && pipeline.templateApplication?.revision !== command.expectedRevision) fail("PIPELINE_CHANGED", "A origem mudou. Recarregue antes de copiar.");
      const saved = await createVersion(transaction, context, { action: "SAVE_TEMPLATE", mode: "SAVE_AS_NEW", key: command.key, name: command.name, entityType: source.template.entityType, changeReason: command.changeReason, pipelineIds: [], stages: source.stages.map((stage) => ({ stableKey: stage.stableKey, name: stage.name, position: stage.position, type: stage.type, leadStageCode: stage.leadStageCode, opportunityStageCode: stage.opportunityStageCode, activities: stage.activities.map(({ activityType, title, script, dueOffsetDays, position, required }) => ({ activityType, title, script, dueOffsetDays, position, required })), requiredFields: stage.requiredFields.map(({ fieldKey, label, offerTemplateId }) => ({ fieldKey, label, offerTemplateId })) })) });
      const application = await transaction.pipelineTemplateApplication.upsert({ where: { pipelineId: pipeline.id }, create: { workspaceId: context.workspaceId, pipelineId: pipeline.id, templateVersionId: saved.id, editMode: "LOCAL_COPY", appliedByActorId: context.actorId }, update: { templateVersionId: saved.id, editMode: "LOCAL_COPY", revision: { increment: 1 }, appliedByActorId: context.actorId, appliedAt: options.now() } });
      return { templateVersion: saved, application };
    });
  }

  async function saveOriginGroup(context: AuthenticatedContext, command: Extract<ReturnType<typeof pipelineTemplateCommandSchema.parse>, { action: "SAVE_ORIGIN_GROUP" }>) {
    return options.database.$transaction(async (transaction) => {
      const [sourceCount, team] = await Promise.all([
        transaction.leadSource.count({ where: { workspaceId: context.workspaceId, id: { in: command.sourceIds }, deletedAt: null } }),
        command.teamId ? transaction.team.findFirst({ where: { id: command.teamId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true } }) : Promise.resolve(null),
      ]);
      if (sourceCount !== new Set(command.sourceIds).size || (command.teamId && !team)) fail("REFERENCE_NOT_FOUND", "Origem ou equipe inválida.", 404);
      if (command.id) {
        const updated = await transaction.pipelineOriginGroup.updateMany({ where: { id: command.id, workspaceId: context.workspaceId }, data: { name: command.name, teamId: command.teamId ?? null, active: command.active, updatedByActorId: context.actorId } });
        if (!updated.count) fail("NOT_FOUND", "Agrupador não encontrado.", 404);
      }
      const group = command.id ? await transaction.pipelineOriginGroup.findUniqueOrThrow({ where: { id: command.id } }) : await transaction.pipelineOriginGroup.create({ data: { workspaceId: context.workspaceId, name: command.name, teamId: command.teamId ?? null, active: command.active, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await transaction.pipelineOriginGroupSource.deleteMany({ where: { workspaceId: context.workspaceId, groupId: group.id } });
      await transaction.pipelineOriginGroupSource.createMany({ data: [...new Set(command.sourceIds)].map((sourceId) => ({ workspaceId: context.workspaceId, groupId: group.id, sourceId })) });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "pipeline_origin_group.saved", entityType: "PipelineOriginGroup", entityId: group.id, changes: asJson(command) } });
      return group;
    });
  }

  async function saveAccessRule(context: AuthenticatedContext, command: Extract<ReturnType<typeof pipelineTemplateCommandSchema.parse>, { action: "SAVE_ACCESS_RULE" }>) {
    const [source, team] = await Promise.all([
      options.database.leadSource.findFirst({ where: { id: command.sourceId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true } }),
      options.database.team.findFirst({ where: { id: command.teamId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!source || !team) fail("REFERENCE_NOT_FOUND", "Origem ou equipe inválida.", 404);
    const values = { sourceId: command.sourceId, teamId: command.teamId, canRead: command.canRead, canDistribute: command.canDistribute, canReassign: command.canReassign, canTransition: command.canTransition, updatedByActorId: context.actorId };
    if (command.id) {
      const result = await options.database.pipelineOriginAccessRule.updateMany({ where: { id: command.id, workspaceId: context.workspaceId }, data: values });
      if (!result.count) fail("NOT_FOUND", "Regra não encontrada.", 404);
      return options.database.pipelineOriginAccessRule.findUniqueOrThrow({ where: { id: command.id } });
    }
    return options.database.pipelineOriginAccessRule.upsert({ where: { workspaceId_sourceId_teamId: { workspaceId: context.workspaceId, sourceId: command.sourceId, teamId: command.teamId } }, create: { workspaceId: context.workspaceId, createdByActorId: context.actorId, ...values }, update: values });
  }

  async function previewMigration(context: AuthenticatedContext, command: Extract<ReturnType<typeof pipelineTemplateCommandSchema.parse>, { action: "PREVIEW_MIGRATION" }>) {
    return options.database.$transaction(async (transaction) => {
      await lock(transaction, `pipeline:${context.workspaceId}:${command.pipelineId}`);
      const [pipeline, target] = await Promise.all([
        transaction.pipeline.findFirst({ where: { id: command.pipelineId, workspaceId: context.workspaceId, deletedAt: null }, include: { templateApplication: { include: { templateVersion: true } }, stages: { where: { deletedAt: null }, orderBy: { position: "asc" } }, leads: { where: { deletedAt: null }, select: { id: true, currentStageId: true } }, opportunities: { where: { deletedAt: null }, select: { id: true, currentStageId: true } } } }),
        transaction.pipelineTemplateVersion.findFirst({ where: { id: command.toTemplateVersionId, workspaceId: context.workspaceId }, include: { template: true, stages: { orderBy: { position: "asc" } } } }),
      ]);
      const application = pipeline?.templateApplication;
      if (!pipeline || !application || !target) fail("NOT_FOUND", "Pipeline aplicado ou versão de destino não encontrada.", 404);
      if (application.revision !== command.expectedRevision) fail("PIPELINE_CHANGED", "A origem mudou. Recarregue antes da prévia.");
      if (pipeline.entityType !== target.template.entityType) fail("ENTITY_TYPE_MISMATCH", "Versão incompatível com o pipeline.");
      const targetKeys = new Set(target.stages.map((stage) => stage.stableKey));
      const cards = pipeline.entityType === "LEAD" ? pipeline.leads.map((card) => ({ entityType: "LEAD", id: card.id, oldStageId: card.currentStageId })) : pipeline.opportunities.map((card) => ({ entityType: "OPPORTUNITY", id: card.id, oldStageId: card.currentStageId }));
      const stageIdsWithCards = new Set(cards.map((card) => card.oldStageId));
      for (const oldStageId of stageIdsWithCards) if (!command.stageMapping[oldStageId] || !targetKeys.has(command.stageMapping[oldStageId]!)) fail("INCOMPLETE_STAGE_MAPPING", "Toda etapa com cards exige um destino válido.", 400);
      for (const sourceStageId of Object.keys(command.stageMapping)) if (!pipeline.stages.some((stage) => stage.id === sourceStageId)) fail("INVALID_STAGE_MAPPING", "O mapeamento contém etapa externa ao pipeline.", 400);
      const affectedCards = cards.map((card) => ({ ...card, targetStableKey: command.stageMapping[card.oldStageId] }));
      const rollbackSnapshot = { stages: pipeline.stages.map(({ id, name, position, type, leadStageCode, opportunityStageCode }) => ({ id, name, position, type, leadStageCode, opportunityStageCode })), cards };
      const signature = fingerprint({ workspaceId: context.workspaceId, pipelineId: pipeline.id, from: application.templateVersionId, to: target.id, mapping: command.stageMapping, revision: application.revision });
      const createdAt = options.now();
      const migration = await transaction.pipelineTemplateMigration.upsert({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint: signature } }, create: { workspaceId: context.workspaceId, pipelineId: pipeline.id, applicationId: application.id, fromTemplateVersionId: application.templateVersionId, toTemplateVersionId: target.id, stageMapping: asJson(command.stageMapping), affectedCards: asJson(affectedCards), rollbackSnapshot: asJson(rollbackSnapshot), fingerprint: signature, expectedPipelineAt: pipeline.updatedAt, expiresAt: new Date(createdAt.getTime() + 15 * 60_000), createdByActorId: context.actorId, createdAt }, update: {} });
      const stageNameById = new Map(pipeline.stages.map((stage) => [stage.id, stage.name]));
      const targetNameByKey = new Map(target.stages.map((stage) => [stage.stableKey, stage.name]));
      return {
        id: migration.id,
        migrationId: migration.id,
        affectedCount: affectedCards.length,
        affectedCards,
        stageMappings: Object.entries(command.stageMapping).map(([fromStageId, toStableKey]) => ({ fromStageId, fromName: stageNameById.get(fromStageId) ?? "Etapa", toStableKey, toName: targetNameByKey.get(toStableKey) ?? "Etapa", count: affectedCards.filter((card) => card.oldStageId === fromStageId).length })),
        rollbackAvailable: true,
        expiresAt: migration.expiresAt,
      };
    });
  }

  async function applyMigration(context: AuthenticatedContext, migrationId: string, expectedRevision: number) {
    return options.database.$transaction(async (transaction) => {
      const migration = await transaction.pipelineTemplateMigration.findFirst({ where: { id: migrationId, workspaceId: context.workspaceId }, include: { application: true, pipeline: { include: { stages: { where: { deletedAt: null } } } }, toVersion: { include: { stages: { orderBy: { position: "asc" } } } } } });
      if (!migration) fail("NOT_FOUND", "Prévia não encontrada.", 404);
      await lock(transaction, `pipeline:${context.workspaceId}:${migration.pipelineId}`);
      if (migration.status !== "PREVIEWED" || migration.expiresAt <= options.now()) fail("PREVIEW_EXPIRED", "A prévia expirou ou já foi consumida.");
      if (migration.application.revision !== expectedRevision || migration.application.templateVersionId !== migration.fromTemplateVersionId || migration.pipeline.updatedAt.getTime() !== migration.expectedPipelineAt.getTime()) fail("PIPELINE_CHANGED", "O pipeline mudou após a prévia.");
      const mapping = migration.stageMapping as Record<string, string>;
      const changedAt = options.now();
      await transaction.pipelineStage.updateMany({ where: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, id: { in: migration.pipeline.stages.map((stage) => stage.id) } }, data: { deletedAt: changedAt, updatedByActorId: context.actorId } });
      const newByKey = new Map<string, string>();
      for (const stage of migration.toVersion.stages) {
        const created = await transaction.pipelineStage.create({ data: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, name: stage.name, position: stage.position, type: stage.type, leadStageCode: stage.leadStageCode, opportunityStageCode: stage.opportunityStageCode, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        newByKey.set(stage.stableKey, created.id);
      }
      const createdStages = [...newByKey.values()];
      for (let index = 0; index < createdStages.length - 1; index++) await transaction.pipelineStageTransition.create({ data: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, fromStageId: createdStages[index]!, toStageId: createdStages[index + 1]!, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      for (const [oldStageId, targetKey] of Object.entries(mapping)) {
        const newStageId = newByKey.get(targetKey);
        if (!newStageId) fail("INVALID_STAGE_MAPPING", "Destino de etapa inválido.", 400);
        if (migration.pipeline.entityType === "LEAD") {
          const ids = await transaction.lead.findMany({ where: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, currentStageId: oldStageId, deletedAt: null }, select: { id: true } });
          for (const { id } of ids) { const effectiveAt = await closeOpenHistory(transaction, context.workspaceId, { leadId: id }, context.actorId, changedAt); await transaction.lead.update({ where: { id }, data: { currentStageId: newStageId, updatedByActorId: context.actorId } }); await transaction.stageHistory.create({ data: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, stageId: newStageId, leadId: id, enteredAt: effectiveAt, enteredByActorId: context.actorId, transitionOrigin: "SYSTEM", transitionReason: "Migração versionada de modelo", managerCorrection: true } }); }
        } else {
          const ids = await transaction.opportunity.findMany({ where: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, currentStageId: oldStageId, deletedAt: null }, select: { id: true } });
          for (const { id } of ids) { const effectiveAt = await closeOpenHistory(transaction, context.workspaceId, { opportunityId: id }, context.actorId, changedAt); await transaction.opportunity.update({ where: { id }, data: { currentStageId: newStageId, revision: { increment: 1 }, updatedByActorId: context.actorId } }); await transaction.stageHistory.create({ data: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, stageId: newStageId, opportunityId: id, enteredAt: effectiveAt, enteredByActorId: context.actorId, transitionOrigin: "SYSTEM", transitionReason: "Migração versionada de modelo", managerCorrection: true } }); }
        }
      }
      await transaction.pipeline.update({ where: { id: migration.pipelineId }, data: { updatedByActorId: context.actorId } });
      await transaction.pipelineTemplateApplication.update({ where: { id: migration.applicationId }, data: { templateVersionId: migration.toTemplateVersionId, revision: { increment: 1 }, appliedByActorId: context.actorId, appliedAt: changedAt } });
      await transaction.pipelineTemplateMigration.update({ where: { id: migration.id }, data: { status: "APPLIED", appliedAt: changedAt } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "pipeline_template.migration.applied", entityType: "PipelineTemplateMigration", entityId: migration.id, changes: asJson({ affectedCards: migration.affectedCards }) } });
      return { id: migration.id, status: "APPLIED" as const, resultingRevision: expectedRevision + 1 };
    });
  }

  async function rollbackMigration(context: AuthenticatedContext, migrationId: string, expectedRevision: number, reason: string) {
    return options.database.$transaction(async (transaction) => {
      const migration = await transaction.pipelineTemplateMigration.findFirst({ where: { id: migrationId, workspaceId: context.workspaceId }, include: { application: true } });
      if (!migration) fail("NOT_FOUND", "Migração não encontrada.", 404);
      await lock(transaction, `pipeline:${context.workspaceId}:${migration.pipelineId}`);
      if (migration.status !== "APPLIED" || migration.application.revision !== expectedRevision || migration.application.templateVersionId !== migration.toTemplateVersionId) fail("ROLLBACK_UNAVAILABLE", "A migração não é a versão ativa ou já foi desfeita.");
      const later = await transaction.pipelineTemplateMigration.count({ where: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, status: "APPLIED", appliedAt: { gt: migration.appliedAt! } } });
      if (later) fail("ROLLBACK_NOT_LATEST", "Somente a última migração aplicada pode ser desfeita.");
      const snapshot = migration.rollbackSnapshot as { stages: Array<{ id: string }>; cards: Array<{ entityType: "LEAD" | "OPPORTUNITY"; id: string; oldStageId: string }> };
      const changedAt = options.now();
      const oldStageIds = snapshot.stages.map((stage) => stage.id);
      await transaction.pipelineStage.updateMany({ where: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, id: { notIn: oldStageIds }, deletedAt: null }, data: { deletedAt: changedAt, updatedByActorId: context.actorId } });
      await transaction.pipelineStage.updateMany({ where: { workspaceId: context.workspaceId, id: { in: oldStageIds } }, data: { deletedAt: null, updatedByActorId: context.actorId } });
      for (const card of snapshot.cards) {
        const effectiveAt = await closeOpenHistory(transaction, context.workspaceId, card.entityType === "LEAD" ? { leadId: card.id } : { opportunityId: card.id }, context.actorId, changedAt);
        if (card.entityType === "LEAD") await transaction.lead.update({ where: { id: card.id }, data: { currentStageId: card.oldStageId, updatedByActorId: context.actorId } });
        else await transaction.opportunity.update({ where: { id: card.id }, data: { currentStageId: card.oldStageId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await transaction.stageHistory.create({ data: { workspaceId: context.workspaceId, pipelineId: migration.pipelineId, stageId: card.oldStageId, ...(card.entityType === "LEAD" ? { leadId: card.id } : { opportunityId: card.id }), enteredAt: effectiveAt, enteredByActorId: context.actorId, transitionOrigin: "SYSTEM", transitionReason: reason, managerCorrection: true } });
      }
      await transaction.pipeline.update({ where: { id: migration.pipelineId }, data: { updatedByActorId: context.actorId } });
      await transaction.pipelineTemplateApplication.update({ where: { id: migration.applicationId }, data: { templateVersionId: migration.fromTemplateVersionId, revision: { increment: 1 }, appliedByActorId: context.actorId, appliedAt: changedAt } });
      await transaction.pipelineTemplateMigration.update({ where: { id: migration.id }, data: { status: "ROLLED_BACK", rolledBackAt: changedAt } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "pipeline_template.migration.rolled_back", entityType: "PipelineTemplateMigration", entityId: migration.id, reason } });
      return { id: migration.id, status: "ROLLED_BACK" as const, resultingRevision: expectedRevision + 1 };
    });
  }

  async function execute(context: AuthenticatedContext, payload: unknown) {
    await manage(context);
    const parsed = pipelineTemplateCommandSchema.safeParse(payload);
    if (!parsed.success) fail("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join(" "), 400);
    const command = parsed.data;
    switch (command.action) {
      case "SAVE_TEMPLATE": return saveTemplate(context, command);
      case "COPY_TEMPLATE": return copyTemplate(context, command);
      case "SAVE_ORIGIN_GROUP": return saveOriginGroup(context, command);
      case "SAVE_ACCESS_RULE": return saveAccessRule(context, command);
      case "PREVIEW_MIGRATION": return previewMigration(context, command);
      case "APPLY_MIGRATION": return applyMigration(context, command.migrationId, command.expectedRevision);
      case "ROLLBACK_MIGRATION": return rollbackMigration(context, command.migrationId, command.expectedRevision, command.reason);
    }
  }

  return Object.freeze({ getScreen, execute });
}

let singleton: ReturnType<typeof createPipelineTemplateService> | undefined;
export function getPipelineTemplateService() {
  singleton ??= createPipelineTemplateService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
