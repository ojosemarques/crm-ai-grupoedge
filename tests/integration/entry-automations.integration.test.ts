import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { createAutomationWorkerService } from "@/modules/automations/application/automation-worker-service";
import { createDefaultAutomationActionRegistry } from "@/modules/automations/application/predefined-entry-automation-actions";
import {
  EntryAutomationKeys,
  predefinedEntryAutomations,
} from "@/modules/automations/domain/predefined-entry-automations";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-22 tests.");

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

function testPhone(seed: string): string {
  const suffix = (
    BigInt(`0x${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`) %
    100_000_000n
  )
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

function intakePayload(
  label: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    channel: "MANUAL",
    idempotencyKey: `crm22:${label}:${randomUUID()}`,
    fullName: `Lead CRM-22 ${label}`,
    phone: testPhone(`${label}:${randomUUID()}`),
    email: `${label}-${randomUUID()}@example.invalid`,
    jobTitle: "Analista",
    organizationName: "Organização fictícia",
    city: "São Paulo",
    stateCode: "SP",
    interestSummary: "Dor operacional explicitada para teste local.",
    budgetCents: 200_000,
    sourceKey: "manual",
    consent: true,
    rawPayload: { test: "CRM-22", label },
    priorityBandCode: "P2",
    ...overrides,
  };
}

function services(testClock: ReturnType<typeof clock>) {
  const engine = createAutomationEngineService({
    database,
    authorization,
    now: testClock.now,
  });
  const intake = createLeadIntakeService({
    database,
    authorization,
    now: testClock.now,
    automationPublisher: engine,
  });
  const history = createOperationalHistoryService({
    database,
    authorization,
    now: testClock.now,
    automationPublisher: engine,
  });
  const worker = createAutomationWorkerService({
    database,
    actionExecutor: createDefaultAutomationActionRegistry(),
    now: testClock.now,
    lockTimeoutSeconds: 30,
    backoffBaseSeconds: 5,
  });
  return { engine, intake, history, worker };
}

async function drainDue(
  worker: ReturnType<typeof createAutomationWorkerService>,
  workerId: string,
) {
  const results = [];
  for (let index = 0; index < 30; index += 1) {
    const result = await worker.processNext(workerId);
    if (result.status === "IDLE") return results;
    results.push(result);
  }
  throw new Error("O worker não ficou ocioso após 30 execuções.");
}

async function finishScheduledChecks(
  testClock: ReturnType<typeof clock>,
  worker: ReturnType<typeof createAutomationWorkerService>,
  label: string,
) {
  testClock.advanceSeconds(61);
  await drainDue(worker, `${label}-60`);
  testClock.advanceSeconds(120);
  await drainDue(worker, `${label}-180`);
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
  await database.lead.updateMany({
    where: {
      workspaceId,
      fullName: { startsWith: "Lead CRM-22" },
      deletedAt: null,
    },
    data: {
      deletedAt: new Date("2047-01-01T00:00:00.000Z"),
      updatedByActorId: automationActorId,
    },
  });
  await database.$disconnect();
});

describe("CRM-22 — automações de entrada", () => {
  it("semeia as cinco regras ativas e permite gestão somente autorizada", async () => {
    const rules = await database.automationRule.findMany({
      where: { workspaceId, key: { in: predefinedEntryAutomations.map(({ key }) => key) } },
      orderBy: { key: "asc" },
    });
    expect(rules).toHaveLength(5);
    expect(rules.every((rule) => rule.isPredefined && rule.status === "ACTIVE")).toBe(true);

    const testClock = clock("2046-01-01T12:00:00.000Z");
    const rule = rules.find(({ key }) => key === EntryAutomationKeys.LEAD_RECEIVED)!;
    await expect(
      services(testClock).engine.changeRuleStatus(viewer, {
        ruleId: rule.id,
        status: "PAUSED",
        reason: "Tentativa sem autorização.",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await services(testClock).engine.changeRuleStatus(admin, {
      ruleId: rule.id,
      status: "PAUSED",
      reason: "Pausa controlada da regra predefinida.",
    });
    expect((await database.automationRule.findUniqueOrThrow({ where: { id: rule.id } })).status).toBe("PAUSED");
    const pausedServices = services(testClock);
    const pausedResult = await pausedServices.intake.intake(
      intakePayload("inactive-rule"),
      manager,
    );
    if (pausedResult.outcome === "REJECTED") throw new Error("Entrada rejeitada.");
    expect(await database.automationRun.count({
      where: {
        workspaceId,
        leadId: pausedResult.leadId,
        automationRuleId: rule.id,
      },
    })).toBe(0);
    await seedDemoDatabase(database, {
      DATABASE_URL: connectionString,
      NODE_ENV: "test",
    });
    expect(await database.automationRule.count({
      where: { workspaceId, key: { in: predefinedEntryAutomations.map(({ key }) => key) } },
    })).toBe(5);
    expect((await database.automationRule.findUniqueOrThrow({ where: { id: rule.id } })).status).toBe("PAUSED");
    await services(testClock).engine.changeRuleStatus(admin, {
      ruleId: rule.id,
      status: "ACTIVE",
      reason: "Retomada controlada da regra predefinida.",
    });
    await finishScheduledChecks(
      testClock,
      pausedServices.worker,
      "crm22-inactive-cleanup",
    );
  });

  it("executa Lead recebido uma vez, reutiliza domínio e marca a mensagem como simulada", async () => {
    const testClock = clock("2046-01-02T12:00:00.000Z");
    const local = services(testClock);
    const payload = intakePayload("received");
    const [first, replay] = await Promise.all([
      local.intake.intake(payload, manager),
      local.intake.intake(payload, manager),
    ]);
    const accepted = first.outcome === "REJECTED" ? replay : first;
    expect(accepted.outcome).toBe("CREATED");
    expect([first, replay].filter((result) => result.outcome !== "REJECTED" && result.idempotentReplay)).toHaveLength(1);
    if (accepted.outcome === "REJECTED") throw new Error("Entrada rejeitada.");

    const results = await Promise.all([
      local.worker.processNext("crm22-received-a"),
      local.worker.processNext("crm22-received-b"),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["IDLE", "SUCCEEDED"]);
    const messages = await database.message.findMany({
      where: { workspaceId, conversation: { leadId: accepted.leadId }, isSimulated: true },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: "OUTBOUND",
      status: "SENT",
      simulationLabel: "Mensagem automática simulada; nenhum canal externo foi acionado.",
    });
    expect(await database.activity.count({
      where: { workspaceId, leadId: accepted.leadId, subject: "Automação: lead recebido" },
    })).toBe(1);
    expect(await database.automationRun.count({ where: { workspaceId, leadId: accepted.leadId } })).toBe(3);
    await finishScheduledChecks(testClock, local.worker, "crm22-received-cleanup");
  });

  it("trata duplicidade sem mesclar campos, alerta o responsável e preserva o score versionado", async () => {
    const testClock = clock("2046-01-03T12:00:00.000Z");
    const local = services(testClock);
    const phone = testPhone(`duplicate:${randomUUID()}`);
    const first = await local.intake.intake(
      intakePayload("duplicate-first", { phone }),
      manager,
    );
    if (first.outcome === "REJECTED") throw new Error("Entrada inicial rejeitada.");
    await drainDue(local.worker, "crm22-duplicate-first");
    const second = await local.intake.intake(
      intakePayload("duplicate-second", {
        phone,
        fullName: "Nome divergente não confiável",
        interestSummary: "Nova conversão com outra dor; preservar ambas.",
      }),
      manager,
    );
    expect(second).toMatchObject({ outcome: "ATTACHED", leadId: first.leadId });
    if (second.outcome === "REJECTED") throw new Error("Duplicidade rejeitada.");
    await drainDue(local.worker, "crm22-duplicate-second");

    const lead = await database.lead.findUniqueOrThrow({ where: { id: first.leadId } });
    expect(lead.fullName).toBe(`Lead CRM-22 duplicate-first`);
    expect(lead.needsIdentityReview).toBe(true);
    expect(await database.leadFormSubmission.count({ where: { leadId: lead.id } })).toBe(2);
    expect(await database.leadScore.count({ where: { leadId: lead.id } })).toBe(2);
    expect(await database.notification.count({
      where: { leadId: lead.id, title: "Nova conversão duplicada" },
    })).toBe(1);
    expect(await database.activity.count({
      where: { leadId: lead.id, subject: "Automação: duplicidade tratada" },
    })).toBe(1);
    await finishScheduledChecks(testClock, local.worker, "crm22-duplicate-cleanup");
  });

  it("destaca P1 com motivo persistido e escala ao gestor após 60 segundos sem tentativa", async () => {
    const testClock = clock("2046-01-04T12:00:00.000Z");
    const local = services(testClock);
    const result = await local.intake.intake(
      intakePayload("p1", {
        jobTitle: "Diretora",
        budgetCents: 1_200_000,
        priorityBandCode: "P1",
      }),
      manager,
    );
    if (result.outcome === "REJECTED") throw new Error("Entrada P1 rejeitada.");
    expect(result.priorityBandCode).toBe("P1");
    await drainDue(local.worker, "crm22-p1-initial");
    const score = await database.leadCurrentScore.findUniqueOrThrow({
      where: { workspaceId_leadId: { workspaceId, leadId: result.leadId } },
      include: { leadScore: true },
    });
    const p1Notification = await database.notification.findFirstOrThrow({
      where: { leadId: result.leadId, title: "Lead P1 priorizado" },
    });
    expect(p1Notification.body).toBe(score.leadScore.reason);
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: "P1_PRIORITY", status: "OPEN" },
    })).toBe(1);

    testClock.advanceSeconds(60);
    await drainDue(local.worker, "crm22-p1-manager");
    expect(await database.notification.count({
      where: { leadId: result.leadId, title: "P1 ainda sem tentativa humana" },
    })).toBeGreaterThan(0);
    testClock.advanceSeconds(1);
    await drainDue(local.worker, "crm22-p1-attention");
    testClock.advanceSeconds(120);
    await drainDue(local.worker, "crm22-p1-critical");
  });

  it("registra atenção em 60s e crítico em 180s sem alterar o SLA zero", async () => {
    const testClock = clock("2046-01-05T12:00:00.000Z");
    const local = services(testClock);
    const result = await local.intake.intake(intakePayload("sla"), manager);
    if (result.outcome === "REJECTED") throw new Error("Entrada SLA rejeitada.");
    await drainDue(local.worker, "crm22-sla-received");
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: { in: ["SLA_ATTENTION", "SLA_CRITICAL"] } },
    })).toBe(0);

    testClock.advanceSeconds(60);
    await drainDue(local.worker, "crm22-sla-boundary-60");
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: "SLA_ATTENTION" },
    })).toBe(0);
    testClock.advanceSeconds(1);
    await drainDue(local.worker, "crm22-sla-60");
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: "SLA_ATTENTION" },
    })).toBe(1);
    testClock.advanceSeconds(119);
    await drainDue(local.worker, "crm22-sla-boundary-180");
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: "SLA_CRITICAL" },
    })).toBe(0);
    testClock.advanceSeconds(1);
    await drainDue(local.worker, "crm22-sla-180");
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: "SLA_CRITICAL" },
    })).toBe(1);
    const cycle = await database.leadSlaCycle.findUniqueOrThrow({
      where: { id: result.slaCycleId },
      include: { priorityBand: { include: { slaPolicy: true } } },
    });
    expect(cycle.assignedAt).toEqual(cycle.receivedAt);
    expect(cycle.automaticAcknowledgedAt).toEqual(cycle.receivedAt);
    expect(cycle.priorityBand.slaPolicy).toMatchObject({
      name: "SLA imediato — 0 minutos",
      firstResponseMinutes: 0,
      healthyMaxSeconds: 60,
      attentionMaxSeconds: 180,
    });
  });

  it("não gera violação depois da primeira tentativa e registra o fato somente uma vez", async () => {
    const testClock = clock("2046-01-06T12:00:00.000Z");
    const local = services(testClock);
    const result = await local.intake.intake(intakePayload("attempt"), manager);
    if (result.outcome === "REJECTED") throw new Error("Entrada rejeitada.");
    await drainDue(local.worker, "crm22-attempt-received");
    testClock.advanceSeconds(30);
    const first = await local.history.recordActivity(manager, {
      leadId: result.leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Primeira tentativa",
      nextTask: {
        title: "Retornar amanhã",
        kind: "FOLLOW_UP",
        priority: "HIGH",
        dueAt: new Date(testClock.now().getTime() + 86_400_000),
      },
    });
    const second = await local.history.recordActivity(manager, {
      leadId: result.leadId,
      type: "CALL_UNANSWERED",
      direction: "OUTBOUND",
      subject: "Segunda tentativa",
    });
    expect(first.firstHumanAttemptRecorded).toBe(true);
    expect(second.firstHumanAttemptRecorded).toBe(false);
    await finishScheduledChecks(testClock, local.worker, "crm22-attempt-cleanup");
    expect(await database.operationalAlert.count({
      where: { leadId: result.leadId, type: { in: ["SLA_ATTENTION", "SLA_CRITICAL"] } },
    })).toBe(0);
    const cycle = await database.leadSlaCycle.findUniqueOrThrow({ where: { id: result.slaCycleId } });
    expect(cycle.firstHumanAttemptSeconds).toBe(30);
  });

  it("prioriza Lead respondeu, reutiliza Ligar agora e cancela cadência incompatível", async () => {
    const testClock = clock("2046-01-07T12:00:00.000Z");
    const local = services(testClock);
    const result = await local.intake.intake(intakePayload("replied"), manager);
    if (result.outcome === "REJECTED") throw new Error("Entrada rejeitada.");
    await drainDue(local.worker, "crm22-replied-received");

    const cadenceRule = await database.automationRule.create({
      data: {
        workspaceId,
        key: `test-cadence-${randomUUID()}`,
        name: "Cadência futura de teste",
        status: "ACTIVE",
        triggerType: "MANUAL",
        actionType: "CREATE_NOTIFICATION",
        conditions: { all: [] },
        actionConfig: { category: "OUTREACH_CADENCE" },
        createdByActorId: automationActorId,
        updatedByActorId: automationActorId,
      },
    });
    const cadenceRun = await database.automationRun.create({
      data: {
        workspaceId,
        automationRuleId: cadenceRule.id,
        leadId: result.leadId,
        actorId: automationActorId,
        status: "PENDING",
        idempotencyKey: `test-cadence:${randomUUID()}`,
        ruleVersion: 1,
        triggerType: "MANUAL",
        actionType: "CREATE_NOTIFICATION",
        conditionsSnapshot: { all: [] },
        actionConfigSnapshot: { category: "OUTREACH_CADENCE" },
        triggeredAt: testClock.now(),
        inputPayload: { payload: { leadId: result.leadId } },
      },
    });
    await database.job.create({
      data: {
        workspaceId,
        type: "AUTOMATION",
        status: "PENDING",
        automationRunId: cadenceRun.id,
        idempotencyKey: cadenceRun.idempotencyKey,
        runAt: new Date(testClock.now().getTime() + 86_400_000),
        payload: { payload: { leadId: result.leadId } },
        createdByActorId: automationActorId,
        updatedByActorId: automationActorId,
      },
    });

    testClock.advanceSeconds(10);
    await local.history.recordActivity(manager, {
      leadId: result.leadId,
      type: "MESSAGE_RECEIVED",
      direction: "INBOUND",
      subject: "Lead respondeu",
    });
    await drainDue(local.worker, "crm22-replied-action");
    const lead = await database.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.awaitingHumanResponse).toBe(true);
    expect(await database.task.count({
      where: { leadId: result.leadId, kind: "IMMEDIATE_CALL", status: "OPEN" },
    })).toBe(1);
    expect(await database.notification.count({
      where: { leadId: result.leadId, title: "Lead respondeu" },
    })).toBe(1);
    expect((await database.automationRun.findUniqueOrThrow({ where: { id: cadenceRun.id } })).status).toBe("CANCELLED");
    await finishScheduledChecks(testClock, local.worker, "crm22-replied-cleanup");
  });

  it("preserva opt-out e usa a Fila Geral quando nenhum SDR está disponível", async () => {
    const testClock = clock("2046-01-08T12:00:00.000Z");
    const local = services(testClock);
    const sdrMembers = await database.workspaceMember.findMany({
      where: {
        workspaceId,
        teamMemberships: { some: { function: "SDR", deletedAt: null } },
      },
      select: {
        id: true,
        leadReceivingPausedAt: true,
        leadReceivingPauseReason: true,
        leadReceivingPausedByActorId: true,
      },
    });
    await database.workspaceMember.updateMany({
      where: { id: { in: sdrMembers.map(({ id }) => id) } },
      data: {
        leadReceivingPausedAt: testClock.now(),
        leadReceivingPauseReason: "Pausa controlada do teste CRM-22.",
        leadReceivingPausedByActorId: manager.actorId,
        updatedByActorId: manager.actorId,
      },
    });
    try {
      const result = await local.intake.intake(
        intakePayload("optout-queue", {
          consent: undefined,
          doNotContact: true,
        }),
        manager,
      );
      if (result.outcome === "REJECTED") throw new Error("Entrada rejeitada.");
      expect(result.operationalOwner.type).toBe("QUEUE");
      await drainDue(local.worker, "crm22-optout-received");
      expect(await database.message.count({
        where: { workspaceId, conversation: { leadId: result.leadId }, isSimulated: true },
      })).toBe(0);
      expect(await database.notification.count({
        where: { leadId: result.leadId, title: "Novo lead para atendimento imediato" },
      })).toBeGreaterThan(0);

      testClock.advanceSeconds(10);
      await local.history.recordActivity(manager, {
        leadId: result.leadId,
        type: "MESSAGE_RECEIVED",
        direction: "INBOUND",
        subject: "Resposta recebida com opt-out",
      });
      await drainDue(local.worker, "crm22-optout-reply");
      expect(await database.task.count({
        where: { leadId: result.leadId, kind: "IMMEDIATE_CALL", status: "OPEN" },
      })).toBe(0);
      const lead = await database.lead.findUniqueOrThrow({ where: { id: result.leadId } });
      expect(lead.contactPreference).toBe("DO_NOT_CONTACT");
      await finishScheduledChecks(testClock, local.worker, "crm22-optout-cleanup");
      expect(await database.operationalAlert.count({
        where: { leadId: result.leadId, type: { in: ["SLA_ATTENTION", "SLA_CRITICAL"] } },
      })).toBe(0);
    } finally {
      for (const member of sdrMembers) {
        await database.workspaceMember.update({
          where: { id: member.id },
          data: {
            leadReceivingPausedAt: member.leadReceivingPausedAt,
            leadReceivingPauseReason: member.leadReceivingPauseReason,
            leadReceivingPausedByActorId: member.leadReceivingPausedByActorId,
            updatedByActorId: manager.actorId,
          },
        });
      }
    }
  });

  it("reverte efeito em falha, aplica retry e não duplica a mensagem", async () => {
    const testClock = clock("2046-01-09T12:00:00.000Z");
    const local = services(testClock);
    await drainDue(local.worker, "crm22-retry-preflight");
    const result = await local.intake.intake(intakePayload("retry"), manager);
    if (result.outcome === "REJECTED") throw new Error("Entrada rejeitada.");
    const realExecutor = createDefaultAutomationActionRegistry();
    let failed = false;
    const retryWorker = createAutomationWorkerService({
      database,
      actionExecutor: {
        async execute(transaction, execution) {
          const key = execution.actionConfig.automationKey;
          if (key === EntryAutomationKeys.LEAD_RECEIVED && !failed) {
            failed = true;
            throw new Error("Falha transitória controlada.");
          }
          return realExecutor.execute(transaction, execution);
        },
      },
      now: testClock.now,
      lockTimeoutSeconds: 30,
      backoffBaseSeconds: 5,
    });
    expect(await retryWorker.processNext("crm22-retry-first")).toMatchObject({
      status: "RETRY_SCHEDULED",
      attemptNumber: 1,
    });
    expect(await database.message.count({
      where: { workspaceId, conversation: { leadId: result.leadId }, isSimulated: true },
    })).toBe(0);
    testClock.advanceSeconds(5);
    expect(await retryWorker.processNext("crm22-retry-second")).toMatchObject({
      status: "SUCCEEDED",
      attemptNumber: 2,
    });
    expect(await database.message.count({
      where: { workspaceId, conversation: { leadId: result.leadId }, isSimulated: true },
    })).toBe(1);
    await finishScheduledChecks(testClock, local.worker, "crm22-retry-cleanup");
  });
});
