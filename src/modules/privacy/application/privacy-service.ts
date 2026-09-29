import { z } from "zod";

import type { Prisma, PrismaClient, PrivacyChannel } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { ensurePrivacyFoundation, projectConsentState } from "@/modules/privacy/application/privacy-foundation";
import { canTransitionDsr, decidePrivacy, PRIVACY_RULE_VERSION } from "@/modules/privacy/domain/privacy-policy";
import type { ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

const channelSchema = z.enum(["PHONE", "EMAIL", "WHATSAPP", "SMS", "IN_APP", "OTHER"]);
const consentInput = z.object({
  leadId: z.string().uuid(), purposeVersionId: z.string().uuid(), contactPointId: z.string().uuid().nullable().optional(),
  channel: channelSchema, action: z.enum(["GRANTED", "DENIED", "REVOKED", "OPTED_OUT", "CORRECTED"]),
  evidenceReference: z.string().trim().min(3).max(500).nullable().optional(), correctionOfId: z.string().uuid().nullable().optional(),
  occurredAt: z.coerce.date(), idempotencyKey: z.string().trim().min(8).max(200), reason: z.string().trim().min(3).max(1000),
}).strict();
const dsrCreateInput = z.object({ leadId: z.string().uuid(), type: z.enum(["ACCESS", "CORRECTION", "PORTABILITY", "RESTRICTION", "OPPOSITION", "REVOCATION", "DELETION"]), receivedChannel: channelSchema, categoryIds: z.array(z.string().uuid()).min(1).max(20), reason: z.string().trim().min(3).max(1000), ownerMemberId: z.string().uuid().nullable().optional(), queueId: z.string().uuid().nullable().optional(), idempotencyKey: z.string().trim().min(8).max(160).optional() }).strict();
const dsrTransitionInput = z.object({ requestId: z.string().uuid(), toStatus: z.enum(["IDENTITY_PENDING", "IN_REVIEW", "ACTION_REQUIRED", "BLOCKED", "COMPLETED", "REJECTED", "CANCELLED"]), reason: z.string().trim().min(3).max(1000), verificationMethod: z.string().trim().min(3).max(120).nullable().optional(), verificationReference: z.string().trim().min(3).max(300).nullable().optional() }).strict();
const holdInput = z.object({ leadId: z.string().uuid(), requestId: z.string().uuid().nullable().optional(), dataCategoryId: z.string().uuid().nullable().optional(), reason: z.string().trim().min(3).max(1000), authorityReference: z.string().trim().min(3).max(300), endsAt: z.coerce.date().nullable().optional() }).strict();

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

async function findLead(tx: Tx | PrismaClient, workspaceId: string, leadId: string) {
  const lead = await tx.lead.findFirst({ where: { id: leadId, workspaceId, deletedAt: null }, select: { id: true, contactId: true, ownerMemberId: true, queueId: true, routingQueue: { select: { teamId: true } }, contactPreference: true } });
  if (!lead) fail("Lead não encontrado neste workspace.", "LEAD_NOT_FOUND", 404);
  return lead;
}

async function leadSnapshot(tx: Tx | PrismaClient, workspaceId: string, leadId: string) {
  const lead = await findLead(tx, workspaceId, leadId);
  if (!lead?.contactId) fail("Lead sem Contact canônico neste workspace.", "CONTACT_NOT_FOUND", 404);
  return lead as typeof lead & { contactId: string };
}

function leadResource(workspaceId: string, lead: Awaited<ReturnType<typeof findLead>>): ResourceScope {
  return { workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, teamId: lead.routingQueue?.teamId ?? null };
}

async function currentDecision(tx: Tx | PrismaClient, input: Readonly<{ workspaceId: string; actorId: string; leadId: string; contactPointId?: string | null; channel: PrivacyChannel; intendedAction: string; persist: boolean }>) {
  const lead = await leadSnapshot(tx, input.workspaceId, input.leadId);
  const pointType = input.channel === "EMAIL" ? "EMAIL" : "PHONE";
  const pointWhere: Prisma.ContactPointWhereInput = { workspaceId: input.workspaceId, contactId: lead.contactId, type: pointType, deletedAt: null };
  if (input.contactPointId) pointWhere.id = input.contactPointId;
  const point = await tx.contactPoint.findFirst({ where: pointWhere, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, doNotContact: true } });
  if (input.contactPointId && !point) fail("Ponto de contato não pertence ao lead.", "CONTACT_POINT_NOT_FOUND", 404);
  const purpose = await tx.processingPurpose.findFirst({ where: { workspaceId: input.workspaceId, code: "legacy-commercial-contact", active: true }, select: { id: true, name: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, noticeVersion: true, status: true, legalBasis: { select: { status: true } } } } } });
  const version = purpose?.versions[0] ?? null;
  const state = purpose ? await tx.consentState.findFirst({ where: { workspaceId: input.workspaceId, contactId: lead.contactId, contactPointId: point?.id ?? null, purposeId: purpose.id, channel: input.channel }, orderBy: { updatedAt: "desc" } }) : null;
  const decision = decidePrivacy({ contactPointDoNotContact: point?.doNotContact ?? false, legacyDoNotContact: lead.contactPreference === "DO_NOT_CONTACT", consentState: state?.state ?? "UNKNOWN", purposeStatus: version?.status ?? null, legalBasisStatus: version?.legalBasis?.status ?? null, enforced: process.env.NODE_ENV === "production" });
  const result = { ...decision, mode: process.env.NODE_ENV === "production" ? "ENFORCED" as const : "SHADOW_LOCAL" as const, contactId: lead.contactId, contactPointId: point?.id ?? null, purpose: purpose ? { id: purpose.id, name: purpose.name, version: version?.version ?? null, versionId: version?.id ?? null, status: version?.status ?? null, noticeVersion: version?.noticeVersion ?? null } : null, consentState: state?.state ?? "UNKNOWN" as const, evaluatedAt: new Date().toISOString(), ruleVersion: PRIVACY_RULE_VERSION };
  const persisted = input.persist
    ? await tx.privacyDecision.create({ data: { workspaceId: input.workspaceId, contactId: lead.contactId, contactPointId: point?.id ?? null, purposeVersionId: version?.id ?? null, channel: input.channel, intendedAction: input.intendedAction, outcome: decision.outcome, mode: result.mode, legalBasisStatus: version?.legalBasis?.status ?? null, consentState: result.consentState, reasonCodes: [...decision.reasonCodes], missingEvidence: [...decision.missingEvidence], ruleVersion: PRIVACY_RULE_VERSION, actorId: input.actorId }, select: { id: true } })
    : null;
  return { lead, result: { ...result, decisionId: persisted?.id ?? null } };
}

export async function evaluatePrivacyInTransaction(
  tx: Tx,
  input: Readonly<{
    workspaceId: string;
    actorId: string;
    leadId: string;
    channel: PrivacyChannel;
    intendedAction: string;
    contactPointId?: string | null;
    persist?: boolean;
  }>,
) {
  return (await currentDecision(tx, { ...input, persist: input.persist ?? true })).result;
}

export async function assertContactAllowedInTransaction(tx: Tx, input: Readonly<{ workspaceId: string; actorId: string; leadId: string; channel: PrivacyChannel; intendedAction: string }>) {
  const { result } = await currentDecision(tx, { ...input, persist: true });
  if (result.outcome === "DENY") fail("Contato bloqueado pela política de privacidade.", "PRIVACY_CONTACT_DENIED", 409);
  return result;
}

export async function cancelPendingOutboundForContactInTransaction(
  tx: Tx,
  input: Readonly<{
    workspaceId: string;
    contactId: string;
    contactPointId?: string | null;
    actorId: string;
    now: Date;
    reasonCode: string;
  }>,
) {
  const pendingMessages = await tx.message.findMany({
    where: {
      workspaceId: input.workspaceId,
      direction: "OUTBOUND",
      status: { in: ["DRAFT", "QUEUED", "ACCEPTED_INTERNAL", "FAILED_TRANSIENT"] },
      conversation: { contactId: input.contactId, ...(input.contactPointId ? { contactPointId: input.contactPointId } : {}) },
    },
    select: { id: true },
  });
  for (const message of pendingMessages) {
    await tx.outboxEvent.updateMany({ where: { workspaceId: input.workspaceId, messageId: message.id, status: { in: ["PENDING", "PROCESSING", "RETRY_PENDING"] } }, data: { status: "CANCELLED", nextRetryAt: null, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorClass: "PRIVACY_BLOCKED", errorCode: input.reasonCode, errorMessage: "Entrega cancelada após bloqueio de privacidade." } });
    await tx.job.updateMany({ where: { workspaceId: input.workspaceId, messageDeliveryAttempts: { some: { messageId: message.id } }, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "CANCELLED", cancelledAt: input.now, finishedAt: input.now, updatedByActorId: input.actorId, errorCode: input.reasonCode, lastError: "Entrega cancelada após bloqueio de privacidade." } });
    const sequence = await tx.messageStatusEvent.count({ where: { workspaceId: input.workspaceId, messageId: message.id } });
    await tx.messageStatusEvent.create({ data: { workspaceId: input.workspaceId, messageId: message.id, status: "CANCELLED", sequence: sequence + 1, source: "INTERNAL", reasonCode: input.reasonCode, actorId: input.actorId, ingestedAt: input.now } });
    await tx.message.update({ where: { id: message.id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
  }
  return { cancelledMessages: pendingMessages.length };
}

export function createPrivacyService(options: Options) {
  const authorization = getAuthorizationService();

  async function getLeadStatus(context: AuthenticatedContext, leadId: string, channel: PrivacyChannel = "PHONE") {
    const lead = await findLead(options.database, context.workspaceId, leadId);
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_STATUS_READ, leadResource(context.workspaceId, lead));
    if (!lead.contactId) {
      return {
        outcome: "REVIEW_REQUIRED" as const,
        reasonCodes: ["CONTACT_IDENTITY_MISSING"],
        missingEvidence: ["canonical_contact"],
        mode: process.env.NODE_ENV === "production" ? "ENFORCED" as const : "SHADOW_LOCAL" as const,
        contactId: null,
        contactPointId: null,
        purpose: null,
        consentState: "UNKNOWN" as const,
        evaluatedAt: options.now().toISOString(),
        ruleVersion: PRIVACY_RULE_VERSION,
      };
    }
    return (await options.database.$transaction((tx) => currentDecision(tx, { workspaceId: context.workspaceId, actorId: context.actorId, leadId, channel, intendedAction: "STATUS_READ", persist: false }))).result;
  }

  async function evaluate(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ leadId: z.string().uuid(), channel: channelSchema, intendedAction: z.string().trim().min(3).max(120) }).strict().parse(raw);
    const lead = await leadSnapshot(options.database, context.workspaceId, input.leadId);
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_STATUS_READ, leadResource(context.workspaceId, lead));
    return (await options.database.$transaction((tx) => currentDecision(tx, { workspaceId: context.workspaceId, actorId: context.actorId, ...input, persist: true }))).result;
  }

  async function recordConsent(context: AuthenticatedContext, raw: unknown) {
    const input = consentInput.parse(raw);
    const lead = await leadSnapshot(options.database, context.workspaceId, input.leadId);
    await authorization.assertAuthorized(context, input.action === "CORRECTED" ? PermissionKeys.PRIVACY_CONSENT_CORRECT : PermissionKeys.PRIVACY_CONSENT_RECORD, leadResource(context.workspaceId, lead));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-consent:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const version = await tx.purposeVersion.findFirst({ where: { id: input.purposeVersionId, workspaceId: context.workspaceId }, include: { purpose: true, legalBasis: true } });
      if (!version) fail("Finalidade não encontrada neste workspace.", "PURPOSE_NOT_FOUND", 404);
      const point = input.contactPointId ? await tx.contactPoint.findFirst({ where: { id: input.contactPointId, workspaceId: context.workspaceId, contactId: lead.contactId, deletedAt: null } }) : null;
      if (input.contactPointId && !point) fail("Ponto de contato não encontrado.", "CONTACT_POINT_NOT_FOUND", 404);
      if (input.action === "GRANTED" && !input.evidenceReference) fail("Consentimento concedido exige referência de prova.", "CONSENT_EVIDENCE_REQUIRED", 409);
      if (input.action === "CORRECTED" && !input.correctionOfId) fail("Correção exige o evento corrigido.", "CORRECTION_REFERENCE_REQUIRED", 409);
      if (input.correctionOfId) {
        const corrected = await tx.consentEvent.findFirst({ where: { id: input.correctionOfId, workspaceId: context.workspaceId, contactId: lead.contactId } });
        if (!corrected) fail("Evento corrigido não encontrado.", "CONSENT_EVENT_NOT_FOUND", 404);
      }
      const effect = input.action === "GRANTED" && version.status === "ACTIVE" && version.legalBasis?.status === "ACTIVE" ? "GRANTED" : input.action === "GRANTED" || input.action === "CORRECTED" ? "REVIEW_REQUIRED" : "DENIED";
      let event = await tx.consentEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (event) {
        if (event.contactId !== lead.contactId || event.purposeVersionId !== version.id || event.channel !== input.channel || event.action !== input.action) fail("A chave idempotente já foi usada com outro consentimento.", "IDEMPOTENCY_CONFLICT", 409);
        const existingState = await tx.consentState.findFirst({ where: { workspaceId: context.workspaceId, contactId: lead.contactId, contactPointId: point?.id ?? null, purposeId: version.purposeId, channel: input.channel } });
        return { eventId: event.id, state: existingState?.state ?? "UNKNOWN", effect: event.effect };
      }
      if (!event) event = await tx.consentEvent.create({ data: { workspaceId: context.workspaceId, contactId: lead.contactId, contactPointId: point?.id ?? null, purposeVersionId: version.id, channel: input.channel, action: input.action, effect, occurredAt: input.occurredAt, capturedAt: options.now(), source: "MANUAL", noticeVersion: version.noticeVersion, evidenceReference: input.evidenceReference ?? null, evidenceQuality: input.evidenceReference ? "REFERENCED" : "MISSING", correctionOfId: input.correctionOfId ?? null, actorId: context.actorId, idempotencyKey: input.idempotencyKey } });
      const nextState = input.action === "OPTED_OUT" ? "OPTED_OUT" : input.action === "REVOKED" ? "REVOKED" : input.action === "DENIED" ? "DENIED" : effect === "GRANTED" ? "GRANTED" : "REVIEW_REQUIRED";
      const state = await projectConsentState(tx, { workspaceId: context.workspaceId, contactId: lead.contactId, contactPointId: point?.id ?? null, purposeId: version.purposeId, channel: input.channel, state: nextState, reasonCode: `MANUAL_${input.action}`, sourceEventId: event.id, effectiveFrom: input.occurredAt });
      if (input.action === "OPTED_OUT" || input.action === "REVOKED") {
        if (point) await tx.contactPoint.update({ where: { id: point.id }, data: { doNotContact: true, updatedByActorId: context.actorId } });
        await tx.lead.updateMany({ where: { workspaceId: context.workspaceId, contactId: lead.contactId, contactPreference: { not: "DO_NOT_CONTACT" } }, data: { contactPreference: "DO_NOT_CONTACT", contactPreferenceUpdatedAt: input.occurredAt, updatedByActorId: context.actorId } });
        await cancelPendingOutboundForContactInTransaction(tx, { workspaceId: context.workspaceId, contactId: lead.contactId, contactPointId: point?.id ?? null, actorId: context.actorId, now: options.now(), reasonCode: input.action === "OPTED_OUT" ? "PRIVACY_OPT_OUT" : "PRIVACY_REVOKED" });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.consent.recorded", entityType: "ConsentEvent", entityId: event.id, reason: input.reason, changes: { action: input.action, effect, state: state.state, purposeVersionId: version.id, channel: input.channel } } });
      return { eventId: event.id, state: state.state, effect };
    }, { isolationLevel: "ReadCommitted" });
  }

  async function summary(context: AuthenticatedContext) {
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_DSR_READ, { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId });
    const [states, policies, requests, actions, holds, decisions] = await Promise.all([
      options.database.consentState.groupBy({ by: ["state"], where: { workspaceId: context.workspaceId }, _count: { _all: true } }),
      options.database.purposeVersion.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId }, _count: { _all: true } }),
      options.database.dataSubjectRequest.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId }, _count: { _all: true } }),
      options.database.retentionAction.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId }, _count: { _all: true } }),
      options.database.legalHold.count({ where: { workspaceId: context.workspaceId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: options.now() } }] } }),
      options.database.privacyDecision.groupBy({ by: ["outcome"], where: { workspaceId: context.workspaceId }, _count: { _all: true } }),
    ]);
    return { states, policies, requests, retentionActions: actions, activeLegalHolds: holds, decisions, generatedAt: options.now().toISOString(), legalConfigurationPending: !policies.some((item) => item.status === "ACTIVE" && item._count._all > 0) };
  }

  async function getScreen(context: AuthenticatedContext) {
    const workspace = { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId } as const;
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_DSR_READ, workspace);
    const [overview, purposes, requests, holds, actions, categories, consentEvents, manageDsr, manageHold, manageRetention, canBackfill] = await Promise.all([
      summary(context),
      options.database.processingPurpose.findMany({
        where: { workspaceId: context.workspaceId, active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true, version: true, status: true, noticeVersion: true, allowedChannels: true, legalBasis: { select: { name: true, status: true } } },
          },
        },
      }),
      options.database.dataSubjectRequest.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        take: 50,
        select: { id: true, type: true, status: true, verificationStatus: true, reason: true, requestedAt: true, dueAt: true, completedAt: true, contact: { select: { preferredName: true, legalName: true } } },
      }),
      options.database.legalHold.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: { id: true, scopeType: true, reason: true, authorityReference: true, status: true, startsAt: true, endsAt: true, contact: { select: { preferredName: true, legalName: true } } },
      }),
      options.database.retentionAction.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: { id: true, action: true, status: true, blockerCodes: true, reason: true, dueAt: true, createdAt: true },
      }),
      options.database.dataCategory.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, sensitivity: true } }),
      options.database.consentEvent.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 25,
        select: { id: true, action: true, effect: true, channel: true, occurredAt: true, evidenceQuality: true, purposeVersion: { select: { version: true, purpose: { select: { name: true } } } }, contact: { select: { preferredName: true, legalName: true } } },
      }),
      authorization.authorize(context, PermissionKeys.PRIVACY_DSR_MANAGE, workspace),
      authorization.authorize(context, PermissionKeys.PRIVACY_LEGAL_HOLD_MANAGE, workspace),
      authorization.authorize(context, PermissionKeys.PRIVACY_RETENTION_MANAGE, workspace),
      authorization.authorize(context, PermissionKeys.PRIVACY_BACKFILL, workspace),
    ]);
    return {
      overview,
      purposes: purposes.map((purpose) => ({ ...purpose, currentVersion: purpose.versions[0] ?? null, versions: undefined })),
      requests,
      holds,
      retentionActions: actions,
      categories,
      consentEvents,
      permissions: { canManageDsr: manageDsr.allowed, canManageLegalHold: manageHold.allowed, canManageRetention: manageRetention.allowed, canBackfill: canBackfill.allowed },
      generatedAt: options.now().toISOString(),
    };
  }

  async function createDsr(context: AuthenticatedContext, raw: unknown) {
    const input = dsrCreateInput.parse(raw);
    const lead = await leadSnapshot(options.database, context.workspaceId, input.leadId);
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_DSR_MANAGE, leadResource(context.workspaceId, lead));
    return options.database.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-dsr:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
        const existing = await tx.dataSubjectRequest.findFirst({ where: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } });
        if (existing) {
          if (existing.contactId !== lead.contactId || existing.type !== input.type) fail("A chave idempotente já foi usada por outra solicitação.", "IDEMPOTENCY_CONFLICT", 409);
          return existing;
        }
      }
      const foundation = await ensurePrivacyFoundation(tx, context.workspaceId, context.actorId);
      const ownerMemberId = input.ownerMemberId ?? null;
      const queueId = input.queueId ?? (!ownerMemberId ? (await tx.queue.findFirst({ where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null }, select: { id: true } }))?.id ?? null : null);
      if (Boolean(ownerMemberId) === Boolean(queueId)) fail("A solicitação exige exatamente um responsável ou fila.", "DSR_OWNER_REQUIRED", 409);
      const validCategories = await tx.dataCategory.findMany({ where: { workspaceId: context.workspaceId, id: { in: input.categoryIds }, active: true }, select: { id: true } });
      if (validCategories.length !== new Set(input.categoryIds).size) fail("Categoria de dados inválida.", "INVALID_DATA_CATEGORY", 409);
      const request = await tx.dataSubjectRequest.create({ data: { workspaceId: context.workspaceId, contactId: lead.contactId, type: input.type, receivedChannel: input.receivedChannel, status: "IDENTITY_PENDING", verificationStatus: "PENDING", ownerMemberId, queueId, reason: input.reason, requestedAt: options.now(), dueAt: new Date(options.now().getTime() + 15 * 24 * 60 * 60_000), createdByActorId: context.actorId, updatedByActorId: context.actorId, idempotencyKey: input.idempotencyKey ?? null } });
      await tx.dataSubjectRequestCategory.createMany({ data: validCategories.map(({ id }) => ({ workspaceId: context.workspaceId, requestId: request.id, dataCategoryId: id })) });
      await tx.dataSubjectRequestEvent.create({ data: { workspaceId: context.workspaceId, requestId: request.id, kind: "CREATED", toStatus: request.status, reason: input.reason, evidence: { identityStatus: request.verificationStatus, categoryCount: validCategories.length, ownerMemberId, queueId }, actorId: context.actorId } });
      if (input.type === "DELETION") await tx.retentionAction.create({ data: { workspaceId: context.workspaceId, retentionPolicyVersionId: foundation.retentionVersion.id, contactId: lead.contactId, requestId: request.id, action: "REVIEW", status: "BLOCKED", preview: { categoryCount: validCategories.length, destructiveExecution: false }, blockerCodes: ["POLICY_PENDING_LEGAL", "HUMAN_APPROVAL_REQUIRED"], reason: "Eliminação ampla bloqueada até aprovação jurídica e preview humano.", idempotencyKey: `dsr:${request.id}:retention-preview`, createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.dsr.created", entityType: "DataSubjectRequest", entityId: request.id, reason: input.reason, changes: { type: input.type, status: request.status, categoryCount: validCategories.length } } });
      return request;
    });
  }

  async function transitionDsr(context: AuthenticatedContext, raw: unknown) {
    const input = dsrTransitionInput.parse(raw);
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_DSR_MANAGE, { workspaceId: context.workspaceId, resourceType: "DataSubjectRequest", resourceId: input.requestId });
    return options.database.$transaction(async (tx) => {
      const request = await tx.dataSubjectRequest.findFirst({ where: { id: input.requestId, workspaceId: context.workspaceId } });
      if (!request) fail("Solicitação não encontrada.", "DSR_NOT_FOUND", 404);
      if (!canTransitionDsr(request.status, input.toStatus)) fail("Transição inválida para a solicitação.", "INVALID_DSR_TRANSITION", 409);
      const verifying = input.toStatus === "IN_REVIEW" && request.verificationStatus !== "VERIFIED";
      if (verifying && (!input.verificationMethod || !input.verificationReference)) fail("Revisão exige verificação de identidade sem documento bruto.", "IDENTITY_VERIFICATION_REQUIRED", 409);
      const verificationData: Prisma.DataSubjectRequestUpdateInput = verifying
        ? {
            verificationStatus: "VERIFIED",
            verificationMethod: input.verificationMethod ?? null,
            verificationReference: input.verificationReference ?? null,
            verifiedAt: options.now(),
          }
        : {};
      const completionData: Prisma.DataSubjectRequestUpdateInput = input.toStatus === "COMPLETED"
        ? { completedAt: options.now(), decision: input.reason }
        : {};
      const updated = await tx.dataSubjectRequest.update({
        where: { id: request.id },
        data: {
          status: input.toStatus,
          ...verificationData,
          ...completionData,
          updatedByActorId: context.actorId,
        },
      });
      await tx.dataSubjectRequestEvent.create({ data: { workspaceId: context.workspaceId, requestId: request.id, kind: verifying ? "IDENTITY_VERIFIED" : input.toStatus === "COMPLETED" ? "COMPLETED" : "STATUS_CHANGED", fromStatus: request.status, toStatus: updated.status, reason: input.reason, evidence: { verificationStatus: updated.verificationStatus }, actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.dsr.transitioned", entityType: "DataSubjectRequest", entityId: request.id, reason: input.reason, changes: { from: request.status, to: updated.status, identityVerified: updated.verificationStatus === "VERIFIED" } } });
      return updated;
    });
  }

  async function exportDsr(context: AuthenticatedContext, requestId: string) {
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_DSR_EXPORT, { workspaceId: context.workspaceId, resourceType: "DataSubjectRequest", resourceId: requestId });
    return options.database.$transaction(async (tx) => {
      const request = await tx.dataSubjectRequest.findFirst({ where: { id: requestId, workspaceId: context.workspaceId, verificationStatus: "VERIFIED" }, include: { contact: { select: { id: true, preferredName: true, legalName: true, locale: true, points: { where: { deletedAt: null }, select: { type: true, originalValue: true, verificationStatus: true, doNotContact: true } } } }, categories: { include: { dataCategory: { select: { code: true, name: true } } } } } });
      if (!request) fail("Solicitação não verificada ou inexistente.", "DSR_EXPORT_NOT_ALLOWED", 409);
      const generatedAt = options.now();
      const expiresAt = new Date(generatedAt.getTime() + 15 * 60_000);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.dsr.exported", entityType: "DataSubjectRequest", entityId: request.id, changes: { categoryCount: request.categories.length, expiresAt: expiresAt.toISOString(), excludesThirdPartyData: true } } });
      await tx.dataSubjectRequestEvent.create({ data: { workspaceId: context.workspaceId, requestId: request.id, kind: "EXPORT_GENERATED", reason: "Pacote mínimo de acesso/portabilidade gerado por usuário autorizado.", evidence: { categoryCount: request.categories.length, excludesThirdPartyData: true }, result: { expiresAt: expiresAt.toISOString() }, actorId: context.actorId } });
      return { requestId: request.id, subject: request.contact, categories: request.categories.map((item) => item.dataCategory), generatedAt: generatedAt.toISOString(), expiresAt: expiresAt.toISOString(), limitations: ["Não inclui dados de terceiros, segredos, hashes, sessões ou conteúdo interno fora do escopo."] };
    });
  }

  async function createLegalHold(context: AuthenticatedContext, raw: unknown) {
    const input = holdInput.parse(raw);
    const lead = await leadSnapshot(options.database, context.workspaceId, input.leadId);
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_LEGAL_HOLD_MANAGE, leadResource(context.workspaceId, lead));
    const hold = await options.database.legalHold.create({ data: { workspaceId: context.workspaceId, contactId: lead.contactId, requestId: input.requestId ?? null, dataCategoryId: input.dataCategoryId ?? null, scopeType: input.dataCategoryId ? "DATA_CATEGORY" : "CONTACT", scopeReference: input.dataCategoryId ?? lead.contactId, reason: input.reason, authorityReference: input.authorityReference, startsAt: options.now(), endsAt: input.endsAt ?? null, createdByActorId: context.actorId } });
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.legal_hold.created", entityType: "LegalHold", entityId: hold.id, reason: input.reason, changes: { scopeType: hold.scopeType, endsAt: hold.endsAt?.toISOString() ?? null } } });
    return hold;
  }


  async function previewRetention(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ leadId: z.string().uuid(), dataCategoryId: z.string().uuid().nullable().optional(), reason: z.string().trim().min(3).max(1000), idempotencyKey: z.string().trim().min(8).max(200) }).strict().parse(raw);
    const lead = await leadSnapshot(options.database, context.workspaceId, input.leadId);
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_RETENTION_MANAGE, leadResource(context.workspaceId, lead));
    return options.database.$transaction(async (tx) => {
      const foundation = await ensurePrivacyFoundation(tx, context.workspaceId, context.actorId);
      const holdTargets: Prisma.LegalHoldWhereInput[] = [{ contactId: lead.contactId }];
      if (input.dataCategoryId) holdTargets.push({ dataCategoryId: input.dataCategoryId });
      const holds = await tx.legalHold.count({ where: { workspaceId: context.workspaceId, status: "ACTIVE", OR: holdTargets, AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: options.now() } }] }] } });
      const blockerCodes = [
        ...(foundation.retentionVersion.status !== "ACTIVE" ? ["POLICY_PENDING_LEGAL"] : []),
        ...(holds > 0 ? ["ACTIVE_LEGAL_HOLD"] : []),
        "HUMAN_APPROVAL_REQUIRED",
      ];
      const action = await tx.retentionAction.upsert({
        where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } },
        update: {},
        create: {
          workspaceId: context.workspaceId,
          retentionPolicyVersionId: foundation.retentionVersion.id,
          contactId: lead.contactId,
          dataCategoryId: input.dataCategoryId ?? null,
          action: "REVIEW",
          status: blockerCodes.length > 0 ? "BLOCKED" : "PLANNED",
          preview: { destructiveExecution: false, target: "CONTACT", contactId: lead.contactId, dataCategoryId: input.dataCategoryId ?? null },
          blockerCodes,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          createdByActorId: context.actorId,
        },
      });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.retention.previewed", entityType: "RetentionAction", entityId: action.id, reason: input.reason, changes: { status: action.status, blockerCodes: action.blockerCodes, destructiveExecution: false } } });
      return action;
    });
  }

  return Object.freeze({ getLeadStatus, evaluate, recordConsent, summary, getScreen, createDsr, transitionDsr, exportDsr, createLegalHold, previewRetention });
}

let service: ReturnType<typeof createPrivacyService> | undefined;
export function getPrivacyService() {
  service ??= createPrivacyService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
