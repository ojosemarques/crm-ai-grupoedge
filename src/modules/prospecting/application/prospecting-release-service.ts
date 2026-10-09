import { createHash } from "node:crypto";

import { Prisma, type PrismaClient, type TaskKind } from "@/generated/prisma/client";

import { normalizeAccountName } from "@/modules/accounts/application/account-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { reassignLeadInTransaction } from "@/modules/leads/application/lead-assignment-operation";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import {
  D1_GATE_STEP_KEYS,
  PROSPECTING_CADENCE_VERSION,
  scheduleProspectingCadence,
} from "@/modules/prospecting/domain/prospecting-cadence";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { logger } from "@/shared/core/logging/logger";

type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function taskKind(action: "CALL" | "EMAIL" | "INSTAGRAM_MESSAGE" | "INSTAGRAM_FOLLOW" | "CLOSE"): TaskKind {
  if (action === "CALL") return "CALL";
  if (action === "INSTAGRAM_MESSAGE") return "INSTAGRAM_MESSAGE";
  if (action === "INSTAGRAM_FOLLOW") return "INSTAGRAM_FOLLOW";
  if (action === "EMAIL") return "EMAIL";
  return "GENERAL";
}

function actionTitle(stepKey: string): string {
  if (stepKey.startsWith("call-")) return `Ligação nº ${stepKey.slice(-1)}`;
  if (stepKey.startsWith("instagram-message-")) return `Mensagem Instagram nº ${stepKey.slice(-1)}`;
  if (stepKey === "instagram-follow") return "Seguir perfil no Instagram";
  return stepKey;
}

function contactScopeLabel(scope: "POLITICIAN" | "ADVISOR" | "OFFICE"): string {
  if (scope === "POLITICIAN") return "Direto";
  if (scope === "ADVISOR") return "Assessoria";
  return "Gabinete";
}

function normalizeInstagram(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

async function ensureVerifiedContactPoint(transaction: Prisma.TransactionClient, input: Readonly<{
  workspaceId: string;
  contactId: string;
  actorId: string;
  type: "PHONE" | "EMAIL" | "WHATSAPP" | "INSTAGRAM";
  originalValue: string;
  normalizedValue: string;
  label: string;
  doNotContact: boolean;
  verifiedAt: Date;
}>) {
  const existing = await transaction.contactPoint.findFirst({
    where: { workspaceId: input.workspaceId, contactId: input.contactId, type: input.type, normalizedValue: input.normalizedValue, deletedAt: null },
    select: { id: true, label: true },
  });
  if (existing) {
    await transaction.contactPoint.update({ where: { id: existing.id }, data: { label: existing.label ?? input.label, verificationStatus: "VERIFIED", quality: "VALID", ...(input.doNotContact ? { doNotContact: true } : {}), verifiedAt: input.verifiedAt, updatedByActorId: input.actorId } });
    return;
  }
  await transaction.contactPoint.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      type: input.type,
      originalValue: input.originalValue,
      normalizedValue: input.normalizedValue,
      label: input.label,
      isPrimary: false,
      verificationStatus: "VERIFIED",
      quality: "VALID",
      source: "LEAD_INTAKE",
      doNotContact: input.doNotContact,
      verifiedAt: input.verifiedAt,
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
  });
}

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

export function createProspectingReleaseService(options: Options) {
  const intake = createLeadIntakeService({
    database: options.database,
    authorization: getAuthorizationService(),
    now: options.now,
    automationPublisher: getAutomationEngineService(),
  });

  async function processNext(workerId: string) {
    const now = options.now();
    const [due] = await options.database.$queryRaw<Array<{ id: string; attemptCount: number }>>(Prisma.sql`
      SELECT release."id", release."attemptCount"
      FROM "prospect_releases" AS release
      INNER JOIN "workspaces" AS workspace ON workspace."id" = release."workspaceId"
      WHERE release."status" IN ('PLANNED'::"ProspectReleaseStatus", 'CLAIMED'::"ProspectReleaseStatus")
        AND release."plannedDate" <= (${now}::timestamptz AT TIME ZONE workspace."timeZone")::date
        AND (release."leaseExpiresAt" IS NULL OR release."leaseExpiresAt" < ${now})
        AND (release."nextAttemptAt" IS NULL OR release."nextAttemptAt" <= ${now})
      ORDER BY release."plannedDate" ASC, release."id" ASC
      LIMIT 1
    `);
    if (!due) return { processed: false, outcome: "EMPTY" as const };
    try {
      const result = await options.database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospect-release:${due.id}`}, 0))`;
        const release = await transaction.prospectRelease.findUnique({ where: { id: due.id } });
        if (!release || !["PLANNED", "CLAIMED"].includes(release.status)) return null;
        const settings = await transaction.prospectingSettings.findUnique({ where: { workspaceId: release.workspaceId } });
        if (!settings?.releaseEnabled) {
          await transaction.prospectRelease.update({ where: { id: release.id }, data: { status: "DEFERRED", reasonCode: "RELEASE_DISABLED" } });
          return { releaseId: release.id, outcome: "DEFERRED" as const };
        }
        const leaseExpiresAt = new Date(now.getTime() + 120_000);
        await transaction.prospectRelease.update({ where: { id: release.id }, data: { status: "CLAIMED", claimedBy: workerId, claimedAt: now, leaseExpiresAt, attemptCount: { increment: 1 }, nextAttemptAt: null, lastErrorAt: null, reasonCode: null } });
        const candidate = await transaction.prospectCandidate.findFirst({
          where: { id: release.candidateId, workspaceId: release.workspaceId, status: "PLANNED", leadId: null },
        });
        if (!candidate || !release.plannedMemberId) fail("Release sem candidato elegível ou vendedor planejado.", "PROSPECTING_RELEASE_INVALID");
        const primaryPhone = candidate.normalizedPhone
          ?? candidate.normalizedPoliticianPhone
          ?? candidate.normalizedAdvisorPhone
          ?? candidate.normalizedWhatsapp;
        if (!primaryPhone) {
          await transaction.prospectRelease.update({
            where: { id: release.id },
            data: { status: "DEFERRED", reasonCode: "CONTACT_REQUIRED", leaseExpiresAt: null },
          });
          await transaction.prospectCandidate.update({
            where: { id: candidate.id },
            data: { status: "READY", plannedReleaseDate: null, revision: { increment: 1 } },
          });
          return { releaseId: release.id, outcome: "DEFERRED" as const };
        }
        if (candidate.mandateVerifiedAt < new Date(now.getTime() - 30 * 86_400_000)) {
          await transaction.prospectRelease.update({ where: { id: release.id }, data: { status: "DEFERRED", reasonCode: "MANDATE_EVIDENCE_STALE", leaseExpiresAt: null } });
          await transaction.prospectCandidate.update({ where: { id: candidate.id }, data: { status: "REVIEW_REQUIRED", reviewReasonCode: "MANDATE_EVIDENCE_STALE", plannedReleaseDate: null, revision: { increment: 1 } } });
          return { releaseId: release.id, outcome: "DEFERRED" as const };
        }
        const seller = await transaction.prospectingSellerConfig.findFirst({
          where: { workspaceId: release.workspaceId, memberId: release.plannedMemberId, active: true },
          select: { memberId: true, senderProfileId: true },
        });
        const member = seller ? await transaction.workspaceMember.findFirst({
          where: { id: seller.memberId, workspaceId: release.workspaceId, status: "ACTIVE", leadReceivingPausedAt: null, deletedAt: null, user: { status: "ACTIVE", deletedAt: null } },
          select: { id: true },
        }) : null;
        if (!member) {
          await transaction.prospectRelease.update({ where: { id: release.id }, data: { status: "DEFERRED", reasonCode: "SELLER_UNAVAILABLE", leaseExpiresAt: null } });
          await transaction.prospectCandidate.update({ where: { id: candidate.id }, data: { status: "READY", plannedReleaseDate: null, revision: { increment: 1 } } });
          return { releaseId: release.id, outcome: "DEFERRED" as const };
        }
        const actor = await transaction.actor.findFirst({
          where: { workspaceId: release.workspaceId, type: "SYSTEM", key: "system", userId: null },
          select: { id: true, type: true, key: true },
        });
        if (!actor || actor.type === "HUMAN") fail("Ator técnico do release é inválido.", "PROSPECTING_RELEASE_ACTOR_INVALID", 500);
        const pipeline = await transaction.pipeline.findFirst({ where: { workspaceId: release.workspaceId, entityType: "LEAD", name: "Prospecção Ativa", deletedAt: null }, select: { id: true } });
        if (!pipeline) fail("Pipeline Prospecção Ativa não configurado.", "PROSPECTING_PIPELINE_UNAVAILABLE", 503);
        const source = await transaction.leadSource.findFirst({ where: { workspaceId: release.workspaceId, key: "open-dot-political-prospecting", deletedAt: null }, select: { id: true } })
          ?? await transaction.leadSource.create({ data: { workspaceId: release.workspaceId, key: "open-dot-political-prospecting", name: "Open-Dot — Prospecção política", type: "WEBHOOK", createdByActorId: actor.id, updatedByActorId: actor.id }, select: { id: true } });
        void source;
        const primaryPhoneScope = candidate.normalizedPhone
          ? candidate.phoneScope
          : candidate.normalizedPoliticianPhone
            ? "POLITICIAN"
            : candidate.normalizedAdvisorPhone
              ? "ADVISOR"
              : candidate.whatsappScope;
        const primaryEmail = candidate.normalizedEmail
          ?? candidate.normalizedPoliticianEmail
          ?? candidate.normalizedAdvisorEmail;
        const primaryEmailScope = candidate.normalizedEmail
          ? candidate.emailScope
          : candidate.normalizedPoliticianEmail
            ? "POLITICIAN"
            : candidate.normalizedAdvisorEmail
              ? "ADVISOR"
              : null;
        const intakeResult = await intake.intake({
          channel: "OPEN_DOT",
          idempotencyKey: `prospect-release:${candidate.id}`,
          fullName: candidate.politicianName,
          ...(primaryPhone ? { phone: primaryPhone } : {}),
          ...(primaryEmail ? { email: primaryEmail } : {}),
          jobTitle: candidate.role === "MAYOR" ? "Prefeito" : "Vereador",
          organizationName: candidate.role === "MAYOR" ? `Prefeitura de ${candidate.municipalityName}` : `Câmara Municipal de ${candidate.municipalityName}`,
          city: candidate.municipalityName,
          stateCode: candidate.stateCode,
          interestSummary: "Prospecção política institucional validada pelo Open-Dot.",
          sourceKey: "open-dot-political-prospecting",
          pipelineId: pipeline.id,
          submittedAt: now,
          rawPayload: { candidateId: candidate.id, externalIdentityKey: candidate.externalIdentityKey, fingerprint: candidate.fingerprint, instagram: candidate.instagram },
          priorityBandCode: "P3",
        }, {
          workspaceId: release.workspaceId,
          actorId: actor.id,
          actorType: actor.type,
          actorKey: actor.key,
        }, transaction);
        if (intakeResult.outcome === "REJECTED") fail(intakeResult.issues[0]?.message ?? "Intake rejeitou o candidato.", `PROSPECTING_INTAKE_${intakeResult.code}`);
        const lead = await transaction.lead.findUniqueOrThrow({
          where: { id: intakeResult.leadId },
          select: { id: true, ownerMemberId: true, contactId: true, currentStageId: true, contactPreference: true, currentStage: { select: { stableKey: true } } },
        });
        if (lead.ownerMemberId !== member.id) {
          const reassignedAt = options.now();
          await reassignLeadInTransaction(transaction, {
            workspaceId: release.workspaceId,
            actorId: actor.id,
            leadId: lead.id,
            targetMemberId: member.id,
            reason: "Distribuição planejada por capacidade da Prospecção Ativa.",
            type: "REDISTRIBUTION",
            requireGeneralQueueOrigin: false,
            reassignAllOpenTasks: true,
            requireTargetAvailability: true,
            assignedAt: reassignedAt,
          });
        }
        await transaction.task.updateMany({
          where: { workspaceId: release.workspaceId, leadId: lead.id, kind: "IMMEDIATE_CALL", status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
          data: { status: "CANCELLED", result: "Substituída pela cadência política D1.", updatedByActorId: actor.id },
        });
        const accountName = candidate.role === "MAYOR" ? `Prefeitura de ${candidate.municipalityName}` : `Câmara Municipal de ${candidate.municipalityName}`;
        const normalizedName = normalizeAccountName(`${accountName} ${candidate.stateCode}`);
        const account = await transaction.account.findFirst({ where: { workspaceId: release.workspaceId, normalizedName, deletedAt: null }, select: { id: true } })
          ?? await transaction.account.create({ data: { workspaceId: release.workspaceId, name: accountName, normalizedName, segment: "PUBLIC_SECTOR", origin: "IMPORT", quality: "CONFIRMED", createdByActorId: actor.id, updatedByActorId: actor.id }, select: { id: true } });
        if (lead.contactId) {
          const role = await transaction.accountContactRole.findFirst({ where: { workspaceId: release.workspaceId, accountId: account.id, contactId: lead.contactId, validTo: null }, select: { id: true } });
          if (!role) await transaction.accountContactRole.create({ data: { workspaceId: release.workspaceId, accountId: account.id, contactId: lead.contactId, roleType: "OTHER", roleTitle: candidate.role === "MAYOR" ? "Prefeito" : "Vereador", source: "AI_SUGGESTION", evidence: `Candidato ${candidate.id} com mandato verificado.`, validFrom: candidate.mandateVerifiedAt, createdByActorId: actor.id } });
          if (primaryPhone && primaryPhoneScope) await transaction.contactPoint.updateMany({ where: { workspaceId: release.workspaceId, contactId: lead.contactId, type: "PHONE", normalizedValue: primaryPhone, deletedAt: null }, data: { label: contactScopeLabel(primaryPhoneScope), verificationStatus: "VERIFIED", quality: "VALID", verifiedAt: candidate.mandateVerifiedAt, updatedByActorId: actor.id } });
          if (primaryEmail && primaryEmailScope) await transaction.contactPoint.updateMany({ where: { workspaceId: release.workspaceId, contactId: lead.contactId, type: "EMAIL", normalizedValue: primaryEmail, deletedAt: null }, data: { label: contactScopeLabel(primaryEmailScope), verificationStatus: "VERIFIED", quality: "VALID", verifiedAt: candidate.mandateVerifiedAt, updatedByActorId: actor.id } });
          const extraContactPoints = [
            candidate.politicianPhone && candidate.normalizedPoliticianPhone ? { type: "PHONE" as const, originalValue: candidate.politicianPhone, normalizedValue: candidate.normalizedPoliticianPhone, label: "Político · Público" } : null,
            candidate.politicianEmail && candidate.normalizedPoliticianEmail ? { type: "EMAIL" as const, originalValue: candidate.politicianEmail, normalizedValue: candidate.normalizedPoliticianEmail, label: "Político · Público" } : null,
            candidate.advisorPhone && candidate.normalizedAdvisorPhone ? { type: "PHONE" as const, originalValue: candidate.advisorPhone, normalizedValue: candidate.normalizedAdvisorPhone, label: "Assessor" } : null,
            candidate.advisorEmail && candidate.normalizedAdvisorEmail ? { type: "EMAIL" as const, originalValue: candidate.advisorEmail, normalizedValue: candidate.normalizedAdvisorEmail, label: "Assessor" } : null,
            candidate.whatsapp && candidate.normalizedWhatsapp && candidate.whatsappScope ? { type: "PHONE" as const, originalValue: candidate.whatsapp, normalizedValue: candidate.normalizedWhatsapp, label: `WhatsApp · ${contactScopeLabel(candidate.whatsappScope)}` } : null,
            candidate.whatsapp && candidate.normalizedWhatsapp && candidate.whatsappScope ? { type: "WHATSAPP" as const, originalValue: candidate.whatsapp, normalizedValue: candidate.normalizedWhatsapp, label: contactScopeLabel(candidate.whatsappScope) } : null,
            candidate.instagram && candidate.instagramScope ? { type: "INSTAGRAM" as const, originalValue: candidate.instagram, normalizedValue: normalizeInstagram(candidate.instagram), label: contactScopeLabel(candidate.instagramScope) } : null,
          ].filter((point): point is NonNullable<typeof point> => Boolean(point));
          for (const point of extraContactPoints) {
            await ensureVerifiedContactPoint(transaction, { workspaceId: release.workspaceId, contactId: lead.contactId, actorId: actor.id, doNotContact: lead.contactPreference === "DO_NOT_CONTACT", verifiedAt: candidate.mandateVerifiedAt, ...point });
          }
        }
        await transaction.lead.update({ where: { id: lead.id }, data: { accountId: account.id, ownerMemberId: member.id, queueId: null, updatedByActorId: actor.id } });
        const workspace = await transaction.workspace.findUniqueOrThrow({ where: { id: release.workspaceId }, select: { timeZone: true } });
        const d1Date = release.plannedDate.toISOString().slice(0, 10);
        const holidays = new Set((await transaction.prospectingCalendarHoliday.findMany({ where: { workspaceId: release.workspaceId }, select: { localDate: true } })).map((item) => item.localDate.toISOString().slice(0, 10)));
        const schedule = scheduleProspectingCadence({ d1Date, timeZone: workspace.timeZone, holidays });
        const deadlineAt = schedule.find((step) => step.stepKey === "close-no-response")!.scheduledAt;
        const cadence = await transaction.prospectingCadenceInstance.create({ data: { workspaceId: release.workspaceId, leadId: lead.id, candidateId: candidate.id, ownerMemberId: member.id, templateVersion: PROSPECTING_CADENCE_VERSION, d1Date: release.plannedDate, deadlineAt, createdByActorId: actor.id } });
        let firstTask: { id: string; dueAt: Date; title: string } | null = null;
        for (const step of schedule) {
          let taskId: string | null = null;
          let emailJobId: string | null = null;
          const channelAvailable = step.action === "CALL"
            ? Boolean(primaryPhone)
            : step.action === "INSTAGRAM_MESSAGE" || step.action === "INSTAGRAM_FOLLOW"
              ? true
              : step.action === "EMAIL"
                ? Boolean(primaryEmail)
                : true;
          if (step.executor === "SELLER" && channelAvailable) {
            const title = actionTitle(step.stepKey);
            const task = await transaction.task.create({ data: { workspaceId: release.workspaceId, leadId: lead.id, assigneeMemberId: member.id, title, description: `${candidate.politicianName} · ${candidate.role === "MAYOR" ? "Prefeito" : "Vereador"} · ${candidate.municipalityName}/${candidate.stateCode}.`, kind: taskKind(step.action), sourceKey: `active-prospecting:${cadence.id}:${step.stepKey}`, status: "OPEN", priority: "MEDIUM", dueAt: step.scheduledAt, createdByActorId: actor.id, updatedByActorId: actor.id }, select: { id: true, dueAt: true, title: true } });
            taskId = task.id;
            firstTask ??= task;
          } else if (step.executor === "OPEN_DOT" && primaryEmail) {
            const job = await transaction.prospectingEmailJob.create({ data: { workspaceId: release.workspaceId, cadenceInstanceId: cadence.id, leadId: lead.id, stepKey: step.stepKey, recipientEmail: primaryEmail, recipientEmailHash: createHash("sha256").update(primaryEmail).digest("hex"), senderProfileId: seller?.senderProfileId ?? null, status: "BLOCKED", scheduledAt: step.scheduledAt, expiresAt: new Date(step.scheduledAt.getTime() + 24 * 3_600_000), idempotencyKey: `${lead.id}:${cadence.id}:${step.stepKey}:v1`, createdByActorId: actor.id } });
            emailJobId = job.id;
            await recordCommercialMetricFactInTransaction(transaction, {
              workspaceId: release.workspaceId, eventKey: `prospecting-email-job:${job.id}:scheduled:v1`, eventType: "EMAIL_SCHEDULED",
              occurredAt: job.createdAt, sourceEntityType: "ProspectingEmailJob", sourceEntityId: job.id, leadId: lead.id,
              creditedMemberId: member.id, leadOwnerMemberIdAtEvent: member.id, cadenceInstanceId: cadence.id,
              cadenceStepKey: step.stepKey, cadenceDay: step.dayNumber, channel: "EMAIL", direction: "OUTBOUND",
              executionMode: "AUTOMATION", result: job.status,
            });
          }
          const unavailableD1 = !channelAvailable && D1_GATE_STEP_KEYS.includes(step.stepKey as (typeof D1_GATE_STEP_KEYS)[number]);
          await transaction.prospectingCadenceStep.create({ data: { workspaceId: release.workspaceId, cadenceInstanceId: cadence.id, leadId: lead.id, stepKey: step.stepKey, dayOffset: step.dayNumber - 1, executor: step.executor, action: step.action, status: unavailableD1 ? "COMPLETED" : !channelAvailable ? "SUPPRESSED" : step.executor === "OPEN_DOT" ? "BLOCKED" : step.executor === "CRM_WORKER" ? "SCHEDULED" : "OPEN", scheduledAt: step.scheduledAt, taskId, emailJobId, resultCode: unavailableD1 ? "CHANNEL_UNAVAILABLE" : null, resultReason: !channelAvailable ? "CHANNEL_UNAVAILABLE" : null, completedAt: unavailableD1 ? now : null, createdByActorId: actor.id } });
        }
        const initialStage = await transaction.pipelineStage.findFirst({ where: { workspaceId: release.workspaceId, pipelineId: pipeline.id, stableKey: "active-prospecting.initial-outreach", deletedAt: null }, select: { id: true } });
        if (!initialStage || !firstTask) fail("Etapa inicial ou tarefas D1 indisponíveis.", "PROSPECTING_CADENCE_CONFIGURATION_INVALID", 503);
        const openStageHistories = await transaction.stageHistory.findMany({
          where: { workspaceId: release.workspaceId, leadId: lead.id, exitedAt: null },
          select: { enteredAt: true, transitionOrigin: true },
        });
        const transitionAt = openStageHistories.reduce(
          (latest, history) => history.enteredAt >= latest ? new Date(history.enteredAt.getTime() + 1) : latest,
          now,
        );
        const humanStageOrigin = openStageHistories.some((history) => ["PIPELINE_BOARD", "PIPELINE_LIST", "LEAD_CARD"].includes(history.transitionOrigin));
        const mayMaterializeInitialStage = !humanStageOrigin
          && ["active-prospecting.new-lead", "active-prospecting.initial-outreach"].includes(lead.currentStage.stableKey ?? "");
        if (mayMaterializeInitialStage && lead.currentStageId !== initialStage.id) {
          await transaction.stageHistory.updateMany({ where: { workspaceId: release.workspaceId, leadId: lead.id, exitedAt: null }, data: { exitedAt: transitionAt, exitedByActorId: actor.id } });
          await transaction.stageHistory.create({ data: { workspaceId: release.workspaceId, pipelineId: pipeline.id, stageId: initialStage.id, leadId: lead.id, enteredAt: transitionAt, enteredByActorId: actor.id, transitionOrigin: "AUTOMATION", transitionReason: "Cadência política D1 materializada." } });
        }
        await transaction.lead.update({ where: { id: lead.id }, data: { ...(mayMaterializeInitialStage ? { currentStageId: initialStage.id } : {}), nextActionTaskId: firstTask.id, nextActionAt: firstTask.dueAt, nextActionDescription: firstTask.title, updatedByActorId: actor.id } });
        await transaction.prospectCandidate.update({ where: { id: candidate.id }, data: { status: "RELEASED", releasedAt: transitionAt, leadId: lead.id, revision: { increment: 1 } } });
        await transaction.prospectRelease.update({ where: { id: release.id }, data: { status: "RELEASED", leadId: lead.id, releasedAt: transitionAt, leaseExpiresAt: null } });
        await transaction.prospectingResearchBatch.update({ where: { id: candidate.batchId }, data: { releasedCount: { increment: 1 } } });
        return { releaseId: release.id, leadId: lead.id, outcome: "RELEASED" as const };
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
      return result ? { processed: true, ...result } : { processed: false, outcome: "RACE_LOST" as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return { processed: false, outcome: "RACE_LOST" as const };
      }
      logger.error({
        releaseId: due.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
        prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null,
      }, "Falha ao materializar candidato de prospecção em Lead");
      const failedAttemptCount = due.attemptCount + 1;
      const terminal = failedAttemptCount >= 3;
      await options.database.prospectRelease.updateMany({
        where: { id: due.id, status: { in: ["PLANNED", "CLAIMED"] } },
        data: {
          status: terminal ? "FAILED" : "PLANNED",
          attemptCount: failedAttemptCount,
          nextAttemptAt: terminal ? null : new Date(now.getTime() + 60_000 * 2 ** Math.max(0, failedAttemptCount - 1)),
          lastErrorAt: now,
          reasonCode: error instanceof ApplicationError ? error.code : "UNEXPECTED_ERROR",
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
      });
      throw error;
    }
  }

  return Object.freeze({ processNext });
}

let singleton: ReturnType<typeof createProspectingReleaseService> | undefined;
export function getProspectingReleaseService() {
  singleton ??= createProspectingReleaseService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
