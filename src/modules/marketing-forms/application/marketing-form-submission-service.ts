import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { META_CONVERSION_EVENT_TYPE, META_CONVERSION_PURPOSE_CODE } from "@/modules/conversion-feedback/domain/conversion-feedback-contracts";
import { buildMinimizedMetaConversion, metaConversionDeduplicationKey, metaConversionEventId } from "@/modules/conversion-feedback/domain/meta-conversion-policy";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";
import { getLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { marketingFormDefinitionSchema, marketingFormSlugSchema, type MarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { publicFormEventSchema, publicFormSubmitSchema } from "@/modules/marketing-forms/domain/public-form-contracts";
import { mapAnswersToLead, validatePublicFormAnswers } from "@/modules/marketing-forms/domain/public-form-validation";
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

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function referrerHost(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().slice(0, 253); } catch { return null; }
}

function whatsappUrl(phone: string, message?: string): string {
  const url = new URL(`https://wa.me/${phone.replace(/\D/g, "")}`);
  if (message) url.searchParams.set("text", message);
  return url.toString();
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
    return { kind: "WHATSAPP", url: whatsappUrl(target.phone, redirects.whatsapp?.message), rotationTargetKey: target.stableKey, rotationAppliedAt: appliedAt } as const;
  }
  if (redirects.whatsapp) {
    return { kind: "WHATSAPP", url: whatsappUrl(redirects.whatsapp.phone, redirects.whatsapp.message), rotationTargetKey: null, rotationAppliedAt: null } as const;
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

async function queueMetaConversionForReceipt(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    form: ResolvedForm;
    receiptId: string;
    receiptPublicId: string;
    actorId: string;
    now: Date;
    allowServerSide: boolean;
  }>,
): Promise<string | null> {
  const tracking = input.form.definition.tracking.meta;
  if (!tracking?.enabled || !tracking.pixelId) return null;
  const submission = await tx.leadFormSubmission.findFirst({
    where: { workspaceId: input.form.workspaceId, marketingFormReceiptId: input.receiptId },
    select: { attributionConversionId: true, contactId: true },
  });
  if (!submission?.attributionConversionId || !submission.contactId) return null;
  const semanticKey = metaConversionDeduplicationKey({ workspaceId: input.form.workspaceId, conversionId: submission.attributionConversionId, eventName: "Lead" });
  const browserEventId = metaConversionEventId({ workspaceId: input.form.workspaceId, conversionId: submission.attributionConversionId, eventName: "Lead" });
  if (!input.allowServerSide || !tracking.connectionId || !tracking.secretReferenceKey) return browserEventId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${semanticKey}, 0))`;
  const existing = await tx.outboxEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: input.form.workspaceId, idempotencyKey: semanticKey } }, select: { payload: true } });
  if (existing?.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload) && typeof existing.payload.eventId === "string") return existing.payload.eventId;

  const [connection, conversion, purpose, points] = await Promise.all([
    tx.integrationConnection.findFirst({ where: {
      id: tracking.connectionId,
      workspaceId: input.form.workspaceId,
      providerKey: "META_ADS",
      enabled: true,
      disabledAt: null,
      status: "CONNECTED",
      capabilityLevel: "CONNECTED",
      capabilities: { some: { capability: "SYNC_PUSH", enabled: true } },
      secrets: { some: { referenceKey: tracking.secretReferenceKey, present: true, disabledAt: null } },
    }, select: { id: true } }),
    tx.attributionConversion.findFirst({ where: { id: submission.attributionConversionId, workspaceId: input.form.workspaceId, status: "ACTIVE", contactId: submission.contactId, leadId: { not: null } } }),
    tx.processingPurpose.findFirst({
      where: { workspaceId: input.form.workspaceId, code: META_CONVERSION_PURPOSE_CODE, active: true },
      select: {
        id: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            validFrom: true,
            validTo: true,
            allowedChannels: true,
            legalBasis: { select: { status: true, validFrom: true, validTo: true } },
          },
        },
      },
    }),
    tx.contactPoint.findMany({
      where: { workspaceId: input.form.workspaceId, contactId: submission.contactId, deletedAt: null, doNotContact: false, type: { in: ["EMAIL", "PHONE"] } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  const purposeVersion = purpose?.versions[0] ?? null;
  if (!connection || !conversion || !purpose || !purposeVersion || purposeVersion.status !== "ACTIVE" || purposeVersion.legalBasis?.status !== "ACTIVE" || !purposeVersion.allowedChannels.includes("OTHER")) return browserEventId;
  if ((purposeVersion.validFrom && purposeVersion.validFrom > input.now) || (purposeVersion.validTo && purposeVersion.validTo <= input.now) || (purposeVersion.legalBasis.validFrom && purposeVersion.legalBasis.validFrom > input.now) || (purposeVersion.legalBasis.validTo && purposeVersion.legalBasis.validTo <= input.now)) return browserEventId;
  const consent = await tx.consentState.findFirst({ where: { workspaceId: input.form.workspaceId, contactId: submission.contactId, purposeId: purpose.id, channel: "OTHER", state: "GRANTED", effectiveFrom: { lte: input.now } }, orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }] });
  if (!consent) return browserEventId;
  const emails = points.filter((point) => point.type === "EMAIL").map((point) => point.normalizedValue);
  const phones = points.filter((point) => point.type === "PHONE").map((point) => point.normalizedValue);
  if (emails.length + phones.length === 0) return browserEventId;
  const payload = buildMinimizedMetaConversion({ workspaceId: input.form.workspaceId, conversionId: conversion.id, contactId: submission.contactId, eventName: "Lead", occurredAt: conversion.occurredAt, valueCents: conversion.valueCents, emails, phones, purposeVersionId: purposeVersion.id, consentState: "GRANTED", evaluatedAt: input.now });
  const outbox = await createOutboxEventInTransaction(tx, {
    workspaceId: input.form.workspaceId,
    connectionId: connection.id,
    actorId: input.actorId,
    eventType: META_CONVERSION_EVENT_TYPE,
    aggregateType: "AttributionConversion",
    aggregateId: conversion.id,
    correlationId: input.receiptPublicId,
    causationId: conversion.sourceEventId,
    idempotencyKey: semanticKey,
    payload,
  });
  await tx.privacyDecision.create({ data: { workspaceId: input.form.workspaceId, contactId: submission.contactId, purposeVersionId: purposeVersion.id, channel: "OTHER", intendedAction: "META_CONVERSION_SIGNAL", outcome: "ALLOW", mode: "ENFORCED", legalBasisStatus: "ACTIVE", consentState: "GRANTED", reasonCodes: ["ACTIVE_PURPOSE", "ACTIVE_LEGAL_BASIS", "EXPLICIT_CONSENT_GRANTED"], missingEvidence: [], ruleVersion: "marketing-form-meta-v1", actorId: input.actorId, correlationId: input.receiptPublicId } });
  await tx.auditLog.create({ data: { workspaceId: input.form.workspaceId, actorId: input.actorId, action: "marketing.form.meta_conversion.queued", entityType: "OutboxEvent", entityId: outbox.id, changes: { receiptId: input.receiptId, conversionId: conversion.id, eventId: payload.eventId, rawIdentityPersisted: false } } });
  return payload.eventId;
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

  async function submit(rawSlug: string, raw: unknown) {
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

    const transactionResult = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form-submit:${form.workspaceId}:${form.versionId}:${idempotencyHash}`}, 0))`;
      const active = await tx.marketingForm.findFirst({ where: { id: form.id, workspaceId: form.workspaceId, status: "ACTIVE", archivedAt: null, deletedAt: null, publishedVersionId: form.versionId }, select: { id: true } });
      if (!active) fail("A versão publicada mudou. Recarregue o formulário.", "MARKETING_FORM_VERSION_STALE", 409);
      const actor = await tx.actor.findFirst({ where: { workspaceId: form.workspaceId, type: "SYSTEM", key: "system", userId: null }, select: { id: true, key: true, type: true } });
      if (!actor || actor.type !== "SYSTEM") fail("Formulário indisponível.", "MARKETING_FORM_SYSTEM_ACTOR_MISSING", 503);

      const prior = await tx.marketingFormReceipt.findUnique({
        where: { workspaceId_marketingFormVersionId_idempotencyHash: { workspaceId: form.workspaceId, marketingFormVersionId: form.versionId, idempotencyHash } },
        select: { id: true, publicId: true, status: true, answers: true, redirectKind: true, redirectUrl: true },
      });
      if (prior && canonicalJson(prior.answers) !== canonicalJson(answers)) {
        fail("A chave de reenvio pertence a outra resposta.", "MARKETING_FORM_IDEMPOTENCY_CONFLICT", 409);
      }
      if (prior?.status === "ACCEPTED") return { ok: true as const, receiptId: prior.id, actorId: actor.id, result: publicResult(prior) };

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
      }, { workspaceId: form.workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key }, tx);

      if (intake.outcome === "REJECTED") {
        await tx.marketingFormReceipt.update({ where: { id: receipt.id }, data: { status: "FAILED", safeErrorCode: intake.code } });
        return { ok: false as const, code: intake.code };
      }

      const session = await tx.marketingSession.findUnique({ where: { workspaceId_publicId: { workspaceId: form.workspaceId, publicId: input.sessionPublicId } }, select: { id: true } });
      await tx.leadFormSubmission.update({
        where: { id: intake.submissionId },
        data: { marketingFormReceiptId: receipt.id, marketingFormId: form.id, marketingFormVersionId: form.versionId, marketingSessionId: session?.id ?? null },
      });
      if (form.definition.destination.tagIds.length) {
        const existing = await tx.leadTag.findMany({ where: { workspaceId: form.workspaceId, leadId: intake.leadId, tagId: { in: form.definition.destination.tagIds }, removedAt: null }, select: { tagId: true } });
        const existingIds = new Set(existing.map((row) => row.tagId));
        await tx.leadTag.createMany({ data: form.definition.destination.tagIds.filter((tagId) => !existingIds.has(tagId)).map((tagId) => ({ workspaceId: form.workspaceId, leadId: intake.leadId, tagId, createdByActorId: actor.id })) });
      }
      const redirect = await chooseRedirect(tx, form);
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
      return { ok: true as const, receiptId: receipt.id, actorId: actor.id, result: publicResult(accepted) };
    }, { isolationLevel: "Serializable" });

    if (!transactionResult.ok) fail("Não foi possível processar esta resposta.", "MARKETING_FORM_INTAKE_REJECTED", 422);
    let metaEventId: string | null = null;
    try {
      metaEventId = await options.database.$transaction((tx) => queueMetaConversionForReceipt(tx, { form, receiptId: transactionResult.receiptId, receiptPublicId: transactionResult.result.receiptPublicId, actorId: transactionResult.actorId, now, allowServerSide: mapped.contactPreference === true }));
    } catch {
      // O provider é best-effort e nunca altera um receipt já aceito.
    }
    return metaEventId ? { ...transactionResult.result, providerEventIds: { meta: metaEventId } } : transactionResult.result;
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
    }
    return options.database.$transaction(async (tx) => {
      const actor = await tx.actor.findFirst({ where: { workspaceId: form.workspaceId, type: "SYSTEM", key: "system", userId: null }, select: { id: true } });
      if (!actor) fail("Formulário indisponível.", "MARKETING_FORM_SYSTEM_ACTOR_MISSING", 503);
      const earliest = input.events.reduce((value, event) => event.occurredAt < value ? event.occurredAt : value, input.events[0]!.occurredAt);
      const session = await tx.marketingSession.upsert({
        where: { workspaceId_publicId: { workspaceId: form.workspaceId, publicId: input.sessionPublicId } },
        create: { workspaceId: form.workspaceId, publicId: input.sessionPublicId, identityState: "ANONYMOUS", startedAt: new Date(earliest), lastSeenAt: now },
        update: { lastSeenAt: now },
      });
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
      return { accepted: result.count };
    });
  }

  return Object.freeze({ submit, recordEvents });
}

let service: ReturnType<typeof createMarketingFormSubmissionService> | undefined;
export function getMarketingFormSubmissionService() {
  service ??= createMarketingFormSubmissionService({ database: getDatabaseClient(), now: () => new Date(), leadIntake: getLeadIntakeService() });
  return service;
}
