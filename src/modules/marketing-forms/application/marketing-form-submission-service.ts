import { assignLeadFormBudgetTag } from "@/modules/leads/application/lead-form-budget-tag";
import { marketingFormBudgetObservation } from "@/modules/marketing-forms/domain/form-budget-response";
import { assignLeadFormCompletionTag } from "@/modules/leads/application/lead-form-completion-tag";
import { tracksMarketingFormCompletion } from "@/modules/marketing-forms/domain/form-completion-status";
import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { queueMetaWebsiteLead, usesWorkspaceMetaWebsiteDataset } from "@/modules/conversion-feedback/application/conversion-feedback-service";
import { metaBrowserMatchKeys, metaConversionEventId } from "@/modules/conversion-feedback/domain/meta-conversion-policy";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";
import { getLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { deliverTelegramReceiptAlertAfterCommit } from "@/modules/integrations/application/telegram-lead-alert-service";
import { createMarketingFormPartialLeadWorker, enqueuePartialLeadInTransaction } from "./marketing-form-partial-lead-service";
import { buildMarketingWhatsAppUrl, marketingFormDefinitionSchema, marketingFormSlugSchema, type MarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { publicFormEventSchema, publicFormSubmitSchema } from "@/modules/marketing-forms/domain/public-form-contracts";
import { mapAnswersToLead, publicFormAnswerError, validatePublicFormAnswers } from "@/modules/marketing-forms/domain/public-form-validation";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = Readonly<{
  database: PrismaClient;
  now: () => Date;
  leadIntake: ReturnType<typeof getLeadIntakeService>;
}>;

type ResolvedForm = Readonly<{
  id: string;
  key: string;
  workspaceId: string;
  versionId: string;
  version: number;
  definition: MarketingFormDefinition;
}>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
type PartialAnswer = Readonly<{ questionKey: string; value: Prisma.JsonValue; answeredAt: string }>;

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function referrerHost(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().slice(0, 253); } catch { return null; }
}

function partialAnswers(value: Prisma.JsonValue): PartialAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.questionKey !== "string" || typeof item.answeredAt !== "string" || !("value" in item) || item.value === undefined) return [];
    return [{ questionKey: item.questionKey, value: item.value, answeredAt: item.answeredAt }];
  });
}

function partialIdentity(definition: MarketingFormDefinition, answers: readonly PartialAnswer[]) {
  const values = new Map(answers.map((answer) => [answer.questionKey, answer.value]));
  const mapped = new Map<string, string>();
  for (const question of definition.questions) {
    const value = values.get(question.stableKey);
    if (!question.mapping || typeof value !== "string") continue;
    const displayValue = (question.type === "SINGLE_CHOICE" || question.type === "DROPDOWN")
      ? question.config.options.find((option) => option.stableKey === value)?.label ?? value
      : value;
    mapped.set(question.mapping, displayValue.trim());
  }
  return {
    respondentName: mapped.get("fullName") || null,
    respondentEmail: mapped.get("email") || null,
    respondentPhone: mapped.get("phone") || null,
  };
}

async function closePartialResponse(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    form: ResolvedForm;
    sessionPublicId: string;
    receiptId: string;
    actorId: string;
    now: Date;
  }>,
) {
  await tx.marketingFormPartialResponse.upsert({
    where: { workspaceId_marketingFormVersionId_sessionPublicId: { workspaceId: input.form.workspaceId, marketingFormVersionId: input.form.versionId, sessionPublicId: input.sessionPublicId } },
    create: {
      workspaceId: input.form.workspaceId,
      marketingFormId: input.form.id,
      marketingFormVersionId: input.form.versionId,
      sessionPublicId: input.sessionPublicId,
      receiptId: input.receiptId,
      answers: [],
      firstAnsweredAt: input.now,
      lastAnsweredAt: input.now,
      completedAt: input.now,
      createdByActorId: input.actorId,
    },
    update: { receiptId: input.receiptId, completedAt: input.now, answers: [], respondentName: null, respondentEmail: null, respondentPhone: null },
  });
}

async function chooseRedirect(
  tx: Prisma.TransactionClient,
  form: ResolvedForm,
) {
  const redirects = form.definition.redirects;
  if (redirects.automaticKind === "GROUP" && redirects.group) {
    return { kind: "GROUP", url: redirects.group.url, rotationTargetKey: null, rotationAppliedAt: null } as const;
  }
  if (redirects.automaticKind === "URL" && redirects.url) {
    return { kind: "URL", url: redirects.url, rotationTargetKey: null, rotationAppliedAt: null } as const;
  }
  if (redirects.automaticKind !== "WHATSAPP") return null;
  if (redirects.rotation) {
    await tx.marketingFormRotationState.upsert({
      where: { workspaceId_marketingFormVersionId: { workspaceId: form.workspaceId, marketingFormVersionId: form.versionId } },
      create: { workspaceId: form.workspaceId, marketingFormId: form.id, marketingFormVersionId: form.versionId },
      update: {},
    });
    const rows = await tx.$queryRaw<Array<{ id: string; nextIndex: number }>>(Prisma.sql`
      SELECT "id", "nextIndex" FROM "marketing_form_rotation_states"
      WHERE "workspaceId" = ${form.workspaceId}::uuid AND "marketingFormVersionId" = ${form.versionId}::uuid
      FOR UPDATE
    `);
    const state = rows[0];
    if (!state) fail("Não foi possível determinar o destino.", "MARKETING_FORM_ROTATION_UNAVAILABLE", 503);
    const target = redirects.rotation.targets[state.nextIndex % redirects.rotation.targets.length];
    if (!target) fail("Não foi possível determinar o destino.", "MARKETING_FORM_ROTATION_UNAVAILABLE", 503);
    const appliedAt = new Date();
    await tx.marketingFormRotationState.update({
      where: { id: state.id },
      data: { nextIndex: (state.nextIndex + 1) % redirects.rotation.targets.length, totalAssignments: { increment: 1 }, revision: { increment: 1 } },
    });
    return { kind: "WHATSAPP", url: buildMarketingWhatsAppUrl(target.phone, redirects.whatsapp?.message), rotationTargetKey: target.stableKey, rotationAppliedAt: appliedAt } as const;
  }
  if (redirects.whatsapp) {
    return { kind: "WHATSAPP", url: buildMarketingWhatsAppUrl(redirects.whatsapp.phone, redirects.whatsapp.message), rotationTargetKey: null, rotationAppliedAt: null } as const;
  }
  return null;
}

function publicResult(receipt: Readonly<{
  publicId: string;
  status: string;
  redirectKind: string | null;
  redirectUrl: string | null;
}>, metaEventId?: string) {
  return {
    receiptPublicId: receipt.publicId,
    outcome: receipt.status,
    redirect: receipt.redirectKind && receipt.redirectUrl
      ? { kind: receipt.redirectKind, url: receipt.redirectUrl }
      : null,
    ...(metaEventId ? { providerEventIds: { meta: metaEventId } } : {}),
  };
}

function browserMetaLeadId(form: ResolvedForm, receiptPublicId: string, attributionConversionId?: string | null) {
  if (!form.definition.tracking.meta?.enabled || !form.definition.tracking.meta.pixelId) return null;
  return attributionConversionId
    ? metaConversionEventId({ workspaceId: form.workspaceId, conversionId: attributionConversionId, eventName: "Lead" })
    : sha256(`meta-browser-lead:${form.workspaceId}:${receiptPublicId}`);
}

export function createMarketingFormSubmissionService(options: Options) {
  async function resolveActive(slug: string, versionPublicId: string): Promise<ResolvedForm> {
    const form = await options.database.marketingForm.findUnique({
      where: { publicSlug: marketingFormSlugSchema.parse(slug) },
      select: { id: true, key: true, workspaceId: true, status: true, archivedAt: true, deletedAt: true, publishedVersionId: true },
    });
    if (!form || form.status !== "ACTIVE" || form.archivedAt || form.deletedAt || !form.publishedVersionId) {
      fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    }
    const version = await options.database.marketingFormVersion.findFirst({
      where: { id: form.publishedVersionId, publicId: versionPublicId, workspaceId: form.workspaceId, marketingFormId: form.id },
      select: { id: true, version: true, definition: true },
    });
    if (!version) fail("A versão publicada mudou. Recarregue o formulário.", "MARKETING_FORM_VERSION_STALE", 409);
    const parsed = marketingFormDefinitionSchema.safeParse(version.definition);
    if (!parsed.success) fail("Formulário indisponível.", "MARKETING_FORM_DEFINITION_INVALID", 503);
    return { id: form.id, key: form.key, workspaceId: form.workspaceId, versionId: version.id, version: version.version, definition: parsed.data };
  }

  async function submit(rawSlug: string, raw: unknown, metaCookies: { fbc?: string | undefined; fbp?: string | undefined; userAgent?: string | undefined } = {}) {
    const input = publicFormSubmitSchema.parse(raw);
    const form = await resolveActive(rawSlug, input.versionPublicId);
    const now = options.now();
    const startedAt = new Date(input.startedAt);
    if (input.honeypot || startedAt.getTime() > now.getTime() + 60_000 || now.getTime() - startedAt.getTime() < 800) {
      fail("Não foi possível aceitar esta resposta.", "MARKETING_FORM_ABUSE_REJECTED", 422);
    }
    const answers = validatePublicFormAnswers(form.definition, input.answers);
    const mapped = mapAnswersToLead(form.definition, answers);
    const idempotencyHash = sha256(`${form.workspaceId}:${form.versionId}:${input.idempotencyToken}`);

    const tracking = form.definition.tracking.meta;
    const configuredConnection = tracking?.connectionId && tracking.secretReferenceKey
      ? { id: tracking.connectionId, secretReferenceKey: tracking.secretReferenceKey }
      : undefined;
    const defaultDataset = tracking?.pixelId && !tracking.connectionId && !tracking.secretReferenceKey
      && tracksMarketingFormCompletion(form.key) && usesWorkspaceMetaWebsiteDataset(form.workspaceId, tracking.pixelId)
      ? tracking.pixelId : undefined;
    async function trackAcceptedLead(tx: Prisma.TransactionClient, submission: { id: string; attributionConversionId: string | null } | null, actorId: string, receiptPublicId: string, occurredAt: Date) {
      const browserEventId = browserMetaLeadId(form, receiptPublicId, submission?.attributionConversionId);
      if (mapped.contactPreference === false) return null;
      if (!submission || !browserEventId || (!configuredConnection && !defaultDataset)) return browserEventId;
      return await queueMetaWebsiteLead(tx, {
        workspaceId: form.workspaceId, submissionId: submission.id, actorId, correlationId: receiptPublicId, now, occurredAt,
        ...(configuredConnection ? { configuredConnection } : {}),
        ...(defaultDataset ? { expectedDatasetId: defaultDataset } : {}),
        ...(defaultDataset && metaCookies.userAgent ? {
          website: { url: `https://crm-ai-grupoedge.vercel.app/f/${rawSlug}`, userAgent: metaCookies.userAgent },
        } : {}),
        browserMatchKeys: metaBrowserMatchKeys({ ...metaCookies, fbclid: input.tracking.clickIds?.fbclid, clickedAt: startedAt }),
      }) ?? browserEventId;
    }

    const transactionResult = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form-partial:${form.workspaceId}:${form.versionId}:${input.sessionPublicId}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form-submit:${form.workspaceId}:${form.versionId}:${idempotencyHash}`}, 0))`;
      const active = await tx.marketingForm.findFirst({ where: { id: form.id, workspaceId: form.workspaceId, status: "ACTIVE", archivedAt: null, deletedAt: null, publishedVersionId: form.versionId }, select: { id: true } });
      if (!active) fail("A versão publicada mudou. Recarregue o formulário.", "MARKETING_FORM_VERSION_STALE", 409);
      const actor = await tx.actor.findFirst({ where: { workspaceId: form.workspaceId, type: "SYSTEM", key: "system", userId: null }, select: { id: true, key: true, type: true } });
      if (!actor || actor.type !== "SYSTEM") fail("Formulário indisponível.", "MARKETING_FORM_SYSTEM_ACTOR_MISSING", 503);

      const prior = await tx.marketingFormReceipt.findUnique({
        where: { workspaceId_marketingFormVersionId_idempotencyHash: { workspaceId: form.workspaceId, marketingFormVersionId: form.versionId, idempotencyHash } },
        select: { id: true, publicId: true, status: true, answers: true, redirectKind: true, redirectUrl: true, acceptedAt: true },
      });
      if (prior && canonicalJson(prior.answers) !== canonicalJson(answers)) {
        fail("A chave de reenvio pertence a outra resposta.", "MARKETING_FORM_IDEMPOTENCY_CONFLICT", 409);
      }
      if (prior?.status === "ACCEPTED") {
        await closePartialResponse(tx, { form, sessionPublicId: input.sessionPublicId, receiptId: prior.id, actorId: actor.id, now });
        const submission = form.definition.tracking.meta?.enabled ? await tx.leadFormSubmission.findFirst({
          where: { workspaceId: form.workspaceId, marketingFormReceiptId: prior.id },
          select: { id: true, attributionConversionId: true },
        }) : null;
        const eventId = await trackAcceptedLead(tx, submission, actor.id, prior.publicId, prior.acceptedAt ?? now);
        return { ok: true as const, receiptId: prior.id, result: publicResult(prior, eventId ?? undefined) };
      }

      const receipt = prior
        ? await tx.marketingFormReceipt.update({ where: { id: prior.id }, data: { status: "PROCESSING", safeErrorCode: null }, select: { id: true, publicId: true } })
        : await tx.marketingFormReceipt.create({
            data: {
              workspaceId: form.workspaceId,
              marketingFormId: form.id,
              marketingFormVersionId: form.versionId,
              idempotencyHash,
              status: "PROCESSING",
              answers: json(answers),
              utmSource: input.tracking.utmSource ?? null,
              utmMedium: input.tracking.utmMedium ?? null,
              utmCampaign: input.tracking.utmCampaign ?? null,
              utmContent: input.tracking.utmContent ?? null,
              utmTerm: input.tracking.utmTerm ?? null,
              referrerHost: referrerHost(input.tracking.referrerUrl),
              startedAt,
              submittedAt: now,
              createdByActorId: actor.id,
            },
            select: { id: true, publicId: true },
          });

      const partial = await tx.marketingFormPartialResponse.findUnique({ where: { workspaceId_marketingFormVersionId_sessionPublicId: { workspaceId: form.workspaceId, marketingFormVersionId: form.versionId, sessionPublicId: input.sessionPublicId } }, select: { id: true, completedAt: true, deletedAt: true } });
      const intake = await options.leadIntake.intake({
        channel: "FORM",
        idempotencyKey: `form:${form.id}:version:${form.versionId}:receipt:${receipt.id}`,
        formIdentifier: form.key,
        fullName: mapped.fullName,
        phone: mapped.phone,
        ...(typeof mapped.email === "string" ? { email: mapped.email } : {}),
        ...(typeof mapped.jobTitle === "string" ? { jobTitle: mapped.jobTitle } : {}),
        ...(typeof mapped.organizationName === "string" ? { organizationName: mapped.organizationName } : {}),
        ...(typeof mapped.city === "string" ? { city: mapped.city } : {}),
        ...(typeof mapped.stateCode === "string" ? { stateCode: mapped.stateCode } : {}),
        ...(typeof mapped.interestSummary === "string" ? { interestSummary: mapped.interestSummary } : {}),
        ...(typeof mapped.budgetCents === "number" ? { budgetCents: Math.trunc(mapped.budgetCents) } : {}),
        ...(typeof mapped.contactPreference === "boolean" ? { consent: mapped.contactPreference } : {}),
        sourceKey: form.definition.destination.sourceKey,
        pipelineId: form.definition.destination.pipelineId,
        initialStageId: form.definition.destination.initialStageId,
        priorityBandCode: form.definition.destination.priorityBandCode,
        submittedAt: now,
        rawPayload: { formAnswers: answers, receiptPublicId: receipt.publicId },
        acquisition: {
          sessionPublicId: input.sessionPublicId,
          marketingFormKey: form.key,
          marketingFormVersion: form.version,
          landingUrl: input.tracking.landingUrl,
          referrerUrl: input.tracking.referrerUrl,
          utmSource: input.tracking.utmSource,
          utmMedium: input.tracking.utmMedium,
          utmCampaign: input.tracking.utmCampaign,
          utmContent: input.tracking.utmContent,
          utmTerm: input.tracking.utmTerm,
          clickIds: input.tracking.clickIds,
        },
      }, { workspaceId: form.workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key }, tx,
        { scheduleTopSendVoice: true, ...(partial && !partial.completedAt && !partial.deletedAt ? { partialResponseId: partial.id } : {}) });

      if (intake.outcome === "REJECTED") {
        await tx.marketingFormReceipt.update({ where: { id: receipt.id }, data: { status: "FAILED", safeErrorCode: intake.code } });
        await closePartialResponse(tx, { form, sessionPublicId: input.sessionPublicId, receiptId: receipt.id, actorId: actor.id, now });
        return { ok: false as const, code: intake.code };
      }

      const session = await tx.marketingSession.findUnique({ where: { workspaceId_publicId: { workspaceId: form.workspaceId, publicId: input.sessionPublicId } }, select: { id: true } });
      const submission = await tx.leadFormSubmission.update({
        where: { id: intake.submissionId },
        select: { id: true, attributionConversionId: true },
        data: { marketingFormReceiptId: receipt.id, marketingFormId: form.id, marketingFormVersionId: form.versionId, marketingSessionId: session?.id ?? null },
      });
      if (form.definition.destination.tagIds.length) {
        const existing = await tx.leadTag.findMany({ where: { workspaceId: form.workspaceId, leadId: intake.leadId, tagId: { in: form.definition.destination.tagIds }, removedAt: null }, select: { tagId: true } });
        const existingIds = new Set(existing.map((row) => row.tagId));
        await tx.leadTag.createMany({ data: form.definition.destination.tagIds.filter((tagId) => !existingIds.has(tagId)).map((tagId) => ({ workspaceId: form.workspaceId, leadId: intake.leadId, tagId, createdByActorId: actor.id })) });
      }
      if (tracksMarketingFormCompletion(form.key)) {
        await assignLeadFormCompletionTag(tx, { workspaceId: form.workspaceId, actorId: actor.id, leadId: intake.leadId, status: "COMPLETED", now });
      }
      const redirect = form.definition.redirects.automaticKind === "AGENDA"
        ? { kind: "AGENDA", url: `/f/agenda/${receipt.publicId}`, rotationTargetKey: null, rotationAppliedAt: null }
        : await chooseRedirect(tx, form);
      const accepted = await tx.marketingFormReceipt.update({
        where: { id: receipt.id },
        data: {
          status: "ACCEPTED",
          sessionId: session?.id ?? null,
          acceptedAt: now,
          redirectKind: redirect?.kind ?? null,
          redirectUrl: redirect?.url ?? null,
          rotationTargetKey: redirect?.rotationTargetKey ?? null,
          rotationAppliedAt: redirect?.rotationAppliedAt ?? null,
        },
        select: { publicId: true, status: true, redirectKind: true, redirectUrl: true },
      });
      await assignLeadFormBudgetTag(tx, {
        workspaceId: form.workspaceId, actorId: actor.id, leadId: intake.leadId,
        observation: marketingFormBudgetObservation(form.definition, answers, now, true),
      });
      await tx.marketingFormEvent.createMany({
        data: ["FORM_SUBMITTED", "FORM_COMPLETED"].map((kind) => ({
          workspaceId: form.workspaceId,
          marketingFormId: form.id,
          marketingFormVersionId: form.versionId,
          sessionId: session?.id ?? null,
          kind: kind as "FORM_SUBMITTED" | "FORM_COMPLETED",
          occurredAt: now,
          idempotencyKey: `receipt:${receipt.id}:${kind}`,
          utmSource: input.tracking.utmSource ?? null,
          utmMedium: input.tracking.utmMedium ?? null,
          utmCampaign: input.tracking.utmCampaign ?? null,
          utmContent: input.tracking.utmContent ?? null,
          utmTerm: input.tracking.utmTerm ?? null,
          referrerHost: referrerHost(input.tracking.referrerUrl),
          createdByActorId: actor.id,
        })),
        skipDuplicates: true,
      });
      await closePartialResponse(tx, { form, sessionPublicId: input.sessionPublicId, receiptId: receipt.id, actorId: actor.id, now });
      const eventId = await trackAcceptedLead(tx, submission, actor.id, accepted.publicId, now);
      return { ok: true as const, receiptId: receipt.id, result: publicResult(accepted, eventId ?? undefined) };
    }, { isolationLevel: "Serializable" });

    if (!transactionResult.ok) fail("Não foi possível processar esta resposta.", "MARKETING_FORM_INTAKE_REJECTED", 422);
    await deliverTelegramReceiptAlertAfterCommit(options.database, form.workspaceId, transactionResult.receiptId);
    return transactionResult.result;
  }

  async function recordEvents(rawSlug: string, raw: unknown) {
    const input = publicFormEventSchema.parse(raw);
    const form = await resolveActive(rawSlug, input.versionPublicId);
    const questions = new Map(form.definition.questions.map((question) => [question.stableKey, question]));
    const now = options.now();
    for (const event of input.events) {
      if (event.occurredAt > new Date(now.getTime() + 60_000).toISOString() || event.occurredAt < new Date(now.getTime() - 24 * 60 * 60_000).toISOString()) {
        fail("Evento fora da janela permitida.", "MARKETING_FORM_EVENT_TIME_INVALID", 422);
      }
      const question = event.questionKey ? questions.get(event.questionKey) : undefined;
      if (event.questionKey && !question) fail("Pergunta inválida.", "MARKETING_FORM_EVENT_QUESTION_INVALID", 422);
      if (event.optionKey) {
        if (!question || !("options" in question.config) || !question.config.options.some((option) => option.stableKey === event.optionKey)) {
          fail("Opção inválida.", "MARKETING_FORM_EVENT_OPTION_INVALID", 422);
        }
      }
      if (event.kind === "QUESTION_ANSWERED" && question) {
        const error = publicFormAnswerError(question, event.answer);
        if (error) fail(error, "MARKETING_FORM_EVENT_ANSWER_INVALID", 422);
      }
    }
    const saved = await options.database.$transaction(async (tx) => {
      let partialId: string | null = null;
      const actor = await tx.actor.findFirst({ where: { workspaceId: form.workspaceId, type: "SYSTEM", key: "system", userId: null }, select: { id: true } });
      if (!actor) fail("Formulário indisponível.", "MARKETING_FORM_SYSTEM_ACTOR_MISSING", 503);
      const answeredEvents = input.events.filter((event) => event.kind === "QUESTION_ANSWERED" && event.questionKey && event.answer !== undefined);
      if (answeredEvents.length) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form-partial:${form.workspaceId}:${form.versionId}:${input.sessionPublicId}`}, 0))`;
      const earliest = input.events.reduce((value, event) => event.occurredAt < value ? event.occurredAt : value, input.events[0]!.occurredAt);
      const session = await tx.marketingSession.upsert({
        where: { workspaceId_publicId: { workspaceId: form.workspaceId, publicId: input.sessionPublicId } },
        create: { workspaceId: form.workspaceId, publicId: input.sessionPublicId, identityState: "ANONYMOUS", startedAt: new Date(earliest), lastSeenAt: now },
        update: { lastSeenAt: now },
      });
      if (answeredEvents.length) {
        const existing = await tx.marketingFormPartialResponse.findUnique({
          where: { workspaceId_marketingFormVersionId_sessionPublicId: { workspaceId: form.workspaceId, marketingFormVersionId: form.versionId, sessionPublicId: input.sessionPublicId } },
        });
        if (!existing?.completedAt && !existing?.deletedAt) {
          const byQuestion = new Map(partialAnswers(existing?.answers ?? []).map((answer) => [answer.questionKey, answer]));
          for (const event of answeredEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))) {
            const current = byQuestion.get(event.questionKey!);
            if (!current || current.answeredAt <= event.occurredAt) {
              byQuestion.set(event.questionKey!, { questionKey: event.questionKey!, value: event.answer as Prisma.JsonValue, answeredAt: event.occurredAt });
            }
          }
          const merged = form.definition.questions.flatMap((question) => byQuestion.get(question.stableKey) ?? []);
          const eventTimes = answeredEvents.map((event) => new Date(event.occurredAt).getTime());
          const firstAnsweredAt = new Date(Math.min(existing?.firstAnsweredAt.getTime() ?? Number.POSITIVE_INFINITY, ...eventTimes));
          const lastAnsweredAt = new Date(Math.max(existing?.lastAnsweredAt.getTime() ?? Number.NEGATIVE_INFINITY, ...eventTimes));
          const identity = partialIdentity(form.definition, merged);
          if (existing) {
            await tx.marketingFormPartialResponse.update({ where: { id: existing.id }, data: { answers: json(merged), ...identity, lastAnsweredAt, utmSource: input.tracking.utmSource ?? existing.utmSource, utmMedium: input.tracking.utmMedium ?? existing.utmMedium, utmCampaign: input.tracking.utmCampaign ?? existing.utmCampaign, utmContent: input.tracking.utmContent ?? existing.utmContent, utmTerm: input.tracking.utmTerm ?? existing.utmTerm, referrerHost: referrerHost(input.tracking.referrerUrl) ?? existing.referrerHost } });
          } else {
            await tx.marketingFormPartialResponse.create({ data: { workspaceId: form.workspaceId, marketingFormId: form.id, marketingFormVersionId: form.versionId, sessionPublicId: input.sessionPublicId, answers: json(merged), ...identity, utmSource: input.tracking.utmSource ?? null, utmMedium: input.tracking.utmMedium ?? null, utmCampaign: input.tracking.utmCampaign ?? null, utmContent: input.tracking.utmContent ?? null, utmTerm: input.tracking.utmTerm ?? null, referrerHost: referrerHost(input.tracking.referrerUrl), firstAnsweredAt, lastAnsweredAt, createdByActorId: actor.id } });
          }
          const stored = await tx.marketingFormPartialResponse.findUniqueOrThrow({ where: { workspaceId_marketingFormVersionId_sessionPublicId: { workspaceId: form.workspaceId, marketingFormVersionId: form.versionId, sessionPublicId: input.sessionPublicId } }, select: { id: true } });
          if (await enqueuePartialLeadInTransaction(tx, stored.id, form.workspaceId, actor.id, now)) partialId = stored.id;
        }
      }
      const result = await tx.marketingFormEvent.createMany({
        data: input.events.map((event) => ({
          workspaceId: form.workspaceId,
          marketingFormId: form.id,
          marketingFormVersionId: form.versionId,
          sessionId: session.id,
          kind: event.kind,
          questionKey: event.questionKey ?? null,
          optionKey: event.optionKey ?? null,
          occurredAt: new Date(event.occurredAt),
          idempotencyKey: `public-form:${form.versionId}:${input.sessionPublicId}:${event.eventId}`,
          utmSource: input.tracking.utmSource ?? null,
          utmMedium: input.tracking.utmMedium ?? null,
          utmCampaign: input.tracking.utmCampaign ?? null,
          utmContent: input.tracking.utmContent ?? null,
          utmTerm: input.tracking.utmTerm ?? null,
          referrerHost: referrerHost(input.tracking.referrerUrl),
          createdByActorId: actor.id,
        })),
        skipDuplicates: true,
      });
      return { accepted: result.count, partialId };
    });
    if (saved.partialId) await createMarketingFormPartialLeadWorker(options).processPartial(form.workspaceId, saved.partialId);
    return { accepted: saved.accepted };
  }

  return Object.freeze({ submit, recordEvents });
}

let service: ReturnType<typeof createMarketingFormSubmissionService> | undefined;
export function getMarketingFormSubmissionService() {
  service ??= createMarketingFormSubmissionService({ database: getDatabaseClient(), now: () => new Date(), leadIntake: getLeadIntakeService() });
  return service;
}
