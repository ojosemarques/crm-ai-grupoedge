import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { leadStageCodes, leadStageLabels } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { regularDestinationCodes } from "@/modules/pipelines/domain/lead-stage-transition-policy";

const defaultCadence = [
  { dayOffset: 1, action: "WHATSAPP" },
  { dayOffset: 2, action: "CALL" },
  { dayOffset: 3, action: "EMAIL" },
  { dayOffset: 5, action: "WHATSAPP" },
  { dayOffset: 7, action: "RECYCLE" },
] as const;
const salesStages = [
  ["MEETING_SCHEDULED", "Reunião agendada", "OPEN"],
  ["MEETING_HELD", "Reunião realizada", "OPEN"],
  ["OPPORTUNITY_CONFIRMED", "Oportunidade confirmada", "OPEN"],
  ["PROPOSAL", "Proposta", "OPEN"],
  ["NEGOTIATION", "Negociação", "OPEN"],
  ["WON", "Ganho", "WON"],
  ["LOST", "Perdido", "LOST"],
] as const;
const salesTransitions = [
  ["MEETING_SCHEDULED", "MEETING_HELD"], ["MEETING_SCHEDULED", "LOST"],
  ["MEETING_HELD", "OPPORTUNITY_CONFIRMED"], ["MEETING_HELD", "LOST"],
  ["OPPORTUNITY_CONFIRMED", "PROPOSAL"], ["OPPORTUNITY_CONFIRMED", "LOST"],
  ["PROPOSAL", "NEGOTIATION"], ["PROPOSAL", "LOST"],
  ["NEGOTIATION", "WON"], ["NEGOTIATION", "LOST"],
] as const;
const priorityBands = [
  { code: "P1", name: "P1 — atendimento imediato", scoreMin: 70, scoreMax: 100, leadPriority: "URGENT", policyKey: "p1-immediate" },
  { code: "P2", name: "P2 — atendimento prioritário", scoreMin: 40, scoreMax: 69, leadPriority: "HIGH", policyKey: "p2-priority" },
  { code: "P3", name: "P3 — atendimento padrão", scoreMin: 0, scoreMax: 39, leadPriority: "MEDIUM", policyKey: "p3-standard" },
] as const;

type Counters = {
  settings: number;
  cadence: number;
  pipelines: number;
  stages: number;
  transitions: number;
  scoringRules: number;
  slaPolicies: number;
  priorityBands: number;
  reasons: number;
};

class DryRunRollback extends Error {
  constructor(readonly created: Counters) { super("Rollback da prévia de inicialização."); }
}

async function ensureLeadPipeline(tx: Prisma.TransactionClient, workspaceId: string, actorId: string, result: Counters) {
  let pipeline = await tx.pipeline.findFirst({ where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null } });
  if (!pipeline) {
    pipeline = await tx.pipeline.create({ data: { workspaceId, name: "Pré-vendas", entityType: "LEAD", isDefault: true, createdByActorId: actorId, updatedByActorId: actorId } });
    result.pipelines += 1;
  }
  const ids = new Map<string, string>();
  for (const [position, code] of leadStageCodes.entries()) {
    let stage = await tx.pipelineStage.findFirst({ where: { workspaceId, pipelineId: pipeline.id, leadStageCode: code, deletedAt: null } });
    if (!stage) {
      stage = await tx.pipelineStage.create({ data: { workspaceId, pipelineId: pipeline.id, name: leadStageLabels[code], position, type: code === "QUALIFIED" ? "WON" : code === "DISQUALIFIED" ? "LOST" : "OPEN", leadStageCode: code, createdByActorId: actorId, updatedByActorId: actorId } });
      result.stages += 1;
    }
    ids.set(code, stage.id);
  }
  for (const from of leadStageCodes) {
    for (const to of regularDestinationCodes(from)) {
      const fromStageId = ids.get(from)!;
      const toStageId = ids.get(to)!;
      const existing = await tx.pipelineStageTransition.findFirst({ where: { workspaceId, pipelineId: pipeline.id, fromStageId, toStageId } });
      if (existing) continue;
      await tx.pipelineStageTransition.create({ data: { workspaceId, pipelineId: pipeline.id, fromStageId, toStageId, createdByActorId: actorId, updatedByActorId: actorId } });
      result.transitions += 1;
    }
  }
}

async function ensureSalesPipeline(tx: Prisma.TransactionClient, workspaceId: string, actorId: string, result: Counters) {
  let pipeline = await tx.pipeline.findFirst({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null } });
  if (!pipeline) {
    pipeline = await tx.pipeline.create({ data: { workspaceId, name: "Vendas", entityType: "OPPORTUNITY", isDefault: true, createdByActorId: actorId, updatedByActorId: actorId } });
    result.pipelines += 1;
  }
  const ids = new Map<string, string>();
  for (const [position, [code, name, type]] of salesStages.entries()) {
    let stage = await tx.pipelineStage.findFirst({ where: { workspaceId, pipelineId: pipeline.id, opportunityStageCode: code, deletedAt: null } });
    if (!stage) {
      stage = await tx.pipelineStage.create({ data: { workspaceId, pipelineId: pipeline.id, name, position, type, opportunityStageCode: code, createdByActorId: actorId, updatedByActorId: actorId } });
      result.stages += 1;
    }
    ids.set(code, stage.id);
  }
  for (const [from, to] of salesTransitions) {
    const fromStageId = ids.get(from)!;
    const toStageId = ids.get(to)!;
    const existing = await tx.pipelineStageTransition.findFirst({ where: { workspaceId, pipelineId: pipeline.id, fromStageId, toStageId } });
    if (existing) continue;
    await tx.pipelineStageTransition.create({ data: { workspaceId, pipelineId: pipeline.id, fromStageId, toStageId, createdByActorId: actorId, updatedByActorId: actorId } });
    result.transitions += 1;
  }
}

export async function ensureProductionFoundation(database: PrismaClient, workspaceSlug: string, dryRun = false) {
  try {
    return await database.$transaction(async (tx) => {
    const result = await ensureProductionFoundationInTransaction(tx, workspaceSlug);
      if (dryRun) throw new DryRunRollback(result);
      return result;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 90_000 });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.created;
    throw error;
  }
}

export async function ensureProductionFoundationInTransaction(tx: Prisma.TransactionClient, workspaceSlug: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`politizai_foundation:${workspaceSlug}`}))`;
    const workspace = await tx.workspace.findFirstOrThrow({ where: { slug: workspaceSlug, deletedAt: null } });
    const actor = await tx.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, type: "SYSTEM", key: "system" } });
    const result: Counters = { settings: 0, cadence: 0, pipelines: 0, stages: 0, transitions: 0, scoringRules: 0, slaPolicies: 0, priorityBands: 0, reasons: 0 };
    const workspaceId = workspace.id;
    const actorId = actor.id;

    const currentSettings = await tx.commercialSettingsVersion.findFirst({ where: { workspaceId, revision: workspace.commercialSettingsRevision } });
    if (!currentSettings) {
      await tx.commercialSettingsVersion.create({ data: {
        workspaceId, revision: workspace.commercialSettingsRevision,
        pactoMinimumInvestigatedDimensions: workspace.pactoMinimumInvestigatedDimensions,
        defaultMeetingDurationMinutes: workspace.defaultMeetingDurationMinutes,
        distributionStrategy: workspace.distributionStrategy,
        maxOpenLeadsPerSdr: workspace.maxOpenLeadsPerSdr,
        leadStagnationDays: workspace.leadStagnationDays,
        leadWithoutActivityDays: workspace.leadWithoutActivityDays,
        createdByActorId: actorId,
        cadence: { create: defaultCadence.map((step, index) => ({ attemptNumber: index + 1, ...step })) },
      } });
      result.settings += 1;
      result.cadence += defaultCadence.length;
    }

    const scoring = await tx.scoringRuleVersion.findFirst({ where: { workspaceId, active: true } });
    if (!scoring) {
      const latest = await tx.scoringRuleVersion.findFirst({ where: { workspaceId, key: "pacto-default" }, orderBy: { version: "desc" } });
      await tx.scoringRuleVersion.create({ data: { workspaceId, key: "pacto-default", version: (latest?.version ?? 0) + 1, algorithmKey: "pacto-weighted-v1", createdByActorId: actorId } });
      result.scoringRules += 1;
    }

    for (const [position, band] of priorityBands.entries()) {
      const existingBand = await tx.leadPriorityBand.findFirst({ where: { workspaceId, code: band.code, active: true, deletedAt: null, slaPolicy: { active: true, deletedAt: null } } });
      if (existingBand) continue;
      let policy = await tx.slaPolicy.findFirst({ where: { workspaceId, key: band.policyKey, active: true, deletedAt: null } });
      if (!policy) {
        const latest = await tx.slaPolicy.findFirst({ where: { workspaceId, key: band.policyKey }, orderBy: { version: "desc" } });
        policy = await tx.slaPolicy.create({ data: { workspaceId, key: band.policyKey, version: (latest?.version ?? 0) + 1, name: "SLA imediato — 0 minutos", firstResponseMinutes: 0, warningMinutesBeforeDue: 0, healthyMaxSeconds: 60, attentionMaxSeconds: 180, createdByActorId: actorId, updatedByActorId: actorId } });
        result.slaPolicies += 1;
      }
      await tx.leadPriorityBand.create({ data: { workspaceId, slaPolicyId: policy.id, code: band.code, name: band.name, position, scoreMin: band.scoreMin, scoreMax: band.scoreMax, leadPriority: band.leadPriority, createdByActorId: actorId, updatedByActorId: actorId } });
      result.priorityBands += 1;
    }

    await ensureLeadPipeline(tx, workspaceId, actorId, result);
    await ensureSalesPipeline(tx, workspaceId, actorId, result);

    for (const [position, [key, name]] of ([
      ["no-budget", "Sem orçamento"], ["no-priority", "Sem prioridade no momento"],
      ["competitor", "Escolheu outra solução"], ["no-response", "Sem retorno"],
      ["timing", "Momento inadequado"],
    ] as const).entries()) {
      const existing = await tx.lossReason.findFirst({ where: { workspaceId, key, deletedAt: null } });
      if (!existing) { await tx.lossReason.create({ data: { workspaceId, key, name, position, createdByActorId: actorId, updatedByActorId: actorId } }); result.reasons += 1; }
    }
    for (const [position, [key, name]] of ([
      ["outside-profile", "Fora do perfil atendido"], ["no-clear-problem", "Sem problema claro"],
      ["no-authority", "Sem acesso à autoridade"], ["no-timing", "Sem timing definido"],
      ["invalid-data", "Dados inválidos"],
    ] as const).entries()) {
      const existing = await tx.disqualificationReason.findFirst({ where: { workspaceId, key, deletedAt: null } });
      if (!existing) { await tx.disqualificationReason.create({ data: { workspaceId, key, name, position, createdByActorId: actorId, updatedByActorId: actorId } }); result.reasons += 1; }
    }
  return result;
}
