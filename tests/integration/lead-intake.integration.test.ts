import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for lead intake integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 15 }),
});
const authorization = createAuthorizationService({ database });
const fixedNow = new Date("2031-05-20T13:00:00.000Z");

type Fixture = Readonly<{
  workspaceId: string;
  workspaceSlug: string;
  systemContext: ServiceActorContext;
  managerContext: AuthenticatedContext;
  viewerContext: AuthenticatedContext;
  managerMemberId: string;
  queueId: string;
  teamId: string;
  sourceId: string;
  campaignId: string;
  creativeId: string;
}>;

async function createMember(
  workspaceId: string,
  workspaceSlug: string,
  systemActorId: string,
  roleId: string,
  roleKey: string,
  label: string,
): Promise<AuthenticatedContext> {
  const suffix = randomUUID();
  const email = `${label}.${suffix}@intake.test`;
  const user = await database.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: `Pessoa ${label}`,
    },
  });
  const member = await database.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      roleId,
      status: "ACTIVE",
      joinedAt: fixedNow,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  const actor = await database.actor.create({
    data: {
      workspaceId,
      userId: user.id,
      type: "HUMAN",
      key: `user:${user.id}`,
      displayName: user.displayName,
    },
  });

  return Object.freeze({
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug,
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId,
    roleKey,
    roleName: roleKey,
    displayName: user.displayName,
  });
}

async function createFixture(label: string): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({
    data: {
      slug: `intake-${label}-${suffix}`.toLowerCase(),
      name: `Intake ${label} ${suffix}`,
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

  const permission = await database.permission.upsert({
    where: { key: PermissionKeys.LEADS_WRITE },
    update: {},
    create: {
      key: PermissionKeys.LEADS_WRITE,
      description: "Alterar leads",
    },
  });
  const [managerRole, viewerRole] = await Promise.all([
    database.role.create({
      data: {
        workspaceId: workspace.id,
        key: "manager",
        name: "Gestor",
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
  await database.rolePermission.create({
    data: {
      workspaceId: workspace.id,
      roleId: managerRole.id,
      permissionId: permission.id,
      scope: "TEAM",
      createdByActorId: systemActor.id,
    },
  });

  const managerContext = await createMember(
    workspace.id,
    workspace.slug,
    systemActor.id,
    managerRole.id,
    "manager",
    "manager",
  );
  const viewerContext = await createMember(
    workspace.id,
    workspace.slug,
    systemActor.id,
    viewerRole.id,
    "viewer",
    "viewer",
  );

  const team = await database.team.create({
    data: {
      workspaceId: workspace.id,
      name: "Pré-vendas",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  await database.teamMember.create({
    data: {
      workspaceId: workspace.id,
      teamId: team.id,
      workspaceMemberId: managerContext.memberId,
      function: "MANAGER",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const queue = await database.queue.create({
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
  const source = await database.leadSource.create({
    data: {
      workspaceId: workspace.id,
      key: "manual",
      name: "Cadastro manual",
      type: "MANUAL",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  const campaign = await database.acquisitionCampaign.create({
    data: {
      workspaceId: workspace.id,
      name: "Campanha local",
      externalRef: "campaign:test",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  const creative = await database.acquisitionCreative.create({
    data: {
      workspaceId: workspace.id,
      campaignId: campaign.id,
      name: "Criativo local",
      externalRef: "creative:test",
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
  const slaPolicy = await database.slaPolicy.create({
    data: {
      workspaceId: workspace.id,
      key: "p3",
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
      slaPolicyId: slaPolicy.id,
      code: "P3",
      name: "P3",
      position: 2,
      scoreMin: 0,
      scoreMax: 49,
      leadPriority: "MEDIUM",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    systemContext: Object.freeze({
      workspaceId: workspace.id,
      actorId: systemActor.id,
      actorType: "SYSTEM",
      actorKey: "system",
    }),
    managerContext,
    viewerContext,
    managerMemberId: managerContext.memberId,
    queueId: queue.id,
    teamId: team.id,
    sourceId: source.id,
    campaignId: campaign.id,
    creativeId: creative.id,
  };
}

function payload(
  phone: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channel: "MANUAL",
    idempotencyKey: randomUUID(),
    fullName: "Maria da Silva",
    phone,
    email: "maria@example.test",
    jobTitle: "Assessora",
    organizationName: "Organização Exemplo",
    city: "São Paulo",
    stateCode: "sp",
    interestSummary: "Organizar o processo comercial",
    budgetCents: 250_000,
    sourceKey: "manual",
    campaignExternalRef: "campaign:test",
    creativeExternalRef: "creative:test",
    consent: true,
    rawPayload: { provider: "integration-test", row: 1 },
    ...overrides,
  };
}

function service(
  hooks: Readonly<{
    afterSubmissionPersisted?: () => Promise<void>;
    afterInitialOperationsPersisted?: () => Promise<void>;
  }> = {},
) {
  return createLeadIntakeService({
    database,
    authorization,
    now: () => fixedNow,
    ...hooks,
  });
}

afterAll(async () => {
  await database.$disconnect();
});

describe("serviço único de entrada de leads", () => {
  it("cria lead, submissão bruta, SLA, etapa, timeline e auditoria atomicamente", async () => {
    const fixture = await createFixture("create");
    const rawPayload = { provider: "manual-test", nested: { answer: 42 } };

    const result = await service().intake(
      payload("(11) 98765-4321", { rawPayload }),
      fixture.managerContext,
    );

    expect(result).toMatchObject({
      outcome: "CREATED",
      normalizedPhone: "+5511987654321",
      conversionCount: 1,
      reviewId: null,
      idempotentReplay: false,
    });
    if (result.outcome === "REJECTED") throw new Error("entrada rejeitada");

    const lead = await database.lead.findUniqueOrThrow({
      where: { id: result.leadId },
    });
    const submission = await database.leadFormSubmission.findUniqueOrThrow({
      where: { id: result.submissionId },
    });

    expect(lead).toMatchObject({
      queueId: fixture.queueId,
      routingQueueId: fixture.queueId,
      ownerMemberId: null,
      sourceId: fixture.sourceId,
      latestSourceId: fixture.sourceId,
      campaignId: fixture.campaignId,
      latestCampaignId: fixture.campaignId,
      creativeId: fixture.creativeId,
      latestCreativeId: fixture.creativeId,
      normalizedEmail: "maria@example.test",
      normalizedPhone: "+5511987654321",
      stateCode: "SP",
      budgetCents: 250_000n,
      contactPreference: "CONSENTED",
      conversionCount: 1,
      priority: "MEDIUM",
      nextActionDescription: "Ligar agora",
    });
    expect(lead.slaStartedAt).toEqual(fixedNow);
    expect(lead.slaDueAt).toEqual(fixedNow);
    expect(submission).toMatchObject({
      leadId: lead.id,
      contactId: lead.contactId,
      status: "LINKED",
      channel: "MANUAL",
      intakeOutcome: "CREATED",
      submittedPhone: "(11) 98765-4321",
      normalizedPhone: "+5511987654321",
      rawPayload,
    });
    expect(lead.contactId).toEqual(expect.any(String));
    await expect(
      database.contact.findUniqueOrThrow({
        where: { id: lead.contactId! },
        include: { points: { orderBy: { type: "asc" } } },
      }),
    ).resolves.toMatchObject({
      preferredName: "Maria da Silva",
      origin: "LEAD_INTAKE",
      points: [
        { type: "PHONE", normalizedValue: "+5511987654321", doNotContact: false },
        { type: "EMAIL", normalizedValue: "maria@example.test", doNotContact: false },
      ],
    });
    await expect(
      Promise.all([
        database.stageHistory.count({ where: { leadId: lead.id, exitedAt: null } }),
        database.activity.count({ where: { leadId: lead.id } }),
        database.leadAssignment.count({ where: { leadId: lead.id } }),
        database.leadSlaCycle.count({ where: { leadId: lead.id } }),
        database.task.count({
          where: { leadId: lead.id, kind: "IMMEDIATE_CALL" },
        }),
        database.operationalAlert.count({
          where: { leadId: lead.id, status: "OPEN" },
        }),
        database.auditLog.count({
          where: { entityId: lead.id, action: "lead.intake.created" },
        }),
      ]),
    ).resolves.toEqual([1, 3, 1, 1, 1, 1, 1]);
  });

  it("anexa duplicidade, preserva campos confiáveis e mantém opt-out", async () => {
    const fixture = await createFixture("duplicate");
    const first = await service().intake(
      payload("11 98888-1111", {
        idempotencyKey: "duplicate:first",
        doNotContact: true,
        consent: undefined,
      }),
      fixture.systemContext,
    );
    const second = await service().intake(
      payload("+55 11 98888 1111", {
        idempotencyKey: "duplicate:second",
        fullName: "Outro nome submetido",
        email: "outro@example.test",
        organizationName: "Outra organização",
        interestSummary: "Interesse mais recente",
        consent: true,
        doNotContact: undefined,
      }),
      fixture.systemContext,
    );

    expect(first.outcome).toBe("CREATED");
    expect(second).toMatchObject({
      outcome: "ATTACHED",
      conversionCount: 2,
      idempotentReplay: false,
    });
    if (first.outcome === "REJECTED" || second.outcome === "REJECTED") {
      throw new Error("entrada rejeitada");
    }
    expect(second.leadId).toBe(first.leadId);

    const lead = await database.lead.findUniqueOrThrow({
      where: { id: first.leadId },
    });
    const review = await database.leadIdentityReview.findUniqueOrThrow({
      where: { id: second.reviewId! },
    });
    expect(lead).toMatchObject({
      fullName: "Maria da Silva",
      normalizedEmail: "maria@example.test",
      organizationName: "Organização Exemplo",
      interestSummary: "Organizar o processo comercial",
      latestInterestSummary: "Interesse mais recente",
      contactPreference: "DO_NOT_CONTACT",
      conversionCount: 2,
      needsIdentityReview: true,
    });
    expect(review).toMatchObject({
      leadId: lead.id,
      assignedTeamId: fixture.teamId,
      reason: "DUPLICATE_PHONE",
      status: "OPEN",
    });
    expect(review.divergenceFields).toEqual(
      expect.arrayContaining([
        "FULL_NAME",
        "EMAIL",
        "ORGANIZATION",
        "INTEREST",
        "CONTACT_PREFERENCE",
      ]),
    );
    expect(
      await database.contactIdentityReview.findMany({
        where: { workspaceId: fixture.workspaceId, leadId: lead.id, status: "OPEN" },
        select: { reason: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { reason: "NAME_DIVERGENCE" },
        { reason: "EMAIL_DIVERGENCE" },
      ]),
    );
    expect(
      await database.contactPoint.findFirstOrThrow({
        where: {
          workspaceId: fixture.workspaceId,
          contactId: lead.contactId!,
          type: "PHONE",
          deletedAt: null,
        },
      }),
    ).toMatchObject({ doNotContact: true });
    await expect(
      Promise.all([
        database.lead.count({ where: { workspaceId: fixture.workspaceId } }),
        database.leadFormSubmission.count({ where: { leadId: lead.id } }),
        database.activity.count({ where: { leadId: lead.id } }),
        database.notification.count({
          where: {
            leadId: lead.id,
            recipientMemberId: fixture.managerMemberId,
            type: "SYSTEM",
          },
        }),
        database.auditLog.count({
          where: { entityId: lead.id, action: "lead.intake.attached" },
        }),
      ]),
    ).resolves.toEqual([1, 2, 8, 1, 1]);
  });

  it("isola a identidade por workspace mesmo para o mesmo telefone", async () => {
    const [workspaceA, workspaceB] = await Promise.all([
      createFixture("workspace-a"),
      createFixture("workspace-b"),
    ]);
    const [resultA, resultB] = await Promise.all([
      service().intake(payload("11 97777-2222"), workspaceA.systemContext),
      service().intake(payload("11 97777-2222"), workspaceB.systemContext),
    ]);

    expect(resultA.outcome).toBe("CREATED");
    expect(resultB.outcome).toBe("CREATED");
    if (resultA.outcome === "REJECTED" || resultB.outcome === "REJECTED") {
      throw new Error("entrada rejeitada");
    }
    expect(resultA.leadId).not.toBe(resultB.leadId);
    expect(
      await database.contact.count({
        where: { workspaceId: { in: [workspaceA.workspaceId, workspaceB.workspaceId] } },
      }),
    ).toBe(2);
    expect(
      await database.contactIdentityReview.count({
        where: { workspaceId: { in: [workspaceA.workspaceId, workspaceB.workspaceId] } },
      }),
    ).toBe(0);
  });

  it("rejeita payload ou referência inválida sem persistência parcial", async () => {
    const fixture = await createFixture("invalid");
    const invalidPayload = await service().intake(
      payload("98765-4321", { fullName: "" }),
      fixture.systemContext,
    );
    const invalidReference = await service().intake(
      payload("11 96666-3333", { sourceKey: "unknown" }),
      fixture.systemContext,
    );

    expect(invalidPayload).toMatchObject({
      outcome: "REJECTED",
      code: "INVALID_PAYLOAD",
    });
    expect(invalidReference).toMatchObject({
      outcome: "REJECTED",
      code: "REFERENCE_NOT_FOUND",
    });
    await expect(
      Promise.all([
        database.lead.count({ where: { workspaceId: fixture.workspaceId } }),
        database.leadFormSubmission.count({
          where: { workspaceId: fixture.workspaceId },
        }),
      ]),
    ).resolves.toEqual([0, 0]);
  });

  it("serializa duas entradas concorrentes do mesmo telefone", async () => {
    const fixture = await createFixture("concurrency");
    const [first, second] = await Promise.all([
      service().intake(
        payload("11 95555-4444", { idempotencyKey: "concurrent:a" }),
        fixture.systemContext,
      ),
      service().intake(
        payload("+55 (11) 95555-4444", { idempotencyKey: "concurrent:b" }),
        fixture.systemContext,
      ),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual([
      "ATTACHED",
      "CREATED",
    ]);
    await expect(
      Promise.all([
        database.lead.count({ where: { workspaceId: fixture.workspaceId } }),
        database.leadFormSubmission.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.leadIdentityReview.count({
          where: { workspaceId: fixture.workspaceId },
        }),
      ]),
    ).resolves.toEqual([1, 2, 1]);
  });

  it("reexecuta a mesma chave de forma idempotente", async () => {
    const fixture = await createFixture("idempotency");
    const entry = payload("11 94444-5555", {
      idempotencyKey: "same-request",
    });
    const first = await service().intake(entry, fixture.systemContext);
    const replay = await service().intake(entry, fixture.systemContext);

    expect(first).toMatchObject({ outcome: "CREATED", idempotentReplay: false });
    expect(replay).toMatchObject({ outcome: "CREATED", idempotentReplay: true });
    await expect(
      Promise.all([
        database.lead.count({ where: { workspaceId: fixture.workspaceId } }),
        database.leadFormSubmission.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.activity.count({ where: { workspaceId: fixture.workspaceId } }),
      ]),
    ).resolves.toEqual([1, 1, 3]);
  });

  it("reverte submissão e efeitos posteriores quando o fluxo falha", async () => {
    const fixture = await createFixture("rollback");
    const failingService = service({
      afterInitialOperationsPersisted: async () => {
        throw new Error("falha injetada depois da distribuição");
      },
    });

    await expect(
      failingService.intake(payload("11 93333-6666"), fixture.systemContext),
    ).rejects.toThrow("falha injetada depois da distribuição");
    await expect(
      Promise.all([
        database.lead.count({ where: { workspaceId: fixture.workspaceId } }),
        database.leadFormSubmission.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.activity.count({ where: { workspaceId: fixture.workspaceId } }),
        database.leadAssignment.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.leadSlaCycle.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.task.count({ where: { workspaceId: fixture.workspaceId } }),
        database.roundRobinState.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.operationalAlert.count({
          where: { workspaceId: fixture.workspaceId },
        }),
        database.auditLog.count({
          where: {
            workspaceId: fixture.workspaceId,
            action: { startsWith: "lead.intake." },
          },
        }),
        database.contact.count({ where: { workspaceId: fixture.workspaceId } }),
        database.contactPoint.count({ where: { workspaceId: fixture.workspaceId } }),
      ]),
    ).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("aplica RBAC no servidor e não aceita contexto cruzado", async () => {
    const workspaceA = await createFixture("rbac-a");
    const workspaceB = await createFixture("rbac-b");

    await expect(
      service().intake(payload("11 92222-7777"), workspaceA.managerContext),
    ).resolves.toMatchObject({ outcome: "CREATED" });
    await expect(
      service().intake(payload("11 91111-8888"), workspaceA.viewerContext),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      service().intake(payload("11 90000-9999"), {
        ...workspaceA.managerContext,
        workspaceId: workspaceB.workspaceId,
        workspaceSlug: workspaceB.workspaceSlug,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    expect(
      await database.lead.count({ where: { workspaceId: workspaceB.workspaceId } }),
    ).toBe(0);
  });
});
