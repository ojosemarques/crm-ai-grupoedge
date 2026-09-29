import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { LifecycleAutomationKeys } from "@/modules/automations/domain/predefined-lifecycle-automations";
import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";
import { ApplicationError, ConfigurationError } from "@/shared/core/errors/application-error";

const CONFIRMATION = "RUN_TRANSIENT_STAGING_WORKER";
const WORKSPACE_SLUG = "politizai-staging";
const RULE_KEY = "prod08.worker.smoke.v1";
const RUN_KEY = "prod08:staging-worker:smoke:v1";

export type StagingWorkerHomologationEnvironment = Readonly<{
  workspaceSlug: typeof WORKSPACE_SLUG;
}>;

export type StagingWorkerPreparation = Readonly<{
  state: "PREPARED" | "ALREADY_EXISTS";
  jobStatus: string;
  fingerprint: string;
  unrelatedDueJobs: number;
}>;

export type StagingWorkerVerification = Readonly<{
  state: "VERIFIED";
  jobStatus: "SUCCEEDED";
  runStatus: "SUCCEEDED";
  attemptCount: number;
  effectCount: number;
  idempotentReplay: boolean;
  actionSkippedSafely: boolean;
  backlog: number;
  rulePaused: boolean;
  externalEgress: false;
  fingerprint: string;
}>;

function fingerprint(...values: string[]): string {
  return createHash("sha256").update(values.join(":"), "utf8").digest("hex").slice(0, 20);
}

function safeRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function parseStagingWorkerHomologationEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): StagingWorkerHomologationEnvironment {
  const contract = loadEnvironmentContract(source);
  const invalid: string[] = [];
  if (contract.APP_ENV !== "staging") invalid.push("APP_ENV");
  if (contract.NODE_ENV !== "production") invalid.push("NODE_ENV");
  if (contract.PROCESS_ROLE !== "worker") invalid.push("PROCESS_ROLE");
  if (contract.AUTOMATION_WORKER_ENABLED !== "true") invalid.push("AUTOMATION_WORKER_ENABLED");
  if (contract.EXTERNAL_ADAPTERS_MODE !== "disabled") invalid.push("EXTERNAL_ADAPTERS_MODE");
  if (contract.DATABASE_EXPECTED_NAME !== "politizai_staging") invalid.push("DATABASE_EXPECTED_NAME");
  if (contract.DATABASE_EXPECTED_SCHEMA !== "public") invalid.push("DATABASE_EXPECTED_SCHEMA");
  if (!contract.databaseUrl.hostname.endsWith(".neon.tech")) invalid.push("DATABASE_URL");
  if (contract.directUrl) invalid.push("DIRECT_URL");
  if (source.STAGING_WORKER_HOMOLOGATION_CONFIRMATION !== CONFIRMATION) {
    invalid.push("STAGING_WORKER_HOMOLOGATION_CONFIRMATION");
  }
  if (source.STAGING_WORKER_HOMOLOGATION_WORKSPACE_SLUG !== WORKSPACE_SLUG) {
    invalid.push("STAGING_WORKER_HOMOLOGATION_WORKSPACE_SLUG");
  }
  if (invalid.length > 0) throw new ConfigurationError([...new Set(invalid)].sort());
  return { workspaceSlug: WORKSPACE_SLUG };
}

export function createStagingWorkerHomologationService(database: PrismaClient) {
  async function locateFixture(environment: StagingWorkerHomologationEnvironment) {
    const workspace = await database.workspace.findUniqueOrThrow({
      where: { slug: environment.workspaceSlug },
      select: { id: true, slug: true },
    });
    const systemActor = await database.actor.findFirstOrThrow({
      where: { workspaceId: workspace.id, type: "SYSTEM", key: "system", userId: null },
      select: { id: true },
    });
    const automationActor = await database.actor.findFirstOrThrow({
      where: { workspaceId: workspace.id, type: "AUTOMATION", userId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const lead = await database.lead.findFirstOrThrow({
      where: {
        workspaceId: workspace.id,
        deletedAt: null,
        submissions: { some: { idempotencyKey: "prod06:staging-homologation:lead:v1" } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, nextActionTaskId: true },
    });
    if (!lead.nextActionTaskId) {
      throw new ApplicationError("A fixture sintética da PROD-06 perdeu a próxima ação.", {
        code: "STAGING_WORKER_FIXTURE_INVALID",
        statusCode: 409,
      });
    }
    return { workspace, systemActor, automationActor, lead };
  }

  return Object.freeze({
    async prepare(
      environment: StagingWorkerHomologationEnvironment,
    ): Promise<StagingWorkerPreparation> {
      const fixture = await locateFixture(environment);
      return database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_prod08_staging_worker_v1'))`;
        const unrelatedDueJobs = await transaction.job.count({
          where: {
            status: { in: ["PENDING", "RUNNING"] },
            OR: [{ status: "RUNNING" }, { runAt: { lte: new Date() } }],
            NOT: { idempotencyKey: RUN_KEY },
          },
        });
        if (unrelatedDueJobs > 0) {
          throw new ApplicationError("Existem jobs alheios ao ensaio aguardando processamento.", {
            code: "STAGING_WORKER_BACKLOG_NOT_EMPTY",
            statusCode: 409,
          });
        }

        const existing = await transaction.automationRun.findFirst({
          where: { workspaceId: fixture.workspace.id, idempotencyKey: RUN_KEY },
          include: { job: { select: { id: true, status: true } } },
        });
        if (existing?.job) {
          return {
            state: "ALREADY_EXISTS" as const,
            jobStatus: existing.job.status,
            fingerprint: fingerprint(existing.id, existing.job.id, existing.automationRuleId),
            unrelatedDueJobs,
          };
        }

        let rule = await transaction.automationRule.findFirst({
          where: { workspaceId: fixture.workspace.id, key: RULE_KEY, deletedAt: null },
        });
        if (!rule) {
          rule = await transaction.automationRule.create({
            data: {
              workspaceId: fixture.workspace.id,
              key: RULE_KEY,
              name: "PROD-08 — smoke sintético do worker",
              description: "Job interno, idempotente e sem egress para homologação temporária de staging.",
              isPredefined: false,
              status: "ACTIVE",
              triggerType: "MANUAL",
              actionType: "APPLY_LIFECYCLE_AUTOMATION",
              conditions: { all: [] },
              actionConfig: {
                automationKey: LifecycleAutomationKeys.NO_NEXT_ACTION,
                category: "PROCESS_HEALTH",
                synthetic: true,
                externalEgress: false,
              },
              version: 1,
              createdByActorId: fixture.systemActor.id,
              updatedByActorId: fixture.systemActor.id,
            },
          });
        } else if (rule.status !== "ACTIVE") {
          rule = await transaction.automationRule.update({
            where: { id: rule.id },
            data: { status: "ACTIVE", updatedByActorId: fixture.systemActor.id },
          });
        }

        const occurredAt = new Date();
        const inputPayload = {
          source: "MANUAL",
          eventIdempotencyKey: RUN_KEY,
          occurredAt: occurredAt.toISOString(),
          triggeredByActorId: fixture.systemActor.id,
          payload: {
            eventType: "LEAD_WITHOUT_NEXT_ACTION",
            leadId: fixture.lead.id,
            synthetic: true,
            task: "PROD-08",
            externalEgress: false,
          },
        } satisfies Prisma.InputJsonValue;
        const run = await transaction.automationRun.create({
          data: {
            workspaceId: fixture.workspace.id,
            automationRuleId: rule.id,
            leadId: fixture.lead.id,
            actorId: fixture.automationActor.id,
            status: "PENDING",
            idempotencyKey: RUN_KEY,
            ruleVersion: rule.version,
            triggerType: "MANUAL",
            actionType: "APPLY_LIFECYCLE_AUTOMATION",
            conditionsSnapshot: { all: [] },
            actionConfigSnapshot: inputJson(rule.actionConfig),
            triggeredAt: occurredAt,
            inputPayload,
          },
        });
        const job = await transaction.job.create({
          data: {
            workspaceId: fixture.workspace.id,
            type: "AUTOMATION",
            status: "PENDING",
            automationRunId: run.id,
            idempotencyKey: RUN_KEY,
            priority: 100,
            runAt: occurredAt,
            maxAttempts: 3,
            payload: inputPayload,
            createdByActorId: fixture.systemActor.id,
            updatedByActorId: fixture.systemActor.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: fixture.workspace.id,
            actorId: fixture.systemActor.id,
            automationRunId: run.id,
            action: "prod08.staging_worker.smoke_scheduled",
            origin: "SYSTEM",
            entityType: "Job",
            entityId: job.id,
            reason: "Homologação temporária e gratuita do worker no staging.",
            changes: { after: { status: "PENDING", synthetic: true } },
            metadata: { task: "PROD-08", externalEgress: false, runtime: "transient-local" },
          },
        });
        return {
          state: "PREPARED" as const,
          jobStatus: job.status,
          fingerprint: fingerprint(run.id, job.id, rule.id),
          unrelatedDueJobs,
        };
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
    },

    async verify(
      environment: StagingWorkerHomologationEnvironment,
    ): Promise<StagingWorkerVerification> {
      const fixture = await locateFixture(environment);
      return database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_prod08_staging_worker_v1'))`;
        const run = await transaction.automationRun.findFirstOrThrow({
          where: { workspaceId: fixture.workspace.id, idempotencyKey: RUN_KEY },
        });
        const rule = await transaction.automationRule.findUniqueOrThrow({
          where: { id: run.automationRuleId },
        });
        const job = await transaction.job.findFirstOrThrow({
          where: { workspaceId: fixture.workspace.id, automationRunId: run.id },
        });
        const attemptCount = await transaction.automationAttempt.count({
          where: { workspaceId: fixture.workspace.id, automationRunId: run.id },
        });
        const effectCount = await transaction.automationEffect.count({
          where: { workspaceId: fixture.workspace.id, automationRunId: run.id },
        });
        if (run.status !== "SUCCEEDED" || job.status !== "SUCCEEDED") {
          throw new ApplicationError("O job sintético da PROD-08 não terminou com sucesso.", {
            code: "STAGING_WORKER_SMOKE_NOT_SUCCEEDED",
            statusCode: 409,
          });
        }
        const output = safeRecord(run.outputPayload);
        const actionSkippedSafely = output.skipped === true && output.reason === "NEXT_ACTION_RESTORED";
        if (!actionSkippedSafely || attemptCount !== 1 || effectCount !== 1) {
          throw new ApplicationError("O resultado idempotente do smoke do worker divergiu.", {
            code: "STAGING_WORKER_SMOKE_INCONSISTENT",
            statusCode: 409,
          });
        }
        const replayCount = await transaction.automationRun.count({
          where: { workspaceId: fixture.workspace.id, idempotencyKey: RUN_KEY },
        });
        const backlog = await transaction.job.count({
          where: { status: { in: ["PENDING", "RUNNING"] } },
        });
        if (backlog !== 0) {
          throw new ApplicationError("O worker deixou backlog após o smoke.", {
            code: "STAGING_WORKER_BACKLOG_REMAINS",
            statusCode: 409,
          });
        }
        if (rule.status === "ACTIVE") {
          await transaction.automationRule.update({
            where: { id: rule.id },
            data: { status: "PAUSED", updatedByActorId: fixture.systemActor.id },
          });
        }
        const priorAudit = await transaction.auditLog.findFirst({
          where: {
            workspaceId: fixture.workspace.id,
            action: "prod08.staging_worker.homologated",
            entityType: "Job",
            entityId: job.id,
          },
          select: { id: true },
        });
        if (!priorAudit) {
          await transaction.auditLog.create({
            data: {
              workspaceId: fixture.workspace.id,
              actorId: fixture.systemActor.id,
              automationRunId: run.id,
              action: "prod08.staging_worker.homologated",
              origin: "SYSTEM",
              entityType: "Job",
              entityId: job.id,
              reason: "Job interno processado uma vez e regra sintética pausada após o ensaio.",
              changes: { before: { status: "PENDING" }, after: { status: "SUCCEEDED" } },
              metadata: {
                task: "PROD-08",
                externalEgress: false,
                runtime: "transient-local",
                attemptCount,
                effectCount,
              },
            },
          });
        }
        return {
          state: "VERIFIED" as const,
          jobStatus: "SUCCEEDED" as const,
          runStatus: "SUCCEEDED" as const,
          attemptCount,
          effectCount,
          idempotentReplay: replayCount === 1,
          actionSkippedSafely,
          backlog,
          rulePaused: true,
          externalEgress: false as const,
          fingerprint: fingerprint(run.id, job.id, rule.id),
        };
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
    },
  });
}
