import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  ACCEPTED_MANUAL_RESULTS,
  D1_GATE_STEP_KEYS,
  resolveProspectingManualResultReason,
} from "@/modules/prospecting/domain/prospecting-cadence";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type StopReason = "HUMAN_REPLY" | "MEETING_SCHEDULED" | "REFUSAL" | "DO_NOT_CONTACT" | "BOUNCE" | "AUTO_REPLY" | "D30_NO_RESPONSE";

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

async function moveStage(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    stableKey: string;
    allowedCurrentStableKeys: readonly string[];
    actorId: string;
    occurredAt: Date;
    reason: string;
  }>,
) {
  const lead = await transaction.lead.findFirst({
    where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
    select: { id: true, pipelineId: true, currentStageId: true, currentStage: { select: { stableKey: true } } },
  });
  if (!lead) fail("Lead da cadência não encontrado.", "PROSPECTING_LEAD_NOT_FOUND", 404);
  const stage = await transaction.pipelineStage.findFirst({ where: { workspaceId: input.workspaceId, pipelineId: lead.pipelineId, stableKey: input.stableKey, deletedAt: null }, select: { id: true } });
  if (!stage) fail("Etapa estável da Prospecção Ativa não encontrada.", "PROSPECTING_STAGE_NOT_FOUND", 503);
  if (stage.id === lead.currentStageId) return;
  if (!lead.currentStage.stableKey || !input.allowedCurrentStableKeys.includes(lead.currentStage.stableKey)) return;
  const openHistories = await transaction.stageHistory.findMany({
    where: { workspaceId: input.workspaceId, leadId: lead.id, exitedAt: null },
    select: { enteredAt: true },
  });
  const transitionAt = openHistories.reduce(
    (latest, history) => history.enteredAt >= latest ? new Date(history.enteredAt.getTime() + 1) : latest,
    input.occurredAt,
  );
  await transaction.stageHistory.updateMany({ where: { workspaceId: input.workspaceId, leadId: lead.id, exitedAt: null }, data: { exitedAt: transitionAt, exitedByActorId: input.actorId } });
  await transaction.stageHistory.create({ data: { workspaceId: input.workspaceId, pipelineId: lead.pipelineId, stageId: stage.id, leadId: lead.id, enteredAt: transitionAt, enteredByActorId: input.actorId, transitionOrigin: "AUTOMATION", transitionReason: input.reason } });
  await transaction.lead.update({ where: { id: lead.id }, data: { currentStageId: stage.id, updatedByActorId: input.actorId } });
}

export async function stopColdCadenceInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ workspaceId: string; leadId: string; actorId: string; reason: StopReason; occurredAt: Date; propagateInstitutional?: boolean }>,
) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-cadence:${input.workspaceId}:${input.leadId}`}, 0))`;
  const cadence = await transaction.prospectingCadenceInstance.findUnique({
    where: { workspaceId_leadId: { workspaceId: input.workspaceId, leadId: input.leadId } },
  });
  if (!cadence) return { stopped: false };
  const concurrentReplyWins = cadence.status === "CLOSED_NO_RESPONSE" && input.reason === "HUMAN_REPLY" && input.occurredAt <= cadence.deadlineAt;
  if (["CLOSED_NO_RESPONSE", "DISCARDED", "CANCELLED", "MEETING_SCHEDULED", "CONVERSATION_STARTED"].includes(cadence.status) && !concurrentReplyWins) return { stopped: false };
  if (input.reason === "D30_NO_RESPONSE" && !["ACTIVE", "PENDING_D1"].includes(cadence.status)) return { stopped: false };
  const status = input.reason === "MEETING_SCHEDULED" ? "MEETING_SCHEDULED"
    : input.reason === "D30_NO_RESPONSE" ? "CLOSED_NO_RESPONSE"
      : input.reason === "REFUSAL" || input.reason === "DO_NOT_CONTACT" ? "DISCARDED"
        : input.reason === "AUTO_REPLY" || input.reason === "BOUNCE" ? "PAUSED"
          : "CONVERSATION_STARTED";
  const terminalColdStop = input.reason !== "AUTO_REPLY" && input.reason !== "BOUNCE";
  await transaction.prospectingCadenceInstance.update({ where: { id: cadence.id }, data: { status, stoppedAt: terminalColdStop ? input.occurredAt : null, stopReasonCode: input.reason, revision: { increment: 1 } } });
  await transaction.prospectingCadenceStep.updateMany({
    where: { workspaceId: input.workspaceId, cadenceInstanceId: cadence.id, status: { in: ["BLOCKED", "SCHEDULED", "OPEN", "IN_PROGRESS"] } },
    data: { status: terminalColdStop ? "CANCELLED" : "BLOCKED", cancelledAt: terminalColdStop ? input.occurredAt : null, resultReason: input.reason },
  });
  await transaction.task.updateMany({
    where: { workspaceId: input.workspaceId, leadId: input.leadId, sourceKey: { startsWith: `active-prospecting:${cadence.id}:` }, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
    data: { status: terminalColdStop ? "CANCELLED" : "OPEN", result: input.reason, updatedByActorId: input.actorId },
  });
  await transaction.prospectingEmailJob.updateMany({
    where: { workspaceId: input.workspaceId, cadenceInstanceId: cadence.id, status: { in: ["BLOCKED", "SCHEDULED", "CLAIMED", "FAILED"] } },
    data: { status: terminalColdStop ? "CANCELLED" : "SUPPRESSED", finalizedAt: input.occurredAt, lastErrorCode: input.reason, leaseExpiresAt: null, lastAuthorizedAt: null },
  });
  const stableKey = status === "MEETING_SCHEDULED" ? "active-prospecting.meeting-scheduled"
    : status === "CLOSED_NO_RESPONSE" ? "active-prospecting.closed-no-response"
      : status === "DISCARDED" ? "active-prospecting.discarded"
        : status === "CONVERSATION_STARTED" ? "active-prospecting.conversation-started"
          : null;
  if (stableKey) {
    const allowedCurrentStableKeys = status === "CONVERSATION_STARTED"
      ? ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence"]
      : status === "MEETING_SCHEDULED"
        ? ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence", "active-prospecting.conversation-started"]
        : ["active-prospecting.new-lead", "active-prospecting.initial-outreach", "active-prospecting.active-cadence"];
    await moveStage(transaction, { ...input, stableKey, allowedCurrentStableKeys, reason: `Interrupção da cadência: ${input.reason}.` });
  }
  if (input.reason === "HUMAN_REPLY") {
    await transaction.lead.update({ where: { id: input.leadId }, data: { awaitingHumanResponse: true, lastInboundResponseAt: input.occurredAt, updatedByActorId: input.actorId } });
    const responseTaskSourceKey = `active-prospecting:${cadence.id}:respond-human`;
    const responseTask = await transaction.task.findFirst({
      where: { workspaceId: input.workspaceId, leadId: input.leadId, sourceKey: responseTaskSourceKey, deletedAt: null },
      select: { id: true },
    });
    if (!responseTask) {
      await transaction.task.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: input.leadId,
          assigneeMemberId: cadence.ownerMemberId,
          title: "Responder conversa iniciada",
          description: "O contato respondeu à prospecção ativa. Assuma a conversa antes de qualquer novo envio.",
          kind: "FOLLOW_UP",
          sourceKey: responseTaskSourceKey,
          status: "OPEN",
          priority: "URGENT",
          dueAt: input.occurredAt,
          createdByActorId: input.actorId,
          updatedByActorId: input.actorId,
        },
      });
    }
  }
  if (input.reason === "DO_NOT_CONTACT" || input.reason === "REFUSAL") {
    const lead = await transaction.lead.findUniqueOrThrow({ where: { id: input.leadId }, select: { contactId: true, normalizedEmail: true } });
    await transaction.lead.update({ where: { id: input.leadId }, data: { contactPreference: "DO_NOT_CONTACT", contactPreferenceUpdatedAt: input.occurredAt, updatedByActorId: input.actorId } });
    if (lead.contactId) await transaction.contactPoint.updateMany({ where: { workspaceId: input.workspaceId, contactId: lead.contactId, deletedAt: null }, data: { doNotContact: true, updatedByActorId: input.actorId } });
    if (lead.normalizedEmail) {
      const externalEventId = `cadence:${cadence.id}:${input.reason.toLowerCase()}`;
      const existingSuppression = await transaction.emailSuppression.findFirst({
        where: { workspaceId: input.workspaceId, externalEventId },
        select: { id: true },
      });
      if (!existingSuppression) {
        await transaction.emailSuppression.create({ data: { workspaceId: input.workspaceId, normalizedEmail: lead.normalizedEmail, purposeKey: "active-prospecting", action: "APPLIED", reasonCode: input.reason, source: "PROSPECTING_CADENCE", externalEventId, effectiveAt: input.occurredAt, createdByActorId: input.actorId } });
      }
    }
    if (input.propagateInstitutional !== false) {
      const candidate = await transaction.prospectCandidate.findUnique({
        where: { workspaceId_leadId: { workspaceId: input.workspaceId, leadId: input.leadId } },
        select: { normalizedPhone: true, phoneScope: true, normalizedEmail: true, emailScope: true },
      });
      if (candidate) {
        const institutionalMatches = await transaction.prospectCandidate.findMany({
          where: {
            workspaceId: input.workspaceId,
            leadId: { not: null },
            NOT: { leadId: input.leadId },
            OR: [
              ...(candidate.phoneScope === "OFFICE" && candidate.normalizedPhone ? [{ normalizedPhone: candidate.normalizedPhone, phoneScope: "OFFICE" as const }] : []),
              ...(candidate.emailScope === "OFFICE" && candidate.normalizedEmail ? [{ normalizedEmail: candidate.normalizedEmail, emailScope: "OFFICE" as const }] : []),
            ],
          },
          distinct: ["leadId"],
          select: { leadId: true },
        });
        for (const related of institutionalMatches) {
          if (!related.leadId) continue;
          await stopColdCadenceInTransaction(transaction, {
            workspaceId: input.workspaceId,
            leadId: related.leadId,
            actorId: input.actorId,
            reason: input.reason,
            occurredAt: input.occurredAt,
            propagateInstitutional: false,
          });
        }
      }
    }
  }
  if (input.reason === "BOUNCE") {
    const lead = await transaction.lead.findUniqueOrThrow({ where: { id: input.leadId }, select: { contactId: true, normalizedEmail: true } });
    if (lead.normalizedEmail) {
      const externalEventId = `cadence:${cadence.id}:hard-bounce`;
      const existingSuppression = await transaction.emailSuppression.findFirst({ where: { workspaceId: input.workspaceId, externalEventId }, select: { id: true } });
      if (!existingSuppression) await transaction.emailSuppression.create({ data: { workspaceId: input.workspaceId, normalizedEmail: lead.normalizedEmail, purposeKey: "active-prospecting", action: "APPLIED", reasonCode: "HARD_BOUNCE", source: "PROSPECTING_CADENCE", externalEventId, effectiveAt: input.occurredAt, createdByActorId: input.actorId } });
      if (lead.contactId) await transaction.contactPoint.updateMany({ where: { workspaceId: input.workspaceId, contactId: lead.contactId, type: "EMAIL", normalizedValue: lead.normalizedEmail, deletedAt: null }, data: { verificationStatus: "INVALID", quality: "INVALID", doNotContact: true, updatedByActorId: input.actorId } });
    }
  }
  if (input.reason === "AUTO_REPLY" || input.reason === "BOUNCE") {
    const existing = await transaction.task.findFirst({ where: { workspaceId: input.workspaceId, leadId: input.leadId, sourceKey: `active-prospecting:${cadence.id}:review-${input.reason.toLowerCase()}` }, select: { id: true } });
    if (!existing) await transaction.task.create({ data: { workspaceId: input.workspaceId, leadId: input.leadId, assigneeMemberId: cadence.ownerMemberId, title: input.reason === "BOUNCE" ? "Revisar e-mail inválido" : "Revisar resposta automática", description: "A cadência foi suspensa e exige decisão humana.", kind: "FOLLOW_UP", sourceKey: `active-prospecting:${cadence.id}:review-${input.reason.toLowerCase()}`, status: "OPEN", priority: "HIGH", dueAt: input.occurredAt, createdByActorId: input.actorId, updatedByActorId: input.actorId } });
  }
  return { stopped: true, cadenceId: cadence.id, status };
}

export async function applyProspectingTaskCompletionInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ workspaceId: string; leadId: string; taskId: string; result: string; resultReason?: string; stopReason?: "REFUSAL" | "DO_NOT_CONTACT"; actorId: string; completedAt: Date }>,
) {
  const step = await transaction.prospectingCadenceStep.findUnique({ where: { workspaceId_taskId: { workspaceId: input.workspaceId, taskId: input.taskId } } });
  if (!step) return null;
  const accepted = step.action === "CALL" ? ACCEPTED_MANUAL_RESULTS.CALL
    : step.action === "INSTAGRAM_MESSAGE" ? ACCEPTED_MANUAL_RESULTS.INSTAGRAM_MESSAGE
      : step.action === "INSTAGRAM_FOLLOW" ? ACCEPTED_MANUAL_RESULTS.INSTAGRAM_FOLLOW
        : [];
  const code = input.result.trim().toUpperCase().replaceAll(" ", "_");
  if (!(accepted as readonly string[]).includes(code)) fail("Resultado inválido para o passo da cadência.", "PROSPECTING_MANUAL_RESULT_INVALID", 400);
  const resultReason = resolveProspectingManualResultReason(code, input.resultReason);
  if (input.stopReason && !input.resultReason?.trim()) fail("Informe o motivo da recusa ou pedido de parada.", "PROSPECTING_STOP_REASON_REQUIRED", 400);
  await transaction.prospectingCadenceStep.update({ where: { id: step.id }, data: { status: "COMPLETED", resultCode: code, resultReason, completedAt: input.completedAt } });
  if (input.stopReason) {
    await stopColdCadenceInTransaction(transaction, { workspaceId: input.workspaceId, leadId: input.leadId, actorId: input.actorId, reason: input.stopReason, occurredAt: input.completedAt });
    return { terminal: true as const, nextActionAt: null, nextActionDescription: null };
  }
  if (step.action === "CALL" && code === "CONNECTED") {
    await stopColdCadenceInTransaction(transaction, { workspaceId: input.workspaceId, leadId: input.leadId, actorId: input.actorId, reason: "HUMAN_REPLY", occurredAt: input.completedAt });
    return { terminal: false as const, nextActionAt: input.completedAt, nextActionDescription: "Atender conversa iniciada" };
  }
  const cadence = await transaction.prospectingCadenceInstance.findUniqueOrThrow({ where: { id: step.cadenceInstanceId } });
  if (D1_GATE_STEP_KEYS.includes(step.stepKey as (typeof D1_GATE_STEP_KEYS)[number])) {
    const remaining = await transaction.prospectingCadenceStep.count({ where: { workspaceId: input.workspaceId, cadenceInstanceId: cadence.id, stepKey: { in: [...D1_GATE_STEP_KEYS] }, status: { not: "COMPLETED" } } });
    if (remaining === 0 && cadence.status === "PENDING_D1") {
      await transaction.prospectingCadenceInstance.update({ where: { id: cadence.id }, data: { status: "ACTIVE", d1GateCompletedAt: input.completedAt, revision: { increment: 1 } } });
      await moveStage(transaction, {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        actorId: input.actorId,
        occurredAt: input.completedAt,
        stableKey: "active-prospecting.active-cadence",
        allowedCurrentStableKeys: ["active-prospecting.initial-outreach"],
        reason: "Gate D1 concluído.",
      });
      const settings = await transaction.prospectingSettings.findUnique({ where: { workspaceId: input.workspaceId } });
      if (settings?.emailEgressEnabled && settings.privacyApprovedAt && settings.canaryApprovedAt) {
        const jobs = await transaction.prospectingEmailJob.findMany({ where: { workspaceId: input.workspaceId, cadenceInstanceId: cadence.id, status: "BLOCKED" }, select: { id: true, stepKey: true, scheduledAt: true, expiresAt: true, senderProfileId: true } });
        for (const job of jobs) {
          if (job.expiresAt <= input.completedAt) {
            await transaction.prospectingEmailJob.update({ where: { id: job.id }, data: { status: "EXPIRED", finalizedAt: input.completedAt, lastErrorCode: "D1_GATE_LATE" } });
            await transaction.prospectingCadenceStep.updateMany({ where: { workspaceId: input.workspaceId, emailJobId: job.id }, data: { status: "EXPIRED", resultReason: "D1_GATE_LATE" } });
            continue;
          }
          const template = await transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: input.workspaceId, stepKey: job.stepKey, published: true }, orderBy: { version: "desc" } });
          const sender = job.senderProfileId ? await transaction.emailConnectionProfile.findFirst({ where: { id: job.senderProfileId, workspaceId: input.workspaceId, operatingMode: "EXTERNAL_READY", spfStatus: "VERIFIED_EXTERNAL", dkimStatus: "VERIFIED_EXTERNAL", dmarcStatus: "VERIFIED_EXTERNAL" } }) : null;
          if (template && sender) {
            await transaction.prospectingEmailJob.update({ where: { id: job.id }, data: { templateVersionId: template.id, senderProfileId: sender.id, renderedSubject: template.subjectTemplate, renderedBody: template.bodyTemplate, status: "SCHEDULED" } });
            await transaction.prospectingCadenceStep.updateMany({ where: { workspaceId: input.workspaceId, emailJobId: job.id }, data: { status: "SCHEDULED" } });
          }
        }
      }
    }
  }
  const next = await transaction.prospectingCadenceStep.findFirst({ where: { workspaceId: input.workspaceId, cadenceInstanceId: cadence.id, status: { in: ["BLOCKED", "SCHEDULED", "OPEN", "IN_PROGRESS"] } }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], select: { scheduledAt: true, stepKey: true } });
  return next ? { terminal: false as const, nextActionAt: next.scheduledAt, nextActionDescription: next.stepKey } : null;
}

export function createProspectingCadenceService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function processDue(workerId: string) {
    void workerId;
    const now = options.now();
    const step = await options.database.prospectingCadenceStep.findFirst({ where: { executor: "CRM_WORKER", stepKey: "close-no-response", status: "SCHEDULED", scheduledAt: { lte: now } }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], select: { id: true, workspaceId: true, leadId: true } });
    if (!step) return { status: "IDLE" };
    await options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-close:${step.id}`}, 0))`;
      const current = await transaction.prospectingCadenceStep.findUnique({ where: { id: step.id } });
      if (!current || current.status !== "SCHEDULED") return;
      const actor = await transaction.actor.findFirstOrThrow({ where: { workspaceId: current.workspaceId, type: "SYSTEM", key: "system" }, select: { id: true } });
      const stopped = await stopColdCadenceInTransaction(transaction, { workspaceId: current.workspaceId, leadId: current.leadId, actorId: actor.id, reason: "D30_NO_RESPONSE", occurredAt: now });
      if (stopped.stopped) {
        await transaction.prospectingCadenceStep.update({ where: { id: current.id }, data: { status: "COMPLETED", completedAt: now, resultCode: "CLOSED_NO_RESPONSE" } });
      } else {
        const cadence = await transaction.prospectingCadenceInstance.findUniqueOrThrow({ where: { id: current.cadenceInstanceId } });
        await transaction.prospectingCadenceStep.update({ where: { id: current.id }, data: { status: "CANCELLED", cancelledAt: now, resultReason: `CADENCE_${cadence.status}` } });
      }
    });
    return { status: "PROCESSED" };
  }
  return Object.freeze({ processDue });
}

let singleton: ReturnType<typeof createProspectingCadenceService> | undefined;
export function getProspectingCadenceService() {
  singleton ??= createProspectingCadenceService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
