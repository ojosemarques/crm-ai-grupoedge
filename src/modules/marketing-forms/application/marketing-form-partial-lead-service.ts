import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { deliverTelegramLeadAlertAfterCommit, enqueueTelegramLeadAlertInTransaction } from "@/modules/integrations/application/telegram-lead-alert-service";
import { getLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import { marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

export const PARTIAL_LEAD_JOB_KIND = "MARKETING_FORM_PARTIAL_LEAD_V1";
export const partialLeadKey = (partialId: string) => `marketing-form-partial-lead:${partialId}`;
export const PARTIAL_LEAD_PLACEHOLDER = "Lead de formulário — nome não informado";
type Options = Readonly<{ database: PrismaClient; now: () => Date; leadIntake: ReturnType<typeof getLeadIntakeService> }>;
const payloadSchema = z.object({ kind: z.literal(PARTIAL_LEAD_JOB_KIND), partialId: z.string().uuid() }).strict();

export async function enqueuePartialLeadInTransaction(tx: Prisma.TransactionClient, partialId: string, workspaceId: string, actorId: string, now: Date) {
  const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, slug: "politizai", status: "ACTIVE", deletedAt: null }, select: { id: true } });
  if (!workspace) return false;
  const partial = await tx.marketingFormPartialResponse.findFirst({ where: { id: partialId, workspaceId, completedAt: null, deletedAt: null }, select: { respondentPhone: true, respondentName: true } });
  if (!partial?.respondentPhone || !normalizePhone(partial.respondentPhone).success) return false;
  if (partial.respondentName && partial.respondentName.trim().length >= 2) {
    const submission = await tx.leadFormSubmission.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(partialId) } }, select: { leadId: true } });
    const phone = normalizePhone(partial.respondentPhone);
    if (submission?.leadId && phone.success) await tx.lead.updateMany({ where: { id: submission.leadId, workspaceId, deletedAt: null, fullName: PARTIAL_LEAD_PLACEHOLDER, normalizedPhone: phone.normalizedPhone }, data: { fullName: partial.respondentName.trim(), updatedByActorId: actorId } });
  }
  await tx.job.upsert({
    where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(partialId) } }, update: {},
    create: { workspaceId, type: "NOTIFICATION", idempotencyKey: partialLeadKey(partialId), priority: 100, runAt: now, maxAttempts: 5,
      payload: { kind: PARTIAL_LEAD_JOB_KIND, partialId }, createdByActorId: actorId, updatedByActorId: actorId },
  });
  return true;
}

export function createMarketingFormPartialLeadWorker(options: Options) {
  async function promote(tx: Prisma.TransactionClient, workspaceId: string, partialId: string) {
    const partial = await tx.marketingFormPartialResponse.findFirst({ where: { id: partialId, workspaceId, deletedAt: null } });
    if (!partial || partial.completedAt) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form-partial:${workspaceId}:${partial.marketingFormVersionId}:${partial.sessionPublicId}`}, 0))`;
    const current = await tx.marketingFormPartialResponse.findFirst({ where: { id: partialId, workspaceId, completedAt: null, deletedAt: null } });
    if (!current?.respondentPhone || !normalizePhone(current.respondentPhone).success) return null;
    const [form, version, pipeline, actor] = await Promise.all([
      tx.marketingForm.findFirst({ where: { id: current.marketingFormId, workspaceId, deletedAt: null, archivedAt: null }, select: { key: true } }),
      tx.marketingFormVersion.findFirst({ where: { id: current.marketingFormVersionId, marketingFormId: current.marketingFormId, workspaceId }, select: { definition: true, version: true } }),
      tx.pipeline.findFirst({ where: { workspaceId, name: ADVERTISING_PIPELINE_NAME, entityType: "LEAD", deletedAt: null, workspace: { slug: "politizai", status: "ACTIVE", deletedAt: null } }, select: { id: true, stages: { where: { leadStageCode: "NEW", type: "OPEN", deletedAt: null }, take: 1, select: { id: true } } } }),
      tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM", key: "system", userId: null }, select: { id: true } }),
    ]);
    if (!form) return null;
    if (!version || !pipeline?.stages[0] || !actor) throw new ApplicationError("Destino do formulário indisponível.", { code: "PARTIAL_LEAD_DESTINATION_UNAVAILABLE", statusCode: 503 });
    const previous = await tx.leadFormSubmission.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(current.id) } }, select: { marketingFormId: true, marketingFormVersionId: true, normalizedPhone: true, lead: { select: { id: true, workspaceId: true, pipelineId: true, deletedAt: true } } } });
    if (previous) {
      const phone = normalizePhone(current.respondentPhone);
      if (previous.marketingFormId !== current.marketingFormId || previous.marketingFormVersionId !== current.marketingFormVersionId || !phone.success || previous.normalizedPhone !== phone.normalizedPhone || !previous.lead || previous.lead.workspaceId !== workspaceId || previous.lead.pipelineId !== pipeline.id || previous.lead.deletedAt) throw new ApplicationError("Vínculo parcial divergente.", { code: "PARTIAL_LEAD_LINK_CONFLICT", statusCode: 409 });
      await enqueueTelegramLeadAlertInTransaction(tx, { workspaceId, leadId: previous.lead.id, actorId: actor.id, occurredAt: options.now() });
      return previous.lead.id;
    }
    const definition = marketingFormDefinitionSchema.parse(version.definition);
    const result = await options.leadIntake.intake({
      channel: "FORM", idempotencyKey: partialLeadKey(current.id), formIdentifier: form.key,
      fullName: current.respondentName && current.respondentName.trim().length >= 2 ? current.respondentName.trim() : PARTIAL_LEAD_PLACEHOLDER,
      phone: current.respondentPhone, ...(current.respondentEmail ? { email: current.respondentEmail } : {}),
      sourceKey: definition.destination.sourceKey, pipelineId: pipeline.id, initialStageId: pipeline.stages[0].id, priorityBandCode: definition.destination.priorityBandCode,
      submittedAt: current.firstAnsweredAt, rawPayload: { partialResponseId: current.id, incomplete: true },
      acquisition: { sessionPublicId: current.sessionPublicId, marketingFormKey: form.key, marketingFormVersion: version.version,
        ...(current.utmSource ? { utmSource: current.utmSource } : {}), ...(current.utmMedium ? { utmMedium: current.utmMedium } : {}),
        ...(current.utmCampaign ? { utmCampaign: current.utmCampaign } : {}), ...(current.utmContent ? { utmContent: current.utmContent } : {}), ...(current.utmTerm ? { utmTerm: current.utmTerm } : {}) },
    }, { workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: "system" }, tx);
    if (result.outcome === "REJECTED") throw new ApplicationError("Entrada parcial rejeitada.", { code: result.code, statusCode: 422 });
    const session = await tx.marketingSession.findUnique({ where: { workspaceId_publicId: { workspaceId, publicId: current.sessionPublicId } }, select: { id: true } });
    await tx.leadFormSubmission.update({ where: { id: result.submissionId }, data: { marketingFormId: current.marketingFormId, marketingFormVersionId: current.marketingFormVersionId, marketingSessionId: session?.id ?? null } });
    // A retomada da mesma sessão mantém o card e as datas de chegada originais.
    if (!result.idempotentReplay && result.outcome === "CREATED") {
      await tx.lead.update({ where: { id: result.leadId }, data: { createdAt: current.firstAnsweredAt } });
      await tx.auditLog.create({ data: { workspaceId, actorId: actor.id, action: "marketing.form.partial_lead_created", entityType: "Lead", entityId: result.leadId, changes: { partialResponseId: current.id, submissionId: result.submissionId } } });
    }
    await enqueueTelegramLeadAlertInTransaction(tx, { workspaceId, leadId: result.leadId, actorId: actor.id, occurredAt: options.now() });
    return result.leadId;
  }

  async function processNext(workerId: string, target?: Readonly<{ workspaceId: string; partialId: string }>) {
    const now = options.now();
    const job = await options.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT j.id FROM jobs j JOIN workspaces w ON w.id=j."workspaceId"
        WHERE j.type='NOTIFICATION' AND j.payload->>'kind'=${PARTIAL_LEAD_JOB_KIND}
          AND j.attempts<j."maxAttempts"
          AND w.slug='politizai' AND w.status='ACTIVE' AND w."deletedAt" IS NULL
          ${target ? Prisma.sql`AND j."workspaceId"=${target.workspaceId}::uuid AND j.payload->>'partialId'=${target.partialId}` : Prisma.empty}
          AND ((j.status='PENDING' AND j."runAt"<=${now}) OR (j.status='RUNNING' AND j."lockExpiresAt"<${now}))
        ORDER BY j.priority DESC,j."runAt",j."createdAt" FOR UPDATE OF j SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: { status: "RUNNING", attempts: { increment: 1 }, lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + 60000), lastAttemptAt: now } });
    });
    if (!job) return { status: "IDLE" };
    try {
      const payload = payloadSchema.parse(job.payload);
      const leadId = await options.database.$transaction(async (tx) => {
        const leadId = job.cancelRequestedAt ? null : await promote(tx, job.workspaceId, payload.partialId);
        const status = leadId ? "SUCCEEDED" : "CANCELLED";
        await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status, result: { leadId }, finishedAt: options.now(), ...(leadId ? {} : { cancelledAt: options.now() }), lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null } });
        return leadId;
      }, { timeout: 45000 });
      if (leadId) await deliverTelegramLeadAlertAfterCommit(options.database, job.workspaceId, leadId);
      return { status: leadId ? "SUCCEEDED" : "CANCELLED" };
    } catch (error) {
      const failed = job.attempts >= job.maxAttempts;
      await options.database.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: failed ? "FAILED" : "PENDING", runAt: new Date(options.now().getTime() + 60000), finishedAt: failed ? options.now() : null, errorCode: error instanceof ApplicationError ? error.code : "PARTIAL_LEAD_FAILED", lastError: "Falha ao encaminhar resposta parcial para Anúncios.", lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      return { status: failed ? "FAILED" : "RETRY_PENDING" };
    }
  }
  return { processNext, processPartial: (workspaceId: string, partialId: string) => processNext(`partial-immediate:${partialId}`, { workspaceId, partialId }) };
}
