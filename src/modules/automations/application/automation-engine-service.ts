import { randomUUID } from "node:crypto";

import type { JobStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  automationActionConfigSchema,
  automationConditionsSchema,
  type InternalAutomationEvent,
  type PublicationResult,
  type PublishedAutomation,
} from "@/modules/automations/domain/automation-contracts";
import { matchesAutomationConditions } from "@/modules/automations/domain/automation-policy";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { logger } from "@/shared/core/logging/logger";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type AutomationEngineServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const manualExecutionSchema = z
  .object({
    ruleId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    input: z.record(z.string(), z.unknown()).default({}),
    runAt: z.coerce.date().optional(),
    priority: z.number().int().min(0).max(100).default(0),
    maxAttempts: z.number().int().min(1).max(25).default(5),
  })
  .strict();

const statusChangeSchema = z
  .object({
    ruleId: z.string().uuid(),
    status: z.enum(["ACTIVE", "PAUSED"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const jobControlSchema = z
  .object({
    jobId: z.string().uuid(),
    action: z.enum(["CANCEL", "REPROCESS"]),
    reason: z.string().trim().min(3).max(500),
    additionalAttempts: z.number().int().min(1).max(10).default(1),
  })
  .strict();

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(
    error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function notFound(message: string): never {
  throw new ApplicationError(message, {
    code: "NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

function conflict(message: string, code: string): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

function toJson(value: unknown, field: string): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("undefined");
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch (cause) {
    throw new ApplicationError(`${field} não é um JSON válido.`, {
      code: "INVALID_AUTOMATION_JSON",
      statusCode: 400,
      expose: true,
      cause,
    });
  }
}

function workspaceResource(workspaceId: string, resourceType = "AutomationRule", resourceId?: string): ResourceScope {
  return { workspaceId, resourceType, ...(resourceId ? { resourceId } : {}) };
}

function leadIdFromPayload(payload: Readonly<Record<string, unknown>>): string | null {
  const candidate = payload.leadId;
  return typeof candidate === "string" && z.string().uuid().safeParse(candidate).success
    ? candidate
    : null;
}

function optionalUuidFromPayload(
  payload: Readonly<Record<string, unknown>>,
  key: "meetingId" | "opportunityId",
): string | null {
  const candidate = payload[key];
  return typeof candidate === "string" && z.string().uuid().safeParse(candidate).success
    ? candidate
    : null;
}

export function createAutomationEngineService(options: AutomationEngineServiceOptions) {
  async function automationActorId(workspaceId: string): Promise<string> {
    const actor = await options.database.actor.findFirst({
      where: { workspaceId, type: "AUTOMATION", userId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!actor) {
      throw new ApplicationError("Ator de automação não configurado no workspace.", {
        code: "AUTOMATION_ACTOR_MISSING",
        statusCode: 409,
        expose: true,
      });
    }
    return actor.id;
  }

  async function scheduleRule(
    ruleId: string,
    event: InternalAutomationEvent,
    source: "EVENT" | "MANUAL",
  ): Promise<PublishedAutomation | null> {
    const idempotencyKey = `${event.idempotencyKey}:rule:${ruleId}`;
    const actorId = await automationActorId(event.workspaceId);

    try {
      const result = await options.database.$transaction((transaction) =>
        scheduleRuleInTransaction(transaction, ruleId, event, source, actorId),
      );
      return result;
    } catch (error) {
      const existing = await options.database.automationRun.findFirst({
        where: { workspaceId: event.workspaceId, idempotencyKey },
        select: { id: true, automationRuleId: true, job: { select: { id: true } } },
      });
      if (existing?.job) {
        return Object.freeze({
          ruleId: existing.automationRuleId,
          runId: existing.id,
          jobId: existing.job.id,
          idempotencyKey,
          duplicated: true,
        });
      }
      throw error;
    }
  }

  async function scheduleRuleInTransaction(
    transaction: Prisma.TransactionClient,
    ruleId: string,
    event: InternalAutomationEvent,
    source: "EVENT" | "MANUAL",
    actorId: string,
  ): Promise<PublishedAutomation | null> {
    const idempotencyKey = `${event.idempotencyKey}:rule:${ruleId}`;
    const existing = await transaction.automationRun.findFirst({
      where: { workspaceId: event.workspaceId, idempotencyKey },
      select: { id: true, automationRuleId: true, job: { select: { id: true } } },
    });
    if (existing?.job) {
      return Object.freeze({
        ruleId: existing.automationRuleId,
        runId: existing.id,
        jobId: existing.job.id,
        idempotencyKey,
        duplicated: true,
      });
    }

    const rule = await transaction.automationRule.findFirst({
      where: { id: ruleId, workspaceId: event.workspaceId, deletedAt: null },
    });
    if (!rule || rule.status !== "ACTIVE") return null;

    const conditions = automationConditionsSchema.safeParse(rule.conditions);
    const actionConfig = automationActionConfigSchema.safeParse(rule.actionConfig);
    if (!conditions.success || !actionConfig.success) {
      throw new ApplicationError("A regra de automação possui configuração inválida.", {
        code: "INVALID_AUTOMATION_RULE",
        statusCode: 409,
        expose: true,
      });
    }
    if (source === "EVENT" && !matchesAutomationConditions(event.payload, conditions.data)) {
      return null;
    }

    const inputPayload = toJson(
      {
        source,
        eventIdempotencyKey: event.idempotencyKey,
        occurredAt: event.occurredAt.toISOString(),
        triggeredByActorId: event.triggeredByActorId ?? null,
        payload: event.payload,
      },
      "Evento",
    );
    const run = await transaction.automationRun.create({
      data: {
        workspaceId: event.workspaceId,
        automationRuleId: rule.id,
        leadId: leadIdFromPayload(event.payload),
        meetingId: optionalUuidFromPayload(event.payload, "meetingId"),
        opportunityId: optionalUuidFromPayload(event.payload, "opportunityId"),
        actorId,
        status: "PENDING",
        idempotencyKey,
        ruleVersion: rule.version,
        triggerType: rule.triggerType,
        actionType: rule.actionType,
        conditionsSnapshot: toJson(conditions.data, "Condições"),
        actionConfigSnapshot: toJson(actionConfig.data, "Configuração"),
        triggeredAt: event.occurredAt,
        inputPayload,
      },
    });
    const job = await transaction.job.create({
      data: {
        workspaceId: event.workspaceId,
        type: "AUTOMATION",
        status: "PENDING",
        automationRunId: run.id,
        idempotencyKey,
        priority: event.priority ?? 0,
        runAt: event.runAt ?? event.occurredAt,
        maxAttempts: event.maxAttempts ?? 5,
        payload: inputPayload,
        createdByActorId: actorId,
        updatedByActorId: actorId,
      },
    });
    return Object.freeze({
      ruleId: rule.id,
      runId: run.id,
      jobId: job.id,
      idempotencyKey,
      duplicated: false,
    });
  }

  function validateEvent(event: InternalAutomationEvent): void {
    if (!z.string().uuid().safeParse(event.workspaceId).success) {
      invalidInput(new z.ZodError([{ code: "custom", path: ["workspaceId"], message: "Workspace inválido.", input: event.workspaceId }]));
    }
    if (!event.idempotencyKey.trim() || event.idempotencyKey.length > 160) {
      throw new ApplicationError("Chave idempotente do evento inválida.", {
        code: "INVALID_IDEMPOTENCY_KEY",
        statusCode: 400,
        expose: true,
      });
    }
    toJson(event.payload, "Payload");
  }

  async function publish(event: InternalAutomationEvent): Promise<PublicationResult> {
    validateEvent(event);

    const rules = await options.database.automationRule.findMany({
      where: {
        workspaceId: event.workspaceId,
        triggerType: event.triggerType,
        status: "ACTIVE",
        deletedAt: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, conditions: true },
    });

    const scheduled: PublishedAutomation[] = [];
    for (const rule of rules) {
      const conditions = automationConditionsSchema.safeParse(rule.conditions);
      if (!conditions.success) {
        logger.warn(
          { ruleId: rule.id, workspaceId: event.workspaceId },
          "Regra ativa ignorada porque suas condições são inválidas",
        );
        continue;
      }
      if (!matchesAutomationConditions(event.payload, conditions.data)) continue;
      const result = await scheduleRule(rule.id, event, "EVENT");
      if (result) scheduled.push(result);
    }
    return Object.freeze({ matchedRules: scheduled.length, scheduled: Object.freeze(scheduled) });
  }

  async function publishInTransaction(
    transaction: Prisma.TransactionClient,
    event: InternalAutomationEvent,
  ): Promise<PublicationResult> {
    validateEvent(event);
    const actor = await transaction.actor.findFirst({
      where: {
        workspaceId: event.workspaceId,
        type: "AUTOMATION",
        userId: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!actor) {
      throw new ApplicationError("Ator de automação não configurado no workspace.", {
        code: "AUTOMATION_ACTOR_MISSING",
        statusCode: 409,
        expose: true,
      });
    }
    const rules = await transaction.automationRule.findMany({
      where: {
        workspaceId: event.workspaceId,
        triggerType: event.triggerType,
        status: "ACTIVE",
        deletedAt: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, conditions: true },
    });
    const scheduled: PublishedAutomation[] = [];
    for (const rule of rules) {
      const conditions = automationConditionsSchema.safeParse(rule.conditions);
      if (!conditions.success || !matchesAutomationConditions(event.payload, conditions.data)) {
        continue;
      }
      const result = await scheduleRuleInTransaction(
        transaction,
        rule.id,
        event,
        "EVENT",
        actor.id,
      );
      if (result) scheduled.push(result);
    }
    return Object.freeze({
      matchedRules: scheduled.length,
      scheduled: Object.freeze(scheduled),
    });
  }

  async function executeManual(context: AuthenticatedContext, payload: unknown) {
    const parsed = manualExecutionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.AUTOMATIONS_EXECUTE,
      workspaceResource(context.workspaceId, "AutomationRule", parsed.data.ruleId),
    );
    const rule = await options.database.automationRule.findFirst({
      where: { id: parsed.data.ruleId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!rule) notFound("Regra de automação não encontrada.");
    if (rule.status !== "ACTIVE") {
      conflict("A regra precisa estar ativa para execução manual.", "AUTOMATION_RULE_INACTIVE");
    }
    const event: InternalAutomationEvent = {
      workspaceId: context.workspaceId,
      triggerType: "MANUAL",
      idempotencyKey:
        parsed.data.idempotencyKey ?? `manual:${context.actorId}:${randomUUID()}`,
      occurredAt: options.now(),
      payload: parsed.data.input,
      triggeredByActorId: context.actorId,
      runAt: parsed.data.runAt ?? options.now(),
      priority: parsed.data.priority,
      maxAttempts: parsed.data.maxAttempts,
    };
    const scheduled = await scheduleRule(rule.id, event, "MANUAL");
    if (!scheduled) conflict("A regra deixou de estar ativa.", "AUTOMATION_RULE_INACTIVE");

    if (!scheduled.duplicated) {
      await options.database.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          automationRunId: scheduled.runId,
          action: "automation.manual_execution.scheduled",
          origin: "API",
          entityType: "AutomationRun",
          entityId: scheduled.runId,
          occurredAt: options.now(),
          changes: { ruleId: rule.id, jobId: scheduled.jobId },
          metadata: { idempotencyKey: scheduled.idempotencyKey },
        },
      });
    }
    return scheduled;
  }

  async function changeRuleStatus(context: AuthenticatedContext, payload: unknown) {
    const parsed = statusChangeSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.AUTOMATIONS_MANAGE,
      workspaceResource(context.workspaceId, "AutomationRule", parsed.data.ruleId),
    );
    const changedAt = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`automation-rule:${context.workspaceId}:${parsed.data.ruleId}`}, 0))
      `;
      const rule = await transaction.automationRule.findFirst({
        where: { id: parsed.data.ruleId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!rule) notFound("Regra de automação não encontrada.");
      if (rule.status === "ARCHIVED") {
        conflict("Uma regra arquivada não pode ser reativada.", "AUTOMATION_RULE_ARCHIVED");
      }
      if (parsed.data.status === "ACTIVE") {
        const conditions = automationConditionsSchema.safeParse(rule.conditions);
        const config = automationActionConfigSchema.safeParse(rule.actionConfig);
        if (!conditions.success || !config.success) {
          conflict("Corrija a configuração antes de ativar a regra.", "INVALID_AUTOMATION_RULE");
        }
      }
      const updated = await transaction.automationRule.update({
        where: { id: rule.id },
        data: {
          status: parsed.data.status,
          updatedByActorId: context.actorId,
          updatedAt: changedAt,
        },
        select: { id: true, status: true, version: true, updatedAt: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action:
            parsed.data.status === "ACTIVE"
              ? "automation.rule.activated"
              : "automation.rule.paused",
          entityType: "AutomationRule",
          origin: "API",
          reason: parsed.data.reason,
          entityId: rule.id,
          occurredAt: changedAt,
          changes: { before: { status: rule.status }, after: { status: updated.status } },
          metadata: { reason: parsed.data.reason, version: updated.version },
        },
      });
      return updated;
    });
  }

  async function controlJob(context: AuthenticatedContext, payload: unknown) {
    const parsed = jobControlSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const permission = parsed.data.action === "CANCEL"
      ? PermissionKeys.AUTOMATIONS_MANAGE
      : PermissionKeys.AUTOMATIONS_EXECUTE;
    await options.authorization.assertAuthorized(
      context,
      permission,
      workspaceResource(context.workspaceId, "Job", parsed.data.jobId),
    );
    const changedAt = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`automation-job:${context.workspaceId}:${parsed.data.jobId}`}, 0))
      `;
      const job = await transaction.job.findFirst({
        where: {
          id: parsed.data.jobId,
          workspaceId: context.workspaceId,
          type: "AUTOMATION",
        },
        include: { automationRun: true },
      });
      if (!job?.automationRun) notFound("Job de automação não encontrado.");

      let result: Readonly<{ id: string; status: JobStatus; cancelRequestedAt: Date | null }>;
      if (parsed.data.action === "CANCEL") {
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) {
          conflict("O job já está em estado terminal.", "AUTOMATION_JOB_TERMINAL");
        }
        if (job.status === "RUNNING") {
          result = await transaction.job.update({
            where: { id: job.id },
            data: { cancelRequestedAt: changedAt, updatedByActorId: context.actorId },
            select: { id: true, status: true, cancelRequestedAt: true },
          });
        } else {
          result = await transaction.job.update({
            where: { id: job.id },
            data: {
              status: "CANCELLED",
              cancelRequestedAt: changedAt,
              cancelledAt: changedAt,
              finishedAt: changedAt,
              updatedByActorId: context.actorId,
            },
            select: { id: true, status: true, cancelRequestedAt: true },
          });
          await transaction.automationRun.update({
            where: { id: job.automationRun.id },
            data: { status: "CANCELLED", cancelledAt: changedAt, finishedAt: changedAt },
          });
        }
      } else {
        if (job.status !== "FAILED") {
          conflict("Somente jobs com falha terminal podem ser reprocessados.", "AUTOMATION_JOB_NOT_FAILED");
        }
        result = await transaction.job.update({
          where: { id: job.id },
          data: {
            status: "PENDING",
            runAt: changedAt,
            maxAttempts: Math.min(25, job.attempts + parsed.data.additionalAttempts),
            finishedAt: null,
            cancelledAt: null,
            cancelRequestedAt: null,
            errorCode: null,
            lastError: null,
            updatedByActorId: context.actorId,
          },
          select: { id: true, status: true, cancelRequestedAt: true },
        });
        await transaction.automationRun.update({
          where: { id: job.automationRun.id },
          data: {
            status: "PENDING",
            startedAt: null,
            finishedAt: null,
            cancelledAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
      }

      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          automationRunId: job.automationRun.id,
          action:
            parsed.data.action === "CANCEL"
              ? "automation.job.cancel_requested"
              : "automation.job.reprocessed",
          entityType: "Job",
          origin: "API",
          reason: parsed.data.reason,
          entityId: job.id,
          occurredAt: changedAt,
          changes: { before: { status: job.status }, after: { status: result.status } },
          metadata: { reason: parsed.data.reason, automationRunId: job.automationRun.id },
        },
      });
      return result;
    });
  }

  return Object.freeze({
    publish,
    publishInTransaction,
    executeManual,
    changeRuleStatus,
    controlJob,
  });
}

let automationEngineService: ReturnType<typeof createAutomationEngineService> | undefined;

export function getAutomationEngineService() {
  automationEngineService ??= createAutomationEngineService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return automationEngineService;
}
