import type {
  ContactPreference,
  LeadDivergenceField,
  LeadIntakeOutcome,
  PriorityBandCode,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { ensureContactForLeadInTransaction } from "@/modules/contacts/application/contact-identity-service";
import { mayAutomaticallyAttachBySharedPhone } from "@/modules/portability/domain/commercial-identity-policy";
import type {
  InternalAutomationEvent,
  PublicationResult,
} from "@/modules/automations/domain/automation-contracts";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import {
  chooseRoundRobinOwner,
  createInitialLeadOperations,
  type OperationalOwner,
} from "@/modules/leads/application/lead-routing";
import {
  prepareFormProvisionalScore,
  recordScoreInTransaction,
} from "@/modules/qualification/application/lead-scoring-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { recordLegacySignalInTransaction } from "@/modules/privacy/application/privacy-foundation";
import { marketingEvidenceInputSchema } from "@/modules/marketing/domain/marketing-contracts";
import { recordLeadIntakeAttributionInTransaction } from "@/modules/marketing/application/marketing-attribution-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => (value ? value : undefined));

function privacySource(channel: "MANUAL" | "CSV" | "LOCAL_WEBHOOK" | "SIMULATOR" | "FORM" | "LANDING_PAGE" | "AD") {
  if (channel === "CSV") return "IMPORT" as const;
  if (channel === "SIMULATOR") return "SIMULATOR" as const;
  if (channel === "LOCAL_WEBHOOK") return "API" as const;
  return "FORM" as const;
}

const leadIntakeSchema = z
  .object({
    channel: z.enum(["MANUAL", "CSV", "LOCAL_WEBHOOK", "SIMULATOR", "FORM", "LANDING_PAGE", "AD"]),
    idempotencyKey: z.string().trim().min(1).max(160),
    formIdentifier: optionalText(160),
    fullName: z.string().trim().min(2).max(200),
    phone: z.string().trim().min(1).max(80),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(320)
      .optional(),
    jobTitle: optionalText(160),
    organizationName: optionalText(200),
    city: optionalText(120),
    stateCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .optional(),
    interestSummary: optionalText(2_000),
    budgetCents: z.number().int().nonnegative().safe().optional(),
    sourceKey: z.string().trim().min(1).max(120),
    pipelineId: z.string().uuid().optional(),
    campaignExternalRef: optionalText(200),
    creativeExternalRef: optionalText(200),
    consent: z.boolean().optional(),
    doNotContact: z.boolean().optional(),
    submittedAt: z.date().optional(),
    rawPayload: z.record(z.string(), z.json()),
    priorityBandCode: z.enum(["P1", "P2", "P3"]).default("P3"),
    acquisition: marketingEvidenceInputSchema.optional(),
    requestedOffer: z.object({ catalogItemId: z.string().uuid(), version: z.number().int().positive() }).strict().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.creativeExternalRef && !value.campaignExternalRef) {
      context.addIssue({
        code: "custom",
        path: ["creativeExternalRef"],
        message: "O criativo exige uma campanha.",
      });
    }

    if (value.consent === true && value.doNotContact === true) {
      context.addIssue({
        code: "custom",
        path: ["doNotContact"],
        message: "Consentimento e não contatar não podem estar ativos juntos.",
      });
    }
  });

export type LeadIntakeInput = z.input<typeof leadIntakeSchema>;
export type LeadIntakeActorContext = AuthenticatedContext | ServiceActorContext;

export type LeadIntakeIssue = Readonly<{
  field: string;
  message: string;
}>;

export type LeadIntakeRejectedResult = Readonly<{
  outcome: "REJECTED";
  code:
    | "INVALID_PAYLOAD"
    | "INVALID_PHONE"
    | "REFERENCE_NOT_FOUND"
    | "CONFIGURATION_UNAVAILABLE"
    | "IDEMPOTENCY_CONFLICT";
  issues: readonly LeadIntakeIssue[];
}>;

export type LeadIntakeAcceptedResult = Readonly<{
  outcome: "CREATED" | "ATTACHED";
  leadId: string;
  submissionId: string;
  normalizedPhone: string;
  conversionCount: number;
  reviewId: string | null;
  divergenceFields: readonly LeadDivergenceField[];
  priorityBandCode: PriorityBandCode;
  operationalOwner: OperationalOwner;
  slaCycleId: string;
  taskId: string;
  idempotentReplay: boolean;
}>;

export type LeadIntakeResult =
  | LeadIntakeRejectedResult
  | LeadIntakeAcceptedResult;

type AuthorizationPort = Readonly<{
  assertAuthorized: ReturnType<typeof getAuthorizationService>["assertAuthorized"];
}>;

type LeadIntakeServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  automationPublisher?: Readonly<{
    publishInTransaction: (
      transaction: Prisma.TransactionClient,
      event: InternalAutomationEvent,
    ) => Promise<PublicationResult>;
  }>;
  afterSubmissionPersisted?: () => Promise<void>;
  afterInitialOperationsPersisted?: () => Promise<void>;
}>;

type ParsedInput = Omit<z.output<typeof leadIntakeSchema>, "budgetCents"> &
  Readonly<{
    normalizedPhone: string;
    normalizedEmail: string | null;
    budgetCents: bigint | null;
    submittedContactPreference: ContactPreference | null;
    receivedAt: Date;
  }>;

type IntakeReferences = Readonly<{
  source: Readonly<{ id: string }>;
  campaign: Readonly<{ id: string }> | null;
  creative: Readonly<{ id: string }> | null;
  queue: Readonly<{ id: string; teamId: string | null }>;
  pipeline: Readonly<{ id: string }>;
  stage: Readonly<{ id: string }>;
  priorityBand: Readonly<{
    id: string;
    code: PriorityBandCode;
    leadPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    slaPolicy: Readonly<{
      firstResponseMinutes: number;
      healthyMaxSeconds: number;
      attentionMaxSeconds: number;
    }>;
  }>;
}>;

type Divergence = Readonly<{
  field: LeadDivergenceField;
  currentValue: string | null;
  submittedValue: string | null;
}>;

function isHumanContext(
  context: LeadIntakeActorContext,
): context is AuthenticatedContext {
  return "memberId" in context;
}

function rejected(
  code: LeadIntakeRejectedResult["code"],
  field: string,
  message: string,
): LeadIntakeRejectedResult {
  return { outcome: "REJECTED", code, issues: [{ field, message }] };
}

function isRejectedResult(
  value: ParsedInput | IntakeReferences | LeadIntakeRejectedResult,
): value is LeadIntakeRejectedResult {
  return "outcome" in value && value.outcome === "REJECTED";
}

function resolveSubmittedContactPreference(
  consent: boolean | undefined,
  doNotContact: boolean | undefined,
): ContactPreference | null {
  if (doNotContact === true) return "DO_NOT_CONTACT";
  if (consent === true) return "CONSENTED";
  if (consent === false) return "NOT_CONSENTED";
  return null;
}

function parseInput(
  payload: unknown,
  receivedAt: Date,
): ParsedInput | LeadIntakeRejectedResult {
  const parsed = leadIntakeSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      outcome: "REJECTED",
      code: "INVALID_PAYLOAD",
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "payload",
        message: issue.message,
      })),
    };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone.success) {
    return rejected("INVALID_PHONE", "phone", phone.message);
  }

  return {
    ...parsed.data,
    normalizedPhone: phone.normalizedPhone,
    normalizedEmail: parsed.data.email ?? null,
    budgetCents:
      parsed.data.budgetCents === undefined
        ? null
        : BigInt(parsed.data.budgetCents),
    submittedContactPreference: resolveSubmittedContactPreference(
      parsed.data.consent,
      parsed.data.doNotContact,
    ),
    receivedAt,
  };
}

async function validateAutomaticActor(
  database: PrismaClient,
  context: ServiceActorContext,
): Promise<void> {
  const actor = await database.actor.findFirst({
    where: {
      id: context.actorId,
      workspaceId: context.workspaceId,
      type: context.actorType,
      key: context.actorKey,
      userId: null,
    },
    select: { id: true },
  });

  if (!actor) {
    throw new ApplicationError("Ator automático inválido.", {
      code: "INVALID_SERVICE_ACTOR",
      statusCode: 403,
      expose: true,
    });
  }
}

async function ensureGeneralQueue(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
): Promise<Readonly<{ id: string; teamId: string | null }>> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`general-queue:${workspaceId}`}, 0)
    )
  `;

  const activeQueue = await transaction.queue.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [{ isGeneral: true }, { key: "general" }],
    },
    orderBy: [{ isGeneral: "desc" }, { createdAt: "asc" }],
    select: { id: true, teamId: true, isGeneral: true },
  });
  if (activeQueue) {
    if (activeQueue.isGeneral) return activeQueue;
    return transaction.queue.update({
      where: { id: activeQueue.id },
      data: { isGeneral: true, updatedByActorId: actorId },
      select: { id: true, teamId: true },
    });
  }

  const archivedQueue = await transaction.queue.findFirst({
    where: {
      workspaceId,
      OR: [{ isGeneral: true }, { key: "general" }],
    },
    orderBy: [{ isGeneral: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (archivedQueue) {
    return transaction.queue.update({
      where: { id: archivedQueue.id },
      data: { isGeneral: true, deletedAt: null, updatedByActorId: actorId },
      select: { id: true, teamId: true },
    });
  }

  const sdrTeam = await transaction.teamMember.findFirst({
    where: {
      workspaceId,
      function: "SDR",
      deletedAt: null,
      team: { deletedAt: null },
      member: {
        status: "ACTIVE",
        deletedAt: null,
        user: { status: "ACTIVE", deletedAt: null },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { teamId: true },
  });

  return transaction.queue.create({
    data: {
      workspaceId,
      teamId: sdrTeam?.teamId ?? null,
      key: "general",
      name: "Fila Geral",
      isGeneral: true,
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
    select: { id: true, teamId: true },
  });
}

async function ensureManualSource(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`manual-source:${workspaceId}`}, 0)
    )
  `;

  const activeSource = await transaction.leadSource.findFirst({
    where: {
      workspaceId,
      key: { equals: "manual", mode: "insensitive" },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (activeSource) return;

  const archivedSource = await transaction.leadSource.findFirst({
    where: {
      workspaceId,
      key: { equals: "manual", mode: "insensitive" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (archivedSource) {
    await transaction.leadSource.update({
      where: { id: archivedSource.id },
      data: {
        type: "MANUAL",
        deletedAt: null,
        updatedByActorId: actorId,
      },
    });
    return;
  }

  await transaction.leadSource.create({
    data: {
      workspaceId,
      key: "manual",
      name: "Cadastro manual",
      type: "MANUAL",
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
  });
}

async function findReferences(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  input: ParsedInput,
): Promise<IntakeReferences | LeadIntakeRejectedResult> {
  const source = await transaction.leadSource.findFirst({
    where: {
      workspaceId,
      key: { equals: input.sourceKey, mode: "insensitive" },
      deletedAt: null,
    },
    select: { id: true },
  });
  const queue = await transaction.queue.findFirst({
    where: { workspaceId, isGeneral: true, deletedAt: null },
    select: { id: true, teamId: true },
  });
  const pipeline = await transaction.pipeline.findFirst({
    where: {
      workspaceId,
      entityType: "LEAD",
      ...(input.pipelineId ? { id: input.pipelineId } : { isDefault: true }),
      deletedAt: null,
    },
    select: { id: true },
  });
  const priorityBand = await transaction.leadPriorityBand.findFirst({
    where: {
      workspaceId,
      code: input.priorityBandCode,
      active: true,
      deletedAt: null,
      slaPolicy: {
        active: true,
        firstResponseMinutes: 0,
        deletedAt: null,
      },
    },
    select: {
      id: true,
      code: true,
      leadPriority: true,
      slaPolicy: {
        select: {
          firstResponseMinutes: true,
          healthyMaxSeconds: true,
          attentionMaxSeconds: true,
        },
      },
    },
  });

  if (!source) {
    return rejected(
      "REFERENCE_NOT_FOUND",
      "sourceKey",
      "A origem informada não existe neste workspace.",
    );
  }

  if (!queue || !pipeline || !priorityBand) {
    return rejected(
      "CONFIGURATION_UNAVAILABLE",
      "workspace",
      `Fila geral, pipeline padrão ou política ${input.priorityBandCode} de SLA 0 não está configurada.`,
    );
  }

  const stage = await transaction.pipelineStage.findFirst({
    where: {
      workspaceId,
      pipelineId: pipeline.id,
      type: "OPEN",
      deletedAt: null,
    },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (!stage) {
    return rejected(
      "CONFIGURATION_UNAVAILABLE",
      "pipeline",
      "O pipeline selecionado não possui etapa inicial aberta.",
    );
  }

  const campaign = input.campaignExternalRef
    ? await transaction.acquisitionCampaign.findFirst({
        where: {
          workspaceId,
          externalRef: input.campaignExternalRef,
          deletedAt: null,
        },
        select: { id: true },
      })
    : null;
  if (input.campaignExternalRef && !campaign) {
    return rejected(
      "REFERENCE_NOT_FOUND",
      "campaignExternalRef",
      "A campanha informada não existe neste workspace.",
    );
  }

  let creative: Readonly<{ id: string }> | null = null;
  if (input.creativeExternalRef) {
    if (!campaign) {
      return rejected(
        "REFERENCE_NOT_FOUND",
        "campaignExternalRef",
        "O criativo informado exige uma campanha válida.",
      );
    }
    creative = await transaction.acquisitionCreative.findFirst({
      where: {
        workspaceId,
        campaignId: campaign.id,
        externalRef: input.creativeExternalRef,
        deletedAt: null,
      },
      select: { id: true },
    });
  }
  if (input.creativeExternalRef && !creative) {
    return rejected(
      "REFERENCE_NOT_FOUND",
      "creativeExternalRef",
      "O criativo informado não pertence à campanha deste workspace.",
    );
  }

  if (input.requestedOffer) {
    const requestedProduct = await transaction.product.findFirst({
      where: {
        workspaceId,
        catalogItemId: input.requestedOffer.catalogItemId,
        version: input.requestedOffer.version,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!requestedProduct) {
      return rejected(
        "REFERENCE_NOT_FOUND",
        "requestedOffer",
        "A versão da oferta solicitada não existe neste workspace.",
      );
    }
  }

  return { source, campaign, creative, queue, pipeline, stage, priorityBand };
}

function addDivergence(
  divergences: Divergence[],
  field: LeadDivergenceField,
  currentValue: string | bigint | null,
  submittedValue: string | bigint | null,
): void {
  if (submittedValue === null) return;
  const current = currentValue === null ? null : String(currentValue).trim();
  const submitted = String(submittedValue).trim();
  if ((current ?? "").toLocaleLowerCase("pt-BR") === submitted.toLocaleLowerCase("pt-BR")) {
    return;
  }
  divergences.push({ field, currentValue: current, submittedValue: submitted });
}

function findDivergences(
  lead: Readonly<{
    fullName: string;
    normalizedEmail: string | null;
    jobTitle: string | null;
    organizationName: string | null;
    city: string | null;
    stateCode: string | null;
    interestSummary: string | null;
    budgetCents: bigint | null;
    contactPreference: ContactPreference;
    sourceId: string;
    campaignId: string | null;
    creativeId: string | null;
  }>,
  input: ParsedInput,
  references: IntakeReferences,
): Divergence[] {
  const divergences: Divergence[] = [];
  addDivergence(divergences, "FULL_NAME", lead.fullName, input.fullName);
  addDivergence(divergences, "EMAIL", lead.normalizedEmail, input.normalizedEmail);
  addDivergence(divergences, "JOB_TITLE", lead.jobTitle, input.jobTitle ?? null);
  addDivergence(
    divergences,
    "ORGANIZATION",
    lead.organizationName,
    input.organizationName ?? null,
  );
  addDivergence(divergences, "CITY", lead.city, input.city ?? null);
  addDivergence(divergences, "STATE", lead.stateCode, input.stateCode ?? null);
  addDivergence(
    divergences,
    "INTEREST",
    lead.interestSummary,
    input.interestSummary ?? null,
  );
  addDivergence(divergences, "BUDGET", lead.budgetCents, input.budgetCents);
  addDivergence(
    divergences,
    "CONTACT_PREFERENCE",
    lead.contactPreference,
    input.submittedContactPreference,
  );
  addDivergence(divergences, "SOURCE", lead.sourceId, references.source.id);
  addDivergence(
    divergences,
    "CAMPAIGN",
    lead.campaignId,
    references.campaign?.id ?? null,
  );
  addDivergence(
    divergences,
    "CREATIVE",
    lead.creativeId,
    references.creative?.id ?? null,
  );
  return divergences;
}

function nextContactPreference(
  current: ContactPreference,
  submitted: ContactPreference | null,
): ContactPreference {
  if (current === "DO_NOT_CONTACT") return current;
  return submitted ?? current;
}

function submissionData(
  workspaceId: string,
  actorId: string,
  input: ParsedInput,
  references: IntakeReferences,
): Prisma.LeadFormSubmissionUncheckedCreateInput {
  return {
    workspaceId,
    sourceId: references.source.id,
    campaignId: references.campaign?.id ?? null,
    creativeId: references.creative?.id ?? null,
    status: "RECEIVED",
    channel: input.channel,
    formIdentifier: input.formIdentifier ?? null,
    idempotencyKey: input.idempotencyKey,
    submittedFullName: input.fullName,
    submittedEmail: input.email ?? null,
    submittedPhone: input.phone,
    normalizedEmail: input.normalizedEmail,
    normalizedPhone: input.normalizedPhone,
    submittedJobTitle: input.jobTitle ?? null,
    submittedOrganizationName: input.organizationName ?? null,
    submittedCity: input.city ?? null,
    submittedStateCode: input.stateCode ?? null,
    submittedInterestSummary: input.interestSummary ?? null,
    submittedBudgetCents: input.budgetCents,
    submittedContactPreference: input.submittedContactPreference,
    requestedCatalogItemId: input.requestedOffer?.catalogItemId ?? null,
    requestedCatalogVersion: input.requestedOffer?.version ?? null,
    submittedAt: input.submittedAt ?? input.receivedAt,
    rawPayload: input.rawPayload,
    createdByActorId: actorId,
  };
}

function acceptedReplay(
  submission: Readonly<{
    id: string;
    normalizedPhone: string | null;
    intakeOutcome: LeadIntakeOutcome | null;
    lead: Readonly<{ id: string; conversionCount: number }> | null;
    identityReview: Readonly<{
      id: string;
      divergenceFields: LeadDivergenceField[];
    }> | null;
    slaCycle: Readonly<{
      id: string;
      assignedMemberId: string | null;
      assignedQueueId: string | null;
      priorityBand: Readonly<{ code: PriorityBandCode }>;
      task: Readonly<{ id: string }> | null;
    }> | null;
  }>,
): LeadIntakeAcceptedResult | null {
  if (
    submission.lead &&
    submission.normalizedPhone &&
    submission.slaCycle?.task &&
    (submission.intakeOutcome === "CREATED" ||
      submission.intakeOutcome === "ATTACHED")
  ) {
    return {
      outcome: submission.intakeOutcome,
      leadId: submission.lead.id,
      submissionId: submission.id,
      normalizedPhone: submission.normalizedPhone,
      conversionCount: submission.lead.conversionCount,
      reviewId: submission.identityReview?.id ?? null,
      divergenceFields: submission.identityReview?.divergenceFields ?? [],
      priorityBandCode: submission.slaCycle.priorityBand.code,
      operationalOwner: submission.slaCycle.assignedMemberId
        ? {
            type: "MEMBER",
            memberId: submission.slaCycle.assignedMemberId,
            queueId: null,
          }
        : {
            type: "QUEUE",
            memberId: null,
            queueId: submission.slaCycle.assignedQueueId!,
          },
      slaCycleId: submission.slaCycle.id,
      taskId: submission.slaCycle.task.id,
      idempotentReplay: true,
    };
  }
  return null;
}

async function lockIntakeIdentity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  input: ParsedInput,
): Promise<void> {
  const lockKeys = [
    `lead-intake:idempotency:${workspaceId}:${input.idempotencyKey}`,
    `lead-intake:phone:${workspaceId}:${input.normalizedPhone}`,
  ].sort();

  for (const lockKey of lockKeys) {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
  }
}

async function publishAcceptedAutomationEvents(
  transaction: Prisma.TransactionClient,
  publisher: NonNullable<LeadIntakeServiceOptions["automationPublisher"]> | undefined,
  input: Readonly<{
    workspaceId: string;
    actorId: string;
    result: LeadIntakeAcceptedResult;
    receivedAt: Date;
    channel: ParsedInput["channel"];
    doNotContact: boolean;
  }>,
): Promise<void> {
  if (!publisher) return;

  const basePayload = Object.freeze({
    eventType: "LEAD_INTAKE_COMPLETED",
    leadId: input.result.leadId,
    submissionId: input.result.submissionId,
    slaCycleId: input.result.slaCycleId,
    taskId: input.result.taskId,
    reviewId: input.result.reviewId,
    outcome: input.result.outcome,
    priorityBandCode: input.result.priorityBandCode,
    operationalOwnerType: input.result.operationalOwner.type,
    doNotContact: input.doNotContact,
    channel: input.channel,
  });
  const priority =
    input.result.priorityBandCode === "P1"
      ? 100
      : input.result.priorityBandCode === "P2"
        ? 50
        : 10;

  await publisher.publishInTransaction(transaction, {
    workspaceId: input.workspaceId,
    triggerType: "LEAD_CREATED",
    idempotencyKey: `intake:${input.result.submissionId}`,
    occurredAt: input.receivedAt,
    triggeredByActorId: input.actorId,
    priority,
    payload: basePayload,
  });

  if (input.result.priorityBandCode === "P1") {
    await publisher.publishInTransaction(transaction, {
      workspaceId: input.workspaceId,
      triggerType: "LEAD_UPDATED",
      idempotencyKey: `p1:${input.result.submissionId}:initial`,
      occurredAt: input.receivedAt,
      triggeredByActorId: input.actorId,
      priority: 100,
      payload: { ...basePayload, eventType: "PRIORITY_P1", phase: "INITIAL" },
    });
    await publisher.publishInTransaction(transaction, {
      workspaceId: input.workspaceId,
      triggerType: "LEAD_UPDATED",
      idempotencyKey: `p1:${input.result.submissionId}:manager`,
      occurredAt: input.receivedAt,
      triggeredByActorId: input.actorId,
      priority: 95,
      runAt: new Date(input.receivedAt.getTime() + 60_000),
      payload: {
        ...basePayload,
        eventType: "PRIORITY_P1",
        phase: "MANAGER_ESCALATION",
      },
    });
  }

  for (const thresholdSeconds of [60, 180] as const) {
    await publisher.publishInTransaction(transaction, {
      workspaceId: input.workspaceId,
      triggerType: "SLA_BREACHED",
      idempotencyKey: `sla:${input.result.slaCycleId}:${thresholdSeconds}`,
      occurredAt: input.receivedAt,
      triggeredByActorId: input.actorId,
      priority: thresholdSeconds === 180 ? 90 : 80,
      runAt: new Date(
        input.receivedAt.getTime() + (thresholdSeconds + 1) * 1_000,
      ),
      payload: {
        ...basePayload,
        eventType: "SLA_CHECK",
        thresholdSeconds,
      },
    });
  }
}

export function createLeadIntakeService(options: LeadIntakeServiceOptions) {
  async function intake(
    payload: unknown,
    context: LeadIntakeActorContext,
  ): Promise<LeadIntakeResult> {
    const parsed = parseInput(payload, options.now());
    if (isRejectedResult(parsed)) return parsed;

    const generalQueue = await options.database.queue.findFirst({
      where: {
        workspaceId: context.workspaceId,
        isGeneral: true,
        deletedAt: null,
      },
      select: { id: true, teamId: true },
    });
    if (isHumanContext(context)) {
      await options.authorization.assertAuthorized(
        context,
        PermissionKeys.LEADS_WRITE,
        {
          workspaceId: context.workspaceId,
          resourceType: "LeadIntake",
          ...(generalQueue
            ? { queueId: generalQueue.id, teamId: generalQueue.teamId }
            : { memberId: context.memberId }),
        },
      );
    } else {
      await validateAutomaticActor(options.database, context);
    }

    return options.database.$transaction(async (transaction) => {
      await ensureGeneralQueue(
        transaction,
        context.workspaceId,
        context.actorId,
      );
      if (parsed.channel === "MANUAL" && parsed.sourceKey.toLowerCase() === "manual") {
        await ensureManualSource(
          transaction,
          context.workspaceId,
          context.actorId,
        );
      }
      await lockIntakeIdentity(transaction, context.workspaceId, parsed);

      const priorSubmission = await transaction.leadFormSubmission.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: context.workspaceId,
            idempotencyKey: parsed.idempotencyKey,
          },
        },
        select: {
          id: true,
          normalizedPhone: true,
          intakeOutcome: true,
          lead: { select: { id: true, conversionCount: true } },
          identityReview: {
            select: { id: true, divergenceFields: true },
          },
          slaCycle: {
            select: {
              id: true,
              assignedMemberId: true,
              assignedQueueId: true,
              priorityBand: { select: { code: true } },
              task: { select: { id: true } },
            },
          },
        },
      });
      if (priorSubmission) {
        const replay = acceptedReplay(priorSubmission);
        return (
          replay ??
          rejected(
            "IDEMPOTENCY_CONFLICT",
            "idempotencyKey",
            "A chave de idempotência já pertence a uma entrada não concluída.",
          )
        );
      }

      const phoneCandidates = await transaction.lead.findMany({
        where: {
          workspaceId: context.workspaceId,
          normalizedPhone: parsed.normalizedPhone,
          deletedAt: null,
        },
      });
      // Telefone é um ponto de contato compartilhável, não uma identidade forte.
      // A associação automática só ocorre quando o e-mail normalizado também coincide;
      // os demais candidatos seguem como pessoas separadas e entram em revisão humana.
      const existingLead = phoneCandidates.find((candidate) => mayAutomaticallyAttachBySharedPhone({ submittedEmail: parsed.normalizedEmail, candidateEmail: candidate.normalizedEmail })) ?? null;
      const preparedScore = await prepareFormProvisionalScore(
        transaction,
        context.workspaceId,
        parsed,
      );
      const currentScore = existingLead
        ? await transaction.leadCurrentScore.findUnique({
            where: {
              workspaceId_leadId: {
                workspaceId: context.workspaceId,
                leadId: existingLead.id,
              },
            },
            select: {
              leadScore: {
                select: { source: true, priorityBandCode: true },
              },
            },
          })
        : null;
      const formMayBecomeCurrent =
        !currentScore || currentScore.leadScore.source === "FORM_PROVISIONAL";
      const priorityBandCode =
        existingLead && !formMayBecomeCurrent
          ? currentScore.leadScore.priorityBandCode
          : preparedScore?.calculation.priorityBandCode ?? parsed.priorityBandCode;

      const references = await findReferences(
        transaction,
        context.workspaceId,
        { ...parsed, priorityBandCode },
      );
      if (isRejectedResult(references)) return references;

      const submission = await transaction.leadFormSubmission.create({
        data: submissionData(
          context.workspaceId,
          context.actorId,
          parsed,
          references,
        ),
        select: { id: true },
      });

      await options.afterSubmissionPersisted?.();

      const submittedAt = parsed.submittedAt ?? parsed.receivedAt;
      const operationalOwner = await chooseRoundRobinOwner(transaction, {
        workspaceId: context.workspaceId,
        queueId: references.queue.id,
        teamId: references.queue.teamId,
        actorId: context.actorId,
        routedAt: parsed.receivedAt,
      });

      if (!existingLead) {
        const slaDueAt = parsed.receivedAt;
        const contactPreference = parsed.submittedContactPreference ?? "UNKNOWN";
        const lead = await transaction.lead.create({
          data: {
            workspaceId: context.workspaceId,
            sourceId: references.source.id,
            campaignId: references.campaign?.id ?? null,
            creativeId: references.creative?.id ?? null,
            latestSourceId: references.source.id,
            latestCampaignId: references.campaign?.id ?? null,
            latestCreativeId: references.creative?.id ?? null,
            pipelineId: references.pipeline.id,
            currentStageId: references.stage.id,
            ownerMemberId: operationalOwner.memberId,
            queueId: operationalOwner.queueId,
            routingQueueId: references.queue.id,
            fullName: parsed.fullName,
            normalizedEmail: parsed.normalizedEmail,
            normalizedPhone: parsed.normalizedPhone,
            jobTitle: parsed.jobTitle ?? null,
            organizationName: parsed.organizationName ?? null,
            city: parsed.city ?? null,
            stateCode: parsed.stateCode ?? null,
            interestSummary: parsed.interestSummary ?? null,
            latestInterestSummary: parsed.interestSummary ?? null,
            budgetCents: parsed.budgetCents,
            contactPreference,
            contactPreferenceUpdatedAt:
              contactPreference === "UNKNOWN" ? null : parsed.receivedAt,
            conversionCount: 1,
            latestSubmissionAt: submittedAt,
            needsIdentityReview: false,
            status: "OPEN",
            priority: references.priorityBand.leadPriority,
            slaStartedAt: parsed.receivedAt,
            slaDueAt,
            lastActivityAt: submittedAt,
            nextActionTaskId: null,
            nextActionAt: null,
            nextActionDescription: null,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
          },
          select: { id: true },
        });

        await transaction.stageHistory.create({
          data: {
            workspaceId: context.workspaceId,
            pipelineId: references.pipeline.id,
            stageId: references.stage.id,
            leadId: lead.id,
            enteredAt: parsed.receivedAt,
            enteredByActorId: context.actorId,
            transitionOrigin: "INTAKE",
            transitionReason: "Entrada inicial do lead.",
          },
        });
        await transaction.activity.create({
          data: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            type: "OTHER",
            direction: "INBOUND",
            subject: "Lead recebido",
            description: "Primeira conversão vinculada à identidade do lead.",
            occurredAt: submittedAt,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
          },
        });
        await transaction.leadFormSubmission.update({
          where: { id: submission.id },
          data: { leadId: lead.id, status: "LINKED", intakeOutcome: "CREATED" },
        });
        const contactIdentity = await ensureContactForLeadInTransaction(
          transaction,
          {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            facts: {
              leadId: lead.id,
              fullName: parsed.fullName,
              jobTitle: parsed.jobTitle ?? null,
              normalizedPhone: parsed.normalizedPhone,
              originalPhone: parsed.phone,
              normalizedEmail: parsed.normalizedEmail,
              originalEmail: parsed.email ?? null,
              doNotContact: contactPreference === "DO_NOT_CONTACT",
              origin: "LEAD_INTAKE",
              submissionId: submission.id,
            },
          },
        );
        const privacyPoint = await transaction.contactPoint.findFirst({
          where: { workspaceId: context.workspaceId, contactId: contactIdentity.contactId, type: "PHONE", normalizedValue: parsed.normalizedPhone, deletedAt: null },
          select: { id: true },
        });
        await recordLeadIntakeAttributionInTransaction(transaction, {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          leadId: lead.id,
          contactId: contactIdentity.contactId,
          submissionId: submission.id,
          sourceId: references.source.id,
          campaignId: references.campaign?.id ?? null,
          creativeId: references.creative?.id ?? null,
          occurredAt: submittedAt,
          correlationId: parsed.idempotencyKey,
          ...(parsed.acquisition ? { acquisition: parsed.acquisition } : {}),
        });
        await recordLegacySignalInTransaction(transaction, {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          contactId: contactIdentity.contactId,
          contactPointId: privacyPoint?.id ?? null,
          preference: contactPreference,
          occurredAt: parsed.receivedAt,
          source: privacySource(parsed.channel),
          idempotencyKey: `intake:${submission.id}:privacy`,
          correlationId: parsed.idempotencyKey,
        });
        const operations = await createInitialLeadOperations(transaction, {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          submissionId: submission.id,
          priorityBandId: references.priorityBand.id,
          priority: references.priorityBand.leadPriority,
          owner: operationalOwner,
          actorId: context.actorId,
          receivedAt: parsed.receivedAt,
          doNotContact: contactPreference === "DO_NOT_CONTACT",
          requestId: parsed.idempotencyKey,
        });
        if (preparedScore) {
          await recordScoreInTransaction(transaction, {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            actorId: context.actorId,
            source: "FORM_PROVISIONAL",
            prepared: preparedScore,
            submissionId: submission.id,
            makeCurrent: true,
            calculatedAt: parsed.receivedAt,
            action: "lead.score.form_provisional_calculated",
          });
        }
        await options.afterInitialOperationsPersisted?.();
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "lead.intake.created",
            entityType: "Lead",
            entityId: lead.id,
            requestId: parsed.idempotencyKey,
            changes: {
              submissionId: submission.id,
              normalizedPhone: parsed.normalizedPhone,
              sourceId: references.source.id,
              campaignId: references.campaign?.id ?? null,
              creativeId: references.creative?.id ?? null,
              contactPreference,
              priorityBandCode: references.priorityBand.code,
              ownerMemberId: operationalOwner.memberId,
              queueId: operationalOwner.queueId,
              slaCycleId: operations.slaCycleId,
              taskId: operations.taskId,
              contactId: contactIdentity.contactId,
            },
            metadata: { channel: parsed.channel, result: "CREATED" },
          },
        });

        const result = {
          outcome: "CREATED",
          leadId: lead.id,
          submissionId: submission.id,
          normalizedPhone: parsed.normalizedPhone,
          conversionCount: 1,
          reviewId: null,
          divergenceFields: [],
          priorityBandCode: references.priorityBand.code,
          operationalOwner,
          slaCycleId: operations.slaCycleId,
          taskId: operations.taskId,
          idempotentReplay: false,
        } satisfies LeadIntakeAcceptedResult;
        await publishAcceptedAutomationEvents(
          transaction,
          options.automationPublisher,
          {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            result,
            receivedAt: parsed.receivedAt,
            channel: parsed.channel,
            doNotContact: contactPreference === "DO_NOT_CONTACT",
          },
        );
        return result;
      }

      const divergences = findDivergences(existingLead, parsed, references);
      const contactPreference = nextContactPreference(
        existingLead.contactPreference,
        parsed.submittedContactPreference,
      );
      const contactPreferenceChanged =
        contactPreference !== existingLead.contactPreference;
      const lastActivityAt =
        parsed.receivedAt > existingLead.lastActivityAt
          ? parsed.receivedAt
          : existingLead.lastActivityAt;
      const isChronologicallyLatest =
        !existingLead.latestSubmissionAt ||
        submittedAt >= existingLead.latestSubmissionAt;

      const lead = await transaction.lead.update({
        where: { id: existingLead.id },
        data: {
          ...(isChronologicallyLatest
            ? {
                latestSourceId: references.source.id,
                latestCampaignId: references.campaign?.id ?? null,
                latestCreativeId: references.creative?.id ?? null,
                latestInterestSummary:
                  parsed.interestSummary ?? existingLead.latestInterestSummary,
                latestSubmissionAt: submittedAt,
              }
            : {}),
          conversionCount: { increment: 1 },
          needsIdentityReview: true,
          ownerMemberId: operationalOwner.memberId,
          queueId: operationalOwner.queueId,
          routingQueueId: references.queue.id,
          priority: references.priorityBand.leadPriority,
          slaStartedAt: parsed.receivedAt,
          slaDueAt: parsed.receivedAt,
          nextActionAt: parsed.receivedAt,
          nextActionDescription:
            contactPreference === "DO_NOT_CONTACT"
              ? "Revisar restrição de contato"
              : "Ligar agora",
          contactPreference,
          contactPreferenceUpdatedAt: contactPreferenceChanged
            ? parsed.receivedAt
            : existingLead.contactPreferenceUpdatedAt,
          lastActivityAt,
          updatedByActorId: context.actorId,
        },
        select: { id: true, conversionCount: true },
      });

      const review = await transaction.leadIdentityReview.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          submissionId: submission.id,
          assignedTeamId: references.queue.teamId,
          reason: "DUPLICATE_PHONE",
          status: "OPEN",
          divergenceFields: divergences.map(({ field }) => field),
          evidence: {
            facts: divergences,
            inference: {
              identityCandidateReason: "SAME_NORMALIZED_PHONE",
              automaticMergePerformed: false,
            },
            missingData:
              divergences.length === 0
                ? ["Nenhuma divergência textual detectada; identidade ainda requer revisão humana."]
                : [],
          },
          createdByActorId: context.actorId,
        },
        select: { id: true },
      });

      const managers = await transaction.teamMember.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(references.queue.teamId
            ? { teamId: references.queue.teamId }
            : {}),
          function: "MANAGER",
          deletedAt: null,
          member: { status: "ACTIVE", deletedAt: null },
        },
        distinct: ["workspaceMemberId"],
        select: { workspaceMemberId: true },
      });

      await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          type: "OTHER",
          direction: "INBOUND",
          subject: "Nova conversão recebida",
          description:
            "Submissão anexada sem mesclagem automática; revisão de identidade aberta.",
          occurredAt: submittedAt,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
      });

      await transaction.leadFormSubmission.update({
        where: { id: submission.id },
        data: { leadId: lead.id, status: "LINKED", intakeOutcome: "ATTACHED" },
      });

      const contactIdentity = await ensureContactForLeadInTransaction(
        transaction,
        {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          facts: {
            leadId: lead.id,
            fullName: parsed.fullName,
            jobTitle: parsed.jobTitle ?? null,
            normalizedPhone: parsed.normalizedPhone,
            originalPhone: parsed.phone,
            normalizedEmail: parsed.normalizedEmail,
            originalEmail: parsed.email ?? null,
            doNotContact: contactPreference === "DO_NOT_CONTACT",
            origin: "LEAD_INTAKE",
            leadIdentityReviewId: review.id,
            submissionId: submission.id,
          },
        },
      );
      const privacyPoint = await transaction.contactPoint.findFirst({
        where: { workspaceId: context.workspaceId, contactId: contactIdentity.contactId, type: "PHONE", normalizedValue: parsed.normalizedPhone, deletedAt: null },
        select: { id: true },
      });
      await recordLeadIntakeAttributionInTransaction(transaction, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        leadId: lead.id,
        contactId: contactIdentity.contactId,
        submissionId: submission.id,
        sourceId: references.source.id,
        campaignId: references.campaign?.id ?? null,
        creativeId: references.creative?.id ?? null,
        occurredAt: submittedAt,
        correlationId: parsed.idempotencyKey,
        ...(parsed.acquisition ? { acquisition: parsed.acquisition } : {}),
      });
      await recordLegacySignalInTransaction(transaction, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        contactId: contactIdentity.contactId,
        contactPointId: privacyPoint?.id ?? null,
        preference: contactPreference,
        occurredAt: parsed.receivedAt,
        source: privacySource(parsed.channel),
        idempotencyKey: `intake:${submission.id}:privacy`,
        correlationId: parsed.idempotencyKey,
      });

      if (contactPreference === "DO_NOT_CONTACT") {
        await transaction.task.updateMany({
          where: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            kind: "IMMEDIATE_CALL",
            status: { in: ["OPEN", "IN_PROGRESS"] },
            deletedAt: null,
          },
          data: {
            status: "CANCELLED",
            completedAt: null,
            updatedByActorId: context.actorId,
          },
        });
      } else {
        await transaction.task.updateMany({
          where: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            kind: "IMMEDIATE_CALL",
            status: { in: ["OPEN", "IN_PROGRESS"] },
            deletedAt: null,
          },
          data: {
            assigneeMemberId: operationalOwner.memberId,
            queueId: operationalOwner.queueId,
            updatedByActorId: context.actorId,
          },
        });
      }

      if (operationalOwner.type === "MEMBER") {
        await transaction.operationalAlert.updateMany({
          where: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            type: "GENERAL_QUEUE_ASSIGNMENT",
            status: "OPEN",
          },
          data: {
            status: "RESOLVED",
            resolvedAt: parsed.receivedAt,
            resolvedByActorId: context.actorId,
          },
        });
      }

      const previousOwner: OperationalOwner = existingLead.ownerMemberId
        ? {
            type: "MEMBER",
            memberId: existingLead.ownerMemberId,
            queueId: null,
          }
        : {
            type: "QUEUE",
            memberId: null,
            queueId: existingLead.queueId!,
          };
      const operations = await createInitialLeadOperations(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        submissionId: submission.id,
        priorityBandId: references.priorityBand.id,
        priority: references.priorityBand.leadPriority,
        owner: operationalOwner,
        previousOwner,
        actorId: context.actorId,
        receivedAt: parsed.receivedAt,
        doNotContact: contactPreference === "DO_NOT_CONTACT",
        requestId: parsed.idempotencyKey,
      });
      if (preparedScore) {
        await recordScoreInTransaction(transaction, {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          actorId: context.actorId,
          source: "FORM_PROVISIONAL",
          prepared: preparedScore,
          submissionId: submission.id,
          makeCurrent: formMayBecomeCurrent,
          calculatedAt: parsed.receivedAt,
          action: formMayBecomeCurrent
            ? "lead.score.form_provisional_recalculated"
            : "lead.score.form_provisional_preserved_as_signal",
        });
      }
      await options.afterInitialOperationsPersisted?.();

      if (managers.length > 0) {
        await transaction.notification.createMany({
          data: managers.map(({ workspaceMemberId }) => ({
            workspaceId: context.workspaceId,
            recipientMemberId: workspaceMemberId,
            leadId: lead.id,
            type: "SYSTEM",
            title: "Revisão de identidade pendente",
            body: `Nova conversão com telefone já existente. Revisão ${review.id}.`,
            createdByActorId: context.actorId,
          })),
        });
      }

      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "lead.intake.attached",
          entityType: "Lead",
          entityId: lead.id,
          requestId: parsed.idempotencyKey,
          changes: {
            submissionId: submission.id,
            reviewId: review.id,
            conversionCount: lead.conversionCount,
            divergenceFields: divergences.map(({ field }) => field),
            preservedTrustedFields: true,
            contactPreference,
            priorityBandCode: references.priorityBand.code,
            ownerMemberId: operationalOwner.memberId,
            queueId: operationalOwner.queueId,
            slaCycleId: operations.slaCycleId,
            taskId: operations.taskId,
            contactId: contactIdentity.contactId,
          },
          metadata: { channel: parsed.channel, result: "ATTACHED" },
        },
      });

      const result = {
        outcome: "ATTACHED",
        leadId: lead.id,
        submissionId: submission.id,
        normalizedPhone: parsed.normalizedPhone,
        conversionCount: lead.conversionCount,
        reviewId: review.id,
        divergenceFields: divergences.map(({ field }) => field),
        priorityBandCode: references.priorityBand.code,
        operationalOwner,
        slaCycleId: operations.slaCycleId,
        taskId: operations.taskId,
        idempotentReplay: false,
      } satisfies LeadIntakeAcceptedResult;
      await publishAcceptedAutomationEvents(
        transaction,
        options.automationPublisher,
        {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          result,
          receivedAt: parsed.receivedAt,
          channel: parsed.channel,
          doNotContact: contactPreference === "DO_NOT_CONTACT",
        },
      );
      return result;
    });
  }

  return Object.freeze({ intake });
}

let leadIntakeService: ReturnType<typeof createLeadIntakeService> | undefined;

export function getLeadIntakeService(): ReturnType<
  typeof createLeadIntakeService
> {
  leadIntakeService ??= createLeadIntakeService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
    automationPublisher: getAutomationEngineService(),
  });
  return leadIntakeService;
}
