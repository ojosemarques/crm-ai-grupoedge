import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createLeadListService } from "@/modules/leads/application/lead-list-service";
import { createSdrQueueService } from "@/modules/leads/application/sdr-queue-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for SDR queue tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 24 }),
});
const authorization = createAuthorizationService({ database });
const now = new Date("2033-05-10T15:00:00.000Z");
let sequence = 40_000_000;
let workspaceId: string;
let systemContext: ServiceActorContext;
let managerContext: AuthenticatedContext;
let adminContext: AuthenticatedContext;
let sdr1Context: AuthenticatedContext;
let sdr2Context: AuthenticatedContext;
let sdr3Context: AuthenticatedContext;
let isolatedSdrContext: AuthenticatedContext;
let legacySellerMemberId: string;

function nextPhone() {
  sequence += 1;
  return `+55119${sequence.toString().slice(-8)}`;
}

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
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
  return createLeadDistributionService({ database, authorization, now: () => now });
}

function queueService() {
  return createSdrQueueService({ database, authorization, now: () => now });
}

async function createLead(
  label: string,
  priorityBandCode: "P1" | "P2" | "P3" = "P2",
  includeInMyDay = true,
) {
  const result = await createLeadIntakeService({
    database,
    authorization,
    now: () => now,
  }).intake(
    {
      channel: "MANUAL",
      idempotencyKey: `crm10:${label}:${randomUUID()}`,
      fullName: label,
      phone: nextPhone(),
      sourceKey: "manual",
      priorityBandCode,
      ...(priorityBandCode === "P1"
        ? {
            jobTitle: "Diretora pública fictícia",
            organizationName: "Organização fictícia",
            interestSummary: `Dor operacional de ${label}`,
            budgetCents: 1_200_000,
          }
        : priorityBandCode === "P2"
          ? {
              jobTitle: "Contato público fictício",
              organizationName: "Organização fictícia",
              interestSummary: `Dor operacional de ${label}`,
              budgetCents: 300_000,
            }
          : { budgetCents: 0 }),
      rawPayload: { test: "crm10", label },
    },
    systemContext,
  );
  if (result.outcome === "REJECTED") throw new Error(result.code);
  if (!includeInMyDay) return result;
  const task = await database.$transaction(async (transaction) => {
    const owner = await transaction.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      select: { ownerMemberId: true, queueId: true },
    });
    await transaction.task.updateMany({
      where: { workspaceId, leadId: result.leadId, slaCycleId: { not: null }, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
      data: { status: "CANCELLED", updatedByActorId: systemContext.actorId },
    });
    const nextTask = await transaction.task.create({
      data: {
        workspaceId,
        leadId: result.leadId,
        assigneeMemberId: owner.ownerMemberId,
        queueId: owner.ownerMemberId ? null : owner.queueId,
        title: "Próxima ação comercial",
        kind: "CALL",
        status: "OPEN",
        priority: "MEDIUM",
        dueAt: now,
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
    });
    await transaction.lead.update({
      where: { id: result.leadId },
      data: {
        nextActionTaskId: nextTask.id,
        nextActionAt: nextTask.dueAt,
        nextActionDescription: nextTask.title,
        updatedByActorId: systemContext.actorId,
      },
    });
    return nextTask;
  });
  return { ...result, taskId: task.id };
}

async function assignTo(leadId: string, memberId: string) {
  const lead = await database.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { ownerMemberId: true },
  });
  if (lead.ownerMemberId === memberId) return;
  if (memberId === isolatedSdrContext.memberId) {
    await database.$transaction([
      database.lead.update({
        where: { id: leadId },
        data: {
          ownerMemberId: memberId,
          queueId: null,
          updatedByActorId: systemContext.actorId,
        },
      }),
      database.task.updateMany({
        where: { workspaceId, leadId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
        data: {
          assigneeMemberId: memberId,
          queueId: null,
          updatedByActorId: systemContext.actorId,
        },
      }),
    ]);
    return;
  }
  await distributionService().redistribute(managerContext, {
    leadId,
    target: { type: "MEMBER", memberId },
    reason: "Preparação controlada da fila CRM-10",
  });
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
  [managerContext, adminContext, sdr1Context, sdr2Context, sdr3Context] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("admin@demo.politizai.local"),
    humanContext("sdr1@demo.politizai.local"),
    humanContext("sdr2@demo.politizai.local"),
    humanContext("sdr3@demo.politizai.local"),
  ]);
  const sdrRole = await database.role.findFirstOrThrow({ where: { workspaceId, key: "sdr", deletedAt: null } });
  const closerRole = await database.role.findFirstOrThrow({ where: { workspaceId, key: "closer", deletedAt: null } });
  const legacySellerEmail = `legacy-seller-${randomUUID()}@local.test`;
  const legacySellerUser = await database.user.create({
    data: { email: legacySellerEmail, normalizedEmail: legacySellerEmail, displayName: "Vendedor legado sem equipe" },
  });
  legacySellerMemberId = (await database.workspaceMember.create({
    data: {
      workspaceId,
      userId: legacySellerUser.id,
      roleId: closerRole.id,
      status: "ACTIVE",
      joinedAt: now,
      createdByActorId: systemContext.actorId,
      updatedByActorId: systemContext.actorId,
    },
  })).id;
  const isolatedEmail = `crm10-isolated-${randomUUID()}@local.test`;
  const isolatedUser = await database.user.create({
    data: { email: isolatedEmail, normalizedEmail: isolatedEmail, displayName: "SDR isolado CRM-10" },
  });
  const isolatedMember = await database.workspaceMember.create({
    data: {
      workspaceId, userId: isolatedUser.id, roleId: sdrRole.id,
      status: "ACTIVE", joinedAt: now,
      leadReceivingPausedAt: now,
      leadReceivingPauseReason: "Isolamento da fixture de fila vazia CRM-10",
      leadReceivingPausedByActorId: systemContext.actorId,
      createdByActorId: systemContext.actorId, updatedByActorId: systemContext.actorId,
    },
  });
  const isolatedActor = await database.actor.create({
    data: {
      workspaceId, userId: isolatedUser.id, type: "HUMAN",
      key: `user:${isolatedUser.id}`, displayName: isolatedUser.displayName,
    },
  });
  const isolatedTeam = await database.team.create({
    data: {
      workspaceId,
      name: `Equipe isolada CRM-10 ${randomUUID()}`,
      createdByActorId: systemContext.actorId,
      updatedByActorId: systemContext.actorId,
    },
  });
  await database.teamMember.createMany({
    data: [
      {
        workspaceId, teamId: isolatedTeam.id, workspaceMemberId: isolatedMember.id,
        function: "SDR", createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
      {
        workspaceId, teamId: isolatedTeam.id, workspaceMemberId: managerContext.memberId,
        function: "MANAGER", createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
    ],
  });
  isolatedSdrContext = Object.freeze({
    sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai",
    userId: isolatedUser.id, memberId: isolatedMember.id, actorId: isolatedActor.id,
    roleId: sdrRole.id, roleKey: sdrRole.key, roleName: sdrRole.name,
    displayName: isolatedUser.displayName,
  });
});

afterAll(async () => {
  await database.$disconnect();
});

describe("fila priorizada do SDR", () => {
  it("exibe vendedor legado sem equipe no Meu Dia e na atribuição do card", async () => {
    const screen = await queueService().getScreen(adminContext, {});
    expect(screen.sdrOptions).toContainEqual({
      id: legacySellerMemberId,
      name: "Vendedor legado sem equipe",
      active: true,
    });

    const created = await createLead("Lead para atribuição ao vendedor legado");
    const operations = await createOperationalHistoryService({
      database,
      authorization,
      now: () => now,
    }).getLeadOperations(adminContext, { leadId: created.leadId });
    const closerFromSalesTeam = await database.workspaceMember.findFirstOrThrow({
      where: {
        workspaceId,
        role: { key: "closer", deletedAt: null },
        teamMemberships: {
          some: { function: "CLOSER", team: { name: "Vendas", deletedAt: null }, deletedAt: null },
        },
      },
      select: { id: true, user: { select: { displayName: true } } },
    });
    expect(operations.assignmentTargets).toContainEqual({
      id: legacySellerMemberId,
      name: "Vendedor legado sem equipe",
    });
    expect(operations.assignmentTargets).toContainEqual({
      id: closerFromSalesTeam.id,
      name: closerFromSalesTeam.user.displayName,
    });
    await distributionService().redistribute(adminContext, {
      leadId: created.leadId,
      target: { type: "MEMBER", memberId: legacySellerMemberId },
      reason: "Validação da atribuição de vendedor no card.",
    });
    await expect(database.lead.findUniqueOrThrow({ where: { id: created.leadId } })).resolves.toMatchObject({
      ownerMemberId: legacySellerMemberId,
      queueId: null,
    });
    await distributionService().redistribute(adminContext, {
      leadId: created.leadId,
      target: { type: "MEMBER", memberId: closerFromSalesTeam.id },
      reason: "Validação da atribuição entre equipes pelo administrador.",
    });
    await expect(database.lead.findUniqueOrThrow({ where: { id: created.leadId } })).resolves.toMatchObject({
      ownerMemberId: closerFromSalesTeam.id,
      queueId: null,
    });
  });

  it("mantém as dez filas honestamente vazias quando o SDR não possui leads", async () => {
    const screen = await queueService().getScreen(isolatedSdrContext, {});
    await database.workspaceMember.update({
      where: { id: isolatedSdrContext.memberId },
      data: {
        leadReceivingPausedAt: null,
        leadReceivingPauseReason: null,
        leadReceivingPausedByActorId: null,
        updatedByActorId: systemContext.actorId,
      },
    });

    expect(screen.sections).toHaveLength(10);
    expect(screen.sections.every((section) => section.total === 0)).toBe(true);
    expect(screen.sections.every((section) => section.items.length === 0)).toBe(true);
  });

  it("retira do Meu Dia tarefas de SLA e leads em conversa iniciada", async () => {
    const before = await queueService().getScreen(isolatedSdrContext, {});
    const slaLead = await createLead(`CRM10 SLA fora do Meu Dia ${randomUUID().slice(0, 8)}`, "P2", false);
    const conversationLead = await createLead(`CRM10 conversa externa ${randomUUID().slice(0, 8)}`, "P2");
    await Promise.all([
      assignTo(slaLead.leadId, isolatedSdrContext.memberId),
      assignTo(conversationLead.leadId, isolatedSdrContext.memberId),
    ]);
    const conversationPipeline = await database.lead.findUniqueOrThrow({
      where: { id: conversationLead.leadId },
      select: { pipelineId: true },
    });
    const conversationStage = await database.pipelineStage.create({
      data: {
        workspaceId,
        pipelineId: conversationPipeline.pipelineId,
        stableKey: "active-prospecting.conversation-started",
        name: "Conversa iniciada",
        position: 99,
        type: "OPEN",
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
      select: { id: true },
    });
    const conversationTask = await database.task.create({
      data: {
        workspaceId,
        leadId: conversationLead.leadId,
        assigneeMemberId: isolatedSdrContext.memberId,
        title: "Responder conversa iniciada",
        kind: "FOLLOW_UP",
        sourceKey: `active-prospecting:${randomUUID()}:respond-human`,
        status: "OPEN",
        priority: "URGENT",
        dueAt: new Date(now.getTime() - 60_000),
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
    });
    await database.task.updateMany({
      where: { workspaceId, leadId: conversationLead.leadId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null, id: { not: conversationTask.id } },
      data: { status: "CANCELLED", updatedByActorId: systemContext.actorId },
    });
    await database.lead.update({
      where: { id: conversationLead.leadId },
      data: {
        currentStageId: conversationStage.id,
        awaitingHumanResponse: true,
        lastInboundResponseAt: now,
        nextActionTaskId: conversationTask.id,
        nextActionAt: conversationTask.dueAt,
        nextActionDescription: conversationTask.title,
        updatedByActorId: systemContext.actorId,
      },
    });

    const after = await queueService().getScreen(isolatedSdrContext, {});
    const visibleIds = after.sections.flatMap((section) => section.items.map((item) => item.id));
    expect(visibleIds).not.toContain(slaLead.leadId);
    expect(visibleIds).not.toContain(conversationLead.leadId);
    expect(after.dailyProduction.tasksDue).toBe(before.dailyProduction.tasksDue);
    expect(after.dailyProduction.callsPending).toBe(before.dailyProduction.callsPending);
  });

  it("omite ligação sem telefone e seleciona a tarefa de Instagram disponível", async () => {
    const before = await queueService().getScreen(isolatedSdrContext, {});
    const lead = await createLead(`CRM10 sem telefone ${randomUUID().slice(0, 8)}`, "P2");
    await assignTo(lead.leadId, isolatedSdrContext.memberId);
    const storedLead = await database.lead.findUniqueOrThrow({
      where: { id: lead.leadId },
      select: { contactId: true },
    });

    await database.$transaction(async (transaction) => {
      await transaction.task.updateMany({
        where: {
          workspaceId,
          leadId: lead.leadId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          deletedAt: null,
        },
        data: { status: "CANCELLED", updatedByActorId: systemContext.actorId },
      });
      if (storedLead.contactId) {
        await transaction.contactPoint.updateMany({
          where: {
            workspaceId,
            contactId: storedLead.contactId,
            type: { in: ["PHONE", "WHATSAPP"] },
            deletedAt: null,
          },
          data: { deletedAt: now, updatedByActorId: systemContext.actorId },
        });
      }
      const callTask = await transaction.task.create({
        data: {
          workspaceId,
          leadId: lead.leadId,
          assigneeMemberId: isolatedSdrContext.memberId,
          title: "Ligação D1 sem telefone",
          kind: "CALL",
          sourceKey: `active-prospecting:${randomUUID()}:call-1`,
          status: "OPEN",
          priority: "MEDIUM",
          dueAt: now,
          createdByActorId: systemContext.actorId,
          updatedByActorId: systemContext.actorId,
        },
      });
      await transaction.task.create({
        data: {
          workspaceId,
          leadId: lead.leadId,
          assigneeMemberId: isolatedSdrContext.memberId,
          title: "Tentativa anterior sem resposta",
          kind: "CALL",
          sourceKey: `active-prospecting:${randomUUID()}:previous-call`,
          status: "COMPLETED",
          result: "NO_ANSWER",
          dueAt: now,
          completedAt: now,
          createdByActorId: systemContext.actorId,
          updatedByActorId: systemContext.actorId,
        },
      });
      await transaction.task.create({
        data: {
          workspaceId,
          leadId: lead.leadId,
          assigneeMemberId: isolatedSdrContext.memberId,
          title: "Seguir no Instagram",
          kind: "INSTAGRAM_FOLLOW",
          sourceKey: `active-prospecting:${randomUUID()}:instagram-follow`,
          status: "OPEN",
          priority: "MEDIUM",
          dueAt: now,
          createdByActorId: systemContext.actorId,
          updatedByActorId: systemContext.actorId,
        },
      });
      await transaction.lead.update({
        where: { id: lead.leadId },
        data: {
          normalizedPhone: null,
          nextActionTaskId: callTask.id,
          nextActionAt: callTask.dueAt,
          nextActionDescription: callTask.title,
          updatedByActorId: systemContext.actorId,
        },
      });
    });

    const after = await queueService().getScreen(isolatedSdrContext, {});
    const item = after.sections
      .find((section) => section.key === "NOW")
      ?.items.find((candidate) => candidate.id === lead.leadId);
    const waitingCallIds = after.sections
      .find((section) => section.key === "WAITING_CALL")
      ?.items.map((candidate) => candidate.id);

    expect(item).toMatchObject({
      nextActionKind: "INSTAGRAM_FOLLOW",
      recommendation: { code: "RECORD_INSTAGRAM" },
    });
    expect(waitingCallIds).not.toContain(lead.leadId);
    expect(after.dailyProduction.calls).toBe(before.dailyProduction.calls + 1);
    expect(after.dailyProduction.callsPending).toBe(before.dailyProduction.callsPending);
    expect(after.dailyProduction.messagesPending).toBe(before.dailyProduction.messagesPending + 1);
  });

  it("ordena respostas, retornos vencidos, novos P1/P2/P3 e demais", async () => {
    const prefix = `CRM10 ordem ${randomUUID().slice(0, 8)}`;
    const responded = await createLead(`${prefix} respondeu`, "P2");
    const p1 = await createLead(`${prefix} P1`, "P1");
    const p2 = await createLead(`${prefix} P2`, "P2");
    const p3 = await createLead(`${prefix} P3`, "P3");
    const overdue = await createLead(`${prefix} vencido`, "P2");
    const remaining = await createLead(`${prefix} restante`, "P2");
    await Promise.all(
      [responded, p1, p2, p3, overdue, remaining].map((lead) =>
        assignTo(lead.leadId, isolatedSdrContext.memberId),
      ),
    );
    const secondStage = await database.pipelineStage.findFirstOrThrow({
      where: { workspaceId, pipeline: { entityType: "LEAD", isDefault: true }, position: 1 },
      select: { id: true },
    });
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 3_600_000);
    await Promise.all([
      createOperationalHistoryService({ database, authorization, now: () => now }).recordActivity(
        managerContext,
        { leadId: responded.leadId, type: "MESSAGE_RECEIVED", direction: "INBOUND", subject: "Resposta recente" },
      ),
      database.lead.update({ where: { id: overdue.leadId }, data: { currentStageId: secondStage.id, nextActionAt: past, updatedByActorId: systemContext.actorId } }),
      database.task.update({ where: { id: overdue.taskId }, data: { dueAt: past, updatedByActorId: systemContext.actorId } }),
      database.lead.update({ where: { id: remaining.leadId }, data: { currentStageId: secondStage.id, nextActionAt: future, updatedByActorId: systemContext.actorId } }),
      database.task.update({ where: { id: remaining.taskId }, data: { dueAt: future, updatedByActorId: systemContext.actorId } }),
    ]);

    const screen = await queueService().getScreen(managerContext, { memberId: isolatedSdrContext.memberId });
    const expectedIds = [responded.leadId, overdue.leadId, p1.leadId, p2.leadId, p3.leadId, remaining.leadId];
    const nowIds = screen.sections
      .find((section) => section.key === "NOW")!
      .items.map((item) => item.id)
      .filter((id) => expectedIds.includes(id));
    expect(nowIds).toEqual(expectedIds);
    expect(screen.sections.find((section) => section.key === "RESPONDED")?.items.map((item) => item.id)).toContain(responded.leadId);
    expect(screen.sections.find((section) => section.key === "OVERDUE")?.items.map((item) => item.id)).toContain(overdue.leadId);
    expect(screen.sections.find((section) => section.key === "P1")?.items.find((item) => item.id === p1.leadId)?.recommendation).toMatchObject({ code: "CALL_NOW" });
  });

  it("expõe lead sem próxima ação como erro operacional rastreável", async () => {
    const lead = await createLead(`CRM10 sem próxima ação ${randomUUID().slice(0, 8)}`, "P2");
    await assignTo(lead.leadId, isolatedSdrContext.memberId);
    await database.lead.update({
      where: { id: lead.leadId },
      data: {
        nextActionAt: null,
        nextActionDescription: null,
        nextActionTaskId: null,
        updatedByActorId: systemContext.actorId,
      },
    });

    const screen = await queueService().getScreen(isolatedSdrContext, {});
    const item = screen.sections
      .find((section) => section.key === "MISSING_NEXT_ACTION")
      ?.items.find((candidate) => candidate.id === lead.leadId);

    expect(item?.recommendation).toMatchObject({
      code: "CREATE_NEXT_ACTION",
      label: "Criar próxima ação",
    });
  });

  it("expõe leads sem contato recente e o mesmo recorte na lista", async () => {
    const lead = await createLead(`CRM10 contato antigo ${randomUUID().slice(0, 8)}`, "P2");
    const contacted = await createLead(`CRM10 contato recente ${randomUUID().slice(0, 8)}`, "P2");
    await assignTo(lead.leadId, isolatedSdrContext.memberId);
    await assignTo(contacted.leadId, isolatedSdrContext.memberId);
    await database.lead.update({
      where: { id: lead.leadId },
      data: {
        lastActivityAt: new Date(now.getTime() - 73 * 60 * 60 * 1_000),
        updatedByActorId: systemContext.actorId,
      },
    });
    await createOperationalHistoryService({ database, authorization, now: () => now }).recordActivity(
      managerContext,
      { leadId: contacted.leadId, type: "MESSAGE_SENT", direction: "OUTBOUND", subject: "Contato recente para validar o recorte" },
    );

    const screen = await queueService().getScreen(isolatedSdrContext, {});
    const staleIds = screen.sections.find((section) => section.key === "STALE_CONTACT")?.items.map((item) => item.id);
    expect(staleIds).toContain(lead.leadId);
    expect(staleIds).not.toContain(contacted.leadId);
    expect(screen.dailyProduction.staleLeads).toBeGreaterThanOrEqual(1);
    expect(screen.dailyProduction.dailyGoal).toMatchObject({
      completed: expect.any(Number),
      target: expect.any(Number),
      remaining: expect.any(Number),
      progressPercent: expect.any(Number),
    });

    const list = await createLeadListService({
      database,
      authorization,
      distribution: distributionService(),
      now: () => now,
    }).getScreen(isolatedSdrContext, { operationalBucket: "STALE_CONTACT" });
    expect(list.list.rows.map((item) => item.id)).toContain(lead.leadId);
  });

  it("recalcula a seção respondidos após uma atividade persistida", async () => {
    const lead = await createLead(`CRM10 atualização ${randomUUID().slice(0, 8)}`, "P2");
    await assignTo(lead.leadId, sdr1Context.memberId);
    const before = await queueService().getScreen(sdr1Context, {});
    expect(before.sections.find((section) => section.key === "RESPONDED")?.items.map((item) => item.id)).not.toContain(lead.leadId);

    await createOperationalHistoryService({ database, authorization, now: () => now }).recordActivity(
      sdr1Context,
      { leadId: lead.leadId, type: "MESSAGE_RECEIVED", direction: "INBOUND", subject: "Lead respondeu" },
    );
    const after = await queueService().getScreen(sdr1Context, {});
    expect(after.sections.find((section) => section.key === "RESPONDED")?.items.map((item) => item.id)).toContain(lead.leadId);
    expect(after.sections.find((section) => section.key === "NOW")?.items.find((item) => item.id === lead.leadId)?.recommendation).toMatchObject({ code: "RESPOND_NOW" });
  });

  it("detecta reunião de hoje pelo timezone do workspace", async () => {
    const lead = await createLead(`CRM10 reunião ${randomUUID().slice(0, 8)}`);
    await assignTo(lead.leadId, sdr2Context.memberId);
    const closer = await database.workspaceMember.findFirstOrThrow({
      where: { workspaceId, teamMemberships: { some: { function: "CLOSER", deletedAt: null } } },
      select: { id: true },
    });
    await database.meeting.create({
      data: {
        workspaceId,
        leadId: lead.leadId,
        ownerMemberId: closer.id,
        title: "Reunião CRM-10",
        startsAt: new Date("2033-05-10T23:30:00.000Z"),
        endsAt: new Date("2033-05-11T00:10:00.000Z"),
        durationMinutes: 40,
        timeZone: "America/Sao_Paulo",
        createdByActorId: managerContext.actorId,
        updatedByActorId: managerContext.actorId,
      },
    });
    const screen = await queueService().getScreen(managerContext, { memberId: sdr2Context.memberId });
    expect(screen.timeZone).toBe("America/Sao_Paulo");
    expect(screen.sections.find((section) => section.key === "MEETINGS_TODAY")?.items.map((item) => item.id)).toContain(lead.leadId);
  });

  it("restringe o SDR à própria fila e permite filtro por SDR ao gestor", async () => {
    const own = await createLead(`CRM10 escopo próprio ${randomUUID().slice(0, 8)}`);
    const other = await createLead(`CRM10 escopo outro ${randomUUID().slice(0, 8)}`);
    await assignTo(own.leadId, sdr1Context.memberId);
    await assignTo(other.leadId, sdr2Context.memberId);

    const ownScreen = await queueService().getScreen(sdr1Context, {});
    const ownIds = ownScreen.sections.find((section) => section.key === "NOW")!.items.map((item) => item.id);
    expect(ownIds).toContain(own.leadId);
    expect(ownIds).not.toContain(other.leadId);
    const managerScreen = await queueService().getScreen(managerContext, { memberId: sdr2Context.memberId });
    const managerIds = managerScreen.sections.find((section) => section.key === "NOW")!.items.map((item) => item.id);
    expect(managerIds).toContain(other.leadId);
    expect(managerIds).not.toContain(own.leadId);
    await expect(
      queueService().getScreen(sdr1Context, { memberId: sdr2Context.memberId }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("reconcilia cada contagem com o mesmo recorte da lista CRM-09", async () => {
    const queue = await queueService().getScreen(managerContext, { memberId: sdr3Context.memberId });
    const list = await createLeadListService({
      database,
      authorization,
      distribution: distributionService(),
      now: () => now,
    }).getScreen(managerContext, {
      responsibles: `member:${sdr3Context.memberId}`,
      operationalBucket: "OVERDUE",
      pageSize: 1,
    });
    expect(queue.sections.find((section) => section.key === "OVERDUE")?.total).toBe(list.list.total);
  });
});
