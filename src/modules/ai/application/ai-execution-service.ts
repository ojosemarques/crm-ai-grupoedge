import { createHash } from "node:crypto";

import { z } from "zod";

import { getVersionedPrompt } from "@/ai/prompts";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  aiAgentTypeSchema,
  aiAnalysisInputSchema,
  parseAIOutput,
  type AIValidatedOutput,
} from "@/modules/ai/domain/ai-contracts";
import { agentUseCaseMap } from "@/modules/ai/domain/ai-governance-contracts";
import { minimizeAIInput } from "@/modules/ai/domain/ai-safety-policy";
import type { AIProvider } from "@/modules/ai/providers/ai-provider";
import { AIProviderError } from "@/modules/ai/providers/ai-provider";
import { GovernedAIProvider } from "@/modules/ai/providers/governed-provider";
import { MockAIProvider } from "@/modules/ai/providers/mock-ai-provider";
import { createAIProvider } from "@/modules/ai/providers/provider-factory";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LEAD"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("OPPORTUNITY"), id: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal("WORKSPACE"),
      teamId: z.string().uuid().optional(),
    })
    .strict(),
]);

const executeAIRequestSchema = z
  .object({
    agent: aiAgentTypeSchema,
    target: targetSchema,
    input: aiAnalysisInputSchema,
  })
  .strict();

export type ExecuteAIRequest = z.input<typeof executeAIRequestSchema>;

export type AIExecutionResult = Readonly<{
  insightId: string;
  executionTraceId: string;
  agent: AIValidatedOutput["agent"];
  prompt: Readonly<{ key: string; version: number }>;
  requestedProviderKey: string;
  providerKey: string;
  mode: "LOCAL_DETERMINISTIC" | "EXTERNAL" | "FALLBACK_LOCAL";
  providerFailureCode: string | null;
  output: AIValidatedOutput;
  persistedAt: string;
}>;

type AuthorizationPort = Readonly<{
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.AI_USE,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type AIExecutionServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  provider: AIProvider;
  fallbackProvider?: AIProvider;
  now?: () => Date;
  monotonicNow?: () => number;
}>;

type ResolvedTarget = Readonly<{
  resource: ResourceScope;
  leadId: string | null;
  opportunityId: string | null;
  targetType: "WORKSPACE" | "LEAD" | "OPPORTUNITY";
}>;

function notFound(): never {
  throw new ApplicationError("Registro não encontrado.", {
    code: "NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

function invalidRequest(error: z.ZodError): never {
  throw new ApplicationError("Solicitação de IA inválida.", {
    code: "INVALID_AI_REQUEST",
    statusCode: 400,
    expose: true,
    cause: error,
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function providerFailureCode(error: unknown): string {
  if (error instanceof AIProviderError) return error.code;
  if (error instanceof z.ZodError) return "PROVIDER_INVALID_RESPONSE";
  return "PROVIDER_UNAVAILABLE";
}

export function createAIExecutionService(options: AIExecutionServiceOptions) {
  const fallbackProvider = options.fallbackProvider ?? new MockAIProvider();
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const governedProviders = new Map<string, GovernedAIProvider>();

  function governedProviderFor(version: {
    id: string;
    timeoutMs: number;
    maxRetries: number;
    rateLimitPerMinute: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxEstimatedCostCents: number;
  }) {
    const policyKey = [
      version.id,
      version.timeoutMs,
      version.maxRetries,
      version.rateLimitPerMinute,
      version.maxInputTokens,
      version.maxOutputTokens,
      version.maxEstimatedCostCents,
    ].join(":");
    const existing = governedProviders.get(policyKey);
    if (existing) return existing;
    const created = new GovernedAIProvider(options.provider, {
      timeoutMs: version.timeoutMs,
      maxRetries: version.maxRetries,
      rateLimitPerMinute: version.rateLimitPerMinute,
      maxInputTokens: version.maxInputTokens,
      maxOutputTokens: version.maxOutputTokens,
      maxEstimatedCostCents: version.maxEstimatedCostCents,
      circuitFailureThreshold: 3,
      circuitResetMs: 30_000,
    });
    governedProviders.set(policyKey, created);
    return created;
  }

  async function resolveTarget(
    context: AuthenticatedContext,
    target: z.output<typeof targetSchema>,
  ): Promise<ResolvedTarget> {
    if (target.type === "LEAD") {
      const lead = await options.database.lead.findFirst({
        where: { id: target.id, workspaceId: context.workspaceId, deletedAt: null },
        select: {
          id: true,
          ownerMemberId: true,
          queueId: true,
          routingQueue: { select: { teamId: true } },
          queue: { select: { teamId: true } },
        },
      });
      if (!lead) notFound();
      return {
        targetType: "LEAD",
        leadId: lead.id,
        opportunityId: null,
        resource: {
          workspaceId: context.workspaceId,
          resourceType: "Lead",
          resourceId: lead.id,
          ownerMemberId: lead.ownerMemberId,
          queueId: lead.ownerMemberId ? null : lead.queueId,
          teamId: lead.ownerMemberId
            ? null
            : lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
        },
      };
    }

    if (target.type === "OPPORTUNITY") {
      const opportunity = await options.database.opportunity.findFirst({
        where: { id: target.id, workspaceId: context.workspaceId, deletedAt: null },
        select: { id: true, ownerMemberId: true },
      });
      if (!opportunity) notFound();
      return {
        targetType: "OPPORTUNITY",
        leadId: null,
        opportunityId: opportunity.id,
        resource: {
          workspaceId: context.workspaceId,
          resourceType: "Opportunity",
          resourceId: opportunity.id,
          ownerMemberId: opportunity.ownerMemberId,
        },
      };
    }

    if (target.teamId) {
      const team = await options.database.team.findFirst({
        where: { id: target.teamId, workspaceId: context.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!team) notFound();
    }
    return {
      targetType: "WORKSPACE",
      leadId: null,
      opportunityId: null,
      resource: {
        workspaceId: context.workspaceId,
        resourceType: "Workspace",
        resourceId: context.workspaceId,
        teamId: target.teamId ?? null,
      },
    };
  }

  async function execute(
    context: AuthenticatedContext,
    request: ExecuteAIRequest,
  ): Promise<AIExecutionResult> {
    const parsed = executeAIRequestSchema.safeParse(request);
    if (!parsed.success) invalidRequest(parsed.error);
    const target = await resolveTarget(context, parsed.data.target);
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, target.resource);

    const aiActor = await options.database.actor.findFirst({
      where: {
        workspaceId: context.workspaceId,
        key: "ai:recommendation",
        type: "AI_AGENT",
      },
      select: { id: true },
    });
    if (!aiActor) {
      throw new ApplicationError("Ator técnico de IA não configurado.", {
        code: "AI_ACTOR_UNAVAILABLE",
        statusCode: 503,
      });
    }

    const useCaseKey = agentUseCaseMap[parsed.data.agent];
    const useCaseVersion = await options.database.aIUseCaseVersion.findFirst({
      where: {
        workspaceId: context.workspaceId,
        key: useCaseKey,
        status: "APPROVED",
      },
      orderBy: { version: "desc" },
    });
    if (!useCaseVersion) {
      throw new ApplicationError("Caso de uso de IA sem versão aprovada.", {
        code: "AI_USE_CASE_NOT_APPROVED",
        statusCode: 409,
        expose: true,
      });
    }
    const workspace = await options.database.workspace.findUniqueOrThrow({
      where: { id: context.workspaceId },
      select: { timeZone: true },
    });
    const allowedInputFields = Array.isArray(useCaseVersion.allowedInputFields)
      ? useCaseVersion.allowedInputFields.filter((value): value is string => typeof value === "string")
      : [];
    const safety = minimizeAIInput(useCaseKey, parsed.data.input, allowedInputFields);
    if (safety.estimatedInputTokens > useCaseVersion.maxInputTokens) {
      throw new ApplicationError("A entrada excedeu o orçamento aprovado para este caso de uso.", {
        code: "AI_INPUT_BUDGET_EXCEEDED",
        statusCode: 413,
        expose: true,
      });
    }

    const prompt = getVersionedPrompt(parsed.data.agent);
    const requestedProvider = options.provider;
    const governedProvider = governedProviderFor(useCaseVersion);
    const startedAt = monotonicNow();
    const requestedAt = now();
    const requestFingerprint = fingerprint({
      agent: parsed.data.agent,
      target: parsed.data.target,
      useCase: { key: useCaseVersion.key, version: useCaseVersion.version },
      prompt: { key: prompt.key, version: prompt.version },
      inputFingerprint: safety.inputFingerprint,
    });
    const trace = await options.database.aIExecutionTrace.create({
      data: {
        workspaceId: context.workspaceId,
        useCaseVersionId: useCaseVersion.id,
        status: "RUNNING",
        targetType: target.targetType,
        targetId: target.leadId ?? target.opportunityId ?? context.workspaceId,
        requestFingerprint,
        inputFingerprint: safety.inputFingerprint,
        asOf: requestedAt,
        timeZone: workspace.timeZone,
        providerKey: requestedProvider.key,
        model: requestedProvider.engineVersion,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        configurationVersion: useCaseVersion.configurationVersion,
        allowedFieldCount: safety.allowedFieldCount,
        blockedFieldCount: safety.blockedFieldCount,
        redactionMetadata: json(safety.redactionMetadata),
        estimatedInputTokens: safety.estimatedInputTokens,
        requestedByActorId: context.actorId,
        startedAt: requestedAt,
      },
    });
    let response;
    let output: AIValidatedOutput;
    let actualProvider = requestedProvider;
    let failureCode: string | null = null;
    let mode: "LOCAL_DETERMINISTIC" | "EXTERNAL" | "FALLBACK_LOCAL" =
      requestedProvider.mode;

    try {
      response = await governedProvider.generate({
        agent: parsed.data.agent,
        prompt,
        input: safety.input,
      });
      output = parseAIOutput(parsed.data.agent, response.output);
    } catch (error) {
      failureCode = providerFailureCode(error);
      actualProvider = fallbackProvider;
      mode = requestedProvider.mode === "EXTERNAL" ? "FALLBACK_LOCAL" : "LOCAL_DETERMINISTIC";
      try {
        response = await fallbackProvider.generate({
          agent: parsed.data.agent,
          prompt,
          input: safety.input,
        });
        output = parseAIOutput(parsed.data.agent, response.output);
      } catch (fallbackError) {
        await options.database.aIExecutionTrace.update({
          where: { id: trace.id },
          data: {
            status: "FAILED",
            providerFailureCode: providerFailureCode(fallbackError),
            fallbackReason: failureCode,
            durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
            completedAt: now(),
          },
        });
        throw fallbackError;
      }
    }

    const durationMs = Math.max(0, Math.round(monotonicNow() - startedAt));
    const persistedAt = now();
    const requiresConfirmation = output.action !== null || output.alternativeAction !== null;
    let insight;
    try {
      insight = await options.database.$transaction(async (transaction) => {
        const created = await transaction.aIInsight.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: target.leadId,
          opportunityId: target.opportunityId,
          targetType: target.targetType,
          agentType: parsed.data.agent,
          engine: mode === "EXTERNAL" ? "LLM" : "RULE_ENGINE",
          engineVersion: actualProvider.engineVersion,
          requestedProviderKey: requestedProvider.key,
          providerKey: actualProvider.key,
          providerMode: mode,
          providerModel: response.model,
          promptKey: prompt.key,
          promptVersion: prompt.version,
          requestFingerprint,
          confidenceBps: Math.round(output.confidence * 10_000),
          durationMs,
          providerFailureCode: failureCode,
          title: prompt.name,
          recommendation: output.action?.title ?? output.summary,
          explanation: output.action?.reason ?? output.summary,
          facts: json(output.facts),
          inferences: json(output.inferences),
          missingData: json(output.missingFields),
          evidence: json({
            contractVersion: 1,
            summary: output.summary,
            evidence: output.evidence,
            pacto: output.pacto,
            questions: output.questions,
            score: output.score,
            priority: output.priority,
            action: output.action,
            alternativeAction: output.alternativeAction,
            urgency: output.urgency,
            confidence: output.confidence,
            risks: output.risks,
          }),
          requiresConfirmation,
          requestedByActorId: context.actorId,
          createdByActorId: aiActor.id,
          createdAt: persistedAt,
        },
      });

      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: aiActor.id,
          aiInsightId: created.id,
          action: "ai.insight.generated",
          origin: "AI",
          entityType: "AIInsight",
          entityId: created.id,
          changes: {
            after: {
              agent: parsed.data.agent,
              status: "OPEN",
              requiresConfirmation,
            },
          },
          metadata: {
            requestedByActorId: context.actorId,
            targetType: target.targetType,
            targetId: target.leadId ?? target.opportunityId ?? context.workspaceId,
            promptKey: prompt.key,
            promptVersion: prompt.version,
            requestedProviderKey: requestedProvider.key,
            providerKey: actualProvider.key,
            providerMode: mode,
            providerFailureCode: failureCode,
            inputSummary: {
              factsCount: parsed.data.input.facts.length,
              requiredFieldsCount: parsed.data.input.requiredFields.length,
              hasScoreSignals: Boolean(parsed.data.input.scoreSignals),
              hasTextExcerpt: Boolean(parsed.data.input.textExcerpt),
            },
          },
          occurredAt: persistedAt,
        },
      });
      if (target.leadId) {
        await transaction.activity.create({
          data: {
            workspaceId: context.workspaceId,
            leadId: target.leadId,
            type: "AI_ACTION",
            direction: "INTERNAL",
            result: "INFORMATION",
            subject: prompt.name,
            description: "Recomendação explicável gerada; nenhuma alteração foi aplicada sem confirmação humana.",
            occurredAt: persistedAt,
            newValues: {
              insightId: created.id,
              agent: parsed.data.agent,
              status: "OPEN",
              requiresConfirmation,
            },
            createdByActorId: aiActor.id,
            updatedByActorId: aiActor.id,
            createdAt: persistedAt,
            updatedAt: persistedAt,
          },
        });
      }
      await transaction.aIExecutionTrace.update({
        where: { id: trace.id },
        data: {
          aiInsightId: created.id,
          status: mode === "FALLBACK_LOCAL" ? "FALLBACK" : "SUCCEEDED",
          providerKey: actualProvider.key,
          model: response.model ?? actualProvider.engineVersion,
          confidenceBps: Math.round(output.confidence * 10_000),
          durationMs,
          estimatedOutputTokens: Math.ceil(JSON.stringify(output).length / 4),
          estimatedCostCents: 0,
          providerFailureCode: failureCode,
          fallbackReason: failureCode,
          completedAt: persistedAt,
        },
      });
        return created;
      });
    } catch (error) {
      await options.database.aIExecutionTrace.update({
        where: { id: trace.id },
        data: {
          status: "FAILED",
          providerFailureCode: "PERSISTENCE_FAILURE",
          durationMs,
          completedAt: now(),
        },
      });
      throw error;
    }

    return {
      insightId: insight.id,
      executionTraceId: trace.id,
      agent: output.agent,
      prompt: { key: prompt.key, version: prompt.version },
      requestedProviderKey: requestedProvider.key,
      providerKey: actualProvider.key,
      mode,
      providerFailureCode: failureCode,
      output,
      persistedAt: insight.createdAt.toISOString(),
    };
  }

  return Object.freeze({ execute });
}

let aiExecutionService: ReturnType<typeof createAIExecutionService> | undefined;

export function getAIExecutionService(): ReturnType<typeof createAIExecutionService> {
  aiExecutionService ??= createAIExecutionService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    provider: createAIProvider(),
  });
  return aiExecutionService;
}
