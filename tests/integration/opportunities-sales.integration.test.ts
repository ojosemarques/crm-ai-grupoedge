import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for opportunity tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 24 }) });
const authorization = createAuthorizationService({ database });
let clock = new Date("2036-03-10T15:00:00.000Z");
let workspaceId: string;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let closer1: AuthenticatedContext;
let closer2: AuthenticatedContext;
let system: ServiceActorContext;
let productId: string;
let lossReasonId: string;
let sequence = 80_000_000;

function futureLocalInput(days = 1) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(clock.getTime() + days * 24 * 60 * 60 * 1_000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
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

function opportunities(overrides: Readonly<{ beforeCommit?: () => Promise<void> }> = {}) {
  return createOpportunityService({ database, authorization, now: () => clock, ...overrides });
}

async function scenario(input: Readonly<{
  label: string;
  meetingStatus?: "SCHEDULED" | "COMPLETED";
  product?: boolean;
  owner?: AuthenticatedContext;
}> ) {
  sequence += 1;
  const intake = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
    channel: "MANUAL",
    idempotencyKey: `crm16:${input.label}:${randomUUID()}`,
    fullName: `${input.label} ${randomUUID().slice(0, 6)}`,
    phone: `+55119${sequence.toString().slice(-8)}`,
    interestSummary: "Interesse comercial fictício para validar o fluxo do closer.",
    sourceKey: "manual",
    priorityBandCode: "P1",
    rawPayload: { test: "crm16", label: input.label },
  }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const owner = input.owner ?? closer1;
  const status = input.meetingStatus ?? "COMPLETED";
  const meeting = await database.meeting.create({
    data: {
      workspaceId,
      leadId: intake.leadId,
      ownerMemberId: owner.memberId,
      title: `Diagnóstico ${input.label}`,
      status,
      startsAt: new Date(clock.getTime() - 60 * 60 * 1_000),
      endsAt: new Date(clock.getTime() - 30 * 60 * 1_000),
      durationMinutes: 30,
      timeZone: "America/Sao_Paulo",
      completedAt: status === "COMPLETED" ? clock : null,
      outcome: status === "COMPLETED" ? "Diagnóstico realizado." : null,
      createdByActorId: manager.actorId,
      updatedByActorId: manager.actorId,
      createdAt: clock,
      updatedAt: clock,
    },
  });
  const result = await opportunities().create(manager, {
    leadId: intake.leadId,
    meetingId: meeting.id,
    ownerMemberId: owner.memberId,
    productId: input.product === false ? null : productId,
    interestDescription: input.product === false ? "Programa permanente ainda sem produto definido" : undefined,
    name: `Negócio ${input.label}`,
    amountCents: "480000",
    mrrCents: "40000",
    tcvCents: "480000",
    probabilityPercent: 55,
    expectedCloseDate: "2036-03-30",
    notes: "Registro fictício e persistido.",
    nextAction: { title: "Preparar próximo passo comercial", dueAtLocal: futureLocalInput() },
  });
  return { leadId: intake.leadId, meetingId: meeting.id, opportunityId: result.opportunityId };
}

async function stages() {
  const rows = await database.pipelineStage.findMany({
    where: { workspaceId, pipeline: { entityType: "OPPORTUNITY", isDefault: true }, deletedAt: null },
    select: { id: true, opportunityStageCode: true },
  });
  return new Map(rows.map((row) => [row.opportunityStageCode, row.id]));
}

async function transition(
  opportunityId: string,
  targetCode: "OPPORTUNITY_CONFIRMED" | "NEGOTIATION" | "WON" | "LOST",
  expectedRevision: number,
  overrides: Record<string, unknown> = {},
) {
  const stageId = (await stages()).get(targetCode);
  if (!stageId) throw new Error(`Stage missing: ${targetCode}`);
  return opportunities().transition(manager, {
    action: "TRANSITION",
    opportunityId,
    targetStageId: stageId,
    expectedRevision,
    reason: `Movimento controlado para ${targetCode}.`,
    origin: "OPPORTUNITY_CARD",
    confirmed: targetCode === "WON" || targetCode === "LOST",
    lossReasonId: targetCode === "LOST" ? lossReasonId : null,
    ...overrides,
  });
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database);
  workspaceId = seeded.workspaceId;
  const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
  system = { workspaceId, actorId: systemActor.id, actorKey: "system", actorType: "SYSTEM" };
  [manager, viewer, closer1, closer2] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    humanContext("closer1@demo.politizai.local"),
    humanContext("closer2@demo.politizai.local"),
  ]);
  const [product, reason] = await Promise.all([
    database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
    database.lossReason.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
  ]);
  productId = product.id;
  lossReasonId = reason.id;
});

afterAll(async () => database.$disconnect());

describe("pipeline comercial de oportunidades", () => {
  it("cria oportunidade, vínculo, próxima ação, histórico, timeline e auditoria atomicamente", async () => {
    const created = await scenario({ label: "criação" });
    const [opportunity, meeting, tasks, history, activities, audit] = await Promise.all([
      database.opportunity.findUniqueOrThrow({ where: { id: created.opportunityId }, include: { currentStage: true } }),
      database.meeting.findUniqueOrThrow({ where: { id: created.meetingId } }),
      database.task.findMany({ where: { workspaceId, opportunityId: created.opportunityId } }),
      database.stageHistory.findMany({ where: { workspaceId, opportunityId: created.opportunityId } }),
      database.activity.findMany({ where: { workspaceId, opportunityId: created.opportunityId } }),
      database.auditLog.findMany({ where: { workspaceId, entityId: created.opportunityId } }),
    ]);
    expect(opportunity).toMatchObject({
      productId,
      amountCents: 480000n,
      mrrCents: 40000n,
      tcvCents: 480000n,
      probabilityBps: 5500,
      status: "OPEN",
      nextActionTaskId: tasks[0]?.id,
    });
    expect(opportunity.currentStage.opportunityStageCode).toBe("MEETING_HELD");
    expect(meeting.opportunityId).toBe(opportunity.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assigneeMemberId: closer1.memberId, status: "OPEN" });
    expect(history).toHaveLength(1);
    expect(activities.map((item) => item.type)).toContain("STAGE_CHANGE");
    expect(audit.map((item) => item.action)).toContain("opportunity.created");
    await expect(database.opportunity.update({
      where: { id: opportunity.id },
      data: { productId: null, interestDescription: null },
    })).rejects.toThrow();
  });

  it("rejeita produto/interesse ausente e reverte todos os efeitos em falha transacional", async () => {
    const created = await scenario({ label: "rollback-base" });
    const extraMeeting = await database.meeting.create({
      data: {
        workspaceId,
        leadId: created.leadId,
        ownerMemberId: closer1.memberId,
        title: "Segunda reunião para rollback",
        status: "COMPLETED",
        startsAt: new Date(clock.getTime() - 3_600_000),
        endsAt: new Date(clock.getTime() - 1_800_000),
        durationMinutes: 30,
        timeZone: "America/Sao_Paulo",
        completedAt: clock,
        createdByActorId: manager.actorId,
        updatedByActorId: manager.actorId,
      },
    });
    const basePayload = {
      leadId: created.leadId,
      meetingId: extraMeeting.id,
      ownerMemberId: closer1.memberId,
      productId: null,
      name: "Oportunidade revertida",
      amountCents: "10000",
      mrrCents: "0",
      tcvCents: "10000",
      probabilityPercent: 20,
      nextAction: { title: "Ação que deve reverter", dueAtLocal: "2036-03-11T11:00" },
    };
    await expect(opportunities().create(manager, basePayload)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(opportunities({ beforeCommit: async () => { throw new Error("falha controlada crm16"); } }).create(manager, {
      ...basePayload,
      interestDescription: "Interesse ainda sem produto",
    })).rejects.toThrow("falha controlada crm16");
    expect(await database.opportunity.count({ where: { workspaceId, name: "Oportunidade revertida" } })).toBe(0);
    expect(await database.task.count({ where: { workspaceId, leadId: created.leadId, title: "Ação que deve reverter" } })).toBe(0);
    expect((await database.meeting.findUniqueOrThrow({ where: { id: extraMeeting.id } })).opportunityId).toBeNull();
  });

  it("usa o comparecimento da reunião para avançar uma única vez e atribui a ação ao closer", async () => {
    const created = await scenario({ label: "comparecimento", meetingStatus: "SCHEDULED" });
    const stageMap = await stages();
    await expect(opportunities().transition(manager, {
      action: "TRANSITION",
      opportunityId: created.opportunityId,
      targetStageId: stageMap.get("MEETING_HELD"),
      expectedRevision: 1,
      reason: "Tentativa sem comparecimento.",
      origin: "OPPORTUNITY_CARD",
      confirmed: false,
    })).rejects.toMatchObject({ code: "MEETING_ATTENDANCE_REQUIRED" });
    clock = new Date("2036-03-10T16:00:00.000Z");
    await createMeetingService({ database, authorization, now: () => clock }).act(manager, {
      action: "ATTENDED",
      meetingId: created.meetingId,
      expectedRevision: 1,
      outcome: "Lead compareceu e confirmou contexto.",
      nextAction: { title: "Confirmar oportunidade", dueAtLocal: "2036-03-11T12:00" },
    });
    const opportunity = await database.opportunity.findUniqueOrThrow({
      where: { id: created.opportunityId },
      include: { currentStage: true },
    });
    expect(opportunity.currentStage.opportunityStageCode).toBe("MEETING_HELD");
    expect(opportunity.revision).toBe(2);
    expect(await database.stageHistory.count({ where: { workspaceId, opportunityId: created.opportunityId, exitedAt: null } })).toBe(1);
    const followUp = await database.task.findFirstOrThrow({
      where: { workspaceId, opportunityId: created.opportunityId, title: "Confirmar oportunidade" },
    });
    expect(followUp.assigneeMemberId).toBe(closer1.memberId);
  });

  it("percorre confirmação, proposta, negociação e ganho com valores persistidos", async () => {
    clock = new Date("2036-03-12T15:00:00.000Z");
    const created = await scenario({ label: "ganho" });
    let state = await transition(created.opportunityId, "OPPORTUNITY_CONFIRMED", 1);
    const proposal = await opportunities().registerProposal(manager, {
      action: "PROPOSAL",
      opportunityId: created.opportunityId,
      expectedRevision: state.revision,
      productId,
      offerTemplateId: null,
      name: "Plano anual Politizai",
      quantity: 1,
      unitPriceCents: "600000",
      discountCents: "30000",
      validUntilDate: "2036-03-25",
      confirmed: true,
      nextAction: { title: "Negociar condições finais", dueAtLocal: "2036-03-13T10:00" },
    });
    state = await transition(created.opportunityId, "NEGOTIATION", proposal.revision);
    const won = await transition(created.opportunityId, "WON", state.revision);
    expect(won.status).toBe("WON");
    const stored = await database.opportunity.findUniqueOrThrow({
      where: { id: created.opportunityId },
      include: { offers: true, currentStage: true },
    });
    expect(stored).toMatchObject({ status: "WON", amountCents: 570000n, tcvCents: 570000n });
    expect(stored.currentStage.opportunityStageCode).toBe("WON");
    expect(stored.offers[0]).toMatchObject({ totalCents: 570000n, acceptedAt: expect.any(Date) });
    await expect(database.offer.update({
      where: { id: stored.offers[0]!.id },
      data: { totalCents: 0n, justification: null },
    })).rejects.toThrow();
    expect(await database.task.count({ where: { workspaceId, opportunityId: stored.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(0);
    expect(await database.stageHistory.count({ where: { workspaceId, opportunityId: stored.id } })).toBe(5);
    expect(await database.activity.count({ where: { workspaceId, opportunityId: stored.id, type: "WON" } })).toBe(1);
    expect(await database.auditLog.count({ where: { workspaceId, entityId: stored.id, action: "opportunity.won" } })).toBe(1);
    expect(await database.opportunityOutcomeSnapshot.findFirst({
      where: { workspaceId, opportunityId: stored.id, status: "WON" },
    })).toMatchObject({
      leadId: created.leadId,
      ownerMemberId: closer1.memberId,
      productId,
      amountCents: 570000n,
      mrrCents: 40000n,
      tcvCents: 570000n,
    });
  });

  it("exige proposta, valor/justificativa, confirmação e bloqueia saltos", async () => {
    clock = new Date("2036-03-14T15:00:00.000Z");
    const created = await scenario({ label: "bloqueios" });
    const stageMap = await stages();
    await expect(opportunities().transition(manager, {
      action: "TRANSITION",
      opportunityId: created.opportunityId,
      targetStageId: stageMap.get("NEGOTIATION"),
      expectedRevision: 1,
      reason: "Salto indevido.",
      origin: "OPPORTUNITY_CARD",
      confirmed: false,
    })).rejects.toMatchObject({ code: "INVALID_OPPORTUNITY_TRANSITION" });
    const confirmed = await transition(created.opportunityId, "OPPORTUNITY_CONFIRMED", 1);
    await expect(opportunities().registerProposal(manager, {
      action: "PROPOSAL",
      opportunityId: created.opportunityId,
      expectedRevision: confirmed.revision,
      productId,
      offerTemplateId: null,
      name: "Proposta sem valor",
      quantity: 1,
      unitPriceCents: "0",
      discountCents: "0",
      confirmed: true,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(transition(created.opportunityId, "LOST", confirmed.revision, {
      confirmed: false,
      lossReasonId: null,
    })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });

  it("exige motivo na perda e reabertura exige permissão, motivo, confirmação e próxima ação", async () => {
    clock = new Date("2036-03-16T15:00:00.000Z");
    const created = await scenario({ label: "perda" });
    await expect(transition(created.opportunityId, "LOST", 1, { lossReasonId: null })).rejects.toMatchObject({
      code: "LOSS_REASON_REQUIRED",
    });
    const confirmed = await transition(created.opportunityId, "OPPORTUNITY_CONFIRMED", 1);
    const proposal = await opportunities().registerProposal(manager, {
      action: "PROPOSAL",
      opportunityId: created.opportunityId,
      expectedRevision: confirmed.revision,
      productId,
      offerTemplateId: null,
      name: "Proposta antes da perda",
      quantity: 1,
      unitPriceCents: "480000",
      discountCents: "0",
      confirmed: true,
    });
    const negotiation = await transition(created.opportunityId, "NEGOTIATION", proposal.revision);
    const lost = await transition(created.opportunityId, "LOST", negotiation.revision);
    await expect(opportunities().reopen(closer1, {
      action: "REOPEN",
      opportunityId: created.opportunityId,
      expectedRevision: lost.revision,
      reason: "Lead retomou a negociação.",
      confirmed: true,
      nextAction: { title: "Retomar negociação", dueAtLocal: "2036-03-17T10:00" },
    })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(opportunities().reopen(manager, {
      action: "REOPEN",
      opportunityId: created.opportunityId,
      expectedRevision: lost.revision,
      reason: "Lead retomou a negociação.",
      confirmed: false,
      nextAction: { title: "Retomar negociação", dueAtLocal: "2036-03-17T10:00" },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const reopened = await opportunities().reopen(manager, {
      action: "REOPEN",
      opportunityId: created.opportunityId,
      expectedRevision: lost.revision,
      reason: "Lead retomou a negociação com novo contexto.",
      confirmed: true,
      nextAction: { title: "Retomar negociação", dueAtLocal: "2036-03-17T10:00" },
    });
    expect(reopened.stageCode).toBe("NEGOTIATION");
    const stored = await database.opportunity.findUniqueOrThrow({ where: { id: created.opportunityId } });
    expect(stored).toMatchObject({ status: "OPEN", closedAt: null, lossReasonId: null });
    expect(await database.stageHistory.count({ where: { workspaceId, opportunityId: stored.id, managerCorrection: true } })).toBe(1);
  });

  it("aplica escopo próprio do closer, visão da equipe, filtros e somente leitura", async () => {
    clock = new Date("2036-03-18T15:00:00.000Z");
    const own = await scenario({ label: "escopo-closer-1", owner: closer1 });
    const other = await scenario({ label: "escopo-closer-2", owner: closer2, product: false });
    const ownScreen = await opportunities().getPipelineScreen(closer1, {});
    expect(ownScreen.stages.flatMap((stage) => stage.opportunities).map((item) => item.id)).toContain(own.opportunityId);
    expect(ownScreen.stages.flatMap((stage) => stage.opportunities).map((item) => item.id)).not.toContain(other.opportunityId);
    expect(ownScreen.canFilterCloser).toBe(false);
    const managerScreen = await opportunities().getPipelineScreen(manager, {
      closerId: closer2.memberId,
      productId: "",
      stageCode: "MEETING_HELD",
      from: "2036-03-18",
      to: "2036-03-19",
    });
    expect(managerScreen.stages.flatMap((stage) => stage.opportunities).map((item) => item.id)).toContain(other.opportunityId);
    const viewerScreen = await opportunities().getPipelineScreen(viewer, {});
    const viewerItem = viewerScreen.stages.flatMap((stage) => stage.opportunities).find((item) => item.id === own.opportunityId);
    expect(viewerItem).toMatchObject({ canWrite: false, canReopen: false });
    await expect(transition(own.opportunityId, "OPPORTUNITY_CONFIRMED", 1)).resolves.toBeDefined();
    await expect(opportunities().transition(viewer, {
      action: "TRANSITION",
      opportunityId: other.opportunityId,
      targetStageId: (await stages()).get("OPPORTUNITY_CONFIRMED"),
      expectedRevision: 1,
      reason: "Visualizador não pode alterar.",
      origin: "OPPORTUNITY_LIST",
      confirmed: false,
    })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("serializa concorrência pela revisão e mantém um único histórico aberto", async () => {
    clock = new Date("2036-03-20T15:00:00.000Z");
    const created = await scenario({ label: "concorrência" });
    const stageMap = await stages();
    const base = {
      action: "TRANSITION" as const,
      opportunityId: created.opportunityId,
      expectedRevision: 1,
      origin: "OPPORTUNITY_BOARD" as const,
    };
    const results = await Promise.allSettled([
      opportunities().transition(manager, {
        ...base,
        targetStageId: stageMap.get("OPPORTUNITY_CONFIRMED"),
        reason: "Confirmar oportunidade concorrente.",
        confirmed: false,
      }),
      opportunities().transition(manager, {
        ...base,
        targetStageId: stageMap.get("LOST"),
        reason: "Perder oportunidade concorrente.",
        confirmed: true,
        lossReasonId,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "OPPORTUNITY_VERSION_CONFLICT" },
    });
    expect(await database.stageHistory.count({ where: { workspaceId, opportunityId: created.opportunityId, exitedAt: null } })).toBe(1);
  });
});
