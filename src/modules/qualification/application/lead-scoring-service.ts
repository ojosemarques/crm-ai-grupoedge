import type {
  LeadScoreSource,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import {
  calculateFormScore,
  calculatePactoScore,
  priorityForScore,
} from "@/modules/qualification/domain/score-calculator";
import {
  scoreSourceLabels,
  scoringRuleKey,
  type ScoreFactorKey,
  type LeadScoreView,
  type ScoreCalculation,
  type ScoreComponent,
  type ScoringRule,
} from "@/modules/qualification/domain/scoring-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.LEADS_READ | typeof PermissionKeys.LEADS_WRITE,
    resource: Readonly<{
      workspaceId: string;
      resourceType: string;
      ownerMemberId: string | null;
      queueId: string | null;
      teamId: string | null;
    }>,
  ) => Promise<void>;
  authorize: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.LEADS_WRITE,
    resource: Readonly<{
      workspaceId: string;
      resourceType: string;
      ownerMemberId: string | null;
      queueId: string | null;
      teamId: string | null;
    }>,
  ) => Promise<Readonly<{ allowed: boolean }>>;
}>;

type ScoringServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  beforeCommit?: () => Promise<void>;
}>;

type PreparedScore = Readonly<{
  rule: ScoringRule;
  calculation: ScoreCalculation;
  inputSnapshot: Prisma.InputJsonValue;
}>;

const querySchema = z.object({ leadId: z.string().uuid() }).strict();
const overrideSchema = z.object({
  leadId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  reason: z.string().trim().min(3).max(1_000),
}).strict();
const recalculateSchema = z.object({
  leadId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
const aiSuggestionSchema = z.object({
  leadId: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  reason: z.string().trim().min(3).max(2_000),
  components: z.array(z.object({
    factor: z.enum([
      "PAIN", "CAPACITY", "DECISION", "INTENT", "CONTEXT",
      "NO_CAPACITY", "NO_PAIN", "CURIOSITY", "INVALID_CONTACT",
      "NO_DECISION_ACCESS", "AI_SUGGESTION",
    ]),
    points: z.number().int().min(-100).max(100),
    maxPoints: z.number().int().min(0).max(100),
    reason: z.string().trim().min(2).max(1_000),
    missingData: z.boolean().default(false),
  }).strict()).min(1).max(12),
}).strict();

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(error.issues.map((issue) => issue.message).join("; "), {
    code: "INVALID_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function ruleFromRecord(record: Readonly<{
  id: string;
  key: string;
  version: number;
  algorithmKey: string;
  painMaxPoints: number;
  capacityMaxPoints: number;
  decisionMaxPoints: number;
  intentMaxPoints: number;
  contextMaxPoints: number;
  partialFactorBasisPoints: number;
  noCapacityPenalty: number;
  noPainPenalty: number;
  curiosityPenalty: number;
  invalidContactPenalty: number;
  noDecisionAccessPenalty: number;
  capacityFullThresholdCents: bigint;
  p1Minimum: number;
  p2Minimum: number;
}>): ScoringRule {
  return Object.freeze({ ...record });
}

export async function getActiveScoringRule(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
): Promise<ScoringRule | null> {
  const rule = await transaction.scoringRuleVersion.findFirst({
    where: { workspaceId, key: scoringRuleKey, active: true },
    orderBy: { version: "desc" },
  });
  return rule ? ruleFromRecord(rule) : null;
}

export async function prepareFormProvisionalScore(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  input: Readonly<{
    interestSummary?: string | null | undefined;
    budgetCents: bigint | null;
    jobTitle?: string | null | undefined;
    organizationName?: string | null | undefined;
    city?: string | null | undefined;
    stateCode?: string | null | undefined;
  }>,
): Promise<PreparedScore | null> {
  const rule = await getActiveScoringRule(transaction, workspaceId);
  if (!rule) return null;
  const normalized = {
    interestSummary: input.interestSummary ?? null,
    budgetCents: input.budgetCents,
    jobTitle: input.jobTitle ?? null,
    organizationName: input.organizationName ?? null,
    city: input.city ?? null,
    stateCode: input.stateCode ?? null,
  };
  return {
    rule,
    calculation: calculateFormScore(normalized, rule),
    inputSnapshot: {
      interestSummary: normalized.interestSummary,
      budgetCents: normalized.budgetCents?.toString() ?? null,
      jobTitle: normalized.jobTitle,
      organizationName: normalized.organizationName,
      city: normalized.city,
      stateCode: normalized.stateCode,
    },
  };
}

function leadPriority(priority: "P1" | "P2" | "P3") {
  if (priority === "P1") return "URGENT" as const;
  if (priority === "P2") return "HIGH" as const;
  return "MEDIUM" as const;
}

export async function recordScoreInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    actorId: string;
    source: LeadScoreSource;
    prepared: PreparedScore;
    submissionId?: string | null;
    pactoRevisionId?: string | null;
    overrideReason?: string | null;
    makeCurrent: boolean;
    calculatedAt: Date;
    expectedRevision?: number;
    action: string;
  }>,
) {
  const [current, leadState] = await Promise.all([
    transaction.leadCurrentScore.findUnique({
      where: {
        workspaceId_leadId: { workspaceId: input.workspaceId, leadId: input.leadId },
      },
      include: { leadScore: { select: { score: true, priorityBandCode: true } } },
    }),
    transaction.lead.findUniqueOrThrow({
      where: { id: input.leadId },
      select: { lastActivityAt: true },
    }),
  ]);
  const revision = current?.revision ?? 0;
  if (input.makeCurrent && input.expectedRevision !== undefined && revision !== input.expectedRevision) {
    throw new ApplicationError(
      "A pontuação foi alterada por outra pessoa. Recarregue antes de continuar.",
      { code: "SCORE_CONCURRENT_UPDATE", statusCode: 409, expose: true },
    );
  }
  const nextRevision = input.makeCurrent ? revision + 1 : null;
  const created = await transaction.leadScore.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      scoringRuleVersionId: input.prepared.rule.id,
      submissionId: input.submissionId ?? null,
      pactoRevisionId: input.pactoRevisionId ?? null,
      source: input.source,
      priorityBandCode: input.prepared.calculation.priorityBandCode,
      score: input.prepared.calculation.score,
      currentRevision: nextRevision,
      modelKey: input.prepared.rule.algorithmKey,
      modelVersion: String(input.prepared.rule.version),
      reason: input.prepared.calculation.reason,
      overrideReason: input.overrideReason ?? null,
      evidence: {
        positiveFactors: input.prepared.calculation.components.filter((item) => item.points > 0).map((item) => item.factor),
        negativeFactors: input.prepared.calculation.components.filter((item) => item.points < 0).map((item) => item.factor),
        missingFactors: input.prepared.calculation.components.filter((item) => item.missingData).map((item) => item.factor),
      },
      inputSnapshot: input.prepared.inputSnapshot,
      calculatedByActorId: input.actorId,
      calculatedAt: input.calculatedAt,
    },
    select: { id: true },
  });
  await transaction.leadScoreComponent.createMany({
    data: input.prepared.calculation.components.map((component) => ({
      workspaceId: input.workspaceId,
      leadScoreId: created.id,
      factor: component.factor,
      points: component.points,
      maxPoints: component.maxPoints,
      reason: component.reason,
      missingData: component.missingData,
      ...(component.evidence ? { evidence: component.evidence } : {}),
      createdAt: input.calculatedAt,
    })),
  });

  if (input.makeCurrent) {
    await transaction.leadCurrentScore.upsert({
      where: {
        workspaceId_leadId: { workspaceId: input.workspaceId, leadId: input.leadId },
      },
      create: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        leadScoreId: created.id,
        revision: nextRevision!,
        updatedByActorId: input.actorId,
        updatedAt: input.calculatedAt,
      },
      update: {
        leadScoreId: created.id,
        revision: nextRevision!,
        updatedByActorId: input.actorId,
        updatedAt: input.calculatedAt,
      },
    });
  }

  await transaction.activity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      type: input.source === "AI_SUGGESTED" ? "AI_ACTION" : "STATUS_CHANGE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: input.makeCurrent ? "Pontuação vigente atualizada" : "Sugestão de pontuação registrada",
      description: `${input.prepared.calculation.score} pontos · ${input.prepared.calculation.priorityBandCode}. ${input.prepared.calculation.reason}`,
      occurredAt: input.calculatedAt,
      ...(input.makeCurrent && current
        ? {
            previousValues: {
              score: current.leadScore.score,
              priorityBandCode: current.leadScore.priorityBandCode,
              revision,
            },
          }
        : {}),
      newValues: {
        scoreId: created.id,
        score: input.prepared.calculation.score,
        priorityBandCode: input.prepared.calculation.priorityBandCode,
        source: input.source,
        currentRevision: nextRevision,
        makeCurrent: input.makeCurrent,
      },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
      createdAt: input.calculatedAt,
      updatedAt: input.calculatedAt,
    },
  });
  await transaction.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      entityType: "LeadScore",
      entityId: created.id,
      occurredAt: input.calculatedAt,
      changes: {
        leadId: input.leadId,
        score: input.prepared.calculation.score,
        priorityBandCode: input.prepared.calculation.priorityBandCode,
        source: input.source,
        currentRevision: nextRevision,
        makeCurrent: input.makeCurrent,
      },
      metadata: {
        ruleKey: input.prepared.rule.key,
        ruleVersion: input.prepared.rule.version,
        algorithmKey: input.prepared.rule.algorithmKey,
      },
    },
  });
  await transaction.lead.update({
    where: { id: input.leadId },
    data: {
      ...(input.makeCurrent
        ? { priority: leadPriority(input.prepared.calculation.priorityBandCode) }
        : {}),
      lastActivityAt:
        leadState.lastActivityAt && leadState.lastActivityAt > input.calculatedAt
          ? leadState.lastActivityAt
          : input.calculatedAt,
      updatedByActorId: input.actorId,
      updatedAt: input.calculatedAt,
    },
  });
  return { scoreId: created.id, revision: nextRevision, ...input.prepared.calculation };
}

async function lockLead(transaction: Prisma.TransactionClient, workspaceId: string, leadId: string) {
  await transaction.$executeRaw`
    SELECT 1 FROM "leads" WHERE "workspaceId" = ${workspaceId}::uuid AND "id" = ${leadId}::uuid FOR UPDATE
  `;
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
  if (!lead) throw new ApplicationError("Lead não encontrado.", { code: "NOT_FOUND", statusCode: 404, expose: true });
  return lead;
}

function resourceForLead(workspaceId: string, lead: Awaited<ReturnType<typeof findLead>>) {
  return {
    workspaceId,
    resourceType: "LeadScore",
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

function componentView(component: Readonly<{
  factor: string;
  points: number;
  maxPoints: number;
  reason: string;
  missingData: boolean;
  evidence: unknown;
}>): ScoreComponent {
  return {
    factor: component.factor as ScoreComponent["factor"],
    points: component.points,
    maxPoints: component.maxPoints,
    reason: component.reason,
    missingData: component.missingData,
    ...(component.evidence && typeof component.evidence === "object"
      ? { evidence: component.evidence as Record<string, string | number | boolean | null> }
      : {}),
  };
}

export function createLeadScoringService(options: ScoringServiceOptions) {
  async function getScore(context: AuthenticatedContext, payload: unknown): Promise<LeadScoreView> {
    const parsed = querySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    const resource = resourceForLead(context.workspaceId, lead);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_READ, resource);
    const canWrite = (await options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, resource)).allowed;
    const [workspace, projection, history, suggestions] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } }),
      options.database.leadCurrentScore.findUnique({
        where: { workspaceId_leadId: { workspaceId: context.workspaceId, leadId: lead.id } },
        include: {
          leadScore: {
            include: {
              scoringRuleVersion: true,
              calculatedBy: { select: { displayName: true } },
              components: { orderBy: [{ factor: "asc" }, { id: "asc" }] },
            },
          },
        },
      }),
      options.database.leadScore.findMany({
        where: { workspaceId: context.workspaceId, leadId: lead.id },
        orderBy: [
          { currentRevision: { sort: "desc", nulls: "last" } },
          { calculatedAt: "desc" },
          { id: "desc" },
        ],
        take: 50,
        include: { calculatedBy: { select: { displayName: true } }, scoringRuleVersion: { select: { version: true } } },
      }),
      options.database.leadScore.findMany({
        where: { workspaceId: context.workspaceId, leadId: lead.id, source: "AI_SUGGESTED" },
        orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
        take: 20,
        include: {
          calculatedBy: { select: { displayName: true } },
          components: { orderBy: [{ factor: "asc" }, { id: "asc" }] },
        },
      }),
    ]);
    const current = projection?.leadScore;
    return Object.freeze({
      leadId: lead.id,
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      revision: projection?.revision ?? 0,
      canWrite,
      current: current ? {
        id: current.id,
        score: current.score,
        priorityBandCode: current.priorityBandCode,
        source: current.source,
        sourceLabel: scoreSourceLabels[current.source],
        reason: current.reason,
        overrideReason: current.overrideReason,
        rule: current.scoringRuleVersion ? {
          key: current.scoringRuleVersion.key,
          version: current.scoringRuleVersion.version,
          algorithmKey: current.scoringRuleVersion.algorithmKey,
        } : null,
        calculatedBy: current.calculatedBy.displayName,
        calculatedAt: current.calculatedAt.toISOString(),
        components: current.components.map(componentView),
      } : null,
      suggestions: suggestions.map((score) => ({
        id: score.id,
        score: score.score,
        priorityBandCode: score.priorityBandCode,
        source: "AI_SUGGESTED" as const,
        reason: score.reason,
        calculatedBy: score.calculatedBy.displayName,
        calculatedAt: score.calculatedAt.toISOString(),
        components: score.components.map(componentView),
      })),
      history: history.map((score) => ({
        id: score.id,
        score: score.score,
        priorityBandCode: score.priorityBandCode,
        source: score.source,
        sourceLabel: scoreSourceLabels[score.source],
        reason: score.reason,
        overrideReason: score.overrideReason,
        currentRevision: score.currentRevision,
        ruleVersion: score.scoringRuleVersion?.version ?? null,
        calculatedBy: score.calculatedBy.displayName,
        calculatedAt: score.calculatedAt.toISOString(),
      })),
    });
  }

  async function override(context: AuthenticatedContext, payload: unknown) {
    const parsed = overrideSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_WRITE, resourceForLead(context.workspaceId, lead));
    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const rule = await getActiveScoringRule(transaction, context.workspaceId);
      if (!rule) throw new ApplicationError("Regra de pontuação ativa não configurada.", { code: "SCORING_RULE_UNAVAILABLE", statusCode: 409, expose: true });
      const component: ScoreComponent = { factor: "HUMAN_OVERRIDE", points: parsed.data.score, maxPoints: 100, reason: parsed.data.reason, missingData: false };
      const prepared: PreparedScore = {
        rule,
        calculation: { score: parsed.data.score, priorityBandCode: priorityForScore(parsed.data.score, rule), reason: `Override humano: ${parsed.data.reason}`, components: [component] },
        inputSnapshot: { score: parsed.data.score, reason: parsed.data.reason },
      };
      const result = await recordScoreInTransaction(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        actorId: context.actorId,
        source: "HUMAN_OVERRIDE",
        prepared,
        overrideReason: parsed.data.reason,
        makeCurrent: true,
        calculatedAt: options.now(),
        expectedRevision: parsed.data.expectedRevision,
        action: "lead.score.overridden",
      });
      await options.beforeCommit?.();
      return result;
    });
  }

  async function recalculate(context: AuthenticatedContext, payload: unknown) {
    const parsed = recalculateSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_WRITE, resourceForLead(context.workspaceId, lead));
    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const rule = await getActiveScoringRule(transaction, context.workspaceId);
      if (!rule) throw new ApplicationError("Regra de pontuação ativa não configurada.", { code: "SCORING_RULE_UNAVAILABLE", statusCode: 409, expose: true });
      const pacto = await transaction.pactoRevision.findFirst({
        where: { workspaceId: context.workspaceId, leadId: lead.id, kind: "VALIDATED" },
        orderBy: { revisionNumber: "desc" },
        include: { dimensions: true },
      });
      let prepared: PreparedScore;
      let source: LeadScoreSource;
      let pactoRevisionId: string | null = null;
      let submissionId: string | null = null;
      if (pacto) {
        source = "SDR_VALIDATED";
        pactoRevisionId = pacto.id;
        prepared = {
          rule,
          calculation: calculatePactoScore(pacto.dimensions.map((item) => ({ dimension: item.dimension, status: item.status, evidence: item.evidence })), rule),
          inputSnapshot: { pactoRevisionId: pacto.id, dimensions: pacto.dimensions.map((item) => ({ dimension: item.dimension, status: item.status, evidence: item.evidence })) },
        };
      } else {
        const submission = await transaction.leadFormSubmission.findFirst({
          where: { workspaceId: context.workspaceId, leadId: lead.id, status: "LINKED" },
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        });
        if (!submission) throw new ApplicationError("Não há formulário ou PACTO validado para recalcular.", { code: "SCORING_INPUT_UNAVAILABLE", statusCode: 409, expose: true });
        source = "FORM_PROVISIONAL";
        submissionId = submission.id;
        prepared = {
          rule,
          calculation: calculateFormScore({ interestSummary: submission.submittedInterestSummary, budgetCents: submission.submittedBudgetCents, jobTitle: submission.submittedJobTitle, organizationName: submission.submittedOrganizationName, city: submission.submittedCity, stateCode: submission.submittedStateCode }, rule),
          inputSnapshot: { submissionId: submission.id },
        };
      }
      const result = await recordScoreInTransaction(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        actorId: context.actorId,
        source,
        prepared,
        submissionId,
        pactoRevisionId,
        makeCurrent: true,
        calculatedAt: options.now(),
        expectedRevision: parsed.data.expectedRevision,
        action: "lead.score.recalculated",
      });
      await options.beforeCommit?.();
      return result;
    });
  }

  async function recordAiSuggestion(context: ServiceActorContext, payload: unknown) {
    const parsed = aiSuggestionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    if (context.actorType !== "AI_AGENT") {
      throw new ApplicationError("Somente um ator de IA pode registrar esta sugestão.", {
        code: "INVALID_SERVICE_ACTOR",
        statusCode: 403,
        expose: true,
      });
    }
    const [actor, lead] = await Promise.all([
      options.database.actor.findFirst({
        where: {
          id: context.actorId,
          workspaceId: context.workspaceId,
          key: context.actorKey,
          type: "AI_AGENT",
          userId: null,
        },
        select: { id: true },
      }),
      findLead(options.database, context.workspaceId, parsed.data.leadId),
    ]);
    if (!actor) {
      throw new ApplicationError("Ator de IA inválido.", {
        code: "INVALID_SERVICE_ACTOR",
        statusCode: 403,
        expose: true,
      });
    }
    return options.database.$transaction(async (transaction) => {
      await lockLead(transaction, context.workspaceId, lead.id);
      const rule = await getActiveScoringRule(transaction, context.workspaceId);
      if (!rule) throw new ApplicationError("Regra de pontuação ativa não configurada.", { code: "SCORING_RULE_UNAVAILABLE", statusCode: 409, expose: true });
      const componentTotal = parsed.data.components.reduce((sum, item) => sum + item.points, 0);
      if (Math.max(0, Math.min(100, componentTotal)) !== parsed.data.score) {
        throw new ApplicationError("A sugestão de IA não reconcilia score e componentes.", {
          code: "INVALID_AI_SCORE",
          statusCode: 400,
          expose: true,
        });
      }
      const components: ScoreComponent[] = parsed.data.components.map((component) => ({
        ...component,
        factor: component.factor as ScoreFactorKey,
      }));
      const prepared: PreparedScore = {
        rule,
        calculation: {
          score: parsed.data.score,
          priorityBandCode: priorityForScore(parsed.data.score, rule),
          reason: parsed.data.reason,
          components,
        },
        inputSnapshot: { mode: "AI_SUGGESTION", componentCount: components.length },
      };
      const result = await recordScoreInTransaction(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        actorId: context.actorId,
        source: "AI_SUGGESTED",
        prepared,
        makeCurrent: false,
        calculatedAt: options.now(),
        action: "lead.score.ai_suggested",
      });
      await options.beforeCommit?.();
      return result;
    });
  }

  return Object.freeze({ getScore, override, recalculate, recordAiSuggestion });
}

let service: ReturnType<typeof createLeadScoringService> | undefined;

export function getLeadScoringService() {
  service ??= createLeadScoringService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}

export type { PreparedScore };
