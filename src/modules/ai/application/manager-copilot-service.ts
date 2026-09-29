import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  getAIExecutionService,
  type AIExecutionResult,
} from "@/modules/ai/application/ai-execution-service";
import type {
  ManagerCopilotConfirmation,
  ManagerCopilotResult,
} from "@/modules/ai/domain/manager-copilot-contracts";
import {
  getManagerAnalyticsService,
} from "@/modules/metrics/application/manager-analytics-service";
import {
  managerQuestionIds,
  type ManagerAnalyticsAnswer,
  type ManagerAnalyticsShell,
} from "@/modules/metrics/domain/manager-analytics-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AnalyticsPort = Readonly<{
  getShell: (context: AuthenticatedContext, input: unknown) => Promise<ManagerAnalyticsShell>;
  answer: (context: AuthenticatedContext, input: unknown) => Promise<ManagerAnalyticsAnswer>;
}>;

type ExecutionPort = Readonly<{
  execute: (
    context: AuthenticatedContext,
    request: Parameters<ReturnType<typeof getAIExecutionService>["execute"]>[1],
  ) => Promise<AIExecutionResult>;
}>;

type ManagerCopilotServiceOptions = Readonly<{
  database: PrismaClient;
  analytics: AnalyticsPort;
  execution: ExecutionPort;
  now: () => Date;
}>;

const filtersSchema = z.object({
  sdrMemberIds: z.array(z.string().uuid()).max(100),
  closerMemberIds: z.array(z.string().uuid()).max(100),
  teamIds: z.array(z.string().uuid()).max(100),
  sourceIds: z.array(z.string().uuid()).max(100),
  campaignIds: z.array(z.string().uuid()).max(100),
  creativeIds: z.array(z.string().uuid()).max(100),
  priorityCodes: z.array(z.enum(["P1", "P2", "P3"])).max(3),
  productIds: z.array(z.string().uuid()).max(100),
}).strict();

const querySchema = z.object({
  preset: z.enum(["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"]),
  fromDate: z.string(),
  toDate: z.string(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  filters: filtersSchema,
}).strict();

const runSchema = z.object({
  questionId: z.enum(managerQuestionIds),
  query: querySchema,
}).strict();

const confirmationSchema = z.object({
  insightId: z.string().uuid(),
  decision: z.enum(["CONFIRM", "REJECT"]),
  note: z.string().trim().min(3).max(1_000),
}).strict();

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(error.issues.map((issue) => issue.message).join(" "), {
    code: "INVALID_INPUT", statusCode: 400, expose: true,
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function compact(value: string, maximum = 1_900) {
  return value.slice(0, maximum);
}

function aiInput(answer: ManagerAnalyticsAnswer) {
  const facts = [
    { field: "question", value: answer.question, source: "METRIC" as const },
    { field: "direct_answer", value: compact(answer.directAnswer), source: "METRIC" as const },
    { field: "period", value: `${answer.period.from}/${answer.period.to}`, source: "METRIC" as const },
    { field: "formula", value: compact(answer.formula), source: "METRIC" as const },
    { field: "numerator", value: `${answer.numerator.label}: ${answer.numerator.value}`, source: "METRIC" as const },
    ...(answer.denominator ? [{ field: "denominator", value: `${answer.denominator.label}: ${answer.denominator.value}`, source: "METRIC" as const }] : []),
    { field: "recommended_action", value: compact(answer.recommendedAction.title), source: "METRIC" as const },
    { field: "recommended_action_reason", value: compact(answer.recommendedAction.reason), source: "METRIC" as const },
    { field: "limitations", value: compact(answer.limitations.join(" | ") || "Nenhuma limitação adicional."), source: "METRIC" as const },
  ];
  return {
    facts,
    requiredFields: [],
    currentState: {},
  };
}

export function createManagerCopilotService(options: ManagerCopilotServiceOptions) {
  async function getShell(context: AuthenticatedContext, input: unknown) {
    return options.analytics.getShell(context, input);
  }

  async function run(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<ManagerCopilotResult> {
    const parsed = runSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    const answer = await options.analytics.answer(context, parsed.data);
    const team = answer.scope === "TEAM"
      ? await options.database.teamMember.findFirst({
          where: {
            workspaceId: context.workspaceId,
            workspaceMemberId: context.memberId,
            deletedAt: null,
            team: { deletedAt: null },
          },
          orderBy: [{ teamId: "asc" }],
          select: { teamId: true },
        })
      : null;
    if (answer.scope === "TEAM" && !team) {
      throw new ApplicationError("Não há equipe ativa para executar a consulta gerencial.", {
        code: "ACCESS_DENIED", statusCode: 403, expose: true,
      });
    }
    const execution = await options.execution.execute(context, {
      agent: "MANAGER_COPILOT",
      target: { type: "WORKSPACE", ...(team ? { teamId: team.teamId } : {}) },
      input: aiInput(answer),
    });
    await options.database.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        aiInsightId: execution.insightId,
        action: "ai.manager.query",
        origin: "API",
        entityType: "Workspace",
        entityId: context.workspaceId,
        changes: json({
          questionId: answer.questionId,
          period: answer.period,
          filters: answer.filters,
          formula: answer.formula,
          numerator: answer.numerator,
          denominator: answer.denominator,
          numbers: answer.numbers,
          comparison: answer.comparison,
          possibleCauses: answer.possibleCauses,
          limitations: answer.limitations,
          confidence: answer.confidence,
        }),
        metadata: {
          relatedRecordKeys: answer.relatedRecords.map((record) => record.key),
          relatedRecordCount: answer.relatedRecords.length,
          promptKey: execution.prompt.key,
          promptVersion: execution.prompt.version,
          providerMode: execution.mode,
        },
        occurredAt: new Date(execution.persistedAt),
      },
    });
    return Object.freeze({
      answer,
      trace: Object.freeze({
        insightId: execution.insightId,
        status: "OPEN" as const,
        promptKey: execution.prompt.key,
        promptVersion: execution.prompt.version,
        providerKey: execution.providerKey,
        mode: execution.mode,
        providerFailureCode: execution.providerFailureCode,
        confidence: execution.output.confidence,
        persistedAt: execution.persistedAt,
      }),
    });
  }

  async function confirm(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<ManagerCopilotConfirmation> {
    const parsed = confirmationSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    await options.analytics.getShell(context, { preset: "MONTH" });
    const insight = await options.database.aIInsight.findFirst({
      where: {
        id: parsed.data.insightId,
        workspaceId: context.workspaceId,
        requestedByActorId: context.actorId,
        targetType: "WORKSPACE",
        agentType: "MANAGER_COPILOT",
      },
      select: { id: true, status: true },
    });
    if (!insight) {
      throw new ApplicationError("Consulta gerencial não encontrada.", {
        code: "NOT_FOUND", statusCode: 404, expose: true,
      });
    }
    if (insight.status !== "OPEN") {
      throw new ApplicationError("Esta recomendação gerencial já foi revisada.", {
        code: "AI_INSIGHT_ALREADY_REVIEWED", statusCode: 409, expose: true,
      });
    }
    const status = parsed.data.decision === "CONFIRM" ? "ACCEPTED" as const : "REJECTED" as const;
    const confirmedAt = options.now();
    await options.database.$transaction(async (transaction) => {
      const updated = await transaction.aIInsight.updateMany({
        where: {
          id: insight.id,
          workspaceId: context.workspaceId,
          requestedByActorId: context.actorId,
          status: "OPEN",
        },
        data: { status, confirmedByActorId: context.actorId, confirmedAt },
      });
      if (updated.count !== 1) {
        throw new ApplicationError("Esta recomendação gerencial já foi revisada.", {
          code: "AI_INSIGHT_ALREADY_REVIEWED", statusCode: 409, expose: true,
        });
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          aiInsightId: insight.id,
          action: parsed.data.decision === "CONFIRM"
            ? "ai.manager.recommendation_confirmed"
            : "ai.manager.recommendation_rejected",
          origin: "DOMAIN",
          entityType: "AIInsight",
          entityId: insight.id,
          reason: parsed.data.note,
          changes: { before: { status: "OPEN" }, after: { status } },
          metadata: { domainMutationExecuted: false },
          occurredAt: confirmedAt,
        },
      });
    });
    return Object.freeze({
      insightId: insight.id,
      status,
      confirmedAt: confirmedAt.toISOString(),
      message: status === "ACCEPTED"
        ? "Plano de ação confirmado e auditado; nenhuma alteração de domínio foi executada."
        : "Recomendação rejeitada e auditada; nenhuma alteração de domínio foi executada.",
    });
  }

  return Object.freeze({ getShell, run, confirm });
}

let service: ReturnType<typeof createManagerCopilotService> | undefined;

export function getManagerCopilotService() {
  service ??= createManagerCopilotService({
    database: getDatabaseClient(),
    analytics: getManagerAnalyticsService(),
    execution: getAIExecutionService(),
    now: () => new Date(),
  });
  return service;
}
