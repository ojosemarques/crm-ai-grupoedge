import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for distribution integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 20 }),
});
const authorization = createAuthorizationService({ database });
const fixedNow = new Date("2031-05-20T13:00:00.000Z");

type HumanFixture = Readonly<{
  context: AuthenticatedContext;
  memberId: string;
  teamMemberId: string;
  userId: string;
}>;

type Fixture = Readonly<{
  workspaceId: string;
  teamId: string;
  queueId: string;
  manager: HumanFixture;
  viewer: HumanFixture;
  sdrs: readonly HumanFixture[];
  systemContext: ServiceActorContext;
}>;

async function createHuman(
  input: Readonly<{
    workspaceId: string;
    workspaceSlug: string;
    systemActorId: string;
    roleId: string;
    roleKey: string;
    teamId: string;
    teamFunction: "MANAGER" | "SDR" | "SUPPORT";
    label: string;
    position: number;
  }>,
): Promise<HumanFixture> {
  const suffix = randomUUID();
  const email = `${input.label}.${suffix}@distribution.test`;
  const user = await database.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: `Pessoa ${input.label}`,
    },
  });
  const member = await database.workspaceMember.create({
    data: {
      workspaceId: input.workspaceId,
      userId: user.id,
      roleId: input.roleId,
      status: "ACTIVE",
      joinedAt: fixedNow,
      createdByActorId: input.systemActorId,
      updatedByActorId: input.systemActorId,
    },
  });
  const actor = await database.actor.create({
    data: {
      workspaceId: input.workspaceId,
      userId: user.id,
      type: "HUMAN",
      key: `user:${user.id}`,
      displayName: user.displayName,
    },
  });
  const teamMember = await database.teamMember.create({
    data: {
      workspaceId: input.workspaceId,
      teamId: input.teamId,
      workspaceMemberId: member.id,
      function: input.teamFunction,
      createdAt: new Date(fixedNow.getTime() + input.position),
      createdByActorId: input.systemActorId,
      updatedByActorId: input.systemActorId,
    },
  });

  return Object.freeze({
    userId: user.id,
    memberId: member.id,
    teamMemberId: teamMember.id,
    context: Object.freeze({
      sessionId: randomUUID(),
      workspaceId: input.workspaceId,
      workspaceSlug: input.workspaceSlug,
      userId: user.id,
      memberId: member.id,
      actorId: actor.id,
      roleId: input.roleId,
      roleKey: input.roleKey,
      roleName: input.roleKey,
      displayName: user.displayName,
    }),
  });
}

async function createFixture(label: string, sdrCount: number): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({
    data: {
      slug: `distribution-${label}-${suffix}`.toLowerCase(),
      name: `Distribution ${label} ${suffix}`,
      timeZone: "America/Sao_Paulo",
    },
  });
  const systemActor = await database.actor.create({
    data: {
      workspaceId: workspace.id,
      type: "SYSTEM",
      key: "system",
      displayName: "Sistema",
    },
  });
  const team = await database.team.create({
    data: {
      workspaceId: workspace.id,
      name: "Pré-vendas",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const [writePermission, assignPermission] = await Promise.all([
    database.permission.upsert({
      where: { key: PermissionKeys.LEADS_WRITE },
      update: {},
      create: {
        key: PermissionKeys.LEADS_WRITE,
        description: "Alterar leads",
      },
    }),
    database.permission.upsert({
      where: { key: PermissionKeys.LEADS_ASSIGN },
      update: {},
      create: {
        key: PermissionKeys.LEADS_ASSIGN,
        description: "Distribuir leads",
      },
    }),
  ]);
  const [managerRole, sdrRole, viewerRole] = await Promise.all([
    database.role.create({
      data: {
        workspaceId: workspace.id,
        key: "commercial-manager",
        name: "Gestor comercial",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
    database.role.create({
      data: {
        workspaceId: workspace.id,
        key: "sdr",
        name: "SDR",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
    database.role.create({
      data: {
        workspaceId: workspace.id,
        key: "viewer",
        name: "Visualizador",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
  ]);
  await database.rolePermission.createMany({
    data: [
      {
        workspaceId: workspace.id,
        roleId: managerRole.id,
        permissionId: writePermission.id,
        scope: "TEAM",
        createdByActorId: systemActor.id,
      },
      {
        workspaceId: workspace.id,
        roleId: managerRole.id,
        permissionId: assignPermission.id,
        scope: "TEAM",
        createdByActorId: systemActor.id,
      },
      {
        workspaceId: workspace.id,
        roleId: sdrRole.id,
        permissionId: writePermission.id,
        scope: "OWN",
        createdByActorId: systemActor.id,
      },
    ],
  });

  const manager = await createHuman({
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    systemActorId: systemActor.id,
    roleId: managerRole.id,
    roleKey: "commercial-manager",
    teamId: team.id,
    teamFunction: "MANAGER",
    label: `${label}-manager`,
    position: 0,
  });
  const viewer = await createHuman({
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    systemActorId: systemActor.id,
    roleId: viewerRole.id,
    roleKey: "viewer",
    teamId: team.id,
    teamFunction: "SUPPORT",
    label: `${label}-viewer`,
    position: 1,
  });
  const sdrs: HumanFixture[] = [];
  for (let index = 0; index < sdrCount; index += 1) {
    sdrs.push(
      await createHuman({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        systemActorId: systemActor.id,
        roleId: sdrRole.id,
        roleKey: "sdr",
        teamId: team.id,
        teamFunction: "SDR",
        label: `${label}-sdr-${index + 1}`,
        position: index + 2,
      }),
    );
  }

  await database.queue.create({
    data: {
      workspaceId: workspace.id,
      teamId: team.id,
      key: "general",
      name: "Fila Geral",
      isGeneral: true,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  const queue = await database.queue.findFirstOrThrow({
    where: { workspaceId: workspace.id, isGeneral: true },
  });
  await database.leadSource.create({
    data: {
      workspaceId: workspace.id,
      key: "manual",
      name: "Cadastro manual",
      type: "MANUAL",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  const pipeline = await database.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: "Pré-vendas",
      entityType: "LEAD",
      isDefault: true,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  await database.pipelineStage.create({
    data: {
      workspaceId: workspace.id,
      pipelineId: pipeline.id,
      name: "Novo",
      position: 0,
      type: "OPEN",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const bands = [
    { code: "P1", min: 70, max: 100, priority: "URGENT" },
    { code: "P2", min: 40, max: 69, priority: "HIGH" },
    { code: "P3", min: 0, max: 39, priority: "MEDIUM" },
  ] as const;
  for (const [position, band] of bands.entries()) {
    const policy = await database.slaPolicy.create({
      data: {
        workspaceId: workspace.id,
        key: `${band.code.toLowerCase()}-immediate`,
        name: "SLA imediato — 0 minutos",
        firstResponseMinutes: 0,
        warningMinutesBeforeDue: 0,
        healthyMaxSeconds: 60,
        attentionMaxSeconds: 180,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });
    await database.leadPriorityBand.create({
      data: {
        workspaceId: workspace.id,
        slaPolicyId: policy.id,
        code: band.code,
        name: band.code,
        position,
        scoreMin: band.min,
        scoreMax: band.max,
        leadPriority: band.priority,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });
  }

  return Object.freeze({
    workspaceId: workspace.id,
    teamId: team.id,
    queueId: queue.id,
    manager,
    viewer,
    sdrs,
    systemContext: Object.freeze({
      workspaceId: workspace.id,
      actorId: systemActor.id,
      actorType: "SYSTEM",
      actorKey: "system",
    }),
  });
}

function payload(
  phone: string,
  priorityBandCode: "P1" | "P2" | "P3" = "P3",
) {
  return {
    channel: "MANUAL" as const,
    idempotencyKey: randomUUID(),
    fullName: `Lead ${phone}`,
    phone,
    sourceKey: "manual",
    priorityBandCode,
    rawPayload: { source: "distribution-integration" },
  };
}

function services() {
  return {
    intake: createLeadIntakeService({
      database,
      authorization,
      now: () => fixedNow,
    }),
    distribution: createLeadDistributionService({
      database,
      authorization,
      now: () => fixedNow,
    }),
  };
}

function accepted<T extends { outcome: string }>(result: T): asserts result is T & {
  outcome: "CREATED" | "ATTACHED";
  leadId: string;
  taskId: string;
  slaCycleId: string;
  operationalOwner: Readonly<{
    type: "MEMBER" | "QUEUE";
    memberId: string | null;
    queueId: string | null;
  }>;
} {
  if (result.outcome === "REJECTED") {
    throw new Error("A entrada de teste foi rejeitada.");
  }
}

afterAll(async () => {
  await database.$disconnect();
});

describe("distribuição operacional e SLA imediato", () => {
  it("mantém round-robin previsível e prioridade persistida", async () => {
    const fixture = await createFixture("round-robin", 3);
    const { intake } = services();
    const expectedOwners = [
      fixture.sdrs[0]!.memberId,
      fixture.sdrs[1]!.memberId,
      fixture.sdrs[2]!.memberId,
      fixture.sdrs[0]!.memberId,
    ];
    const bands = ["P1", "P2", "P3", "P1"] as const;

    for (const [index, band] of bands.entries()) {
      const result = await intake.intake(
        payload(`11 98${index}00-10${index}0`, band),
        fixture.systemContext,
      );
      accepted(result);
      expect(result.operationalOwner).toEqual({
        type: "MEMBER",
        memberId: expectedOwners[index],
        queueId: null,
      });
      const task = await database.task.findUniqueOrThrow({
        where: { id: result.taskId },
      });
      expect(task).toMatchObject({
        assigneeMemberId: expectedOwners[index],
        queueId: null,
        title: "Ligar agora",
        kind: "IMMEDIATE_CALL",
        status: "OPEN",
        priority: band === "P1" ? "URGENT" : band === "P2" ? "HIGH" : "MEDIUM",
      });
      expect(task.dueAt).toEqual(fixedNow);
    }

    await expect(
      database.roundRobinState.findUniqueOrThrow({
        where: { queueId: fixture.queueId },
        select: { assignmentSequence: true, lastAssignedTeamMemberId: true },
      }),
    ).resolves.toEqual({
      assignmentSequence: 4n,
      lastAssignedTeamMemberId: fixture.sdrs[0]!.teamMemberId,
    });
  });

  it("serializa entradas simultâneas sem dupla atribuição e preserva P1, P2 e P3", async () => {
    const fixture = await createFixture("simultaneous", 3);
    const { intake } = services();
    const results = (
      await Promise.all([
      intake.intake(payload("11 98701-2001", "P1"), fixture.systemContext),
      intake.intake(payload("11 98702-2002", "P2"), fixture.systemContext),
      intake.intake(payload("11 98703-2003", "P3"), fixture.systemContext),
      ])
    ).map((result) => {
      accepted(result);
      return result;
    });

    expect(new Set(results.map((result) => result.operationalOwner.memberId))).toEqual(
      new Set(fixture.sdrs.map(({ memberId }) => memberId)),
    );
    const tasks = await database.task.findMany({
      where: { id: { in: results.map(({ taskId }) => taskId) } },
      select: { priority: true },
    });
    expect(tasks.map(({ priority }) => priority).sort()).toEqual([
      "HIGH",
      "MEDIUM",
      "URGENT",
    ]);
    await expect(
      Promise.all([
        database.leadAssignment.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.leadSlaCycle.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.task.count({
          where: { workspaceId: fixture.workspaceId, kind: "IMMEDIATE_CALL" },
        }),
      ]),
    ).resolves.toEqual([3, 3, 3]);
  });

  it("respeita o limite configurado de leads abertos por SDR", async () => {
    const fixture = await createFixture("capacity-limit", 2);
    await database.workspace.update({
      where: { id: fixture.workspaceId },
      data: { maxOpenLeadsPerSdr: 1 },
    });
    const { intake } = services();
    const first = await intake.intake(payload("11 98704-2401", "P1"), fixture.systemContext);
    const second = await intake.intake(payload("11 98704-2402", "P2"), fixture.systemContext);
    const third = await intake.intake(payload("11 98704-2403", "P3"), fixture.systemContext);
    accepted(first); accepted(second); accepted(third);
    expect(new Set([first.operationalOwner.memberId, second.operationalOwner.memberId])).toEqual(
      new Set(fixture.sdrs.map((member) => member.memberId)),
    );
    expect(third.operationalOwner).toEqual({ type: "QUEUE", memberId: null, queueId: fixture.queueId });
  });

  it("ignora SDR pausado e inativo, permitindo pausa própria auditada", async () => {
    const fixture = await createFixture("availability", 4);
    const { intake, distribution } = services();

    await distribution.setReceivingPause(fixture.manager.context, {
      memberId: fixture.sdrs[0]!.memberId,
      paused: true,
      reason: "Ausência planejada",
    });
    await database.workspaceMember.update({
      where: { id: fixture.sdrs[1]!.memberId },
      data: {
        status: "INACTIVE",
        updatedByActorId: fixture.manager.context.actorId,
      },
    });
    await database.user.update({
      where: { id: fixture.sdrs[2]!.userId },
      data: { status: "DISABLED" },
    });

    const result = await intake.intake(
      payload("11 98711-2111", "P1"),
      fixture.systemContext,
    );
    accepted(result);
    expect(result.operationalOwner.memberId).toBe(fixture.sdrs[3]!.memberId);

    await distribution.setReceivingPause(fixture.manager.context, {
      memberId: fixture.sdrs[0]!.memberId,
      paused: false,
    });
    await distribution.setReceivingPause(fixture.sdrs[0]!.context, {
      memberId: fixture.sdrs[0]!.memberId,
      paused: true,
      reason: "Pausa solicitada pelo SDR",
    });
    await expect(
      database.auditLog.count({
        where: {
          workspaceId: fixture.workspaceId,
          actorId: fixture.sdrs[0]!.context.actorId,
          action: "lead.receiving.paused",
        },
      }),
    ).resolves.toBe(1);
  });

  it("usa a Fila Geral como responsável explícito quando não há SDR", async () => {
    const fixture = await createFixture("general-queue", 0);
    const { intake } = services();
    const result = await intake.intake(
      payload("11 98721-2222", "P2"),
      fixture.systemContext,
    );
    accepted(result);

    expect(result.operationalOwner).toEqual({
      type: "QUEUE",
      memberId: null,
      queueId: fixture.queueId,
    });
    const [lead, cycle, task, assignment, alert] = await Promise.all([
      database.lead.findUniqueOrThrow({ where: { id: result.leadId } }),
      database.leadSlaCycle.findUniqueOrThrow({ where: { id: result.slaCycleId } }),
      database.task.findUniqueOrThrow({ where: { id: result.taskId } }),
      database.leadAssignment.findFirstOrThrow({ where: { leadId: result.leadId } }),
      database.operationalAlert.findFirstOrThrow({ where: { leadId: result.leadId } }),
    ]);
    expect(lead).toMatchObject({
      ownerMemberId: null,
      queueId: fixture.queueId,
      routingQueueId: fixture.queueId,
    });
    expect(cycle).toMatchObject({
      assignedMemberId: null,
      assignedQueueId: fixture.queueId,
      receivedAt: fixedNow,
      assignedAt: fixedNow,
      automaticAcknowledgedAt: fixedNow,
    });
    expect(task).toMatchObject({
      assigneeMemberId: null,
      queueId: fixture.queueId,
      dueAt: fixedNow,
    });
    expect(assignment).toMatchObject({
      type: "GENERAL_QUEUE_FALLBACK",
      toMemberId: null,
      toQueueId: fixture.queueId,
    });
    expect(alert).toMatchObject({
      queueId: fixture.queueId,
      type: "GENERAL_QUEUE_ASSIGNMENT",
      status: "OPEN",
    });
  });

  it("protege distribuição manual e redistribuição no servidor", async () => {
    const fixture = await createFixture("redistribution", 2);
    const { intake, distribution } = services();
    for (const sdr of fixture.sdrs) {
      await distribution.setReceivingPause(fixture.manager.context, {
        memberId: sdr.memberId,
        paused: true,
        reason: "Forçar entrada pela Fila Geral",
      });
    }
    const result = await intake.intake(
      payload("11 98731-2333"),
      fixture.systemContext,
    );
    accepted(result);

    await expect(
      distribution.assignManually(fixture.manager.context, {
        leadId: result.leadId,
        memberId: fixture.sdrs[0]!.memberId,
        reason: "Destino ainda está pausado",
      }),
    ).rejects.toMatchObject({ code: "COMMERCIAL_OWNER_UNAVAILABLE" });

    await distribution.setReceivingPause(fixture.manager.context, {
      memberId: fixture.sdrs[0]!.memberId,
      paused: false,
    });
    const manual = await distribution.assignManually(fixture.manager.context, {
      leadId: result.leadId,
      memberId: fixture.sdrs[0]!.memberId,
      reason: "Distribuição manual pelo gestor",
    });
    expect(manual).toMatchObject({
      ownerMemberId: fixture.sdrs[0]!.memberId,
      queueId: null,
    });

    await expect(
      distribution.redistribute(fixture.viewer.context, {
        leadId: result.leadId,
        target: { type: "GENERAL_QUEUE" },
        reason: "Tentativa sem permissão",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const redistributed = await distribution.redistribute(
      fixture.manager.context,
      {
        leadId: result.leadId,
        target: { type: "MEMBER", memberId: fixture.sdrs[1]!.memberId },
        reason: "Atribuição explícita mesmo com recebimento automático pausado",
      },
    );
    expect(redistributed.ownerMemberId).toBe(fixture.sdrs[1]!.memberId);

    const returnedToQueue = await distribution.redistribute(
      fixture.manager.context,
      {
        leadId: result.leadId,
        target: { type: "GENERAL_QUEUE" },
        reason: "Aguardar nova decisão do gestor",
      },
    );
    expect(returnedToQueue).toMatchObject({
      ownerMemberId: null,
      queueId: fixture.queueId,
    });

    const [lead, task, assignments, deniedAudits, openAlerts] = await Promise.all([
      database.lead.findUniqueOrThrow({ where: { id: result.leadId } }),
      database.task.findUniqueOrThrow({ where: { id: result.taskId } }),
      database.leadAssignment.findMany({
        where: { leadId: result.leadId },
        orderBy: { createdAt: "asc" },
      }),
      database.auditLog.count({
        where: {
          workspaceId: fixture.workspaceId,
          actorId: fixture.viewer.context.actorId,
          action: "authorization.denied",
        },
      }),
      database.operationalAlert.count({
        where: { leadId: result.leadId, status: "OPEN" },
      }),
    ]);
    expect(lead).toMatchObject({ ownerMemberId: null, queueId: fixture.queueId });
    expect(task).toMatchObject({ assigneeMemberId: null, queueId: fixture.queueId });
    expect(assignments.map(({ type }) => type)).toEqual([
      "GENERAL_QUEUE_FALLBACK",
      "MANUAL",
      "REDISTRIBUTION",
      "REDISTRIBUTION",
    ]);
    expect(deniedAudits).toBe(1);
    expect(openAlerts).toBe(1);
  });

  it("registra primeira tentativa e primeira conexão uma única vez em segundos", async () => {
    const fixture = await createFixture("human-attempt", 1);
    const { intake, distribution } = services();
    const result = await intake.intake(
      payload("11 98741-2444", "P1"),
      fixture.systemContext,
    );
    accepted(result);
    const firstAttemptAt = new Date("2031-05-20T10:01:01.900-03:00");
    const firstConnectedAt = new Date("2031-05-20T10:03:00.500-03:00");

    await expect(
      distribution.recordHumanAttempt(fixture.sdrs[0]!.context, {
        leadId: result.leadId,
        outcome: "NOT_CONNECTED",
        occurredAt: firstAttemptAt,
        nextTask: {
          title: "Retornar amanhã",
          kind: "FOLLOW_UP",
          priority: "HIGH",
          dueAt: new Date("2031-05-21T10:00:00.000-03:00"),
        },
      }),
    ).resolves.toMatchObject({
      firstHumanAttemptRecorded: true,
      firstConnectedRecorded: false,
    });
    await expect(
      distribution.recordHumanAttempt(fixture.sdrs[0]!.context, {
        leadId: result.leadId,
        outcome: "NOT_CONNECTED",
        occurredAt: new Date("2031-05-20T10:02:00.000-03:00"),
      }),
    ).resolves.toMatchObject({
      firstHumanAttemptRecorded: false,
      firstConnectedRecorded: false,
    });
    await expect(
      distribution.recordHumanAttempt(fixture.sdrs[0]!.context, {
        leadId: result.leadId,
        outcome: "CONNECTED",
        occurredAt: firstConnectedAt,
      }),
    ).resolves.toMatchObject({
      firstHumanAttemptRecorded: false,
      firstConnectedRecorded: true,
    });
    await distribution.recordHumanAttempt(fixture.sdrs[0]!.context, {
      leadId: result.leadId,
      outcome: "CONNECTED",
      occurredAt: new Date("2031-05-20T10:04:00.000-03:00"),
    });

    const [cycle, task, lead] = await Promise.all([
      database.leadSlaCycle.findUniqueOrThrow({ where: { id: result.slaCycleId } }),
      database.task.findUniqueOrThrow({ where: { id: result.taskId } }),
      database.lead.findUniqueOrThrow({ where: { id: result.leadId } }),
    ]);
    expect(cycle).toMatchObject({
      receivedAt: fixedNow,
      assignedAt: fixedNow,
      automaticAcknowledgedAt: fixedNow,
      firstHumanAttemptAt: firstAttemptAt,
      firstHumanAttemptSeconds: 61,
      firstConnectedAt,
      firstResponseTimeSeconds: 180,
    });
    expect(task).toMatchObject({
      status: "COMPLETED",
      completedAt: firstAttemptAt,
      result: "Tentativa humana registrada.",
    });
    expect(lead.firstRespondedAt).toEqual(firstConnectedAt);
    expect(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(cycle.receivedAt),
    ).toBe("10:00");
  });

  it("mantém o histórico de atribuição append-only", async () => {
    const fixture = await createFixture("append-only", 1);
    const { intake } = services();
    const result = await intake.intake(
      payload("11 98751-2555"),
      fixture.systemContext,
    );
    accepted(result);
    const assignment = await database.leadAssignment.findFirstOrThrow({
      where: { leadId: result.leadId },
    });

    await expect(
      database.leadAssignment.update({
        where: { id: assignment.id },
        data: { reason: "Tentativa de alteração" },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      database.leadAssignment.count({ where: { id: assignment.id } }),
    ).resolves.toBe(1);
  });
});
