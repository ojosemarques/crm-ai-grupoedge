import {
  Prisma,
  type PrismaClient,
  type QualificationCriterionStatus,
} from "@/generated/prisma/client";
import type {
  AuthenticatedContext,
} from "@/modules/auth/application/authenticated-context";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import {
  getActiveScoringRule,
  recordScoreInTransaction,
  type PreparedScore,
} from "@/modules/qualification/application/lead-scoring-service";
import { calculatePactoScore } from "@/modules/qualification/domain/score-calculator";
import {
  qualificationEvidenceOrigins,
  pactoDimensionGuidance,
  pactoDimensionLabels,
  pactoDimensions,
  pactoStatuses,
  type PactoDimensionKey,
  type PactoQualificationView,
} from "@/modules/qualification/domain/pacto-contracts";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.LEADS_READ | typeof PermissionKeys.LEADS_WRITE,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.LEADS_READ | typeof PermissionKeys.LEADS_WRITE,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type PactoServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  beforeCommit?: () => Promise<void>;
}>;

const dimensionInputSchema = z
  .object({
    dimension: z.enum(pactoDimensions),
    status: z.enum(pactoStatuses),
    note: z.string().trim().max(2_000).nullable().optional(),
    evidence: z.string().trim().max(5_000).nullable().optional(),
    origin: z.enum(qualificationEvidenceOrigins).nullable().optional(),
  })
  .strict();

const mutationSchema = z
  .object({
    leadId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    dimensions: z.array(dimensionInputSchema).length(5),
  })
  .strict();

const querySchema = z.object({ leadId: z.string().uuid() }).strict();

const suggestionSchema = z
  .object({
    leadId: z.string().uuid(),
    submissionId: z.string().uuid().optional(),
    origin: z.enum(["FORM", "AI"]),
    dimensions: z
      .array(
        z.object({
          dimension: z.enum(pactoDimensions),
          status: z.enum(pactoStatuses).refine((status) => status !== "UNKNOWN", {
            message: "Uma sugestão não pode representar ausência de dado.",
          }),
          note: z.string().trim().max(2_000).nullable().optional(),
          evidence: z.string().trim().min(2).max(5_000),
        }).strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

type LeadScope = Readonly<{
  id: string;
  ownerMemberId: string | null;
  queueId: string | null;
  routingQueue: { teamId: string | null } | null;
  queue: { teamId: string | null } | null;
}>;

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(
    error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

function resourceForLead(workspaceId: string, lead: LeadScope): ResourceScope {
  return {
    workspaceId,
    resourceType: "Lead",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

async function findLead(database: PrismaClient, workspaceId: string, leadId: string) {
  const lead = await database.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      ownerMemberId: true,
      queueId: true,
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
    },
  });
  if (!lead) {
    throw new ApplicationError("Lead não encontrado.", {
      code: "NOT_FOUND",
      statusCode: 404,
      expose: true,
    });
  }
  return lead;
}

async function lockLead(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  leadId: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`lead-distribution:${workspaceId}:${leadId}`}, 0)
    )
  `;
}

function normalizeDimensions(
  dimensions: readonly z.output<typeof dimensionInputSchema>[],
) {
  const byDimension = new Map(dimensions.map((item) => [item.dimension, item]));
  if (byDimension.size !== pactoDimensions.length) {
    conflict("PACTO_DIMENSIONS_INVALID", "Informe cada dimensão do PACTO exatamente uma vez.");
  }
  return pactoDimensions.map((dimension) => {
    const item = byDimension.get(dimension)!;
    const note = item.note?.trim() || null;
    const evidence = item.evidence?.trim() || null;
    const origin = item.origin ?? null;
    if (item.status !== "UNKNOWN" && (!evidence || !origin)) {
      conflict(
        "PACTO_EVIDENCE_REQUIRED",
        `${pactoDimensionLabels[dimension]} exige evidência e origem humana.`,
      );
    }
    return {
      dimension,
      status: item.status,
      note,
      evidence: item.status === "UNKNOWN" ? null : evidence,
      origin: item.status === "UNKNOWN" ? null : origin,
    };
  });
}

function legacyProjection(dimensions: ReturnType<typeof normalizeDimensions>) {
  const byDimension = new Map(dimensions.map((item) => [item.dimension, item]));
  const project = (dimension: PactoDimensionKey) => {
    const item = byDimension.get(dimension)!;
    return {
      status: item.status as QualificationCriterionStatus,
      evidence: item.evidence
        ? { text: item.evidence, note: item.note, origin: item.origin }
        : Prisma.DbNull,
    };
  };
  return {
    problem: project("POLITICAL_CONTEXT"),
    consequence: project("AFFLICTION"),
    objective: project("CAPACITY"),
    authority: project("DECISION"),
    timing: project("OPPORTUNITY_NOW"),
  };
}

async function mutateQualification(
  options: PactoServiceOptions,
  context: AuthenticatedContext,
  payload: unknown,
  kind: "DRAFT_SAVED" | "VALIDATED",
) {
  const parsed = mutationSchema.safeParse(payload);
  if (!parsed.success) invalidInput(parsed.error);
  const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
  await options.authorization.assertAuthorized(
    context,
    PermissionKeys.LEADS_WRITE,
    resourceForLead(context.workspaceId, lead),
  );
  const dimensions = normalizeDimensions(parsed.data.dimensions);

  return options.database.$transaction(async (transaction) => {
    await lockLead(transaction, context.workspaceId, lead.id);
    const transactionalLead = await transaction.lead.findFirst({
      where: { id: lead.id, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        lastActivityAt: true,
        nextActionAt: true,
        nextActionDescription: true,
      },
    });
    if (!transactionalLead) {
      throw new ApplicationError("Lead não encontrado.", {
        code: "NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }
    const workspace = await transaction.workspace.findUniqueOrThrow({
      where: { id: context.workspaceId },
      select: { pactoMinimumInvestigatedDimensions: true },
    });
    const existing = await transaction.leadQualification.findUnique({
      where: { workspaceId_leadId: { workspaceId: context.workspaceId, leadId: lead.id } },
      select: { id: true, revision: true, status: true },
    });
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== parsed.data.expectedRevision) {
      conflict(
        "PACTO_CONCURRENT_UPDATE",
        "A qualificação foi alterada por outra pessoa. Recarregue antes de salvar.",
      );
    }
    const investigatedDimensions = dimensions.filter((item) => item.status !== "UNKNOWN").length;
    const missingDimensions = dimensions
      .filter((item) => item.status === "UNKNOWN")
      .map((item) => item.dimension);
    const hasDisqualifyingDimension = dimensions.some(
      (item) => item.status === "DISQUALIFYING",
    );
    if (
      kind === "VALIDATED" &&
      investigatedDimensions < workspace.pactoMinimumInvestigatedDimensions
    ) {
      conflict(
        "PACTO_INCOMPLETE",
        `PACTO incompleto. Faltam: ${missingDimensions.map((item) => pactoDimensionLabels[item]).join(", ")}.`,
      );
    }

    const occurredAt = options.now();
    const revision = currentRevision + 1;
    const qualificationStatus = kind === "VALIDATED" ? "COMPLETED" : "IN_PROGRESS";
    const validationActorId = kind === "VALIDATED" ? context.actorId : null;
    const validationAt = kind === "VALIDATED" ? occurredAt : null;
    const projection = legacyProjection(dimensions);
    const qualification = existing
      ? await transaction.leadQualification.update({
          where: { id: existing.id },
          data: {
            status: qualificationStatus,
            revision,
            minimumRequiredDimensions: workspace.pactoMinimumInvestigatedDimensions,
            validatedAt: validationAt,
            validatedByActorId: validationActorId,
            assessedAt: occurredAt,
            updatedByActorId: context.actorId,
            updatedAt: occurredAt,
            problemStatus: projection.problem.status,
            problemEvidence: projection.problem.evidence,
            consequenceStatus: projection.consequence.status,
            consequenceEvidence: projection.consequence.evidence,
            objectiveStatus: projection.objective.status,
            objectiveEvidence: projection.objective.evidence,
            authorityStatus: projection.authority.status,
            authorityEvidence: projection.authority.evidence,
            timingStatus: projection.timing.status,
            timingEvidence: projection.timing.evidence,
          },
        })
      : await transaction.leadQualification.create({
          data: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            status: qualificationStatus,
            revision,
            minimumRequiredDimensions: workspace.pactoMinimumInvestigatedDimensions,
            validatedAt: validationAt,
            validatedByActorId: validationActorId,
            assessedAt: occurredAt,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
            createdAt: occurredAt,
            updatedAt: occurredAt,
            problemStatus: projection.problem.status,
            problemEvidence: projection.problem.evidence,
            consequenceStatus: projection.consequence.status,
            consequenceEvidence: projection.consequence.evidence,
            objectiveStatus: projection.objective.status,
            objectiveEvidence: projection.objective.evidence,
            authorityStatus: projection.authority.status,
            authorityEvidence: projection.authority.evidence,
            timingStatus: projection.timing.status,
            timingEvidence: projection.timing.evidence,
          },
        });

    for (const dimension of dimensions) {
      const recorded = dimension.status === "UNKNOWN" ? null : occurredAt;
      await transaction.pactoAssessment.upsert({
        where: {
          workspaceId_leadId_dimension: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            dimension: dimension.dimension,
          },
        },
        create: {
          workspaceId: context.workspaceId,
          qualificationId: qualification.id,
          leadId: lead.id,
          ...dimension,
          recordedAt: recorded,
          recordedByActorId: recorded ? context.actorId : null,
          validatedAt: validationAt && recorded ? validationAt : null,
          validatedByActorId: validationAt && recorded ? context.actorId : null,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        update: {
          status: dimension.status,
          note: dimension.note,
          evidence: dimension.evidence,
          origin: dimension.origin,
          recordedAt: recorded,
          recordedByActorId: recorded ? context.actorId : null,
          validatedAt: validationAt && recorded ? validationAt : null,
          validatedByActorId: validationAt && recorded ? context.actorId : null,
          updatedAt: occurredAt,
        },
      });
    }

    const isQualificationReady =
      kind === "VALIDATED" &&
      investigatedDimensions >= workspace.pactoMinimumInvestigatedDimensions &&
      !hasDisqualifyingDimension;
    const history = await transaction.pactoRevision.create({
      data: {
        workspaceId: context.workspaceId,
        qualificationId: qualification.id,
        leadId: lead.id,
        revisionNumber: revision,
        kind,
        qualificationStatus,
        minimumRequiredDimensions: workspace.pactoMinimumInvestigatedDimensions,
        investigatedDimensions,
        hasDisqualifyingDimension,
        isQualificationReady,
        createdByActorId: context.actorId,
        createdAt: occurredAt,
      },
      select: { id: true },
    });
    await transaction.pactoRevisionDimension.createMany({
      data: dimensions.map((dimension) => ({
        workspaceId: context.workspaceId,
        revisionId: history.id,
        ...dimension,
        recordedAt: dimension.status === "UNKNOWN" ? null : occurredAt,
        recordedByActorId: dimension.status === "UNKNOWN" ? null : context.actorId,
        validatedAt: validationAt && dimension.status !== "UNKNOWN" ? validationAt : null,
        validatedByActorId:
          validationAt && dimension.status !== "UNKNOWN" ? context.actorId : null,
        createdAt: occurredAt,
      })),
    });

    if (kind === "VALIDATED") {
      const scoringRule = await getActiveScoringRule(transaction, context.workspaceId);
      if (scoringRule) {
        const preparedScore: PreparedScore = {
          rule: scoringRule,
          calculation: calculatePactoScore(
            dimensions.map((dimension) => ({
              dimension: dimension.dimension,
              status: dimension.status,
              evidence: dimension.evidence,
            })),
            scoringRule,
          ),
          inputSnapshot: {
            pactoRevisionId: history.id,
            dimensions: dimensions.map((dimension) => ({
              dimension: dimension.dimension,
              status: dimension.status,
              evidence: dimension.evidence,
            })),
          },
        };
        await recordScoreInTransaction(transaction, {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          actorId: context.actorId,
          source: "SDR_VALIDATED",
          prepared: preparedScore,
          pactoRevisionId: history.id,
          makeCurrent: true,
          calculatedAt: occurredAt,
          action: "lead.score.sdr_validated",
        });
      }
    }

    const activity = await transaction.activity.create({
      data: {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        type: "STATUS_CHANGE",
        direction: "INTERNAL",
        result: kind === "VALIDATED" ? "COMPLETED" : "INFORMATION",
        subject: kind === "VALIDATED" ? "Qualificação PACTO validada" : "Rascunho PACTO salvo",
        description:
          kind === "VALIDATED"
            ? `${investigatedDimensions} dimensões investigadas; prontidão: ${isQualificationReady ? "sim" : "não"}.`
            : `${investigatedDimensions} dimensões investigadas; validação humana pendente.`,
        occurredAt,
        nextActionAt: transactionalLead.nextActionAt,
        nextActionDescription: transactionalLead.nextActionDescription,
        previousValues: { revision: currentRevision, status: existing?.status ?? "NOT_STARTED" },
        newValues: {
          revision,
          status: qualificationStatus,
          investigatedDimensions,
          hasDisqualifyingDimension,
          isQualificationReady,
        },
        createdByActorId: context.actorId,
        updatedByActorId: context.actorId,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    });
    if (kind === "VALIDATED") {
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId: context.workspaceId,
        eventKey: `pacto-revision:${history.id}:validated:v1`,
        eventType: "PACTO_VALIDATED",
        occurredAt,
        sourceEntityType: "PactoRevision",
        sourceEntityId: history.id,
        leadId: lead.id,
        activityId: activity.id,
        teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
        creditedMemberId: lead.ownerMemberId,
        performedByMemberId: context.memberId,
        leadOwnerMemberIdAtEvent: lead.ownerMemberId,
        activityType: "STATUS_CHANGE",
        result: isQualificationReady ? "READY" : "VALIDATED_WITH_GAPS",
        executionMode: "MANUAL",
        safeMetadata: { revision, investigatedDimensions, hasDisqualifyingDimension, minimumRequiredDimensions: workspace.pactoMinimumInvestigatedDimensions },
      });
    }
    await transaction.lead.update({
      where: { id: lead.id },
      data: {
        lastActivityAt:
          occurredAt > transactionalLead.lastActivityAt
            ? occurredAt
            : transactionalLead.lastActivityAt,
        updatedByActorId: context.actorId,
        updatedAt: occurredAt,
      },
    });
    await transaction.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action: kind === "VALIDATED" ? "lead.pacto.validated" : "lead.pacto.draft_saved",
        entityType: "LeadQualification",
        entityId: qualification.id,
        occurredAt,
        changes: {
          leadId: lead.id,
          revision,
          investigatedDimensions,
          missingDimensions,
          hasDisqualifyingDimension,
          isQualificationReady,
        },
        metadata: { pactoRevisionId: history.id },
      },
    });
    await options.beforeCommit?.();
    return Object.freeze({
      qualificationId: qualification.id,
      revision,
      status: qualificationStatus,
      investigatedDimensions,
      missingDimensions,
      hasDisqualifyingDimension,
      isQualificationReady,
    });
  });
}

export function createPactoQualificationService(options: PactoServiceOptions) {
  async function getPacto(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<PactoQualificationView> {
    const parsed = querySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    const resource = resourceForLead(context.workspaceId, lead);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_READ, resource);
    const canWrite = (
      await options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, resource)
    ).allowed;
    const [workspace, qualification, suggestions] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true, pactoMinimumInvestigatedDimensions: true },
      }),
      options.database.leadQualification.findUnique({
        where: {
          workspaceId_leadId: { workspaceId: context.workspaceId, leadId: lead.id },
        },
        include: {
          validatedBy: { select: { displayName: true } },
          assessments: {
            include: {
              recordedBy: { select: { displayName: true } },
              validatedBy: { select: { displayName: true } },
            },
          },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 20,
            include: {
              createdBy: { select: { displayName: true } },
              dimensions: {
                include: {
                  recordedBy: { select: { displayName: true } },
                  validatedBy: { select: { displayName: true } },
                },
              },
            },
          },
        },
      }),
      options.database.pactoSuggestion.findMany({
        where: { workspaceId: context.workspaceId, leadId: lead.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        include: { createdBy: { select: { displayName: true } } },
      }),
    ]);
    const currentByDimension = new Map(
      qualification?.assessments.map((item) => [item.dimension, item]) ?? [],
    );
    const mapDimension = (dimension: PactoDimensionKey, item?: {
      status: QualificationCriterionStatus;
      note: string | null;
      evidence: string | null;
      origin: string | null;
      recordedAt: Date | null;
      validatedAt: Date | null;
      recordedBy: { displayName: string } | null;
      validatedBy: { displayName: string } | null;
    }) => ({
      dimension,
      label: pactoDimensionLabels[dimension],
      guidance: pactoDimensionGuidance[dimension],
      status: (item?.status ?? "UNKNOWN") as PactoQualificationView["dimensions"][number]["status"],
      note: item?.note ?? null,
      evidence: item?.evidence ?? null,
      origin: item?.origin ?? null,
      recordedAt: item?.recordedAt?.toISOString() ?? null,
      recordedBy: item?.recordedBy?.displayName ?? null,
      validatedAt: item?.validatedAt?.toISOString() ?? null,
      validatedBy: item?.validatedBy?.displayName ?? null,
    });
    const dimensions = pactoDimensions.map((dimension) =>
      mapDimension(dimension, currentByDimension.get(dimension)),
    );
    const minimumRequiredDimensions =
      qualification?.minimumRequiredDimensions ?? workspace.pactoMinimumInvestigatedDimensions;
    const investigatedDimensions = dimensions.filter((item) => item.status !== "UNKNOWN").length;
    const missingDimensions = dimensions
      .filter((item) => item.status === "UNKNOWN")
      .map((item) => item.dimension);
    const hasDisqualifyingDimension = dimensions.some(
      (item) => item.status === "DISQUALIFYING",
    );
    const suggestionViews = suggestions.map((item) => ({
      id: item.id,
      dimension: item.dimension,
      label: pactoDimensionLabels[item.dimension],
      status: item.status as PactoQualificationView["dimensions"][number]["status"],
      note: item.note,
      evidence: item.evidence,
      origin: item.origin as "FORM" | "AI",
      createdBy: item.createdBy.displayName,
      createdAt: item.createdAt.toISOString(),
    }));
    return Object.freeze({
      leadId: lead.id,
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      revision: qualification?.revision ?? 0,
      aggregateStatus: qualification?.status ?? "NOT_STARTED",
      minimumRequiredDimensions,
      investigatedDimensions,
      missingDimensions,
      hasDisqualifyingDimension,
      isQualificationReady:
        qualification?.status === "COMPLETED" &&
        investigatedDimensions >= minimumRequiredDimensions &&
        !hasDisqualifyingDimension,
      validatedAt: qualification?.validatedAt?.toISOString() ?? null,
      validatedBy: qualification?.validatedBy?.displayName ?? null,
      canWrite,
      dimensions,
      formPrequalification: suggestionViews.filter((item) => item.origin === "FORM"),
      aiSuggestions: suggestionViews.filter((item) => item.origin === "AI"),
      history:
        qualification?.revisions.map((revision) => ({
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          kind: revision.kind,
          qualificationStatus: revision.qualificationStatus,
          minimumRequiredDimensions: revision.minimumRequiredDimensions,
          investigatedDimensions: revision.investigatedDimensions,
          hasDisqualifyingDimension: revision.hasDisqualifyingDimension,
          isQualificationReady: revision.isQualificationReady,
          createdBy: revision.createdBy.displayName,
          createdAt: revision.createdAt.toISOString(),
          dimensions: pactoDimensions.map((dimension) =>
            mapDimension(
              dimension,
              revision.dimensions.find((item) => item.dimension === dimension),
            ),
          ),
        })) ?? [],
    });
  }

  async function recordSuggestion(context: ServiceActorContext, payload: unknown) {
    const parsed = suggestionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const actor = await options.database.actor.findFirst({
      where: {
        id: context.actorId,
        workspaceId: context.workspaceId,
        type: context.actorType,
        userId: null,
      },
      select: { id: true },
    });
    if (!actor) {
      throw new ApplicationError("Ator automático inválido.", {
        code: "INVALID_SERVICE_ACTOR",
        statusCode: 403,
        expose: true,
      });
    }
    if (
      (parsed.data.origin === "FORM" && context.actorType !== "SYSTEM") ||
      (parsed.data.origin === "AI" && context.actorType !== "AI_AGENT") ||
      (parsed.data.origin === "FORM" && !parsed.data.submissionId) ||
      (parsed.data.origin === "AI" && parsed.data.submissionId)
    ) {
      throw new ApplicationError("Origem da sugestão incompatível com o ator.", {
        code: "INVALID_SUGGESTION_SOURCE",
        statusCode: 400,
        expose: true,
      });
    }
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      if (parsed.data.submissionId) {
        const submission = await transaction.leadFormSubmission.findFirst({
          where: {
            id: parsed.data.submissionId,
            leadId: lead.id,
            workspaceId: context.workspaceId,
          },
          select: { id: true },
        });
        if (!submission) {
          throw new ApplicationError("Submissão do formulário não encontrada.", {
            code: "NOT_FOUND",
            statusCode: 404,
            expose: true,
          });
        }
      }
      const occurredAt = options.now();
      const created = await transaction.pactoSuggestion.createManyAndReturn({
        data: parsed.data.dimensions.map((dimension) => ({
          workspaceId: context.workspaceId,
          leadId: lead.id,
          submissionId: parsed.data.submissionId ?? null,
          ...dimension,
          note: dimension.note?.trim() || null,
          origin: parsed.data.origin,
          createdByActorId: context.actorId,
          createdAt: occurredAt,
        })),
        select: { id: true },
      });
      await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          type: parsed.data.origin === "AI" ? "AI_ACTION" : "STATUS_CHANGE",
          direction: "INTERNAL",
          result: "INFORMATION",
          subject:
            parsed.data.origin === "AI"
              ? "Sugestão de PACTO registrada pela IA"
              : "Pré-qualificação do formulário registrada",
          description: "Sinal separado da validação humana; nenhum status vigente foi alterado.",
          occurredAt,
          newValues: { suggestionIds: created.map((item) => item.id), origin: parsed.data.origin },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action:
            parsed.data.origin === "AI"
              ? "lead.pacto.ai_suggested"
              : "lead.pacto.form_prequalified",
          entityType: "Lead",
          entityId: lead.id,
          occurredAt,
          changes: { suggestionIds: created.map((item) => item.id) },
          metadata: { origin: parsed.data.origin },
        },
      });
      return Object.freeze({ suggestionIds: created.map((item) => item.id) });
    });
  }

  return Object.freeze({
    getPacto,
    saveDraft: (context: AuthenticatedContext, payload: unknown) =>
      mutateQualification(options, context, payload, "DRAFT_SAVED"),
    validate: (context: AuthenticatedContext, payload: unknown) =>
      mutateQualification(options, context, payload, "VALIDATED"),
    recordSuggestion,
  });
}

let service: ReturnType<typeof createPactoQualificationService> | undefined;

export function getPactoQualificationService() {
  service ??= createPactoQualificationService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
