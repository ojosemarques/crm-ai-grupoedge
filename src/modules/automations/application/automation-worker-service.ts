import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { AutomationActionExecutor, WorkerExecutionResult } from "@/modules/automations/domain/automation-contracts";
import { automationActionConfigSchema } from "@/modules/automations/domain/automation-contracts";
import { calculateBackoffSeconds } from "@/modules/automations/domain/automation-policy";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { logger } from "@/shared/core/logging/logger";

type AutomationWorkerOptions = Readonly<{
  database: PrismaClient;
  actionExecutor: AutomationActionExecutor;
  now: () => Date;
  lockTimeoutSeconds: number;
  backoffBaseSeconds: number;
}>;

type ClaimedJob = Readonly<{
  jobId: string;
  runId: string;
  ruleId: string;
  workspaceId: string;
  actorId: string;
  attemptId: string;
  attemptNumber: number;
  maxAttempts: number;
  idempotencyKey: string;
  actionType: Parameters<AutomationActionExecutor["execute"]>[1]["actionType"];
  actionConfig: unknown;
  inputPayload: unknown;
  ruleVersion: number;
  cancelRequestedAt: Date | null;
  ruleActive: boolean;
}>;

class AutomationCancelledError extends Error {
  constructor(readonly reason: "CANCEL_REQUESTED" | "RULE_INACTIVE") {
    super(reason);
    this.name = "AutomationCancelledError";
  }
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ApplicationError("A automação retornou uma saída inválida.", {
      code: "INVALID_AUTOMATION_OUTPUT",
      statusCode: 500,
    });
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function failureDetails(error: unknown): Readonly<{ code: string; message: string }> {
  if (error instanceof ApplicationError) {
    return {
      code: error.code,
      message: error.expose ? error.message.slice(0, 1_000) : "A ação da automação falhou.",
    };
  }
  return { code: "AUTOMATION_ACTION_FAILED", message: "A ação da automação falhou." };
}

export function createAutomationWorkerService(options: AutomationWorkerOptions) {
  async function claimNext(workerId: string): Promise<ClaimedJob | null> {
    const claimedAt = options.now();
    const lockExpiresAt = new Date(
      claimedAt.getTime() + options.lockTimeoutSeconds * 1_000,
    );
    return options.database.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "jobs"
        WHERE "type" = 'AUTOMATION'::"JobType"
          AND "automationRunId" IS NOT NULL
          AND "attempts" < "maxAttempts"
          AND (
            ("status" = 'PENDING'::"JobStatus" AND "runAt" <= ${claimedAt})
            OR (
              "status" = 'RUNNING'::"JobStatus"
              AND "lockExpiresAt" IS NOT NULL
              AND "lockExpiresAt" <= ${claimedAt}
            )
          )
        ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const candidate = candidates[0];
      if (!candidate) return null;

      const previous = await transaction.job.findUniqueOrThrow({
        where: { id: candidate.id },
        select: { id: true, workspaceId: true, status: true },
      });
      if (previous.status === "RUNNING") {
        await transaction.automationAttempt.updateMany({
          where: {
            workspaceId: previous.workspaceId,
            jobId: previous.id,
            status: "RUNNING",
          },
          data: {
            status: "FAILED",
            finishedAt: claimedAt,
            errorCode: "WORKER_LOCK_EXPIRED",
            errorMessage: "O worker anterior perdeu o lock antes de concluir.",
          },
        });
      }

      const job = await transaction.job.update({
        where: { id: candidate.id },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          lockedAt: claimedAt,
          lockedBy: workerId,
          lockExpiresAt,
          lastAttemptAt: claimedAt,
          finishedAt: null,
          cancelledAt: null,
          errorCode: null,
          lastError: null,
        },
        include: {
          automationRun: {
            include: { rule: { select: { status: true } } },
          },
        },
      });
      if (!job.automationRun) return null;

      await transaction.automationRun.update({
        where: { id: job.automationRun.id },
        data: {
          status: "RUNNING",
          startedAt: job.automationRun.startedAt ?? claimedAt,
          finishedAt: null,
          cancelledAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      const attempt = await transaction.automationAttempt.create({
        data: {
          workspaceId: job.workspaceId,
          automationRunId: job.automationRun.id,
          jobId: job.id,
          attemptNumber: job.attempts,
          workerId,
          status: "RUNNING",
          startedAt: claimedAt,
        },
      });

      return Object.freeze({
        jobId: job.id,
        runId: job.automationRun.id,
        ruleId: job.automationRun.automationRuleId,
        workspaceId: job.workspaceId,
        actorId: job.automationRun.actorId,
        attemptId: attempt.id,
        attemptNumber: job.attempts,
        maxAttempts: job.maxAttempts,
        idempotencyKey: job.idempotencyKey,
        actionType: job.automationRun.actionType,
        actionConfig: job.automationRun.actionConfigSnapshot,
        inputPayload: job.automationRun.inputPayload,
        ruleVersion: job.automationRun.ruleVersion,
        cancelRequestedAt: job.cancelRequestedAt,
        ruleActive: job.automationRun.rule.status === "ACTIVE",
      });
    });
  }

  async function finishCancelled(
    claim: ClaimedJob,
    reason: "CANCEL_REQUESTED" | "RULE_INACTIVE",
  ): Promise<WorkerExecutionResult> {
    const finishedAt = options.now();
    await options.database.$transaction(async (transaction) => {
      const updated = await transaction.job.updateMany({
        where: {
          id: claim.jobId,
          workspaceId: claim.workspaceId,
          status: "RUNNING",
          lockedBy: { not: null },
          attempts: claim.attemptNumber,
        },
        data: {
          status: "CANCELLED",
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
          finishedAt,
          cancelledAt: finishedAt,
          errorCode: reason,
          lastError:
            reason === "RULE_INACTIVE"
              ? "A regra não está ativa."
              : "Cancelamento solicitado.",
          updatedByActorId: claim.actorId,
        },
      });
      await transaction.automationAttempt.updateMany({
        where: { id: claim.attemptId, status: "RUNNING" },
        data: {
          status: "CANCELLED",
          finishedAt,
          errorCode: reason,
          errorMessage:
            reason === "RULE_INACTIVE"
              ? "A regra não está ativa."
              : "Cancelamento solicitado.",
        },
      });
      if (updated.count > 0) {
        await transaction.automationRun.update({
          where: { id: claim.runId },
          data: {
            status: "CANCELLED",
            finishedAt,
            cancelledAt: finishedAt,
            errorCode: reason,
            errorMessage:
              reason === "RULE_INACTIVE"
                ? "A regra não está ativa."
                : "Cancelamento solicitado.",
          },
        });
      }
    });
    return {
      status: "CANCELLED",
      jobId: claim.jobId,
      runId: claim.runId,
      attemptNumber: claim.attemptNumber,
      errorCode: reason,
    };
  }

  async function executeAction(claim: ClaimedJob): Promise<Readonly<Record<string, unknown>>> {
    const actionConfig = automationActionConfigSchema.safeParse(claim.actionConfig);
    if (!actionConfig.success) {
      throw new ApplicationError("Snapshot de configuração inválido.", {
        code: "INVALID_AUTOMATION_RULE",
        statusCode: 409,
        expose: true,
      });
    }
    const effectIdempotencyKey = `${claim.idempotencyKey}:action:${claim.actionType}`;
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`automation-effect:${claim.workspaceId}:${effectIdempotencyKey}`}, 0))
      `;
      const current = await transaction.job.findFirst({
        where: { id: claim.jobId, workspaceId: claim.workspaceId },
        select: {
          cancelRequestedAt: true,
          automationRun: { select: { rule: { select: { status: true } } } },
        },
      });
      if (current?.cancelRequestedAt) throw new AutomationCancelledError("CANCEL_REQUESTED");
      if (current?.automationRun?.rule.status !== "ACTIVE") {
        throw new AutomationCancelledError("RULE_INACTIVE");
      }

      const existing = await transaction.automationEffect.findFirst({
        where: { workspaceId: claim.workspaceId, idempotencyKey: effectIdempotencyKey },
        select: { status: true, outputPayload: true },
      });
      if (existing?.status === "SUCCEEDED") return asRecord(existing.outputPayload);

      const startedAt = options.now();
      const effect = await transaction.automationEffect.create({
        data: {
          workspaceId: claim.workspaceId,
          automationRunId: claim.runId,
          attemptId: claim.attemptId,
          idempotencyKey: effectIdempotencyKey,
          actionType: claim.actionType,
          status: "RUNNING",
          inputPayload: safeJson({
            actionConfig: actionConfig.data,
            event: asRecord(claim.inputPayload),
          }),
          startedAt,
        },
      });
      const output = await options.actionExecutor.execute(transaction, {
        workspaceId: claim.workspaceId,
        automationRunId: claim.runId,
        automationRuleId: claim.ruleId,
        ruleVersion: claim.ruleVersion,
        actionType: claim.actionType,
        actionConfig: actionConfig.data,
        eventPayload: asRecord(claim.inputPayload),
        effectIdempotencyKey,
        actorId: claim.actorId,
        now: startedAt,
      });
      const outputPayload = safeJson(output);
      await transaction.automationEffect.update({
        where: { id: effect.id },
        data: { status: "SUCCEEDED", outputPayload, finishedAt: options.now() },
      });
      return output;
    });
  }

  async function finishSucceeded(
    claim: ClaimedJob,
    output: Readonly<Record<string, unknown>>,
  ): Promise<WorkerExecutionResult> {
    const finishedAt = options.now();
    const outputPayload = safeJson(output);
    await options.database.$transaction(async (transaction) => {
      const updated = await transaction.job.updateMany({
        where: {
          id: claim.jobId,
          workspaceId: claim.workspaceId,
          status: "RUNNING",
          attempts: claim.attemptNumber,
        },
        data: {
          status: "SUCCEEDED",
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
          result: outputPayload,
          finishedAt,
          cancelledAt: null,
          errorCode: null,
          lastError: null,
          updatedByActorId: claim.actorId,
        },
      });
      await transaction.automationAttempt.updateMany({
        where: { id: claim.attemptId, status: "RUNNING" },
        data: { status: "SUCCEEDED", finishedAt, outputPayload },
      });
      if (updated.count > 0) {
        await transaction.automationRun.update({
          where: { id: claim.runId },
          data: {
            status: "SUCCEEDED",
            outputPayload,
            finishedAt,
            cancelledAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
      }
    });
    return {
      status: "SUCCEEDED",
      jobId: claim.jobId,
      runId: claim.runId,
      attemptNumber: claim.attemptNumber,
    };
  }

  async function finishFailed(claim: ClaimedJob, error: unknown): Promise<WorkerExecutionResult> {
    const finishedAt = options.now();
    const failure = failureDetails(error);
    const terminal = claim.attemptNumber >= claim.maxAttempts;
    const nextRunAt = new Date(
      finishedAt.getTime() +
        calculateBackoffSeconds(claim.attemptNumber, options.backoffBaseSeconds) * 1_000,
    );
    await options.database.$transaction(async (transaction) => {
      await transaction.automationAttempt.updateMany({
        where: { id: claim.attemptId, status: "RUNNING" },
        data: {
          status: "FAILED",
          finishedAt,
          errorCode: failure.code,
          errorMessage: failure.message,
        },
      });
      const updated = await transaction.job.updateMany({
        where: {
          id: claim.jobId,
          workspaceId: claim.workspaceId,
          status: "RUNNING",
          attempts: claim.attemptNumber,
        },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          runAt: terminal ? finishedAt : nextRunAt,
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
          errorCode: failure.code,
          lastError: failure.message,
          finishedAt: terminal ? finishedAt : null,
          cancelledAt: null,
          updatedByActorId: claim.actorId,
        },
      });
      if (updated.count > 0) {
        await transaction.automationRun.update({
          where: { id: claim.runId },
          data: {
            status: terminal ? "FAILED" : "PENDING",
            finishedAt: terminal ? finishedAt : null,
            errorCode: failure.code,
            errorMessage: failure.message,
          },
        });
      }
    });
    logger.warn(
      {
        jobId: claim.jobId,
        runId: claim.runId,
        attemptNumber: claim.attemptNumber,
        terminal,
        errorCode: failure.code,
      },
      terminal ? "Automação terminou em falha" : "Automação reagendada após falha",
    );
    return terminal
      ? {
          status: "FAILED",
          jobId: claim.jobId,
          runId: claim.runId,
          attemptNumber: claim.attemptNumber,
          errorCode: failure.code,
        }
      : {
          status: "RETRY_SCHEDULED",
          jobId: claim.jobId,
          runId: claim.runId,
          attemptNumber: claim.attemptNumber,
          nextRunAt,
          errorCode: failure.code,
        };
  }

  async function processNext(workerId: string): Promise<WorkerExecutionResult> {
    const claim = await claimNext(workerId);
    if (!claim) return { status: "IDLE" };
    if (claim.cancelRequestedAt) return finishCancelled(claim, "CANCEL_REQUESTED");
    if (!claim.ruleActive) return finishCancelled(claim, "RULE_INACTIVE");
    try {
      return await finishSucceeded(claim, await executeAction(claim));
    } catch (error) {
      if (error instanceof AutomationCancelledError) {
        return finishCancelled(claim, error.reason);
      }
      return finishFailed(claim, error);
    }
  }

  return Object.freeze({ processNext });
}
