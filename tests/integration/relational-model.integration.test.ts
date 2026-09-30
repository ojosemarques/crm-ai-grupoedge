import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for relational integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, {
    max: 5,
  }),
});

async function createFixture(prefix: string) {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({
    data: {
      name: `${prefix} ${suffix}`,
      slug: `${prefix.toLowerCase()}-${suffix}`,
    },
  });

  const systemActor = await database.actor.create({
    data: {
      workspaceId: workspace.id,
      type: "SYSTEM",
      key: "system",
      displayName: "Sistema Politizai",
    },
  });

  const role = await database.role.create({
    data: {
      workspaceId: workspace.id,
      key: "commercial",
      name: "Comercial",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const user = await database.user.create({
    data: {
      email: `${prefix}.${suffix}@example.test`,
      normalizedEmail: `${prefix}.${suffix}@example.test`.toLowerCase(),
      displayName: `Pessoa ${suffix}`,
    },
  });

  const member = await database.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      roleId: role.id,
      status: "ACTIVE",
      joinedAt: new Date(),
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const humanActor = await database.actor.create({
    data: {
      workspaceId: workspace.id,
      type: "HUMAN",
      key: `user:${user.id}`,
      displayName: user.displayName,
      userId: user.id,
    },
  });

  const source = await database.leadSource.create({
    data: {
      workspaceId: workspace.id,
      key: "manual",
      name: "Manual",
      type: "MANUAL",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const queue = await database.queue.create({
    data: {
      workspaceId: workspace.id,
      key: "general",
      name: "Fila geral",
      isGeneral: true,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const leadPipeline = await database.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: "Entrada de leads",
      entityType: "LEAD",
      isDefault: true,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const leadStage = await database.pipelineStage.create({
    data: {
      workspaceId: workspace.id,
      pipelineId: leadPipeline.id,
      name: "Novo",
      position: 0,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const opportunityPipeline = await database.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: "Oportunidades",
      entityType: "OPPORTUNITY",
      isDefault: true,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  const opportunityStage = await database.pipelineStage.create({
    data: {
      workspaceId: workspace.id,
      pipelineId: opportunityPipeline.id,
      name: "Aberta",
      position: 0,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  return {
    workspace,
    systemActor,
    humanActor,
    role,
    user,
    member,
    source,
    queue,
    leadPipeline,
    leadStage,
    opportunityPipeline,
    opportunityStage,
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

type LeadOverrides = {
  sourceId?: string;
  pipelineId?: string;
  currentStageId?: string;
  ownerMemberId?: string | null;
  queueId?: string | null;
  normalizedPhone?: string | null;
};

async function createLead(fixture: Fixture, overrides: LeadOverrides = {}) {
  const now = new Date();
  const ownerMemberId = overrides.ownerMemberId ?? null;
  const queueId =
    overrides.queueId === undefined ? fixture.queue.id : overrides.queueId;

  return database.lead.create({
    data: {
      workspaceId: fixture.workspace.id,
      sourceId: overrides.sourceId ?? fixture.source.id,
      pipelineId: overrides.pipelineId ?? fixture.leadPipeline.id,
      currentStageId: overrides.currentStageId ?? fixture.leadStage.id,
      ownerMemberId,
      queueId,
      fullName: `Lead ${randomUUID().slice(0, 8)}`,
      normalizedPhone:
        overrides.normalizedPhone === undefined
          ? `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
          : overrides.normalizedPhone,
      status: "OPEN",
      priority: "MEDIUM",
      slaStartedAt: now,
      slaDueAt: new Date(now.getTime() + 5 * 60_000),
      lastActivityAt: now,
      nextActionTaskId: null,
      nextActionAt: null,
      nextActionDescription: null,
      createdByActorId: fixture.systemActor.id,
      updatedByActorId: fixture.systemActor.id,
    },
  });
}

async function createOpportunity(fixture: Fixture, leadId: string, amountCents: bigint) {
  return database.opportunity.create({
    data: {
      workspaceId: fixture.workspace.id,
      leadId,
      pipelineId: fixture.opportunityPipeline.id,
      currentStageId: fixture.opportunityStage.id,
      ownerMemberId: fixture.member.id,
      name: `Oportunidade ${randomUUID().slice(0, 8)}`,
      interestDescription: "Interesse relacional usado somente pelo teste",
      amountCents,
      probabilityBps: 5_000,
      createdByActorId: fixture.systemActor.id,
      updatedByActorId: fixture.systemActor.id,
    },
  });
}

afterAll(async () => {
  await database.$disconnect();
});

describe("modelo relacional do CRM", () => {
  it("cria atores humanos, de sistema, automação e agente de IA com vínculo coerente", async () => {
    const fixture = await createFixture("actors");

    const automationActor = await database.actor.create({
      data: {
        workspaceId: fixture.workspace.id,
        type: "AUTOMATION",
        key: "automation:sla",
        displayName: "Automação de SLA",
      },
    });
    const aiActor = await database.actor.create({
      data: {
        workspaceId: fixture.workspace.id,
        type: "AI_AGENT",
        key: "ai:recommendation",
        displayName: "Agente de recomendação",
      },
    });
    const secondHumanActor = await database.actor.create({
      data: {
        workspaceId: fixture.workspace.id,
        type: "HUMAN",
        key: "human:secondary",
        displayName: fixture.user.displayName,
        userId: fixture.user.id,
      },
    });

    expect([
      fixture.systemActor.type,
      automationActor.type,
      aiActor.type,
      secondHumanActor.type,
    ]).toEqual(["SYSTEM", "AUTOMATION", "AI_AGENT", "HUMAN"]);

    await expect(
      database.actor.create({
        data: {
          workspaceId: fixture.workspace.id,
          type: "SYSTEM",
          key: "invalid-system-user",
          displayName: "Sistema inválido",
          userId: fixture.user.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("impede relações entre workspaces diferentes", async () => {
    const origin = await createFixture("workspace-origin");
    const target = await createFixture("workspace-target");
    const permission = await database.permission.create({
      data: {
        key: `leads.read.${randomUUID()}`,
        description: "Permissão isolada para o teste",
      },
    });

    const validGrant = await database.rolePermission.create({
      data: {
        workspaceId: target.workspace.id,
        roleId: target.role.id,
        permissionId: permission.id,
        createdByActorId: target.systemActor.id,
      },
    });
    expect(validGrant.workspaceId).toBe(target.workspace.id);

    await expect(
      database.rolePermission.create({
        data: {
          workspaceId: target.workspace.id,
          roleId: origin.role.id,
          permissionId: permission.id,
          createdByActorId: target.systemActor.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      createLead(target, { sourceId: origin.source.id }),
    ).rejects.toThrow();

    await expect(
      database.role.create({
        data: {
          workspaceId: target.workspace.id,
          key: "invalid-actor",
          name: "Ator externo",
          createdByActorId: origin.systemActor.id,
          updatedByActorId: origin.systemActor.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("permite telefone compartilhado entre leads e delega identidade aos contatos", async () => {
    const firstWorkspace = await createFixture("phone-first");
    const secondWorkspace = await createFixture("phone-second");
    const normalizedPhone = "+5511999990001";

    await createLead(firstWorkspace, { normalizedPhone });

    const secondLeadInWorkspace = await createLead(firstWorkspace, {
      normalizedPhone,
    });
    expect(secondLeadInWorkspace.normalizedPhone).toBe(normalizedPhone);

    const leadInAnotherWorkspace = await createLead(secondWorkspace, {
      normalizedPhone,
    });
    expect(leadInAnotherWorkspace.normalizedPhone).toBe(normalizedPhone);

    await expect(
      createLead(firstWorkspace, { normalizedPhone: "11999990002" }),
    ).rejects.toThrow();
  });

  it("persiste a entrada antes do vínculo e preserva múltiplas submissões no soft delete", async () => {
    const fixture = await createFixture("soft-delete");
    const normalizedPhone = "+5511999990003";

    const pendingSubmission = await database.leadFormSubmission.create({
      data: {
        workspaceId: fixture.workspace.id,
        sourceId: fixture.source.id,
        status: "RECEIVED",
        idempotencyKey: `pending-form:${randomUUID()}`,
        normalizedPhone,
        submittedAt: new Date(),
        rawPayload: { phone: normalizedPhone },
        createdByActorId: fixture.systemActor.id,
      },
    });
    expect(pendingSubmission.leadId).toBeNull();

    const lead = await createLead(fixture, { normalizedPhone });

    const submission = await database.leadFormSubmission.create({
      data: {
        workspaceId: fixture.workspace.id,
        leadId: lead.id,
        sourceId: fixture.source.id,
        status: "LINKED",
        idempotencyKey: `form:${randomUUID()}`,
        normalizedPhone,
        submittedAt: new Date(),
        rawPayload: { name: lead.fullName, phone: normalizedPhone },
        createdByActorId: fixture.systemActor.id,
      },
    });
    const secondSubmission = await database.leadFormSubmission.create({
      data: {
        workspaceId: fixture.workspace.id,
        leadId: lead.id,
        sourceId: fixture.source.id,
        status: "LINKED",
        idempotencyKey: `form:${randomUUID()}`,
        normalizedPhone,
        submittedAt: new Date(),
        rawPayload: { name: lead.fullName, phone: normalizedPhone, repeat: true },
        createdByActorId: fixture.systemActor.id,
      },
    });

    const deletedAt = new Date();
    await database.lead.update({
      where: { id: lead.id },
      data: {
        deletedAt,
        updatedByActorId: fixture.humanActor.id,
      },
    });

    const retainedSubmissions = await database.leadFormSubmission.findMany({
      where: { id: { in: [submission.id, secondSubmission.id] } },
    });
    expect(retainedSubmissions).toHaveLength(2);
    expect(retainedSubmissions.every((item) => item.leadId === lead.id)).toBe(true);

    const replacement = await createLead(fixture, { normalizedPhone });
    expect(replacement.id).not.toBe(lead.id);

    await expect(
      database.lead.delete({ where: { id: lead.id } }),
    ).rejects.toThrow();
  });

  it("rejeita centavos negativos e preserva inteiros monetários grandes", async () => {
    const fixture = await createFixture("money");
    const lead = await createLead(fixture);

    await expect(
      database.product.create({
        data: {
          workspaceId: fixture.workspace.id,
          sku: `negative-${randomUUID()}`,
          name: "Produto inválido",
          listPriceCents: -1n,
          createdByActorId: fixture.systemActor.id,
          updatedByActorId: fixture.systemActor.id,
        },
      }),
    ).rejects.toThrow();

    await expect(createOpportunity(fixture, lead.id, -1n)).rejects.toThrow();

    const amountCents = 12_345_678_901n;
    const opportunity = await createOpportunity(fixture, lead.id, amountCents);
    const product = await database.product.create({
      data: {
        workspaceId: fixture.workspace.id,
        sku: `valid-${randomUUID()}`,
        name: "Produto válido",
        listPriceCents: 1_000n,
        createdByActorId: fixture.systemActor.id,
        updatedByActorId: fixture.systemActor.id,
      },
    });
    const offer = await database.offer.create({
      data: {
        workspaceId: fixture.workspace.id,
        opportunityId: opportunity.id,
        productId: product.id,
        name: "Proposta válida",
        quantity: 2,
        unitPriceCents: 1_000n,
        discountCents: 100n,
        totalCents: 1_900n,
        createdByActorId: fixture.systemActor.id,
        updatedByActorId: fixture.systemActor.id,
      },
    });

    expect(opportunity.amountCents).toBe(amountCents);
    expect(offer.totalCents).toBe(1_900n);

    await expect(
      database.offer.create({
        data: {
          workspaceId: fixture.workspace.id,
          opportunityId: opportunity.id,
          productId: product.id,
          name: "Proposta inconsistente",
          quantity: 2,
          unitPriceCents: 1_000n,
          discountCents: 100n,
          totalCents: 1_899n,
          createdByActorId: fixture.systemActor.id,
          updatedByActorId: fixture.systemActor.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("exige responsável ou fila e respeita o discriminador do pipeline", async () => {
    const fixture = await createFixture("required-relations");

    await expect(
      createLead(fixture, { queueId: null, ownerMemberId: null }),
    ).rejects.toThrow();

    await expect(
      createLead(fixture, {
        queueId: fixture.queue.id,
        ownerMemberId: fixture.member.id,
      }),
    ).rejects.toThrow();

    await expect(
      createLead(fixture, {
        pipelineId: fixture.opportunityPipeline.id,
        currentStageId: fixture.opportunityStage.id,
      }),
    ).rejects.toThrow();

    const ownedLead = await createLead(fixture, {
      queueId: null,
      ownerMemberId: fixture.member.id,
    });
    expect(ownedLead.ownerMemberId).toBe(fixture.member.id);
    expect(ownedLead.queueId).toBeNull();
  });

  it("registra entrada e saída de etapa e permite calcular sua duração", async () => {
    const fixture = await createFixture("stage-history");
    const lead = await createLead(fixture);
    const enteredAt = new Date("2026-09-09T12:00:00.000Z");
    const exitedAt = new Date("2026-09-09T12:01:30.000Z");

    await expect(
      database.stageHistory.create({
        data: {
          workspaceId: fixture.workspace.id,
          pipelineId: fixture.leadPipeline.id,
          stageId: fixture.leadStage.id,
          leadId: lead.id,
          enteredAt,
          exitedAt: new Date(enteredAt.getTime() - 1),
          enteredByActorId: fixture.systemActor.id,
          exitedByActorId: fixture.systemActor.id,
        },
      }),
    ).rejects.toThrow();

    const firstEntry = await database.stageHistory.create({
      data: {
        workspaceId: fixture.workspace.id,
        pipelineId: fixture.leadPipeline.id,
        stageId: fixture.leadStage.id,
        leadId: lead.id,
        enteredAt,
        enteredByActorId: fixture.systemActor.id,
      },
    });

    await expect(
      database.stageHistory.create({
        data: {
          workspaceId: fixture.workspace.id,
          pipelineId: fixture.leadPipeline.id,
          stageId: fixture.leadStage.id,
          leadId: lead.id,
          enteredAt: new Date(enteredAt.getTime() + 1_000),
          enteredByActorId: fixture.systemActor.id,
        },
      }),
    ).rejects.toThrow();

    await database.stageHistory.update({
      where: { id: firstEntry.id },
      data: {
        exitedAt,
        exitedByActorId: fixture.humanActor.id,
      },
    });

    await database.stageHistory.create({
      data: {
        workspaceId: fixture.workspace.id,
        pipelineId: fixture.leadPipeline.id,
        stageId: fixture.leadStage.id,
        leadId: lead.id,
        enteredAt: exitedAt,
        enteredByActorId: fixture.humanActor.id,
      },
    });

    const durations = await database.$queryRaw<Array<{ seconds: number }>>`
      SELECT EXTRACT(EPOCH FROM ("exitedAt" - "enteredAt"))::integer AS "seconds"
      FROM "stage_history"
      WHERE "id" = ${firstEntry.id}::uuid
    `;
    expect(durations[0]?.seconds).toBe(90);
  });

  it("torna AuditLog append-only no próprio banco", async () => {
    const fixture = await createFixture("audit");
    const auditLog = await database.auditLog.create({
      data: {
        workspaceId: fixture.workspace.id,
        actorId: fixture.humanActor.id,
        action: "lead.read",
        entityType: "Lead",
        entityId: randomUUID(),
        changes: { fact: "registro criado para teste" },
      },
    });

    await expect(
      database.auditLog.update({
        where: { id: auditLog.id },
        data: { action: "tampered" },
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      database.auditLog.delete({ where: { id: auditLog.id } }),
    ).rejects.toThrow(/append-only/);

    const retainedLog = await database.auditLog.findUnique({
      where: { id: auditLog.id },
    });
    expect(retainedLog?.action).toBe("lead.read");
  });
});
