import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const inputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PREVIEW") }).strict(),
  z.object({ mode: z.literal("APPLY"), expectedRevision: z.number().int().positive() }).strict(),
]);

type Authorization = ReturnType<typeof getAuthorizationService>;
type MarketingForms = ReturnType<typeof getMarketingFormService>;
type Database = PrismaClient | Prisma.TransactionClient;
type Options = Readonly<{
  database: PrismaClient;
  authorization: Authorization;
  marketingForms: MarketingForms;
  now: () => Date;
  ensurePipeline: typeof ensureAdvertisingPipeline;
}>;

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext, formId: string) {
  return { workspaceId: context.workspaceId, resourceType: "MarketingForm", resourceId: formId, memberId: context.memberId } as const;
}

function destinationMatches(value: Prisma.JsonValue, pipelineId: string, stageId: string) {
  const definition = marketingFormDefinitionSchema.safeParse(value);
  return definition.success
    && definition.data.destination.pipelineId === pipelineId
    && definition.data.destination.initialStageId === stageId;
}

export function createMarketingFormAdvertisingSyncService(options: Options) {
  async function authorize(context: AuthenticatedContext, formId: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, resource(context, formId));
    await options.authorization.assertAuthorized(context, PermissionKeys.BULK_ACTIONS_EXECUTE, resource(context, formId));
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_WRITE, {
      workspaceId: context.workspaceId,
      resourceType: "LeadPipeline",
      memberId: context.memberId,
    });
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_ASSIGN, {
      workspaceId: context.workspaceId,
      resourceType: "LeadPipeline",
      memberId: context.memberId,
    });
  }

  async function inspect(context: AuthenticatedContext, formId: string, database: Database = options.database) {
    const storedForm = await database.marketingForm.findFirst({
      where: { id: formId, workspaceId: context.workspaceId, deletedAt: null, archivedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        revision: true,
        draftDefinition: true,
        publishedVersionId: true,
      },
    });
    if (!storedForm) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    const publishedVersion = storedForm.publishedVersionId
      ? await database.marketingFormVersion.findFirst({
          where: { workspaceId: context.workspaceId, marketingFormId: storedForm.id, id: storedForm.publishedVersionId },
          select: { definition: true },
        })
      : null;
    const form = { ...storedForm, publishedVersion };
    const pipeline = await database.pipeline.findFirst({
      where: { workspaceId: context.workspaceId, entityType: "LEAD", name: ADVERTISING_PIPELINE_NAME, deletedAt: null },
      select: {
        id: true,
        stages: { where: { leadStageCode: "NEW", type: "OPEN", deletedAt: null }, take: 1, select: { id: true, name: true } },
      },
    });
    const stage = pipeline?.stages[0] ?? null;
    if (!pipeline || !stage) fail("O pipeline Anúncios não possui a etapa Novo lead.", "ADVERTISING_PIPELINE_UNAVAILABLE", 503);
    const receipts = await database.marketingFormReceipt.findMany({
      where: { workspaceId: context.workspaceId, marketingFormId: form.id, status: "ACCEPTED", deletedAt: null },
      select: { id: true },
    });
    const submissions = receipts.length
      ? await database.leadFormSubmission.findMany({
          where: { workspaceId: context.workspaceId, marketingFormId: form.id, marketingFormReceiptId: { in: receipts.map((receipt) => receipt.id) }, leadId: { not: null } },
          select: { marketingFormReceiptId: true, leadId: true },
        })
      : [];
    const leadIds = [...new Set(submissions.flatMap((submission) => submission.leadId ? [submission.leadId] : []))];
    const leads = leadIds.length
      ? await database.lead.findMany({
          where: { workspaceId: context.workspaceId, id: { in: leadIds }, deletedAt: null },
          select: { id: true, pipelineId: true, currentStageId: true, pipeline: { select: { name: true } }, currentStage: { select: { name: true } } },
        })
      : [];
    const moveIds = leads.filter((lead) => lead.pipelineId !== pipeline.id || lead.currentStageId !== stage.id).map((lead) => lead.id);
    const [historyCount, humanHistoryLeads, closedHistoryLeads] = moveIds.length
      ? await Promise.all([
          database.stageHistory.count({ where: { workspaceId: context.workspaceId, leadId: { in: moveIds } } }),
          database.stageHistory.findMany({ where: { workspaceId: context.workspaceId, leadId: { in: moveIds }, transitionOrigin: { in: ["PIPELINE_BOARD", "PIPELINE_LIST", "LEAD_CARD"] } }, distinct: ["leadId"], select: { leadId: true } }),
          database.stageHistory.findMany({ where: { workspaceId: context.workspaceId, leadId: { in: moveIds }, exitedAt: { not: null } }, distinct: ["leadId"], select: { leadId: true } }),
        ])
      : [0, [], []];
    const distribution = new Map<string, number>();
    for (const lead of leads) {
      const key = `${lead.pipeline.name} · ${lead.currentStage.name}`;
      distribution.set(key, (distribution.get(key) ?? 0) + 1);
    }
    return {
      form,
      pipeline,
      stage,
      moveIds,
      summary: {
        formId: form.id,
        formName: form.name,
        revision: form.revision,
        status: form.status,
        target: { pipeline: ADVERTISING_PIPELINE_NAME, stage: stage.name },
        futureResponsesConfigured: destinationMatches(form.draftDefinition, pipeline.id, stage.id)
          && Boolean(form.publishedVersion && destinationMatches(form.publishedVersion.definition, pipeline.id, stage.id)),
        acceptedResponses: receipts.length,
        linkedResponses: new Set(submissions.map((submission) => submission.marketingFormReceiptId)).size,
        unlinkedResponses: Math.max(0, receipts.length - new Set(submissions.map((submission) => submission.marketingFormReceiptId)).size),
        distinctLeads: leadIds.length,
        availableLeads: leads.length,
        missingLeads: Math.max(0, leadIds.length - leads.length),
        alreadyRouted: leads.length - moveIds.length,
        toMove: moveIds.length,
        preservedHistoryRows: historyCount,
        leadsWithHumanStageHistory: humanHistoryLeads.length,
        leadsWithClosedStageHistory: closedHistoryLeads.length,
        distribution: [...distribution].map(([location, count]) => ({ location, count })),
      },
    };
  }

  async function moveExistingLeads(context: AuthenticatedContext, formId: string) {
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form-advertising-sync:${context.workspaceId}:${formId}`}, 0))`;
      const snapshot = await inspect(context, formId, transaction);
      const moved = [] as string[];
      for (const leadId of snapshot.moveIds) {
        const histories = await transaction.stageHistory.findMany({
          where: { workspaceId: context.workspaceId, leadId },
          orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
          select: { id: true, enteredAt: true, exitedAt: true },
        });
        const lastEnteredAt = histories[0]?.enteredAt ?? options.now();
        const transitionAt = new Date(Math.max(options.now().getTime(), lastEnteredAt.getTime() + 1));
        await transaction.stageHistory.updateMany({
          where: { workspaceId: context.workspaceId, leadId, exitedAt: null },
          data: { exitedAt: transitionAt, exitedByActorId: context.actorId },
        });
        await transaction.lead.update({
          where: { id: leadId },
          data: {
            pipelineId: snapshot.pipeline.id,
            currentStageId: snapshot.stage.id,
            status: "OPEN",
            disqualificationReasonId: null,
            updatedByActorId: context.actorId,
            updatedAt: transitionAt,
          },
        });
        await transaction.stageHistory.create({
          data: {
            workspaceId: context.workspaceId,
            pipelineId: snapshot.pipeline.id,
            stageId: snapshot.stage.id,
            leadId,
            enteredAt: transitionAt,
            enteredByActorId: context.actorId,
            transitionOrigin: "SYSTEM",
            transitionReason: "Resposta existente do formulário encaminhada ao pipeline de Anúncios.",
            managerCorrection: true,
          },
        });
        moved.push(leadId);
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "marketing.form.advertising_sync_applied",
          entityType: "MarketingForm",
          entityId: formId,
          changes: {
            acceptedResponses: snapshot.summary.acceptedResponses,
            linkedResponses: snapshot.summary.linkedResponses,
            distinctLeads: snapshot.summary.distinctLeads,
            movedLeads: moved.length,
            alreadyRouted: snapshot.summary.alreadyRouted,
            preservedHistoryRows: snapshot.summary.preservedHistoryRows,
            createdTasks: 0,
            createdActivities: 0,
            createdGoals: 0,
            targetPipelineId: snapshot.pipeline.id,
            targetStageId: snapshot.stage.id,
          },
        },
      });
      return moved.length;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
  }

  async function run(context: AuthenticatedContext, formId: string, raw: unknown) {
    const input = inputSchema.parse(raw);
    await authorize(context, formId);
    if (input.mode === "PREVIEW") return { mode: input.mode, ...(await inspect(context, formId)).summary };
    await options.ensurePipeline(options.database, context.workspaceId, context.actorId);
    let snapshot = await inspect(context, formId);
    if (snapshot.form.revision !== input.expectedRevision) {
      fail("O formulário foi alterado por outra sessão.", "MARKETING_FORM_REVISION_CONFLICT", 409);
    }
    const parsed = marketingFormDefinitionSchema.safeParse(snapshot.form.draftDefinition);
    if (!parsed.success) fail("O rascunho do formulário é inválido.", "MARKETING_FORM_DEFINITION_INVALID", 422);
    const destination = {
      ...parsed.data.destination,
      pipelineId: snapshot.pipeline.id,
      initialStageId: snapshot.stage.id,
    };
    let revision = snapshot.form.revision;
    const draftChanged = !destinationMatches(snapshot.form.draftDefinition, snapshot.pipeline.id, snapshot.stage.id);
    if (draftChanged) {
      const updated = await options.marketingForms.updateDraft(context, formId, {
        name: snapshot.form.name,
        expectedRevision: revision,
        definition: { ...parsed.data, destination },
      });
      revision = updated.revision;
    }
    const publishedChanged = !snapshot.form.publishedVersion || !destinationMatches(snapshot.form.publishedVersion.definition, snapshot.pipeline.id, snapshot.stage.id);
    if (draftChanged || publishedChanged) {
      const published = await options.marketingForms.action(context, formId, { action: "PUBLISH", expectedRevision: revision });
      if (!("form" in published)) fail("Não foi possível publicar o novo destino.", "MARKETING_FORM_PUBLISH_FAILED", 500);
      revision = published.form.revision;
    }
    const movedLeads = await moveExistingLeads(context, formId);
    snapshot = await inspect(context, formId);
    return { mode: input.mode, ...snapshot.summary, revision, movedLeads };
  }

  return Object.freeze({ run });
}

let singleton: ReturnType<typeof createMarketingFormAdvertisingSyncService> | undefined;

export function getMarketingFormAdvertisingSyncService() {
  if (!singleton) {
    const database = getDatabaseClient();
    const authorization = getAuthorizationService();
    const marketingForms = getMarketingFormService();
    singleton = createMarketingFormAdvertisingSyncService({ database, authorization, marketingForms, now: () => new Date(), ensurePipeline: ensureAdvertisingPipeline });
  }
  return singleton;
}
