import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { createAutomationObservabilityService } from "@/modules/automations/application/automation-observability-service";
import { createAutomationWorkerService } from "@/modules/automations/application/automation-worker-service";
import type { AutomationActionExecutor } from "@/modules/automations/domain/automation-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for automation tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 16 }),
});
const authorization = createAuthorizationService({ database });
let workspaceId: string;
let automationActorId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;

function clock(value: string) {
  let current = new Date(value);
  return {
    now: () => new Date(current),
    advanceSeconds(seconds: number) {
      current = new Date(current.getTime() + seconds * 1_000);
    },
  };
}

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
    select: {
      id: true,
      userId: true,
      roleId: true,
      role: { select: { key: true, name: true } },
      user: { select: { displayName: true } },
    },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
    select: { id: true },
  });
  return Object.freeze({
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  });
}

async function createRule(label: string, status: "ACTIVE" | "PAUSED" = "ACTIVE") {
  return database.automationRule.create({
    data: {
      workspaceId,
      name: `CRM-21 ${label}`,
      status,
      triggerType: "LEAD_CREATED",
      actionType: "CREATE_NOTIFICATION",
      conditions: {
        all: [{ path: "case", operator: "EQUALS", value: label }],
      },
      actionConfig: { test: label },
      version: 1,
      createdByActorId: automationActorId,
      updatedByActorId: automationActorId,
    },
  });
}

function engine(testClock: ReturnType<typeof clock>) {
  return createAutomationEngineService({
    database,
    authorization,
    now: testClock.now,
  });
}

function worker(
  testClock: ReturnType<typeof clock>,
  actionExecutor: AutomationActionExecutor,
) {
  return createAutomationWorkerService({
    database,
    actionExecutor,
    now: testClock.now,
    lockTimeoutSeconds: 30,
    backoffBaseSeconds: 5,
  });
}

function successfulExecutor(counter?: { value: number }): AutomationActionExecutor {
  return {
    async execute(transaction, execution) {
      if (counter) counter.value += 1;
      const audit = await transaction.auditLog.create({
        data: {
          workspaceId: execution.workspaceId,
          actorId: execution.actorId,
          action: "test.automation.domain_effect",
          entityType: "AutomationRun",
          entityId: execution.automationRunId,
          occurredAt: execution.now,
          metadata: { effectIdempotencyKey: execution.effectIdempotencyKey },
        },
      });
      return { auditId: audit.id };
    },
  };
}

async function publishCase(
  testClock: ReturnType<typeof clock>,
  label: string,
  key: string,
  maxAttempts = 5,
) {
  return engine(testClock).publish({
    workspaceId,
    triggerType: "LEAD_CREATED",
    idempotencyKey: key,
    occurredAt: testClock.now(),
    payload: { case: label },
    maxAttempts,
  });
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, {
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  });
  workspaceId = seeded.workspaceId;
  automationActorId = (
    await database.actor.findFirstOrThrow({
      where: { workspaceId, type: "AUTOMATION", userId: null },
      select: { id: true },
    })
  ).id;
  [admin, manager, viewer] = await Promise.all([
    humanContext("admin@demo.politizai.local"),
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
  ]);
});

afterAll(async () => {
  await database.$disconnect();
});

describe("CRM-21 automation engine", () => {
  it("publica uma vez e não duplica job, run ou efeito com a mesma chave", async () => {
    const testClock = clock("2045-01-01T12:00:00.000Z");
    const label = `idempotency-${randomUUID()}`;
    await createRule(label);
    const key = `crm21:${randomUUID()}`;

    const [first, repeated] = await Promise.all([
      publishCase(testClock, label, key),
      publishCase(testClock, label, key),
    ]);
    expect(first.scheduled).toHaveLength(1);
    expect(repeated.scheduled).toHaveLength(1);
    expect(new Set([first.scheduled[0]?.jobId, repeated.scheduled[0]?.jobId]).size).toBe(1);

    const counter = { value: 0 };
    const localWorker = worker(testClock, successfulExecutor(counter));
    const result = await localWorker.processNext("worker-idempotency");
    expect(result.status).toBe("SUCCEEDED");
    const runId = first.scheduled[0]!.runId;
    const jobId = first.scheduled[0]!.jobId;
    await database.$transaction(async (transaction) => {
      await transaction.job.update({
        where: { id: jobId },
        data: { status: "PENDING", finishedAt: null, runAt: testClock.now() },
      });
      await transaction.automationRun.update({
        where: { id: runId },
        data: { status: "PENDING", finishedAt: null },
      });
    });
    expect((await localWorker.processNext("worker-idempotency-replay")).status).toBe(
      "SUCCEEDED",
    );
    expect((await localWorker.processNext("worker-idempotency")).status).toBe("IDLE");
    expect(counter.value).toBe(1);

    expect(await database.automationRun.count({ where: { id: runId } })).toBe(1);
    expect(await database.job.count({ where: { automationRunId: runId } })).toBe(1);
    expect(await database.automationEffect.count({ where: { automationRunId: runId } })).toBe(1);
    expect(await database.automationAttempt.count({ where: { automationRunId: runId } })).toBe(2);
  });

  it("agenda retry com backoff controlado e conclui sem duplicar efeito", async () => {
    const testClock = clock("2045-01-02T12:00:00.000Z");
    const label = `retry-${randomUUID()}`;
    await createRule(label);
    const publication = await publishCase(testClock, label, `crm21:${randomUUID()}`);
    let calls = 0;
    const localWorker = worker(testClock, {
      async execute(transaction, execution) {
        calls += 1;
        if (calls === 1) throw new Error("falha transitória não persistida");
        return successfulExecutor().execute(transaction, execution);
      },
    });

    const first = await localWorker.processNext("worker-retry");
    expect(first).toMatchObject({ status: "RETRY_SCHEDULED", attemptNumber: 1 });
    if (first.status !== "RETRY_SCHEDULED") throw new Error("Retry esperado.");
    expect(first.nextRunAt.toISOString()).toBe("2045-01-02T12:00:05.000Z");
    expect((await localWorker.processNext("worker-retry")).status).toBe("IDLE");
    testClock.advanceSeconds(5);
    expect(await localWorker.processNext("worker-retry")).toMatchObject({
      status: "SUCCEEDED",
      attemptNumber: 2,
    });
    const runId = publication.scheduled[0]!.runId;
    expect(await database.automationAttempt.count({ where: { automationRunId: runId } })).toBe(2);
    expect(await database.automationEffect.count({ where: { automationRunId: runId } })).toBe(1);
  });

  it("registra falha terminal e permite reprocessamento manual autorizado", async () => {
    const testClock = clock("2045-01-03T12:00:00.000Z");
    const label = `failure-${randomUUID()}`;
    await createRule(label);
    const publication = await publishCase(testClock, label, `crm21:${randomUUID()}`, 1);
    const failingWorker = worker(testClock, {
      async execute() {
        throw new Error("conteúdo técnico não deve vazar");
      },
    });
    expect(await failingWorker.processNext("worker-failure")).toMatchObject({
      status: "FAILED",
      errorCode: "AUTOMATION_ACTION_FAILED",
    });
    const jobId = publication.scheduled[0]!.jobId;
    expect(await database.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastError: "A ação da automação falhou.",
    });

    await engine(testClock).controlJob(manager, {
      jobId,
      action: "REPROCESS",
      reason: "Falha transitória revisada pelo gestor.",
    });
    expect(await worker(testClock, successfulExecutor()).processNext("worker-reprocess")).toMatchObject({
      status: "SUCCEEDED",
      attemptNumber: 2,
    });
    expect(await database.auditLog.count({
      where: { workspaceId, action: "automation.job.reprocessed", entityId: jobId },
    })).toBe(1);
  });

  it("usa SKIP LOCKED para impedir processamento concorrente duplicado", async () => {
    const testClock = clock("2045-01-04T12:00:00.000Z");
    const label = `concurrency-${randomUUID()}`;
    await createRule(label);
    const publication = await publishCase(testClock, label, `crm21:${randomUUID()}`);
    const counter = { value: 0 };
    const localWorker = worker(testClock, successfulExecutor(counter));
    const results = await Promise.all([
      localWorker.processNext("worker-concurrent-a"),
      localWorker.processNext("worker-concurrent-b"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["IDLE", "SUCCEEDED"]);
    expect(counter.value).toBe(1);
    expect(await database.automationAttempt.count({
      where: { automationRunId: publication.scheduled[0]!.runId },
    })).toBe(1);
  });

  it("retoma job com lock expirado após reinício e preserva a tentativa anterior", async () => {
    const testClock = clock("2045-01-05T12:00:00.000Z");
    const label = `restart-${randomUUID()}`;
    await createRule(label);
    const publication = await publishCase(testClock, label, `crm21:${randomUUID()}`);
    const { jobId, runId } = publication.scheduled[0]!;
    const expiredAt = testClock.now();
    testClock.advanceSeconds(60);
    await database.$transaction(async (transaction) => {
      await transaction.job.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          attempts: 1,
          lockedAt: expiredAt,
          lockedBy: "worker-encerrado",
          lockExpiresAt: expiredAt,
          lastAttemptAt: expiredAt,
        },
      });
      await transaction.automationRun.update({
        where: { id: runId },
        data: { status: "RUNNING", startedAt: expiredAt },
      });
      await transaction.automationAttempt.create({
        data: {
          workspaceId,
          automationRunId: runId,
          jobId,
          attemptNumber: 1,
          workerId: "worker-encerrado",
          status: "RUNNING",
          startedAt: expiredAt,
        },
      });
    });
    expect(await worker(testClock, successfulExecutor()).processNext("worker-reiniciado")).toMatchObject({
      status: "SUCCEEDED",
      attemptNumber: 2,
    });
    const attempts = await database.automationAttempt.findMany({
      where: { automationRunId: runId },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map((attempt) => [attempt.status, attempt.errorCode])).toEqual([
      ["FAILED", "WORKER_LOCK_EXPIRED"],
      ["SUCCEEDED", null],
    ]);
  });

  it("cancela job quando a regra fica inativa e não executa a ação", async () => {
    const testClock = clock("2045-01-06T12:00:00.000Z");
    const label = `inactive-${randomUUID()}`;
    const rule = await createRule(label);
    const publication = await publishCase(testClock, label, `crm21:${randomUUID()}`);
    await engine(testClock).changeRuleStatus(admin, {
      ruleId: rule.id,
      status: "PAUSED",
      reason: "Pausa controlada para validar o motor.",
    });
    const counter = { value: 0 };
    expect(await worker(testClock, successfulExecutor(counter)).processNext("worker-inactive")).toMatchObject({
      status: "CANCELLED",
      errorCode: "RULE_INACTIVE",
    });
    expect(counter.value).toBe(0);
    expect(await database.job.findUniqueOrThrow({
      where: { id: publication.scheduled[0]!.jobId },
    })).toMatchObject({ status: "CANCELLED" });
  });

  it("respeita agendamento e cancelamento explícito antes da execução", async () => {
    const testClock = clock("2045-01-07T12:00:00.000Z");
    const label = `schedule-${randomUUID()}`;
    const rule = await createRule(label);
    const scheduled = await engine(testClock).executeManual(manager, {
      ruleId: rule.id,
      input: { case: label },
      idempotencyKey: `manual:${randomUUID()}`,
      runAt: new Date(testClock.now().getTime() + 60_000),
    });
    const localWorker = worker(testClock, successfulExecutor());
    expect((await localWorker.processNext("worker-schedule")).status).toBe("IDLE");
    await engine(testClock).controlJob(admin, {
      jobId: scheduled.jobId,
      action: "CANCEL",
      reason: "Execução cancelada antes do horário.",
    });
    testClock.advanceSeconds(60);
    expect((await localWorker.processNext("worker-schedule")).status).toBe("IDLE");
    expect(await database.job.findUniqueOrThrow({ where: { id: scheduled.jobId } })).toMatchObject({
      status: "CANCELLED",
    });
  });

  it("aplica permissões reais a execução, gestão e observabilidade", async () => {
    const testClock = clock("2045-01-08T12:00:00.000Z");
    const label = `rbac-${randomUUID()}`;
    const rule = await createRule(label);
    const localEngine = engine(testClock);
    await expect(
      localEngine.executeManual(viewer, { ruleId: rule.id, input: {} }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      localEngine.changeRuleStatus(manager, {
        ruleId: rule.id,
        status: "PAUSED",
        reason: "Gestor não administra regra.",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const manual = await localEngine.executeManual(manager, {
      ruleId: rule.id,
      input: { case: label },
      idempotencyKey: `manual:${randomUUID()}`,
    });
    expect(manual.duplicated).toBe(false);
    const observability = createAutomationObservabilityService({
      database,
      authorization,
      now: testClock.now,
    });
    expect((await observability.getOverview(manager, {})).workspaceId).toBe(workspaceId);
    await expect(observability.getOverview(viewer, {})).rejects.toBeInstanceOf(AccessDeniedError);
    await worker(testClock, successfulExecutor()).processNext("worker-rbac-cleanup");
  });
});
