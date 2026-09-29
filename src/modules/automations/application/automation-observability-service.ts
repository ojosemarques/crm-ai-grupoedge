import type { JobStatus, PrismaClient, RunStatus } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
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

type Options = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const optionalQueryValue = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value === "" ? undefined : value, schema.optional());

const querySchema = z
  .object({
    status: optionalQueryValue(z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"])),
    ruleId: optionalQueryValue(z.string().uuid()),
    leadId: optionalQueryValue(z.string().uuid()),
    from: optionalQueryValue(z.coerce.date()),
    to: optionalQueryValue(z.coerce.date()),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .passthrough();

const jobStatuses: readonly JobStatus[] = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];
const runStatuses: readonly RunStatus[] = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

export function createAutomationObservabilityService(options: Options) {
  async function getOverview(context: AuthenticatedContext, input: unknown) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) {
      throw new ApplicationError(
        parsed.error.issues.map((issue) => issue.message).join(" "),
        { code: "INVALID_INPUT", statusCode: 400, expose: true },
      );
    }
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.AUTOMATIONS_READ,
      { workspaceId: context.workspaceId, resourceType: "AutomationRun" },
    );
    const now = options.now();
    const status = parsed.data.status;
    const ruleId = parsed.data.ruleId;
    if (parsed.data.from && parsed.data.to && parsed.data.from >= parsed.data.to) {
      throw new ApplicationError("O início do período deve ser anterior ao fim.", {
        code: "INVALID_INPUT",
        statusCode: 400,
        expose: true,
      });
    }
    const manage = await options.authorization.authorize(
      context,
      PermissionKeys.AUTOMATIONS_MANAGE,
      { workspaceId: context.workspaceId, resourceType: "AutomationRule" },
    );
    const execute = await options.authorization.authorize(
      context,
      PermissionKeys.AUTOMATIONS_EXECUTE,
      { workspaceId: context.workspaceId, resourceType: "AutomationRule" },
    );
    const timeWhere = {
      ...(parsed.data.from ? { gte: parsed.data.from } : {}),
      ...(parsed.data.to ? { lt: parsed.data.to } : {}),
    };
    const runWhere = {
      workspaceId: context.workspaceId,
      ...(status ? { status: status as RunStatus } : {}),
      ...(ruleId ? { automationRuleId: ruleId } : {}),
      ...(parsed.data.leadId ? { leadId: parsed.data.leadId } : {}),
      ...(Object.keys(timeWhere).length > 0 ? { triggeredAt: timeWhere } : {}),
    };
    const [jobGroups, runGroups, staleLocks, recentRuns, rules] = await Promise.all([
      options.database.job.groupBy({
        by: ["status"],
        where: { workspaceId: context.workspaceId, type: "AUTOMATION" },
        _count: { _all: true },
      }),
      options.database.automationRun.groupBy({
        by: ["status"],
        where: { workspaceId: context.workspaceId },
        _count: { _all: true },
      }),
      options.database.job.count({
        where: {
          workspaceId: context.workspaceId,
          type: "AUTOMATION",
          status: "RUNNING",
          lockExpiresAt: { lte: now },
        },
      }),
      options.database.automationRun.findMany({
        where: runWhere,
        orderBy: [{ triggeredAt: "desc" }, { id: "desc" }],
        take: parsed.data.limit,
        select: {
          id: true,
          automationRuleId: true,
          leadId: true,
          meetingId: true,
          opportunityId: true,
          ruleVersion: true,
          triggerType: true,
          actionType: true,
          status: true,
          idempotencyKey: true,
          triggeredAt: true,
          startedAt: true,
          finishedAt: true,
          errorCode: true,
          errorMessage: true,
          inputPayload: true,
          outputPayload: true,
          lead: { select: { fullName: true } },
          rule: { select: { name: true, status: true } },
          job: {
            select: {
              id: true,
              status: true,
              attempts: true,
              maxAttempts: true,
              runAt: true,
              lockedBy: true,
              lockExpiresAt: true,
            },
          },
          attempts: {
            orderBy: { attemptNumber: "asc" },
            select: {
              id: true,
              attemptNumber: true,
              workerId: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      }),
      options.database.automationRule.findMany({
        where: { workspaceId: context.workspaceId, isPredefined: true, deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          status: true,
          version: true,
          triggerType: true,
          actionType: true,
          conditions: true,
          actionConfig: true,
          updatedAt: true,
        },
      }),
    ]);

    const jobCounts = new Map(jobGroups.map((row) => [row.status, row._count._all]));
    const runCounts = new Map(runGroups.map((row) => [row.status, row._count._all]));
    return Object.freeze({
      generatedAt: now.toISOString(),
      workspaceId: context.workspaceId,
      staleLocks,
      filters: {
        status: status ?? "",
        ruleId: ruleId ?? "",
        leadId: parsed.data.leadId ?? "",
        from: parsed.data.from?.toISOString() ?? "",
        to: parsed.data.to?.toISOString() ?? "",
      },
      capabilities: { canManage: manage.allowed, canExecute: execute.allowed },
      rules: rules.map((rule) => ({ ...rule, updatedAt: rule.updatedAt.toISOString() })),
      jobs: Object.fromEntries(jobStatuses.map((key) => [key, jobCounts.get(key) ?? 0])),
      runs: Object.fromEntries(runStatuses.map((key) => [key, runCounts.get(key) ?? 0])),
      recentRuns: recentRuns.map((run) => ({
        ...run,
        triggeredAt: run.triggeredAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        job: run.job
          ? {
              ...run.job,
              runAt: run.job.runAt.toISOString(),
              lockExpiresAt: run.job.lockExpiresAt?.toISOString() ?? null,
            }
          : null,
        attempts: run.attempts.map((attempt) => ({
          ...attempt,
          startedAt: attempt.startedAt.toISOString(),
          finishedAt: attempt.finishedAt?.toISOString() ?? null,
        })),
        leadName: run.lead?.fullName ?? null,
        lead: undefined,
      })),
    });
  }

  return Object.freeze({ getOverview });
}

export type AutomationOverview = Awaited<
  ReturnType<ReturnType<typeof createAutomationObservabilityService>["getOverview"]>
>;

let service: ReturnType<typeof createAutomationObservabilityService> | undefined;

export function getAutomationObservabilityService() {
  service ??= createAutomationObservabilityService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
