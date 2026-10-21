import type { Prisma } from "@/generated/prisma/client";
import { transitionLeadStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import type { ActiveProspectingStageOutcome } from "@/modules/prospecting/domain/prospecting-stage-outcome";
import { ApplicationError } from "@/shared/core/errors/application-error";

const activeProspectingPipelineName = "Prospecção Ativa";

const stageRules: Readonly<Record<ActiveProspectingStageOutcome, Readonly<{
  targetStableKey: string;
  allowedCurrentStableKeys: readonly string[];
  reason: string;
}>>> = Object.freeze({
  OUTREACH_ATTEMPTED: {
    targetStableKey: "active-prospecting.active-cadence",
    allowedCurrentStableKeys: ["active-prospecting.new-lead", "active-prospecting.initial-outreach"],
    reason: "Primeira tentativa de contato registrada; cadência iniciada.",
  },
  CONTACT_CONNECTED: {
    targetStableKey: "active-prospecting.conversation-started",
    allowedCurrentStableKeys: ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence"],
    reason: "Contato efetivo registrado; conversa iniciada.",
  },
  MEETING_SCHEDULED: {
    targetStableKey: "active-prospecting.meeting-scheduled",
    allowedCurrentStableKeys: ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence", "active-prospecting.conversation-started"],
    reason: "Reunião agendada durante a prospecção.",
  },
  CLOSED_NO_RESPONSE: {
    targetStableKey: "active-prospecting.closed-no-response",
    allowedCurrentStableKeys: ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence"],
    reason: "Cadência encerrada sem retorno.",
  },
  DISCARDED: {
    targetStableKey: "active-prospecting.discarded",
    allowedCurrentStableKeys: ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence", "active-prospecting.conversation-started"],
    reason: "Lead descartado durante a prospecção.",
  },
});

export async function syncActiveProspectingStageInTransaction(
  transaction: Prisma.TransactionClient,
  context: Readonly<{ workspaceId: string; actorId: string }>,
  input: Readonly<{
    leadId: string;
    outcome: ActiveProspectingStageOutcome;
    occurredAt: Date;
    reason?: string;
  }>,
) {
  const rule = stageRules[input.outcome];
  const lead = await transaction.lead.findFirst({
    where: { id: input.leadId, workspaceId: context.workspaceId, deletedAt: null },
    select: {
      currentStageId: true,
      currentStage: { select: { stableKey: true } },
      pipeline: { select: { id: true, name: true } },
    },
  });
  if (!lead || lead.pipeline.name !== activeProspectingPipelineName) {
    return Object.freeze({ synced: false as const, reason: "OUTSIDE_ACTIVE_PROSPECTING" as const });
  }
  if (lead.currentStage.stableKey === rule.targetStableKey) {
    return Object.freeze({ synced: false as const, reason: "ALREADY_IN_TARGET_STAGE" as const });
  }
  if (!lead.currentStage.stableKey || !rule.allowedCurrentStableKeys.includes(lead.currentStage.stableKey)) {
    return Object.freeze({ synced: false as const, reason: "LATER_OR_INCOMPATIBLE_STAGE" as const });
  }
  const target = await transaction.pipelineStage.findFirst({
    where: {
      workspaceId: context.workspaceId,
      pipelineId: lead.pipeline.id,
      stableKey: rule.targetStableKey,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!target) {
    throw new ApplicationError(`Etapa ${rule.targetStableKey} ausente na Prospecção Ativa.`, {
      code: "PROSPECTING_STAGE_NOT_FOUND",
      statusCode: 503,
      expose: true,
    });
  }
  const transition = await transitionLeadStageInTransaction(transaction, context, {
    leadId: input.leadId,
    targetStageId: target.id,
    reason: input.reason ?? rule.reason,
    origin: "AUTOMATION",
    managerCorrection: false,
    confirmed: true,
  }, input.occurredAt);
  return Object.freeze({ synced: true as const, transition });
}
