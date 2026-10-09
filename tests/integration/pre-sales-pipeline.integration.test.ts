import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { leadStageCodes, type LeadStageCode } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for pre-sales pipeline tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 24 }),
});
const authorization = createAuthorizationService({ database });
let clock = new Date("2035-02-10T15:00:00.000Z");
let workspaceId: string;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;
let sdrContext: AuthenticatedContext;
let systemContext: ServiceActorContext;
let sequence = 70_000_000;

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

function pipelineService(overrides: Readonly<{
  beforeCommit?: () => Promise<void>;
  automationPublisher?: Parameters<typeof createPreSalesPipelineService>[0]["automationPublisher"];
}> = {}) {
  return createPreSalesPipelineService({
    database,
    authorization,
    now: () => clock,
    ...(overrides.beforeCommit ? { beforeCommit: overrides.beforeCommit } : {}),
    ...(overrides.automationPublisher ? { automationPublisher: overrides.automationPublisher } : {}),
  });
}

async function createLead(label: string) {
  sequence += 1;
  const result = await createLeadIntakeService({
    database,
    authorization,
    now: () => clock,
  }).intake({
    channel: "MANUAL",
    idempotencyKey: `crm14:${label}:${randomUUID()}`,
    fullName: `${label} ${randomUUID().slice(0, 8)}`,
    phone: `+55119${sequence.toString().slice(-8)}`,
    sourceKey: "manual",
    priorityBandCode: "P2",
    rawPayload: { test: "crm14", label },
  }, systemContext);
  if (result.outcome === "REJECTED") throw new Error(result.issues[0]?.message ?? result.code);
  return result;
}

async function stages() {
  const rows = await database.pipelineStage.findMany({
    where: {
      workspaceId,
      pipeline: { entityType: "LEAD", isDefault: true, deletedAt: null },
      deletedAt: null,
      leadStageCode: { not: null },
    },
    orderBy: { position: "asc" },
    select: { id: true, name: true, leadStageCode: true },
  });
  return new Map(rows.flatMap((row) => row.leadStageCode ? [[row.leadStageCode as LeadStageCode, row]] : []));
}

async function state(leadId: string, context = managerContext) {
  return pipelineService().getLeadState(context, { leadId });
}

async function transition(
  leadId: string,
  target: LeadStageCode,
  input: Partial<{
    context: AuthenticatedContext;
    expectedUpdatedAt: string;
    reason: string;
    managerCorrection: boolean;
    confirmed: boolean;
    disqualificationReasonId: string | null;
  }> = {},
) {
  const current = await state(leadId, input.context ?? managerContext);
  const targetStage = (await stages()).get(target);
  if (!targetStage) throw new Error(`Etapa ${target} ausente no teste.`);
  return pipelineService().transition(input.context ?? managerContext, {
    leadId,
    targetStageId: targetStage.id,
    expectedUpdatedAt: input.expectedUpdatedAt ?? current.updatedAt,
    reason: input.reason ?? `Transição de teste para ${target}`,
    origin: "PIPELINE_LIST",
    managerCorrection: input.managerCorrection ?? false,
    confirmed: input.confirmed ?? false,
    disqualificationReasonId: input.disqualificationReasonId ?? null,
  });
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  workspaceId = seed.workspaceId;
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, key: "system", type: "SYSTEM" },
    select: { id: true },
  });
  systemContext = Object.freeze({
    workspaceId,
    actorId: actor.id,
    actorKey: "system",
    actorType: "SYSTEM",
  });
  [managerContext, viewerContext, sdrContext] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    humanContext("sdr1@demo.politizai.local"),
  ]);
});

afterAll(async () => database.$disconnect());

describe("pipeline de pré-vendas e transições", () => {
  it("mantém as oito etapas semânticas e contagens rastreáveis no board e na lista", async () => {
    const lead = await createLead("CRM14 board");
    const screen = await pipelineService().getScreen(managerContext, { q: "CRM14 board" });
    expect(screen.stages.map((stage) => stage.code)).toEqual(leadStageCodes);
    expect(screen.stages.reduce((total, stage) => total + stage.count, 0)).toBe(1);
    expect(screen.stages.find((stage) => stage.code === "NEW")?.leads[0]).toMatchObject({
      id: lead.leadId,
      currentStageName: "Novo",
    });
    const managerState = await state(lead.leadId);
    expect(managerState.transitions)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "TRYING_CONTACT", allowed: true }),
        expect.objectContaining({ code: "QUALIFIED", allowed: true }),
      ]));

    const viewerState = await state(lead.leadId, viewerContext);
    expect(viewerState).toMatchObject({ canWrite: false, canCorrect: false });
    await expect(transition(lead.leadId, "TRYING_CONTACT", { context: viewerContext }))
      .rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("localiza o lead por telefone principal ou telefone adicional com e sem máscara", async () => {
    const lead = await createLead("CRM14 busca telefone");
    const stored = await database.lead.findUniqueOrThrow({
      where: { id: lead.leadId },
      select: { contactId: true, normalizedPhone: true },
    });
    expect(stored.normalizedPhone).toBeTruthy();
    expect(stored.contactId).toBeTruthy();

    const primaryDigits = stored.normalizedPhone!.replace(/\D/g, "");
    const primarySearch = `(${primaryDigits.slice(2, 4)}) ${primaryDigits.slice(4, 9)}-${primaryDigits.slice(9)}`;
    const byPrimaryPhone = await pipelineService().getScreen(managerContext, { q: primarySearch });
    expect(byPrimaryPhone.stages.flatMap((stage) => stage.leads).map((item) => item.id)).toContain(lead.leadId);

    await database.contactPoint.create({
      data: {
        workspaceId,
        contactId: stored.contactId!,
        type: "PHONE",
        originalValue: "(66) 3461-7350",
        normalizedValue: "+556634617350",
        countryCode: "55",
        label: "Gabinete",
        source: "MANUAL",
        createdByActorId: systemContext.actorId,
        updatedByActorId: systemContext.actorId,
      },
    });

    const byAdditionalPhone = await pipelineService().getScreen(managerContext, { q: "66 3461-7350" });
    expect(byAdditionalPhone.stages.flatMap((stage) => stage.leads).map((item) => item.id)).toContain(lead.leadId);

    const stage = byAdditionalPhone.stages.find((item) => item.leads.some((item) => item.id === lead.leadId));
    expect(stage).toBeDefined();
    await expect(pipelineService().getStagePage(managerContext, {
      pipelineId: byAdditionalPhone.pipelineId,
      q: "+55 (66) 3461-7350",
      stageId: stage!.id,
      offset: 0,
      limit: 20,
    })).resolves.toMatchObject({ leads: [expect.objectContaining({ id: lead.leadId })] });
  });

  it("transiciona pelo serviço, fecha intervalos e registra timeline e auditoria", async () => {
    const lead = await createLead("CRM14 histórico");
    const initial = await state(lead.leadId);
    clock = new Date(clock.getTime() + 60_000);
    await transition(lead.leadId, "TRYING_CONTACT", { expectedUpdatedAt: initial.updatedAt });
    clock = new Date(clock.getTime() + 90_000);
    await transition(lead.leadId, "CONNECTED");
    clock = new Date(clock.getTime() + 30_000);
    await transition(lead.leadId, "IN_QUALIFICATION");

    const [history, activities, audit] = await Promise.all([
      database.stageHistory.findMany({ where: { workspaceId, leadId: lead.leadId }, orderBy: { enteredAt: "asc" } }),
      database.activity.findMany({ where: { workspaceId, leadId: lead.leadId, type: "STAGE_CHANGE" }, orderBy: { occurredAt: "asc" } }),
      database.auditLog.findMany({ where: { workspaceId, entityId: lead.leadId, action: "lead.stage.transitioned" } }),
    ]);
    expect(history).toHaveLength(4);
    expect(history.filter((item) => item.exitedAt === null)).toHaveLength(1);
    expect(history[0]!.exitedAt!.getTime() - history[0]!.enteredAt.getTime()).toBe(60_000);
    expect(history.slice(1).map((item) => item.transitionOrigin)).toEqual([
      "PIPELINE_LIST", "PIPELINE_LIST", "PIPELINE_LIST",
    ]);
    expect(activities).toHaveLength(3);
    expect(audit).toHaveLength(3);
    await expect(database.stageHistory.update({
      where: { id: history[0]!.id },
      data: { transitionReason: "Tentativa de reescrever o fato histórico" },
    })).rejects.toThrow(/immutable/);
  });

  it("registra agendamento quando o card entra manualmente em Reunião agendada", async () => {
    const lead = await createLead("CRM14 reunião por card");
    clock = new Date(clock.getTime() + 60_000);
    await transition(lead.leadId, "MEETING_SCHEDULED", { context: managerContext });

    const fact = await database.commercialMetricFact.findFirstOrThrow({
      where: {
        workspaceId,
        leadId: lead.leadId,
        sourceEntityType: "StageHistory",
        eventType: "MEETING_SCHEDULED",
      },
      select: {
        creditedMemberId: true,
        performedByMemberId: true,
        bookedByMemberId: true,
        result: true,
      },
    });
    expect(fact).toEqual({
      creditedMemberId: managerContext.memberId,
      performedByMemberId: managerContext.memberId,
      bookedByMemberId: managerContext.memberId,
      result: "STAGE_TRANSITION",
    });
  });

  it("permite mover livremente sem fluxo, PACTO ou próxima ação obrigatórios", async () => {
    const direct = await createLead("CRM14 movimento livre");
    const initial = await state(direct.leadId);
    const qualifiedStage = (await stages()).get("QUALIFIED")!;
    const qualified = await pipelineService({
      automationPublisher: {
        publishInTransaction: async () => {
          throw new Error("automação de qualificação indisponível");
        },
      },
    }).transition(managerContext, {
      leadId: direct.leadId,
      targetStageId: qualifiedStage.id,
      expectedUpdatedAt: initial.updatedAt,
      origin: "PIPELINE_BOARD",
    });
    expect(qualified).toMatchObject({ toStageCode: "QUALIFIED", status: "QUALIFIED" });

    const withoutAction = await createLead("CRM14 sem ação");
    await database.task.updateMany({
      where: { workspaceId, leadId: withoutAction.leadId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: { status: "CANCELLED", updatedByActorId: systemContext.actorId },
    });
    await database.lead.update({
      where: { id: withoutAction.leadId },
      data: { nextActionTaskId: null, nextActionAt: null, nextActionDescription: null },
    });
    await expect(transition(withoutAction.leadId, "NURTURING"))
      .resolves.toMatchObject({ toStageCode: "NURTURING" });
  });

  it("desqualifica sem campos auxiliares obrigatórios e encerra tarefas", async () => {
    const lead = await createLead("CRM14 desqualificação");
    const result = await transition(lead.leadId, "DISQUALIFIED");
    const stored = await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } });
    expect(result.cancelledTaskIds.length).toBeGreaterThan(0);
    expect(stored).toMatchObject({
      status: "DISQUALIFIED",
      disqualificationReasonId: null,
      nextActionTaskId: null,
      nextActionAt: null,
      nextActionDescription: null,
    });
    expect(await database.task.count({
      where: { workspaceId, leadId: lead.leadId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    })).toBe(0);
    expect(await database.activity.count({
      where: { workspaceId, leadId: lead.leadId, type: "STAGE_CHANGE" },
    })).toBe(1);
  });

  it("diferencia correção do gestor e não permite que SDR a use", async () => {
    const lead = await createLead("CRM14 correção");
    const distribution = createLeadDistributionService({ database, authorization, now: () => clock });
    const stored = await database.lead.findUniqueOrThrow({ where: { id: lead.leadId }, select: { ownerMemberId: true } });
    if (stored.ownerMemberId !== sdrContext.memberId) {
      await distribution.redistribute(managerContext, {
        leadId: lead.leadId,
        target: { type: "MEMBER", memberId: sdrContext.memberId },
        reason: "Preparação do teste de correção gerencial",
      });
    }
    const afterAssignment = await state(lead.leadId, sdrContext);
    const target = (await stages()).get("NURTURING")!;
    await expect(pipelineService().transition(sdrContext, {
      leadId: lead.leadId,
      targetStageId: target.id,
      expectedUpdatedAt: afterAssignment.updatedAt,
      reason: "SDR tentou corrigir a etapa diretamente.",
      origin: "LEAD_CARD",
      managerCorrection: true,
      confirmed: true,
    })).rejects.toBeInstanceOf(AccessDeniedError);

    const corrected = await transition(lead.leadId, "NURTURING", {
      managerCorrection: true,
      confirmed: true,
      reason: "Gestor corrigiu a etapa após revisar o histórico.",
    });
    expect(corrected.toStageCode).toBe("NURTURING");
    const history = await database.stageHistory.findFirstOrThrow({
      where: { workspaceId, leadId: lead.leadId, exitedAt: null },
    });
    expect(history).toMatchObject({ managerCorrection: true, transitionOrigin: "PIPELINE_LIST" });
    expect(await database.auditLog.count({
      where: { workspaceId, entityId: lead.leadId, action: "lead.stage.manager_corrected" },
    })).toBe(1);
  });

  it("serializa concorrência e rejeita a segunda mutação obsoleta", async () => {
    const lead = await createLead("CRM14 concorrência");
    const initial = await state(lead.leadId);
    const stageMap = await stages();
    const payload = (target: LeadStageCode) => ({
      leadId: lead.leadId,
      targetStageId: stageMap.get(target)!.id,
      expectedUpdatedAt: initial.updatedAt,
      reason: `Concorrência controlada para ${target}`,
      origin: "PIPELINE_BOARD" as const,
    });
    const settled = await Promise.allSettled([
      pipelineService().transition(managerContext, payload("TRYING_CONTACT")),
      pipelineService().transition(managerContext, payload("CONNECTED")),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(settled.find((result) => result.status === "rejected"))
      .toMatchObject({ reason: { code: "LEAD_VERSION_CONFLICT" } });
    expect(await database.stageHistory.count({ where: { workspaceId, leadId: lead.leadId } })).toBe(2);
    expect(await database.stageHistory.count({ where: { workspaceId, leadId: lead.leadId, exitedAt: null } })).toBe(1);
  });

  it("reverte integralmente a transição quando a transação falha", async () => {
    const lead = await createLead("CRM14 rollback");
    const before = await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } });
    const initialState = await state(lead.leadId);
    const target = (await stages()).get("TRYING_CONTACT")!;
    const countsBefore = await Promise.all([
      database.stageHistory.count({ where: { workspaceId, leadId: lead.leadId } }),
      database.activity.count({ where: { workspaceId, leadId: lead.leadId, type: "STAGE_CHANGE" } }),
      database.auditLog.count({ where: { workspaceId, entityId: lead.leadId, action: "lead.stage.transitioned" } }),
    ]);
    const rollback = pipelineService({
      beforeCommit: async () => { throw new Error("falha transacional simulada CRM-14"); },
    });
    await expect(rollback.transition(managerContext, {
      leadId: lead.leadId,
      targetStageId: target.id,
      expectedUpdatedAt: initialState.updatedAt,
      reason: "Teste controlado de rollback integral.",
      origin: "PIPELINE_BOARD",
    })).rejects.toThrow("falha transacional simulada CRM-14");
    const after = await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } });
    expect(after.currentStageId).toBe(before.currentStageId);
    expect(await Promise.all([
      database.stageHistory.count({ where: { workspaceId, leadId: lead.leadId } }),
      database.activity.count({ where: { workspaceId, leadId: lead.leadId, type: "STAGE_CHANGE" } }),
      database.auditLog.count({ where: { workspaceId, entityId: lead.leadId, action: "lead.stage.transitioned" } }),
    ])).toEqual(countsBefore);
  });
});
