import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createLeadListService } from "@/modules/leads/application/lead-list-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for lead list tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 24 }),
});
const authorization = createAuthorizationService({ database });
const now = new Date("2033-05-10T15:00:00.000Z");
let sequence = 30_000_000;
let workspaceId: string;
let systemContext: ServiceActorContext;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;
let sdr1Context: AuthenticatedContext;
let sdr2Context: AuthenticatedContext;

function nextPhone() {
  sequence += 1;
  return `+55119${sequence.toString().slice(-8)}`;
}

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: {
      workspaceId,
      user: { normalizedEmail: email },
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
      roleId: true,
      user: { select: { displayName: true } },
      role: { select: { key: true, name: true } },
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

function distributionService() {
  return createLeadDistributionService({
    database,
    authorization,
    now: () => now,
  });
}

function listService() {
  return createLeadListService({
    database,
    authorization,
    distribution: distributionService(),
    now: () => now,
  });
}

async function createLead(
  label: string,
  priorityBandCode: "P1" | "P2" | "P3" = "P2",
  overrides: Partial<{
    sourceKey: string;
    campaignExternalRef: string;
    creativeExternalRef: string;
    jobTitle: string;
    city: string;
    stateCode: string;
    interestSummary: string;
    budgetCents: number;
  }> = {},
) {
  const intake = createLeadIntakeService({
    database,
    authorization,
    now: () => now,
  });
  const result = await intake.intake(
    {
      channel: "MANUAL",
      idempotencyKey: `crm09:${label}:${randomUUID()}`,
      fullName: label,
      phone: nextPhone(),
      sourceKey: overrides.sourceKey ?? "manual",
      priorityBandCode,
      ...(overrides.campaignExternalRef
        ? { campaignExternalRef: overrides.campaignExternalRef }
        : {}),
      ...(overrides.creativeExternalRef
        ? { creativeExternalRef: overrides.creativeExternalRef }
        : {}),
      ...(overrides.jobTitle ? { jobTitle: overrides.jobTitle } : {}),
      ...(overrides.city ? { city: overrides.city } : {}),
      ...(overrides.stateCode ? { stateCode: overrides.stateCode } : {}),
      ...(overrides.interestSummary
        ? { interestSummary: overrides.interestSummary }
        : {}),
      ...(overrides.budgetCents ? { budgetCents: overrides.budgetCents } : {}),
      rawPayload: { test: "crm09", label },
    },
    systemContext,
  );
  if (result.outcome === "REJECTED") {
    throw new Error(result.issues[0]?.message ?? result.code);
  }
  return result;
}

async function assignTo(leadId: string, memberId: string) {
  const lead = await database.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { ownerMemberId: true },
  });
  if (lead.ownerMemberId !== memberId) {
    await distributionService().redistribute(managerContext, {
      leadId,
      target: { type: "MEMBER", memberId },
      reason: "Preparação controlada do teste de escopo",
    });
  }
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  workspaceId = seed.workspaceId;
  const system = await database.actor.findFirstOrThrow({
    where: { workspaceId, key: "system", type: "SYSTEM" },
    select: { id: true },
  });
  systemContext = Object.freeze({
    workspaceId,
    actorId: system.id,
    actorKey: "system",
    actorType: "SYSTEM",
  });
  [managerContext, viewerContext, sdr1Context, sdr2Context] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    humanContext("sdr1@demo.politizai.local"),
    humanContext("sdr2@demo.politizai.local"),
  ]);
});

afterAll(async () => {
  await database.$disconnect();
});

describe("lista operacional de leads", () => {
  it("combina filtros relacionais, score vigente disponível e SLA no servidor", async () => {
    const label = `CRM09 alvo filtros ${randomUUID().slice(0, 8)}`;
    const lead = await createLead(label, "P1", {
      sourceKey: "website",
      campaignExternalRef: "demo:campaign:institutional",
      creativeExternalRef: "demo:creative:institutional-video",
      jobTitle: "Secretário municipal",
      city: "Campinas",
      stateCode: "SP",
      interestSummary: "Dor explícita com comunicação pública",
      budgetCents: 1_500_000,
    });
    const stored = await database.lead.findUniqueOrThrow({
      where: { id: lead.leadId },
      select: {
        id: true,
        ownerMemberId: true,
        routingQueue: { select: { teamId: true } },
        currentStageId: true,
        latestSourceId: true,
        sourceId: true,
        latestCampaignId: true,
        campaignId: true,
        latestCreativeId: true,
        creativeId: true,
      },
    });
    if (
      !stored.ownerMemberId ||
      !stored.routingQueue?.teamId ||
      !(stored.latestCampaignId ?? stored.campaignId) ||
      !(stored.latestCreativeId ?? stored.creativeId)
    ) {
      throw new Error("O lead de teste não recebeu as relações operacionais esperadas.");
    }
    const testScore = await database.leadScore.create({
      data: {
        workspaceId,
        leadId: stored.id,
        score: 84,
        source: "FORM_PROVISIONAL",
        priorityBandCode: "P1",
        currentRevision: 2,
        modelKey: "crm09-test",
        modelVersion: "1",
        reason: "Dor e capacidade informadas",
        inputSnapshot: { test: true },
        calculatedByActorId: systemContext.actorId,
      },
    });
    await Promise.all([
      database.leadCurrentScore.update({
        where: { workspaceId_leadId: { workspaceId, leadId: stored.id } },
        data: {
          leadScoreId: testScore.id,
          revision: 2,
          updatedByActorId: systemContext.actorId,
          updatedAt: now,
        },
      }),
      database.leadQualification.create({
        data: {
          workspaceId,
          leadId: stored.id,
          status: "IN_PROGRESS",
          authorityStatus: "POSITIVE",
          createdByActorId: systemContext.actorId,
          updatedByActorId: systemContext.actorId,
        },
      }),
    ]);
    const screen = await listService().getScreen(managerContext, {
      q: label,
      responsibles: `member:${stored.ownerMemberId}`,
      teams: stored.routingQueue.teamId,
      priorities: "P1",
      scoreMin: "80",
      scoreMax: "90",
      stages: stored.currentStageId,
      statuses: "OPEN",
      sla: "HEALTHY",
      sources: stored.latestSourceId ?? stored.sourceId,
      campaigns: stored.latestCampaignId ?? stored.campaignId,
      creatives: stored.latestCreativeId ?? stored.creativeId,
      jobTitle: "secretário municipal",
      state: "sp",
      city: "campinas",
      pain: "comunicação pública",
      capacity: "ABOVE_10000",
      decisionMaker: "POSITIVE",
      enteredFrom: new Date(now.getTime() - 60_000).toISOString(),
      enteredTo: new Date(now.getTime() + 60_000).toISOString(),
      lastActivityFrom: new Date(now.getTime() - 60_000).toISOString(),
      lastActivityTo: new Date(now.getTime() + 60_000).toISOString(),
      nextAction: "FUTURE",
      nextActionFrom: now.toISOString(),
      nextActionTo: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(screen.list.total).toBe(1);
    expect(screen.list.rows[0]).toMatchObject({
      id: stored.id,
      priorityCode: "P1",
      score: 84,
      priorityReason: "Dor e capacidade informadas",
      sourceName: "Formulário do site",
      campaignName: "Demonstração — aquisição institucional",
      creativeName: "Vídeo institucional",
      slaSeconds: 0,
      slaBand: "HEALTHY",
      decisionMakerStatus: "POSITIVE",
    });
  });

  it("filtra próxima ação vencida, ausência, desqualificação e perda sem inferir dados", async () => {
    const prefix = `CRM09 exceções ${randomUUID().slice(0, 8)}`;
    const overdue = await createLead(`${prefix} vencido`);
    const past = new Date(now.getTime() - 3_600_000);
    await database.$transaction([
      database.task.update({
        where: { id: overdue.taskId },
        data: { dueAt: past, updatedByActorId: systemContext.actorId },
      }),
      database.lead.update({
        where: { id: overdue.leadId },
        data: { nextActionAt: past, updatedByActorId: systemContext.actorId },
      }),
    ]);

    const disqualificationReason =
      await database.disqualificationReason.findFirstOrThrow({
        where: { workspaceId, deletedAt: null },
        select: { id: true },
      });
    const disqualified = await createLead(`${prefix} desqualificado`);
    await database.lead.update({
      where: { id: disqualified.leadId },
      data: {
        status: "DISQUALIFIED",
        disqualificationReasonId: disqualificationReason.id,
        nextActionTaskId: null,
        nextActionAt: null,
        nextActionDescription: null,
        updatedByActorId: systemContext.actorId,
      },
    });

    const lossReason = await database.lossReason.findFirstOrThrow({
      where: { workspaceId, deletedAt: null },
      select: { id: true },
    });
    const lost = await createLead(`${prefix} perdido`);
    const salesPipeline = await database.pipeline.findFirstOrThrow({
      where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true },
      select: {
        id: true,
        stages: {
          where: { type: "LOST" },
          take: 1,
          select: { id: true },
        },
      },
    });
    const closer = await database.workspaceMember.findFirstOrThrow({
      where: {
        workspaceId,
        teamMemberships: { some: { function: "CLOSER", deletedAt: null } },
      },
      select: { id: true },
    });
    await database.opportunity.create({
      data: {
        workspaceId,
        leadId: lost.leadId,
        pipelineId: salesPipeline.id,
        currentStageId: salesPipeline.stages[0]!.id,
        ownerMemberId: closer.id,
        name: `${prefix} oportunidade`,
        interestDescription: "Interesse histórico usado pelo filtro de perda",
        status: "LOST",
        amountCents: 500_000n,
        probabilityBps: 0,
        closedAt: now,
        lossReasonId: lossReason.id,
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
    });

    const service = listService();
    expect(
      (await service.getScreen(managerContext, { q: prefix, nextAction: "OVERDUE" }))
        .list.rows.map((row) => row.id),
    ).toContain(overdue.leadId);
    expect(
      (await service.getScreen(managerContext, { q: prefix, nextAction: "MISSING" }))
        .list.rows.map((row) => row.id),
    ).toContain(disqualified.leadId);
    expect(
      (
        await service.getScreen(managerContext, {
          q: prefix,
          disqualificationReasons: disqualificationReason.id,
        })
      ).list.rows.map((row) => row.id),
    ).toEqual([disqualified.leadId]);
    expect(
      (
        await service.getScreen(managerContext, {
          q: prefix,
          lossReasons: lossReason.id,
        })
      ).list.rows.map((row) => row.id),
    ).toEqual([lost.leadId]);
  });

  it("aplica a ordem operacional padrão de forma determinística", async () => {
    const prefix = `CRM09 ordem ${randomUUID().slice(0, 8)}`;
    const responded = await createLead(`${prefix} 1 respondeu`, "P2");
    const p1 = await createLead(`${prefix} 2 P1`, "P1");
    const p2 = await createLead(`${prefix} 3 P2`, "P2");
    const p3 = await createLead(`${prefix} 4 P3`, "P3");
    const overdue = await createLead(`${prefix} 5 retorno vencido`, "P2");
    const remaining = await createLead(`${prefix} 6 restante`, "P2");
    const secondStage = await database.pipelineStage.findFirstOrThrow({
      where: {
        workspaceId,
        pipeline: { entityType: "LEAD", isDefault: true },
        position: 1,
      },
      select: { id: true },
    });
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 3_600_000);
    await Promise.all([
      createOperationalHistoryService({
        database,
        authorization,
        now: () => now,
      }).recordActivity(managerContext, {
        leadId: responded.leadId,
        type: "MESSAGE_RECEIVED",
        direction: "INBOUND",
        subject: "Resposta recente",
      }),
      database.lead.update({
        where: { id: overdue.leadId },
        data: {
          currentStageId: secondStage.id,
          nextActionAt: past,
          updatedByActorId: systemContext.actorId,
        },
      }),
      database.task.update({
        where: { id: overdue.taskId },
        data: { dueAt: past, updatedByActorId: systemContext.actorId },
      }),
      database.lead.update({
        where: { id: remaining.leadId },
        data: {
          currentStageId: secondStage.id,
          nextActionAt: future,
          updatedByActorId: systemContext.actorId,
        },
      }),
      database.task.update({
        where: { id: remaining.taskId },
        data: { dueAt: future, updatedByActorId: systemContext.actorId },
      }),
    ]);
    const result = await listService().getScreen(managerContext, { q: prefix });
    expect(result.list.rows.map((row) => row.id)).toEqual([
      responded.leadId,
      p1.leadId,
      p2.leadId,
      p3.leadId,
      overdue.leadId,
      remaining.leadId,
    ]);
  });

  it("pagina mais de 300 leads sem carregar a coleção inteira", async () => {
    const prefix = `CRM09 volume ${randomUUID().slice(0, 8)}`;
    const phoneBase = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16) % 90_000_000;
    const [source, pipeline, stage, queue] = await Promise.all([
      database.leadSource.findFirstOrThrow({ where: { workspaceId, key: "manual" }, select: { id: true } }),
      database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "LEAD", isDefault: true }, select: { id: true } }),
      database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipeline: { entityType: "LEAD", isDefault: true }, position: 0 }, select: { id: true } }),
      database.queue.findFirstOrThrow({ where: { workspaceId, isGeneral: true, deletedAt: null }, select: { id: true } }),
    ]);
    await database.lead.createMany({
      data: Array.from({ length: 305 }, (_, index) => ({
        id: randomUUID(),
        workspaceId,
        sourceId: source.id,
        pipelineId: pipeline.id,
        currentStageId: stage.id,
        queueId: queue.id,
        routingQueueId: queue.id,
        fullName: `${prefix} ${index.toString().padStart(3, "0")}`,
        normalizedPhone: `+55118${(phoneBase + index).toString().padStart(8, "0")}`,
        status: "DISQUALIFIED" as const,
        priority: "MEDIUM" as const,
        slaStartedAt: now,
        slaDueAt: now,
        lastActivityAt: now,
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      })),
    });
    const result = await listService().getScreen(managerContext, {
      q: prefix,
      page: 2,
      pageSize: 100,
      sort: "name",
      direction: "asc",
    });
    expect(result.list).toMatchObject({ total: 305, page: 2, pageSize: 100, totalPages: 4 });
    expect(result.list.rows).toHaveLength(100);
    expect(result.list.rows[0]?.fullName).toBe(`${prefix} 100`);
  });

  it("salva visualização por usuário/workspace, audita e aplica soft delete", async () => {
    const service = listService();
    const name = `Visão CRM09 ${randomUUID().slice(0, 8)}`;
    const created = await service.createSavedView(managerContext, {
      name,
      query: {
        priorities: ["P1", "P2"],
        sort: "score",
        direction: "desc",
        columns: ["name", "score", "nextAction"],
      },
    });
    const managerScreen = await service.getScreen(managerContext, {});
    const viewerScreen = await service.getScreen(viewerContext, {});
    expect(managerScreen.savedViews.find((view) => view.id === created.id)?.query)
      .toMatchObject({ priorities: ["P1", "P2"], sort: "score", direction: "desc" });
    expect(viewerScreen.savedViews.some((view) => view.id === created.id)).toBe(false);
    await expect(
      service.createSavedView(managerContext, { name: name.toUpperCase(), query: {} }),
    ).rejects.toMatchObject({ code: "SAVED_VIEW_ALREADY_EXISTS" });
    await expect(service.deleteSavedView(viewerContext, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await service.deleteSavedView(managerContext, created.id);
    const stored = await database.savedView.findUniqueOrThrow({ where: { id: created.id } });
    const audits = await database.auditLog.count({
      where: {
        workspaceId,
        entityType: "SavedView",
        entityId: created.id,
        action: { in: ["saved_view.created", "saved_view.deleted"] },
      },
    });
    expect(stored.deletedAt).toEqual(now);
    expect(audits).toBe(2);
  });

  it("redistribui seleção com confirmação de domínio, eventos e auditoria", async () => {
    const prefix = `CRM09 lote ${randomUUID().slice(0, 8)}`;
    const first = await createLead(`${prefix} A`);
    const second = await createLead(`${prefix} B`);
    const service = listService();
    const result = await service.bulkRedistribute(managerContext, {
      leadIds: [first.leadId, second.leadId],
      target: { type: "GENERAL_QUEUE" },
      reason: "Redistribuição em massa validada no teste",
    });
    expect(result).toMatchObject({ requested: 2, changed: 2, skipped: 0 });
    const [leads, activities, audits] = await Promise.all([
      database.lead.findMany({
        where: { id: { in: [first.leadId, second.leadId] } },
        select: { ownerMemberId: true, queue: { select: { isGeneral: true } } },
      }),
      database.activity.count({
        where: {
          workspaceId,
          leadId: { in: [first.leadId, second.leadId] },
          type: "RESPONSIBLE_CHANGE",
          subject: "Lead redistribuído",
        },
      }),
      database.auditLog.count({
        where: {
          workspaceId,
          entityType: "Lead",
          entityId: { in: [first.leadId, second.leadId] },
          action: "lead.assignment.redistributed",
        },
      }),
    ]);
    expect(leads.every((lead) => !lead.ownerMemberId && lead.queue?.isGeneral)).toBe(true);
    expect(activities).toBe(2);
    expect(audits).toBe(2);
    await expect(
      service.bulkRedistribute(viewerContext, {
        leadIds: [first.leadId],
        target: { type: "MEMBER", memberId: sdr1Context.memberId },
        reason: "Tentativa sem permissão",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("restringe SDR aos próprios leads/fila e rejeita contexto de outro workspace", async () => {
    const prefix = `CRM09 escopo ${randomUUID().slice(0, 8)}`;
    const own = await createLead(`${prefix} próprio`);
    const other = await createLead(`${prefix} outro`);
    await assignTo(own.leadId, sdr1Context.memberId);
    await assignTo(other.leadId, sdr2Context.memberId);
    const service = listService();
    const sdrScreen = await service.getScreen(sdr1Context, { q: prefix });
    const viewerScreen = await service.getScreen(viewerContext, { q: prefix });
    expect(sdrScreen.list.rows.map((row) => row.id)).toEqual([own.leadId]);
    expect(viewerScreen.list.rows.map((row) => row.id).sort()).toEqual(
      [own.leadId, other.leadId].sort(),
    );
    await expect(
      service.getScreen(
        { ...managerContext, workspaceId: randomUUID() },
        { q: prefix },
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
