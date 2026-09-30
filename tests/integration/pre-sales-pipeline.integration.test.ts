import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { leadStageCodes, type LeadStageCode } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
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

function pipelineService(overrides: Readonly<{ beforeCommit?: () => Promise<void> }> = {}) {
  return createPreSalesPipelineService({
    database,
    authorization,
    now: () => clock,
    ...overrides,
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

async function validatePacto(leadId: string) {
  return createPactoQualificationService({ database, authorization, now: () => clock }).validate(managerContext, {
    leadId,
    expectedRevision: 0,
    dimensions: pactoDimensions.map((dimension) => ({
      dimension,
      status: "POSITIVE" as const,
      evidence: `Evidência validada para ${dimension}`,
      origin: "SDR" as const,
    })),
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
        expect.objectContaining({ code: "QUALIFIED", allowed: false }),
      ]));

    const viewerState = await state(lead.leadId, viewerContext);
    expect(viewerState).toMatchObject({ canWrite: false, canCorrect: false });
    await expect(transition(lead.leadId, "TRYING_CONTACT", { context: viewerContext }))
      .rejects.toBeInstanceOf(AccessDeniedError);
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

  it("rejeita transição fora do grafo, PACTO incompleto e etapa aberta sem próxima ação", async () => {
    const invalid = await createLead("CRM14 inválida");
    await expect(transition(invalid.leadId, "QUALIFIED", { confirmed: true }))
      .rejects.toMatchObject({ code: "INVALID_STAGE_TRANSITION" });

    const pacto = await createLead("CRM14 pacto");
    await transition(pacto.leadId, "CONNECTED");
    await transition(pacto.leadId, "IN_QUALIFICATION");
    await expect(transition(pacto.leadId, "QUALIFIED", { confirmed: true }))
      .rejects.toMatchObject({ code: "PACTO_REQUIRED" });
    await validatePacto(pacto.leadId);
    const qualified = await transition(pacto.leadId, "QUALIFIED", { confirmed: true });
    expect(qualified).toMatchObject({ toStageCode: "QUALIFIED", status: "QUALIFIED" });

    const withoutAction = await createLead("CRM14 sem ação");
    await transition(withoutAction.leadId, "TRYING_CONTACT");
    await database.task.updateMany({
      where: { workspaceId, leadId: withoutAction.leadId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: { status: "CANCELLED", updatedByActorId: systemContext.actorId },
    });
    await database.lead.update({
      where: { id: withoutAction.leadId },
      data: { nextActionTaskId: null, nextActionAt: null, nextActionDescription: null },
    });
    await expect(transition(withoutAction.leadId, "NURTURING"))
      .rejects.toMatchObject({ code: "NEXT_ACTION_REQUIRED" });
  });

  it("exige motivo e confirmação ao desqualificar, encerra tarefas e mantém o lead explicável", async () => {
    const lead = await createLead("CRM14 desqualificação");
    const reason = await database.disqualificationReason.findFirstOrThrow({
      where: { workspaceId, active: true, deletedAt: null },
      orderBy: { position: "asc" },
    });
    await expect(transition(lead.leadId, "DISQUALIFIED", { confirmed: true }))
      .rejects.toMatchObject({ code: "DISQUALIFICATION_REASON_REQUIRED" });
    await expect(transition(lead.leadId, "DISQUALIFIED", { disqualificationReasonId: reason.id }))
      .rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const result = await transition(lead.leadId, "DISQUALIFIED", {
      confirmed: true,
      disqualificationReasonId: reason.id,
      reason: "Contato inválido confirmado pelo gestor.",
    });
    const stored = await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } });
    expect(result.cancelledTaskIds.length).toBeGreaterThan(0);
    expect(stored).toMatchObject({
      status: "DISQUALIFIED",
      disqualificationReasonId: reason.id,
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
