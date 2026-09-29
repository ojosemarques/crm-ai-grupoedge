import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { assertExactCreditTotal, ATTRIBUTION_POLICY_VERSION, calculateAttributionCredits } from "@/modules/marketing/domain/attribution-policy";
import { acquisitionQuerySchema, attributionModelVersionInputSchema, attributionRunInputSchema, landingPageDefinitionSchema, marketingBackfillInputSchema, marketingEvidenceInputSchema, marketingFormDefinitionSchema, type MarketingEvidenceInput } from "@/modules/marketing/domain/marketing-contracts";
import { normalizeMarketingEvidence } from "@/modules/marketing/domain/marketing-normalization";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;
const RULE_VERSION = "crm38-backfill-v1";

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: "MarketingAttribution", resourceId: context.workspaceId };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function ensureAttributionModelsInTransaction(tx: Tx, workspaceId: string, actorId: string) {
  const definitions = [
    { key: "first-touch", name: "Primeiro toque", algorithm: "FIRST_TOUCH" as const },
    { key: "last-touch", name: "Último toque", algorithm: "LAST_TOUCH" as const },
    { key: "linear", name: "Linear", algorithm: "LINEAR" as const },
  ];
  for (const definition of definitions) {
    const model = await tx.attributionModel.upsert({
      where: { workspaceId_key: { workspaceId, key: definition.key } },
      create: { workspaceId, key: definition.key, name: definition.name, status: "ACTIVE", createdByActorId: actorId, updatedByActorId: actorId },
      update: {},
    });
    const config = { policyVersion: ATTRIBUTION_POLICY_VERSION, algorithm: definition.algorithm, unknownBucket: true };
    if (!await tx.attributionModelVersion.findUnique({ where: { workspaceId_attributionModelId_version: { workspaceId, attributionModelId: model.id, version: 1 } }, select: { id: true } })) {
      await tx.attributionModelVersion.create({ data: { workspaceId, attributionModelId: model.id, version: 1, algorithm: definition.algorithm, lookbackDays: 90, schemaVersion: "1.0", config, configHash: hash(config), createdByActorId: actorId } });
    }
  }
  const category = await tx.dataCategory.findFirst({ where: { workspaceId, code: "MARKETING_ATTRIBUTION", version: 1 }, select: { id: true } });
  const basis = await tx.legalBasis.upsert({
    where: { workspaceId_code_version: { workspaceId, code: "marketing-attribution-pending", version: 1 } },
    create: { workspaceId, code: "marketing-attribution-pending", version: 1, basisType: "UNDETERMINED", name: "Atribuição de marketing pendente", description: "Base técnica sem autorização jurídica; mantém a finalidade em revisão.", status: "PENDING_LEGAL", createdByActorId: actorId },
    update: {},
  });
  const purpose = await tx.processingPurpose.upsert({
    where: { workspaceId_code: { workspaceId, code: "marketing-attribution-analytics" } },
    create: { workspaceId, code: "marketing-attribution-analytics", name: "Mensuração e atribuição de marketing", description: "Mensuração interna de jornada; não autoriza mídia, contato ou egress externo.", createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  const purposeVersion = await tx.purposeVersion.upsert({
    where: { workspaceId_purposeId_version: { workspaceId, purposeId: purpose.id, version: 1 } },
    create: { workspaceId, purposeId: purpose.id, legalBasisId: basis.id, version: 1, description: purpose.description, audience: "Visitantes e leads do workspace", allowedChannels: ["OTHER"], noticeText: "Finalidade em revisão jurídica; captura elegível permanece bloqueada.", noticeVersion: "crm38-pending-v1", status: "PENDING_LEGAL", materiallyChanged: true, createdByActorId: actorId },
    update: {},
  });
  if (category) await tx.purposeDataCategory.createMany({ data: [{ workspaceId, purposeVersionId: purposeVersion.id, dataCategoryId: category.id }], skipDuplicates: true });
  const page = await tx.landingPage.upsert({
    where: { workspaceId_key: { workspaceId, key: "politizai-principal" } },
    create: { workspaceId, key: "politizai-principal", name: "Landing principal Politizai", canonicalUrl: "https://example.invalid/politizai", status: "DRAFT", createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  if (!await tx.landingPageVersion.findUnique({ where: { workspaceId_landingPageId_version: { workspaceId, landingPageId: page.id, version: 1 } }, select: { id: true } })) {
    await tx.landingPageVersion.create({ data: { workspaceId, landingPageId: page.id, version: 1, canonicalUrl: page.canonicalUrl, title: "Definição local sem publicação", schemaVersion: "1.0", definition: { externalPublishing: false }, createdByActorId: actorId } });
  }
  const form = await tx.marketingForm.upsert({
    where: { workspaceId_key: { workspaceId, key: "captacao-principal" } },
    create: { workspaceId, key: "captacao-principal", name: "Formulário principal de captação", status: "DRAFT", createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  if (!await tx.marketingFormVersion.findUnique({ where: { workspaceId_marketingFormId_version: { workspaceId, marketingFormId: form.id, version: 1 } }, select: { id: true } })) {
    await tx.marketingFormVersion.create({ data: { workspaceId, marketingFormId: form.id, landingPageId: page.id, version: 1, schemaVersion: "1.0", definition: { fields: ["fullName", "phone", "email"], externalPublishing: false }, createdByActorId: actorId } });
  }
}

async function marketingPrivacyDecision(tx: Tx, input: { workspaceId: string; actorId: string; contactId: string | null }) {
  const purpose = await tx.processingPurpose.findFirst({
    where: { workspaceId: input.workspaceId, code: "marketing-attribution-analytics", active: true },
    select: { versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, status: true, legalBasis: { select: { status: true } } } } },
  });
  const version = purpose?.versions[0] ?? null;
  const outcome = version?.status === "ACTIVE" && version.legalBasis?.status === "ACTIVE" ? "ALLOW" as const : "REVIEW_REQUIRED" as const;
  if (input.contactId) {
    await tx.privacyDecision.create({
      data: {
        workspaceId: input.workspaceId, contactId: input.contactId, purposeVersionId: version?.id ?? null,
        channel: "OTHER", intendedAction: "MARKETING_ATTRIBUTION_CAPTURE", outcome, mode: "SHADOW_LOCAL",
        legalBasisStatus: version?.legalBasis?.status ?? null, consentState: "UNKNOWN",
        reasonCodes: outcome === "ALLOW" ? ["PURPOSE_AND_LEGAL_BASIS_ACTIVE"] : ["MARKETING_PURPOSE_PENDING_LEGAL"],
        missingEvidence: outcome === "ALLOW" ? [] : ["approved_marketing_purpose"],
        ruleVersion: "crm38-marketing-privacy-v1", actorId: input.actorId,
      },
    });
  }
  return outcome;
}

export async function recordLeadIntakeAttributionInTransaction(tx: Tx, input: Readonly<{
  workspaceId: string; actorId: string; leadId: string; contactId: string | null; submissionId: string;
  sourceId: string; campaignId: string | null; creativeId: string | null; occurredAt: Date;
  correlationId: string; acquisition?: MarketingEvidenceInput;
}>) {
  const conversion = await tx.attributionConversion.upsert({
    where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: `lead-intake:${input.submissionId}:conversion` } },
    create: {
      workspaceId: input.workspaceId, kind: "LEAD_RECEIVED", contactId: input.contactId, leadId: input.leadId,
      submissionId: input.submissionId, occurredAt: input.occurredAt, sourceEventType: "LeadFormSubmission",
      sourceEventId: input.submissionId, idempotencyKey: `lead-intake:${input.submissionId}:conversion`,
      evidenceClass: "DIRECT", evidence: { fact: "Submissão vinculada ao lead" }, correlationId: input.correlationId,
      createdByActorId: input.actorId,
    },
    update: {},
  });

  let touchpointId: string | null = null;
  let sessionId: string | null = null;
  let formId: string | null = null;
  let formVersionId: string | null = null;
  if (input.acquisition) {
    const parsed = marketingEvidenceInputSchema.parse(input.acquisition);
    const normalized = normalizeMarketingEvidence(parsed);
    const privacyDecision = await marketingPrivacyDecision(tx, input);
    if (normalized.sessionPublicId) {
      const session = await tx.marketingSession.upsert({
        where: { workspaceId_publicId: { workspaceId: input.workspaceId, publicId: normalized.sessionPublicId } },
        create: { workspaceId: input.workspaceId, publicId: normalized.sessionPublicId, contactId: input.contactId, identityState: input.contactId ? "ASSOCIATED" : "ANONYMOUS", startedAt: input.occurredAt, lastSeenAt: input.occurredAt },
        update: { contactId: input.contactId, identityState: input.contactId ? "ASSOCIATED" : "ANONYMOUS", lastSeenAt: input.occurredAt },
      });
      sessionId = session.id;
    }
    if (normalized.marketingFormKey) {
      const form = await tx.marketingForm.findFirst({ where: { workspaceId: input.workspaceId, key: normalized.marketingFormKey, deletedAt: null } });
      formId = form?.id ?? null;
      if (form && normalized.marketingFormVersion) {
        formVersionId = (await tx.marketingFormVersion.findUnique({ where: { workspaceId_marketingFormId_version: { workspaceId: input.workspaceId, marketingFormId: form.id, version: normalized.marketingFormVersion } }, select: { id: true } }))?.id ?? null;
      }
    }
    const touchpoint = await tx.marketingTouchpoint.upsert({
      where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: `lead-intake:${input.submissionId}:touchpoint` } },
      create: {
        workspaceId: input.workspaceId, sessionId, contactId: input.contactId, leadId: input.leadId, submissionId: input.submissionId,
        marketingFormId: formId, marketingFormVersionId: formVersionId, sourceId: input.sourceId, campaignId: input.campaignId,
        creativeId: input.creativeId, kind: "FORM_SUBMIT", evidenceClass: "DIRECT", occurredAt: input.occurredAt,
        referrerHost: normalized.referrerHost, landingPath: normalized.landingPath, utmSource: normalized.utmSource,
        utmMedium: normalized.utmMedium, utmCampaign: normalized.utmCampaign, utmContent: normalized.utmContent,
        utmTerm: normalized.utmTerm, clickIdType: normalized.clickIdType, clickIdHash: normalized.clickIdHash,
        privacyDecision, attributionEligible: privacyDecision === "ALLOW", idempotencyKey: `lead-intake:${input.submissionId}:touchpoint`,
        evidence: { facts: normalized.facts, missingEvidence: normalized.missingEvidence }, correlationId: input.correlationId,
        createdByActorId: input.actorId,
      }, update: {},
    });
    touchpointId = touchpoint.id;
    if (privacyDecision !== "ALLOW") {
      await tx.acquisitionDataQualityIssue.upsert({
        where: { workspaceId_entityType_entityId_issueCode: { workspaceId: input.workspaceId, entityType: "MarketingTouchpoint", entityId: touchpoint.id, issueCode: "PRIVACY_REVIEW_REQUIRED" } },
        create: { workspaceId: input.workspaceId, entityType: "MarketingTouchpoint", entityId: touchpoint.id, issueCode: "PRIVACY_REVIEW_REQUIRED", severity: "WARNING", evidence: { purpose: "marketing-attribution-analytics", outcome: privacyDecision }, detectedAt: input.occurredAt },
        update: {},
      });
    }
  }
  await tx.leadFormSubmission.update({ where: { id: input.submissionId }, data: { marketingSessionId: sessionId, marketingFormId: formId, marketingFormVersionId: formVersionId, marketingTouchpointId: touchpointId, attributionConversionId: conversion.id } });
  const outbox = await createOutboxEventInTransaction(tx, {
    workspaceId: input.workspaceId, actorId: input.actorId, eventType: "marketing.conversion.recorded",
    aggregateType: "AttributionConversion", aggregateId: conversion.id, correlationId: input.correlationId,
    causationId: input.submissionId, idempotencyKey: `marketing:${conversion.id}:outbox`,
    payload: { conversionId: conversion.id, leadId: input.leadId, kind: "LEAD_RECEIVED", externalEgress: false },
  });
  await tx.outboxEvent.update({
    where: { id: outbox.id },
    data: { status: "DELIVERED_LOCAL", deliveredLocallyAt: input.occurredAt },
  });
  return { conversionId: conversion.id, touchpointId, sessionId, formId, formVersionId };
}

export function createMarketingAttributionService(options: Options) {
  const authorization = getAuthorizationService();
  const authorize = (context: AuthenticatedContext, permission: (typeof PermissionKeys)[keyof typeof PermissionKeys]) =>
    authorization.assertAuthorized(context, permission, resource(context));

  async function getScreen(context: AuthenticatedContext, raw: unknown = {}) {
    await authorize(context, PermissionKeys.MARKETING_JOURNEY_READ);
    const now = options.now();
    const query = acquisitionQuerySchema.parse(raw);
    const periodEnd = query.periodEnd ?? now;
    const periodStart = query.periodStart ?? new Date(periodEnd.getTime() - 30 * 86_400_000);
    const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const acquisition = { ...(query.sourceId ? { sourceId: query.sourceId } : {}), ...(query.campaignId ? { campaignId: query.campaignId } : {}), ...(query.creativeId ? { creativeId: query.creativeId } : {}) };
    const [models, definitions, touchpoints, conversions, lastRuns, issues, openReviewCount, sourceBreakdown, leadSources, permissions] = await Promise.all([
      options.database.attributionModel.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { name: "asc" } }),
      Promise.all([
        options.database.landingPage.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: { name: "asc" } }),
        options.database.marketingForm.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: { name: "asc" } }),
      ]),
      options.database.marketingTouchpoint.count({ where: { workspaceId: context.workspaceId, occurredAt: { gte: periodStart, lt: periodEnd }, ...acquisition, ...(query.evidenceClass ? { evidenceClass: query.evidenceClass } : {}) } }),
      options.database.attributionConversion.count({ where: { workspaceId: context.workspaceId, occurredAt: { gte: periodStart, lt: periodEnd }, status: "ACTIVE" } }),
      options.database.attributionRun.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { startedAt: "desc" }, take: 10 }),
      options.database.acquisitionDataQualityIssue.findMany({ where: { workspaceId: context.workspaceId, ...(query.reviewStatus ? { status: query.reviewStatus } : {}) }, orderBy: [{ status: "asc" }, { detectedAt: "desc" }], take: 50 }),
      options.database.acquisitionDataQualityIssue.count({ where: { workspaceId: context.workspaceId, status: "OPEN" } }),
      options.database.marketingTouchpoint.groupBy({ by: ["sourceId"], where: { workspaceId: context.workspaceId, occurredAt: { gte: periodStart, lt: periodEnd }, ...acquisition }, _count: { _all: true } }),
      options.database.leadSource.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, name: true } }),
      Promise.all([
        authorization.authorize(context, PermissionKeys.MARKETING_ATTRIBUTION_EXECUTE, resource(context)),
        authorization.authorize(context, PermissionKeys.MARKETING_MODELS_MANAGE, resource(context)),
        authorization.authorize(context, PermissionKeys.MARKETING_REVIEWS_MANAGE, resource(context)),
        authorization.authorize(context, PermissionKeys.MARKETING_EVIDENCE_EXPORT, resource(context)),
      ]),
    ]);
    return {
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString(), timeZone: workspace.timeZone },
      summary: { touchpoints, conversions, openReviews: openReviewCount, latestCoverageBps: lastRuns[0]?.coverageBps ?? null },
      models, definitions: { landingPages: definitions[0], forms: definitions[1] }, runs: lastRuns, issues,
      sourceBreakdown: sourceBreakdown.map((row) => ({ ...row, sourceName: leadSources.find((source) => source.id === row.sourceId)?.name ?? "Origem não identificada" })),
      facts: ["Dados persistidos no workspace", "Modelos versionados; nenhuma mídia externa conectada"],
      inferences: [] as string[],
      missingInformation: touchpoints === 0 ? ["touchpoints elegíveis"] : [],
      permissions: { canExecute: permissions[0].allowed, canManageModels: permissions[1].allowed, canReview: permissions[2].allowed, canExportEvidence: permissions[3].allowed },
    };
  }

  async function runAttribution(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MARKETING_ATTRIBUTION_EXECUTE);
    const input = attributionRunInputSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attribution:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const replay = await tx.attributionRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) return { ...replay, idempotentReplay: true };
      const model = await tx.attributionModel.findFirst({ where: { workspaceId: context.workspaceId, key: input.modelKey, status: "ACTIVE" } });
      if (!model) fail("Modelo de atribuição ativo não encontrado.", "ATTRIBUTION_MODEL_NOT_FOUND", 404);
      const version = await tx.attributionModelVersion.findUnique({ where: { workspaceId_attributionModelId_version: { workspaceId: context.workspaceId, attributionModelId: model.id, version: model.currentVersion } } });
      if (!version) fail("Versão vigente do modelo não encontrada.", "ATTRIBUTION_MODEL_VERSION_NOT_FOUND", 409);
      const run = await tx.attributionRun.create({ data: { workspaceId: context.workspaceId, attributionModelId: model.id, modelVersionId: version.id, periodStart: input.periodStart, periodEnd: input.periodEnd, startedAt: options.now(), idempotencyKey: input.idempotencyKey, correlationId: randomUUID(), requestedByActorId: context.actorId } });
      const conversions = await tx.attributionConversion.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", occurredAt: { gte: input.periodStart, lt: input.periodEnd } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
      let attributed = 0; let partial = 0; let unattributed = 0;
      for (const conversion of conversions) {
        const since = new Date(conversion.occurredAt.getTime() - version.lookbackDays * 86_400_000);
        const touches = await tx.marketingTouchpoint.findMany({
          where: { workspaceId: context.workspaceId, occurredAt: { gte: since, lte: conversion.occurredAt }, OR: [
            ...(conversion.contactId ? [{ contactId: conversion.contactId }] : []),
            ...(conversion.leadId ? [{ leadId: conversion.leadId }] : []),
            ...(conversion.submissionId ? [{ submissionId: conversion.submissionId }] : []),
          ] }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        });
        const credits = calculateAttributionCredits(version.algorithm, touches.map((touch) => ({ id: touch.id, occurredAt: touch.occurredAt, eligible: touch.attributionEligible && touch.privacyDecision === "ALLOW", evidenceClass: touch.evidenceClass })));
        assertExactCreditTotal(credits);
        await tx.attributionCredit.createMany({ data: credits.map((credit) => ({ workspaceId: context.workspaceId, attributionRunId: run.id, conversionId: conversion.id, touchpointId: credit.touchpointId, coverageState: credit.coverageState, creditBps: credit.creditBps, reasonCode: credit.reasonCode, explanation: credit.explanation, evidence: { modelVersionId: version.id, algorithm: version.algorithm } })) });
        if (credits[0]!.coverageState === "UNATTRIBUTED") unattributed += 1;
        else if (credits[0]!.coverageState === "PARTIAL") partial += 1;
        else attributed += 1;
      }
      const covered = attributed + partial;
      const coverageBps = conversions.length === 0 ? 0 : Math.floor(covered * 10_000 / conversions.length);
      const status = partial > 0 || unattributed > 0 ? "PARTIAL" as const : "COMPLETED" as const;
      const finished = await tx.attributionRun.update({ where: { id: run.id }, data: { status, finishedAt: options.now(), conversionCount: conversions.length, attributedCount: attributed, partialCount: partial, unattributedCount: unattributed, coverageBps } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.attribution.executed", entityType: "AttributionRun", entityId: run.id, requestId: input.idempotencyKey, changes: { modelKey: input.modelKey, modelVersion: version.version, conversionCount: conversions.length, coverageBps, externalEgress: false } } });
      return { ...finished, idempotentReplay: false };
    }, { isolationLevel: "Serializable" });
  }

  async function backfill(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MARKETING_ATTRIBUTION_EXECUTE);
    const input = marketingBackfillInputSchema.parse(raw);
    const replay = await options.database.marketingBackfillRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
    if (replay) return { ...replay, idempotentReplay: true };
    return options.database.$transaction(async (tx) => {
      const run = await tx.marketingBackfillRun.create({ data: { workspaceId: context.workspaceId, mode: input.mode, status: "RUNNING", ruleVersion: RULE_VERSION, idempotencyKey: input.idempotencyKey, correlationId: randomUUID(), requestedByActorId: context.actorId, startedAt: options.now() } });
      const submissions = await tx.leadFormSubmission.findMany({ where: { workspaceId: context.workspaceId, leadId: { not: null }, contactId: { not: null } }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: input.limit });
      let created = 0; let existing = 0; let skipped = 0; const divergent = 0;
      for (const submission of submissions) {
        const existingConversion = await tx.attributionConversion.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: `legacy:${submission.id}:conversion` } } });
        if (input.mode === "DRY_RUN") {
          await tx.marketingBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, submissionId: submission.id, outcome: existingConversion ? "ALREADY_EXISTS" : "SKIPPED", reasonCode: existingConversion ? "FACT_ALREADY_PRESENT" : "DRY_RUN_WOULD_CREATE", evidence: { sourceId: submission.sourceId, campaignId: submission.campaignId, creativeId: submission.creativeId }, idempotencyKey: `${run.id}:${submission.id}` } });
          if (existingConversion) existing += 1; else skipped += 1;
          continue;
        }
        if (existingConversion || submission.attributionConversionId) {
          await tx.marketingBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, submissionId: submission.id, conversionId: existingConversion?.id ?? submission.attributionConversionId, outcome: "ALREADY_EXISTS", reasonCode: "FACT_ALREADY_PRESENT", idempotencyKey: `${run.id}:${submission.id}` } });
          existing += 1; continue;
        }
        const privacyDecision = await marketingPrivacyDecision(tx, { workspaceId: context.workspaceId, actorId: context.actorId, contactId: submission.contactId });
        const touchpoint = await tx.marketingTouchpoint.create({ data: { workspaceId: context.workspaceId, contactId: submission.contactId, leadId: submission.leadId, submissionId: submission.id, sourceId: submission.sourceId, campaignId: submission.campaignId, creativeId: submission.creativeId, kind: "FORM_SUBMIT", evidenceClass: "LEGACY_REVIEW_REQUIRED", occurredAt: submission.submittedAt, privacyDecision, attributionEligible: false, idempotencyKey: `legacy:${submission.id}:touchpoint`, evidence: { derivation: "LeadFormSubmission relational fields", ruleVersion: RULE_VERSION }, correlationId: run.correlationId, createdByActorId: context.actorId } });
        const conversion = await tx.attributionConversion.create({ data: { workspaceId: context.workspaceId, kind: "LEAD_RECEIVED", contactId: submission.contactId, leadId: submission.leadId, submissionId: submission.id, occurredAt: submission.submittedAt, sourceEventType: "LeadFormSubmission", sourceEventId: submission.id, idempotencyKey: `legacy:${submission.id}:conversion`, evidenceClass: "DIRECT", evidence: { ruleVersion: RULE_VERSION }, correlationId: run.correlationId, createdByActorId: context.actorId } });
        await tx.leadFormSubmission.update({ where: { id: submission.id }, data: { marketingTouchpointId: touchpoint.id, attributionConversionId: conversion.id } });
        await tx.acquisitionDataQualityIssue.upsert({ where: { workspaceId_entityType_entityId_issueCode: { workspaceId: context.workspaceId, entityType: "MarketingTouchpoint", entityId: touchpoint.id, issueCode: "LEGACY_EVIDENCE_REVIEW_REQUIRED" } }, create: { workspaceId: context.workspaceId, entityType: "MarketingTouchpoint", entityId: touchpoint.id, issueCode: "LEGACY_EVIDENCE_REVIEW_REQUIRED", severity: "WARNING", evidence: { ruleVersion: RULE_VERSION, privacyDecision }, detectedAt: options.now() }, update: {} });
        await tx.marketingBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, submissionId: submission.id, touchpointId: touchpoint.id, conversionId: conversion.id, outcome: "CREATED", reasonCode: "LEGACY_FACTS_PROJECTED", evidence: { privacyDecision, attributionEligible: false }, idempotencyKey: `${run.id}:${submission.id}` } });
        created += 1;
      }
      const status = divergent > 0 ? "PARTIAL" as const : "COMPLETED" as const;
      const finished = await tx.marketingBackfillRun.update({ where: { id: run.id }, data: { status, candidateCount: submissions.length, createdCount: created, existingCount: existing, divergentCount: divergent, skippedCount: skipped, finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.mode === "DRY_RUN" ? "marketing.backfill.dry_run" : "marketing.backfill.executed", entityType: "MarketingBackfillRun", entityId: run.id, requestId: input.idempotencyKey, changes: { candidateCount: submissions.length, created, existing, skipped, divergent, ruleVersion: RULE_VERSION } } });
      return { ...finished, idempotentReplay: false };
    }, { isolationLevel: "Serializable" });
  }

  async function resolveIssue(context: AuthenticatedContext, issueId: string, reason: string) {
    await authorize(context, PermissionKeys.MARKETING_REVIEWS_MANAGE);
    return options.database.$transaction(async (tx) => {
      const issue = await tx.acquisitionDataQualityIssue.findFirst({ where: { id: issueId, workspaceId: context.workspaceId } });
      if (!issue) fail("Pendência de atribuição não encontrada.", "ACQUISITION_ISSUE_NOT_FOUND", 404);
      const updated = await tx.acquisitionDataQualityIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedAt: options.now(), resolvedByActorId: context.actorId, resolutionReason: reason } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.issue.resolved", entityType: "AcquisitionDataQualityIssue", entityId: issue.id, reason, changes: { previousStatus: issue.status, status: "RESOLVED" } } });
      return updated;
    });
  }

  async function saveLandingPage(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE);
    const input = landingPageDefinitionSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`landing-page:${context.workspaceId}:${input.key}`}, 0))`;
      const current = await tx.landingPage.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.key } } });
      const version = (current?.currentVersion ?? 0) + 1;
      const page = current
        ? await tx.landingPage.update({ where: { id: current.id }, data: { name: input.name, canonicalUrl: input.canonicalUrl, currentVersion: version, status: "ACTIVE", updatedByActorId: context.actorId } })
        : await tx.landingPage.create({ data: { workspaceId: context.workspaceId, key: input.key, name: input.name, canonicalUrl: input.canonicalUrl, status: "ACTIVE", currentVersion: version, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.landingPageVersion.create({ data: { workspaceId: context.workspaceId, landingPageId: page.id, version, canonicalUrl: input.canonicalUrl, title: input.title ?? null, schemaVersion: "1.0", definition: input.definition, createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.landing_page.versioned", entityType: "LandingPage", entityId: page.id, changes: { version, key: input.key } } });
      return page;
    });
  }

  async function saveMarketingForm(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE);
    const input = marketingFormDefinitionSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      if (input.landingPageId && !await tx.landingPage.findFirst({ where: { id: input.landingPageId, workspaceId: context.workspaceId, deletedAt: null } })) fail("Landing page não encontrada neste workspace.", "LANDING_PAGE_NOT_FOUND", 404);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form:${context.workspaceId}:${input.key}`}, 0))`;
      const current = await tx.marketingForm.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.key } } });
      const version = (current?.currentVersion ?? 0) + 1;
      const form = current
        ? await tx.marketingForm.update({ where: { id: current.id }, data: { name: input.name, currentVersion: version, status: "ACTIVE", updatedByActorId: context.actorId } })
        : await tx.marketingForm.create({ data: { workspaceId: context.workspaceId, key: input.key, name: input.name, status: "ACTIVE", currentVersion: version, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.marketingFormVersion.create({ data: { workspaceId: context.workspaceId, marketingFormId: form.id, landingPageId: input.landingPageId ?? null, version, schemaVersion: "1.0", definition: input.definition, createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.form.versioned", entityType: "MarketingForm", entityId: form.id, changes: { version, key: input.key } } });
      return form;
    });
  }

  async function createModelVersion(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.MARKETING_MODELS_MANAGE);
    const input = attributionModelVersionInputSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const model = await tx.attributionModel.findFirst({ where: { id: input.modelId, workspaceId: context.workspaceId, status: { not: "RETIRED" } } });
      if (!model) fail("Modelo não encontrado neste workspace.", "ATTRIBUTION_MODEL_NOT_FOUND", 404);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attribution-model:${context.workspaceId}:${model.id}`}, 0))`;
      const version = model.currentVersion + 1;
      const config = { policyVersion: ATTRIBUTION_POLICY_VERSION, algorithm: input.algorithm, unknownBucket: true };
      const created = await tx.attributionModelVersion.create({ data: { workspaceId: context.workspaceId, attributionModelId: model.id, version, algorithm: input.algorithm, lookbackDays: input.lookbackDays, schemaVersion: "1.0", config, configHash: hash(config), createdByActorId: context.actorId } });
      await tx.attributionModel.update({ where: { id: model.id }, data: { currentVersion: version, status: "ACTIVE", updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.attribution_model.versioned", entityType: "AttributionModel", entityId: model.id, reason: input.reason, changes: { previousVersion: model.currentVersion, version, algorithm: input.algorithm, lookbackDays: input.lookbackDays } } });
      return created;
    });
  }

  return { getScreen, runAttribution, backfill, resolveIssue, saveLandingPage, saveMarketingForm, createModelVersion };
}

let singleton: ReturnType<typeof createMarketingAttributionService> | null = null;
export function getMarketingAttributionService() {
  singleton ??= createMarketingAttributionService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
