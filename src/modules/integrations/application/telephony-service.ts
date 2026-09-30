import { createHash } from "node:crypto";

import { Prisma, type PrismaClient, type TelephonyCallStatus } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  recordTelephonyDispositionInTransaction,
  registerTelephonyConnectedInTransaction,
  registerTelephonyFirstAttemptInTransaction,
  registerTelephonyOutcomeInTransaction,
} from "@/modules/activities/application/telephony-activity-writer";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import {
  TELEPHONY_CONTRACT_VERSION,
  TELEPHONY_JOB_MAX_ATTEMPTS,
  TELEPHONY_PROVIDER_KEY,
  TELEPHONY_SIMULATION_LABEL,
  assessTelephonyEvent,
  isWithinTelephonyContactWindow,
  normalizeTelephonyAddress,
  sanitizeTelephonyMetadata,
  telephonyStatusRank,
  telephonyCallbackSchema,
  telephonyConfigureSchema,
  telephonyDispositionSchema,
  telephonyStartCallSchema,
  verifyLocalTelephonyCallback,
  type TelephonyCallback,
} from "@/modules/integrations/domain/telephony-contracts";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function workspaceResource(context: AuthenticatedContext): ResourceScope {
  return { workspaceId: context.workspaceId, resourceType: "TelephonyConnectionProfile", resourceId: context.workspaceId, ownerMemberId: context.memberId };
}

async function systemFoundation(tx: Tx, workspaceId: string) {
  const [actor, queue] = await Promise.all([
    tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.queue.findFirst({ where: { workspaceId, isGeneral: true, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  if (!actor) fail("Ator Sistema não configurado.", "TELEPHONY_SYSTEM_ACTOR_MISSING");
  if (!queue) fail("Fila Geral não configurada.", "TELEPHONY_GENERAL_QUEUE_MISSING");
  return { actor, queue };
}

async function currentProfile(database: PrismaClient | Tx, workspaceId: string) {
  return database.telephonyConnectionProfile.findFirst({
    where: { workspaceId },
    include: { connection: { include: { configVersions: { orderBy: { version: "desc" }, take: 1 } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function resolveTarget(database: PrismaClient | Tx, context: AuthenticatedContext, input: ReturnType<typeof telephonyStartCallSchema.parse>) {
  const where: Prisma.LeadWhereInput = input.leadId ? { id: input.leadId }
    : input.opportunityId ? { opportunities: { some: { id: input.opportunityId, deletedAt: null } } }
    : input.contactId ? { contactId: input.contactId }
    : { accountId: input.accountId! };
  const lead = await database.lead.findFirst({
    where: { ...where, workspaceId: context.workspaceId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true, fullName: true, normalizedPhone: true, contactId: true, accountId: true, campaignId: true,
      ownerMemberId: true, queueId: true, routingQueueId: true, priority: true,
      routingQueue: { select: { teamId: true } },
      contact: { select: { points: { where: { type: "PHONE", deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { id: true, normalizedValue: true, doNotContact: true } } } },
    },
  });
  if (!lead) fail("Alvo de telefonia não encontrado neste workspace.", "TELEPHONY_TARGET_NOT_FOUND", 404);
  const opportunity = input.opportunityId ? await database.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: context.workspaceId, leadId: lead.id, deletedAt: null }, select: { id: true } }) : null;
  const meeting = input.meetingId ? await database.meeting.findFirst({ where: { id: input.meetingId, workspaceId: context.workspaceId, leadId: lead.id }, select: { id: true } }) : null;
  if (input.opportunityId && !opportunity) fail("Oportunidade não pertence ao alvo.", "TELEPHONY_OPPORTUNITY_MISMATCH", 404);
  if (input.meetingId && !meeting) fail("Reunião não pertence ao alvo.", "TELEPHONY_MEETING_MISMATCH", 404);
  return { lead, opportunityId: opportunity?.id ?? null, meetingId: meeting?.id ?? null, point: lead.contact?.points[0] ?? null };
}

function targetResource(context: AuthenticatedContext, target: Awaited<ReturnType<typeof resolveTarget>>): ResourceScope {
  return {
    workspaceId: context.workspaceId,
    resourceType: "PhoneCall",
    resourceId: target.lead.id,
    ownerMemberId: target.lead.ownerMemberId,
    queueId: target.lead.queueId ?? target.lead.routingQueueId,
    teamId: target.lead.routingQueue?.teamId ?? null,
  };
}

async function scopeFilter(context: AuthenticatedContext, permission: typeof PermissionKeys.TELEPHONY_READ, options: Options) {
  const decision = await getAuthorizationService().authorize(context, permission, workspaceResource(context));
  if (!decision.allowed) await getAuthorizationService().assertAuthorized(context, permission, workspaceResource(context));
  if (!decision.allowed || decision.scope === "WORKSPACE") return {};
  if (decision.scope === "OWN") return { ownerMemberId: context.memberId } satisfies Prisma.PhoneCallWhereInput;
  const teams = await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
  return { OR: [{ ownerMemberId: context.memberId }, { teamId: { in: teams.map((item) => item.teamId) } }] } satisfies Prisma.PhoneCallWhereInput;
}

function messageStatus(status: TelephonyCallStatus) {
  if (status === "INITIATED") return "ACCEPTED_INTERNAL" as const;
  if (status === "RINGING") return "SENT" as const;
  if (status === "ANSWERED" || status === "COMPLETED") return "DELIVERED" as const;
  if (status === "CANCELLED") return "CANCELLED" as const;
  if (status === "FAILED") return "FAILED_PERMANENT" as const;
  return "SENT" as const;
}

type TelephonyTimestampProjection = Readonly<{
  initiatedAt?: Date;
  ringingAt?: Date;
  answeredAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}>;

function timeProjection(
  status: TelephonyCallStatus,
  occurredAt: Date,
  current: Readonly<{ initiatedAt: Date | null; ringingAt: Date | null; answeredAt: Date | null }>,
): TelephonyTimestampProjection {
  if (status === "INITIATED" && !current.initiatedAt) return { initiatedAt: occurredAt };
  if (status === "RINGING" && !current.ringingAt) return { ringingAt: occurredAt };
  if (status === "ANSWERED" && !current.answeredAt) return { answeredAt: occurredAt };
  if (status === "COMPLETED") return { completedAt: occurredAt };
  if (status === "CANCELLED") return { cancelledAt: occurredAt };
  if (["BUSY", "NO_ANSWER", "FAILED", "VOICEMAIL"].includes(status)) return { completedAt: occurredAt };
  return {};
}

function legTimeProjection(
  status: TelephonyCallStatus,
  occurredAt: Date,
  current: Readonly<{ initiatedAt: Date | null; ringingAt: Date | null; answeredAt: Date | null }>,
): Omit<TelephonyTimestampProjection, "cancelledAt"> {
  const projection = timeProjection(status, occurredAt, current);
  if (projection.cancelledAt) return { completedAt: projection.cancelledAt };
  return projection;
}

export async function applyTelephonyEventInTransaction(tx: Tx, input: Readonly<{ workspaceId: string; actorId: string; event: TelephonyCallback; source?: "INTERNAL" | "LOCAL_SIMULATOR" | "PROVIDER" | "REPLAY" }>) {
  const duplicate = await tx.phoneCallStatusEvent.findFirst({ where: { workspaceId: input.workspaceId, providerKey: TELEPHONY_PROVIDER_KEY, externalEventId: input.event.eventId } });
  if (duplicate) return { status: "DUPLICATE" as const, eventId: duplicate.id };
  const call = await tx.phoneCall.findFirst({ where: { id: input.event.callId, workspaceId: input.workspaceId }, include: { statusEvents: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 1 }, lead: { select: { id: true } } } });
  if (!call) fail("Ligação não encontrada neste workspace.", "TELEPHONY_CALL_NOT_FOUND", 404);
  const assessment = assessTelephonyEvent({ currentStatus: call.status, currentSequence: call.statusSequence, incomingStatus: input.event.status, incomingSequence: input.event.sequence, latestOccurredAt: call.statusEvents[0]?.occurredAt ?? null, occurredAt: input.event.occurredAt });
  const latestOccurredAt = call.statusEvents[0]?.occurredAt ?? null;
  const laterTransferLegEvent = Boolean(
    input.event.leg
      && input.event.sequence > call.statusSequence
      && (!latestOccurredAt || input.event.occurredAt >= latestOccurredAt)
      && telephonyStatusRank[input.event.status] < telephonyStatusRank[call.status],
  );
  if (!assessment.project && !laterTransferLegEvent) {
    const review = await tx.telephonyEventReview.upsert({
      where: { workspaceId_profileId_eventKey_reasonCode: { workspaceId: input.workspaceId, profileId: call.profileId, eventKey: input.event.eventId, reasonCode: assessment.reasonCode } },
      create: { workspaceId: input.workspaceId, profileId: call.profileId, callId: call.id, eventKey: input.event.eventId, reasonCode: assessment.reasonCode, evidence: json({ incomingStatus: input.event.status, incomingSequence: input.event.sequence, currentStatus: call.status, currentSequence: call.statusSequence }), createdByActorId: input.actorId },
      update: {},
    });
    await tx.phoneCall.update({ where: { id: call.id }, data: { reviewRequired: true, updatedByActorId: input.actorId } });
    return { status: "REVIEW_REQUIRED" as const, reviewId: review.id, reasonCode: assessment.reasonCode };
  }
  let legId: string | null = null;
  if (input.event.leg) {
    const priorLeg = await tx.phoneCallLeg.findUnique({
      where: { workspaceId_callId_sequence: { workspaceId: input.workspaceId, callId: call.id, sequence: input.event.leg.sequence } },
    });
    const leg = await tx.phoneCallLeg.upsert({
      where: { workspaceId_callId_sequence: { workspaceId: input.workspaceId, callId: call.id, sequence: input.event.leg.sequence } },
      create: { workspaceId: input.workspaceId, callId: call.id, role: input.event.leg.role, sequence: input.event.leg.sequence, status: input.event.status, phoneMasked: call.remotePhoneMasked, externalLegId: input.event.leg.externalLegId, ...legTimeProjection(input.event.status, input.event.occurredAt, { initiatedAt: null, ringingAt: null, answeredAt: null }) },
      update: { status: input.event.status, ...legTimeProjection(input.event.status, input.event.occurredAt, priorLeg ?? { initiatedAt: null, ringingAt: null, answeredAt: null }) },
    });
    legId = leg.id;
  } else {
    const primaryLeg = await tx.phoneCallLeg.findUnique({ where: { workspaceId_callId_sequence: { workspaceId: input.workspaceId, callId: call.id, sequence: 1 } } });
    if (primaryLeg) {
      await tx.phoneCallLeg.update({ where: { id: primaryLeg.id }, data: { status: input.event.status, ...legTimeProjection(input.event.status, input.event.occurredAt, primaryLeg) } });
      legId = primaryLeg.id;
    }
  }
  await tx.phoneCallStatusEvent.create({ data: { workspaceId: input.workspaceId, callId: call.id, legId, status: input.event.status, sequence: input.event.sequence, source: input.source ?? "LOCAL_SIMULATOR", providerReported: false, providerKey: TELEPHONY_PROVIDER_KEY, externalEventId: input.event.eventId, occurredAt: input.event.occurredAt, reasonCode: input.event.reasonCode ?? null, safeMetadata: json(sanitizeTelephonyMetadata(input.event.metadata) ?? {}), actorId: input.actorId } });
  const terminalStatus = ["COMPLETED", "BUSY", "NO_ANSWER", "CANCELLED", "FAILED", "VOICEMAIL"].includes(input.event.status);
  if (terminalStatus && legId) {
    const terminalLeg = await tx.phoneCallLeg.findUnique({ where: { id: legId } });
    if (terminalLeg) {
      const startedAt = terminalLeg.initiatedAt ?? terminalLeg.ringingAt ?? call.queuedAt;
      await tx.phoneCallLeg.update({
        where: { id: legId },
        data: {
          durationSeconds: Math.max(0, Math.floor((input.event.occurredAt.getTime() - startedAt.getTime()) / 1_000)),
          talkDurationSeconds: terminalLeg.answeredAt ? Math.max(0, Math.floor((input.event.occurredAt.getTime() - terminalLeg.answeredAt.getTime()) / 1_000)) : 0,
        },
      });
    }
  }
  const baseDuration = Math.max(0, Math.floor((input.event.occurredAt.getTime() - call.queuedAt.getTime()) / 1_000));
  const data: Prisma.PhoneCallUpdateInput = laterTransferLegEvent
    ? { statusSequence: input.event.sequence, updatedBy: { connect: { workspaceId_id: { workspaceId: input.workspaceId, id: input.actorId } } } }
    : { status: input.event.status, statusSequence: input.event.sequence, ...timeProjection(input.event.status, input.event.occurredAt, call), updatedBy: { connect: { workspaceId_id: { workspaceId: input.workspaceId, id: input.actorId } } } };
  if (terminalStatus) {
    data.durationSeconds = baseDuration;
    data.talkDurationSeconds = call.answeredAt ? Math.max(0, Math.floor((input.event.occurredAt.getTime() - call.answeredAt.getTime()) / 1_000)) : 0;
  }
  await tx.phoneCall.update({ where: { id: call.id }, data });
  await tx.message.update({ where: { id: call.messageId }, data: { ...(laterTransferLegEvent ? {} : { status: messageStatus(input.event.status) }), lastProviderStatusAt: input.event.occurredAt, revision: { increment: 1 } } });
  if (input.event.status === "INITIATED" && call.leadId) await registerTelephonyFirstAttemptInTransaction(tx, { workspaceId: input.workspaceId, leadId: call.leadId, actorId: call.createdByActorId, occurredAt: input.event.occurredAt });
  if (input.event.status === "ANSWERED" && call.leadId) await registerTelephonyConnectedInTransaction(tx, { workspaceId: input.workspaceId, leadId: call.leadId, occurredAt: input.event.occurredAt });
  if (terminalStatus && call.leadId) {
    await registerTelephonyOutcomeInTransaction(tx, { workspaceId: input.workspaceId, callId: call.id, leadId: call.leadId, opportunityId: call.opportunityId, messageId: call.messageId, actorId: call.createdByActorId, status: input.event.status, occurredAt: input.event.occurredAt, durationSeconds: baseDuration, talkDurationSeconds: call.answeredAt ? Math.max(0, Math.floor((input.event.occurredAt.getTime() - call.answeredAt.getTime()) / 1_000)) : 0 });
  }
  return { status: "APPLIED" as const, callId: call.id, projectedStatus: input.event.status };
}

export function createTelephonyService(options: Options) {
  const authorization = getAuthorizationService();

  async function screen(context: AuthenticatedContext) {
    const access = await scopeFilter(context, PermissionKeys.TELEPHONY_READ, options);
    const where: Prisma.PhoneCallWhereInput = { workspaceId: context.workspaceId, ...access };
    const profile = await currentProfile(options.database, context.workspaceId);
    const [groups, calls, connected, duration, attempts, dispositionGroups, openReviews, failedJobs, canStart, canCancel, canDisposition, canReplay, canConfigure, canViewSensitive] = await Promise.all([
      options.database.phoneCall.groupBy({ by: ["status"], where, _count: { _all: true } }),
      options.database.phoneCall.findMany({ where, orderBy: [{ queuedAt: "desc" }, { id: "desc" }], take: 50, include: { lead: { select: { id: true, fullName: true } }, opportunity: { select: { id: true, name: true } }, owner: { select: { user: { select: { displayName: true } } } }, queue: { select: { name: true } }, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } } }),
      options.database.phoneCall.count({ where: { ...where, answeredAt: { not: null } } }),
      options.database.phoneCall.aggregate({ where: { ...where, durationSeconds: { not: null } }, _avg: { durationSeconds: true, talkDurationSeconds: true } }),
      options.database.phoneCallAttempt.count({ where: { workspaceId: context.workspaceId, call: access } }),
      options.database.phoneCall.groupBy({ by: ["disposition"], where: { ...where, disposition: { not: null } }, _count: { _all: true } }),
      options.database.telephonyEventReview.count({ where: { workspaceId: context.workspaceId, status: "OPEN", ...(Object.keys(access).length ? { call: access } : {}) } }),
      options.database.job.count({ where: { workspaceId: context.workspaceId, type: "TELEPHONY_CALL", status: "FAILED" } }),
      authorization.authorize(context, PermissionKeys.TELEPHONY_START, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.TELEPHONY_CANCEL, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.TELEPHONY_DISPOSITION, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.TELEPHONY_REPLAY, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.TELEPHONY_CONFIGURE, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.TELEPHONY_VIEW_SENSITIVE, workspaceResource(context)),
    ]);
    const total = groups.reduce((sum, item) => sum + item._count._all, 0);
    return {
      generatedAt: options.now().toISOString(),
      externalEgress: false as const,
      recordingEnabled: false as const,
      transcriptionEnabled: false as const,
      activationStatus: !profile ? "CONFIGURATION_INCOMPLETE" as const : profile.operatingMode,
      profile: profile ? { id: profile.id, revision: profile.connection.revision, operatingMode: profile.operatingMode, originatorLabel: profile.originatorLabel, timeZone: profile.timeZone, contactWindowStartMinute: profile.contactWindowStartMinute, contactWindowEndMinute: profile.contactWindowEndMinute, contactWeekdays: profile.contactWeekdays } : null,
      metrics: { total, connected, connectRate: total ? connected / total : null, attempts, averageDurationSeconds: duration._avg.durationSeconds ?? null, averageTalkSeconds: duration._avg.talkDurationSeconds ?? null, openReviews, failedJobs, byStatus: Object.fromEntries(groups.map((item) => [item.status, item._count._all])), byDisposition: Object.fromEntries(dispositionGroups.map((item) => [item.disposition ?? "UNSET", item._count._all])) },
      calls: calls.map((call) => ({ id: call.id, leadId: call.leadId, leadName: call.lead?.fullName ?? "Contato sem lead", opportunityId: call.opportunity?.id ?? null, opportunityName: call.opportunity?.name ?? null, owner: call.owner?.user.displayName ?? call.queue?.name ?? "Sem atribuição", direction: call.direction, status: call.status, disposition: call.disposition, scenario: call.scenario, queuedAt: call.queuedAt.toISOString(), answeredAt: call.answeredAt?.toISOString() ?? null, completedAt: call.completedAt?.toISOString() ?? null, durationSeconds: call.durationSeconds, remotePhone: canViewSensitive.allowed ? call.calleePhoneE164 ?? call.remotePhoneMasked : call.remotePhoneMasked, simulationLabel: call.simulationLabel, revision: call.revision, lastAttempt: call.attempts[0] ? { attemptNumber: call.attempts[0].attemptNumber, status: call.attempts[0].status, errorCode: call.attempts[0].errorCode } : null })),
      permissions: { start: canStart.allowed, cancel: canCancel.allowed, disposition: canDisposition.allowed, replay: canReplay.allowed, configure: canConfigure.allowed, viewSensitive: canViewSensitive.allowed },
      checklist: ["Escolher provider e validar contrato", "Provisionar número e identidade", "Homologar chamadas PSTN", "Definir política jurídica de gravação", "Homologar webhooks externos e retenção"],
    };
  }

  async function startOutbound(context: AuthenticatedContext, raw: unknown) {
    const input = telephonyStartCallSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telephony-start:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telephony-target:${context.workspaceId}:${input.leadId ?? input.opportunityId ?? input.contactId ?? input.accountId}`}, 0))`;
      let target = await resolveTarget(tx, context, input);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telephony-lead:${context.workspaceId}:${target.lead.id}`}, 0))`;
      target = await resolveTarget(tx, context, input);
      await authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_START, targetResource(context, target));
      const existing = await tx.phoneCall.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return { status: existing.status, callId: existing.id, jobCreated: false, idempotent: true, externalEgress: false };
      const profile = await currentProfile(tx, context.workspaceId);
      if (!profile || profile.operatingMode !== "LOCAL_SIMULATOR" || !profile.connection.enabled) fail("Simulador de telefonia local não está ativo.", "TELEPHONY_LOCAL_SIMULATOR_INACTIVE");
      const foundation = await systemFoundation(tx, context.workspaceId);
      const normalized = normalizeTelephonyAddress(target.point?.normalizedValue ?? target.lead.normalizedPhone ?? "");
      if (!normalized.success) {
        const priorReview = await tx.telephonyEventReview.findFirst({ where: { workspaceId: context.workspaceId, profileId: profile.id, eventKey: `address:${input.idempotencyKey}` } });
        if (priorReview) return { status: "REVIEW_REQUIRED" as const, reviewId: priorReview.id, jobCreated: false, idempotent: true, externalEgress: false };
        const review = await tx.telephonyEventReview.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, eventKey: `address:${input.idempotencyKey}`, reasonCode: normalized.reasonCode, evidence: { phoneHash: normalized.hash, targetType: "LEAD", targetId: target.lead.id }, createdByActorId: context.actorId } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.call.blocked_for_identity_review", entityType: "TelephonyEventReview", entityId: review.id, changes: { reasonCode: normalized.reasonCode, externalEgress: false } } });
        return { status: "REVIEW_REQUIRED" as const, reviewId: review.id, jobCreated: false, idempotent: false, externalEgress: false };
      }
      const priorBlock = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "telephony.call.blocked_by_policy", entityType: "Lead", entityId: target.lead.id, changes: { path: ["idempotencyKey"], equals: input.idempotencyKey } }, orderBy: { occurredAt: "desc" } });
      if (priorBlock) {
        const changes = priorBlock.changes && typeof priorBlock.changes === "object" && !Array.isArray(priorBlock.changes) ? priorBlock.changes : {};
        const reasonCode = "reasonCode" in changes && typeof changes.reasonCode === "string" ? changes.reasonCode : "BLOCKED_BY_POLICY";
        return { status: "BLOCKED_BY_POLICY" as const, reasonCode, jobCreated: false, idempotent: true, externalEgress: false };
      }
      const privacy = await evaluatePrivacyInTransaction(tx, { workspaceId: context.workspaceId, actorId: context.actorId, leadId: target.lead.id, contactPointId: target.point?.id ?? null, channel: "PHONE", intendedAction: "TELEPHONY_OUTBOUND_START", persist: true });
      const suppression = await tx.telephonySuppression.findFirst({ where: { workspaceId: context.workspaceId, phoneHash: normalized.hash, purposeKey: "legacy-commercial-contact" }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] });
      const withinWindow = isWithinTelephonyContactWindow({ now: options.now(), timeZone: profile.timeZone, startMinute: profile.contactWindowStartMinute, endMinute: profile.contactWindowEndMinute, weekdays: profile.contactWeekdays });
      const blockedReason = privacy.outcome === "DENY" ? "PRIVACY_DENIED" : target.point?.doNotContact || suppression?.action === "APPLIED" ? "PHONE_SUPPRESSED" : !withinWindow ? "OUTSIDE_CONTACT_WINDOW" : null;
      if (blockedReason) {
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.call.blocked_by_policy", entityType: "Lead", entityId: target.lead.id, changes: { idempotencyKey: input.idempotencyKey, reasonCode: blockedReason, privacyDecisionId: privacy.decisionId, externalEgress: false } } });
        return { status: "BLOCKED_BY_POLICY" as const, reasonCode: blockedReason, jobCreated: false, idempotent: false, externalEgress: false };
      }
      const ownerMemberId = target.lead.ownerMemberId;
      const queueId = ownerMemberId ? null : target.lead.queueId ?? target.lead.routingQueueId ?? foundation.queue.id;
      const conversation = await tx.conversation.create({ data: { workspaceId: context.workspaceId, contactId: target.lead.contactId, contactPointId: target.point?.id ?? null, accountId: target.lead.accountId, leadId: target.lead.id, opportunityId: target.opportunityId, meetingId: target.meetingId, connectionId: profile.connectionId, assigneeMemberId: ownerMemberId, queueId, channel: "PHONE", status: "PENDING_INTERNAL", subject: `Ligação para ${target.lead.fullName}`, priority: target.lead.priority, externalThreadId: `${TELEPHONY_PROVIDER_KEY}:${input.correlationId}`, openedAt: options.now(), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      const message = await tx.message.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, senderActorId: context.actorId, direction: "OUTBOUND", type: "CALL_EVENT", status: "QUEUED", subject: "Ligação local simulada", body: null, bodyHash: sha256(`telephony:${input.idempotencyKey}`), providerKey: TELEPHONY_PROVIDER_KEY, idempotencyKey: `telephony-message:${input.idempotencyKey}`, clientCorrelationId: input.correlationId, privacyDecisionId: privacy.decisionId, purposeVersionId: privacy.purpose?.versionId ?? null, isSimulated: true, simulationLabel: TELEPHONY_SIMULATION_LABEL, occurredAt: options.now() } });
      const call = await tx.phoneCall.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, conversationId: conversation.id, messageId: message.id, contactId: target.lead.contactId, contactPointId: target.point?.id ?? null, accountId: target.lead.accountId, leadId: target.lead.id, opportunityId: target.opportunityId, meetingId: target.meetingId, campaignId: target.lead.campaignId, ownerMemberId, teamId: target.lead.routingQueue?.teamId ?? null, queueId, direction: "OUTBOUND", status: "QUEUED", calleePhoneE164: normalized.e164, remotePhoneHash: normalized.hash, remotePhoneMasked: normalized.masked, providerKey: TELEPHONY_PROVIDER_KEY, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, privacyDecisionId: privacy.decisionId, purposeVersionId: privacy.purpose?.versionId ?? null, isSimulated: true, simulationLabel: TELEPHONY_SIMULATION_LABEL, scenario: input.scenario, queuedAt: options.now(), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.phoneCallLeg.create({ data: { workspaceId: context.workspaceId, callId: call.id, role: "CUSTOMER", sequence: 1, status: "QUEUED", phoneE164: normalized.e164, phoneMasked: normalized.masked } });
      await tx.phoneCallStatusEvent.create({ data: { workspaceId: context.workspaceId, callId: call.id, status: "QUEUED", sequence: 1, source: "INTERNAL", providerReported: false, providerKey: TELEPHONY_PROVIDER_KEY, externalEventId: `queued:${call.id}`, occurredAt: call.queuedAt, reasonCode: "USER_REQUESTED", safeMetadata: { scenario: input.scenario, simulated: true }, actorId: context.actorId } });
      const outbox = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, eventType: "telephony.call.start", eventVersion: TELEPHONY_CONTRACT_VERSION, aggregateType: "PhoneCall", aggregateId: call.id, correlationId: input.correlationId, idempotencyKey: `telephony-outbox:${input.idempotencyKey}`, payload: { callId: call.id, scenario: input.scenario, externalEgress: false }, payloadHash: sha256(canonicalJson({ callId: call.id, scenario: input.scenario, externalEgress: false })), status: "PENDING", availableAt: call.queuedAt, createdByActorId: context.actorId, messageId: message.id } });
      const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "TELEPHONY_CALL", idempotencyKey: `telephony-job:${input.idempotencyKey}`, priority: target.lead.priority === "URGENT" ? 100 : target.lead.priority === "HIGH" ? 75 : target.lead.priority === "MEDIUM" ? 50 : 25, runAt: call.queuedAt, payload: { callId: call.id, outboxId: outbox.id, scenario: input.scenario, externalEgress: false }, maxAttempts: TELEPHONY_JOB_MAX_ATTEMPTS, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: call.queuedAt, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.call.queued_local", entityType: "PhoneCall", entityId: call.id, origin: "DOMAIN", changes: { leadId: target.lead.id, ownerMemberId, queueId, jobId: job.id, privacyDecisionId: privacy.decisionId, scenario: input.scenario, recording: false, transcription: false, externalEgress: false } } });
      return { status: "QUEUED" as const, callId: call.id, jobId: job.id, jobCreated: true, idempotent: false, externalEgress: false };
    });
  }

  async function setDisposition(context: AuthenticatedContext, raw: unknown) {
    const input = telephonyDispositionSchema.parse(raw);
    const call = await options.database.phoneCall.findFirst({ where: { id: input.callId, workspaceId: context.workspaceId }, include: { lead: { select: { id: true, priority: true } }, queue: { select: { teamId: true } } } });
    if (!call || !call.lead) fail("Ligação não encontrada ou sem lead no workspace.", "TELEPHONY_CALL_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_DISPOSITION, { workspaceId: context.workspaceId, resourceType: "PhoneCall", resourceId: call.id, ownerMemberId: call.ownerMemberId, queueId: call.queueId, teamId: call.teamId ?? call.queue?.teamId ?? null });
    return options.database.$transaction(async (tx) => {
      const changed = await tx.phoneCall.updateMany({ where: { id: call.id, workspaceId: context.workspaceId, revision: input.expectedRevision, disposition: null }, data: { disposition: input.disposition, dispositionNote: input.note ?? null, dispositionedAt: options.now(), dispositionedByActorId: context.actorId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (changed.count !== 1) fail("A ligação mudou ou já recebeu resultado. Atualize a tela.", "TELEPHONY_DISPOSITION_CONFLICT");
      const history = await recordTelephonyDispositionInTransaction(tx, { workspaceId: context.workspaceId, callId: call.id, leadId: call.lead!.id, opportunityId: call.opportunityId, actorId: context.actorId, ownerMemberId: call.ownerMemberId, queueId: call.queueId, leadPriority: call.lead!.priority, disposition: input.disposition, note: input.note ?? null, occurredAt: options.now(), nextAction: input.nextAction ?? null });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.call.disposition_recorded", entityType: "PhoneCall", entityId: call.id, origin: "DOMAIN", changes: { disposition: input.disposition, notePresent: Boolean(input.note), nextTaskId: history.nextTaskId, pipelineChanged: false } } });
      return { callId: call.id, disposition: input.disposition, ...history };
    });
  }

  async function cancel(context: AuthenticatedContext, callId: string) {
    const call = await options.database.phoneCall.findFirst({ where: { id: callId, workspaceId: context.workspaceId }, include: { queue: { select: { teamId: true } } } });
    if (!call) fail("Ligação não encontrada.", "TELEPHONY_CALL_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_CANCEL, { workspaceId: context.workspaceId, resourceType: "PhoneCall", resourceId: call.id, ownerMemberId: call.ownerMemberId, queueId: call.queueId, teamId: call.teamId ?? call.queue?.teamId ?? null });
    if (["COMPLETED", "BUSY", "NO_ANSWER", "CANCELLED", "FAILED", "VOICEMAIL"].includes(call.status)) fail("A ligação já está em estado terminal.", "TELEPHONY_CALL_TERMINAL");
    return options.database.$transaction(async (tx) => {
      await tx.job.updateMany({ where: { workspaceId: context.workspaceId, type: "TELEPHONY_CALL", status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["callId"], equals: call.id } }, data: { status: "CANCELLED", cancelledAt: options.now(), finishedAt: options.now(), updatedByActorId: context.actorId } });
      const result = await applyTelephonyEventInTransaction(tx, { workspaceId: context.workspaceId, actorId: context.actorId, source: "INTERNAL", event: { eventId: `cancel:${call.id}:${call.revision}`, callId: call.id, status: "CANCELLED", occurredAt: options.now(), sequence: call.statusSequence + 1 } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.call.cancelled", entityType: "PhoneCall", entityId: call.id, changes: { externalEgress: false } } });
      return result;
    });
  }

  async function replay(context: AuthenticatedContext, callId: string) {
    const call = await options.database.phoneCall.findFirst({ where: { id: callId, workspaceId: context.workspaceId }, include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } } });
    if (!call) fail("Ligação não encontrada.", "TELEPHONY_CALL_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_REPLAY, workspaceResource(context));
    const job = await options.database.job.findFirst({ where: { workspaceId: context.workspaceId, type: "TELEPHONY_CALL", payload: { path: ["callId"], equals: call.id } } });
    if (!job || job.status !== "FAILED") fail("Somente ligação em dead-letter pode ser reprocessada.", "TELEPHONY_REPLAY_NOT_ALLOWED");
    return options.database.$transaction(async (tx) => {
      await tx.job.update({ where: { id: job.id }, data: { status: "PENDING", attempts: 0, runAt: options.now(), finishedAt: null, errorCode: null, lastError: null, updatedByActorId: context.actorId } });
      await tx.outboxEvent.updateMany({ where: { workspaceId: context.workspaceId, aggregateType: "PhoneCall", aggregateId: call.id }, data: { status: "PENDING", availableAt: options.now(), nextRetryAt: null, errorClass: null, errorCode: null, errorMessage: null } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.call.replay_requested", entityType: "PhoneCall", entityId: call.id, changes: { previousAttempt: call.attempts[0]?.attemptNumber ?? 0, externalEgress: false } } });
      return { callId: call.id, status: "PENDING" as const };
    });
  }

  async function configureLocal(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_CONFIGURE, workspaceResource(context));
    const input = telephonyConfigureSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const profile = await currentProfile(tx, context.workspaceId);
      if (!profile) fail("Fundação local de telefonia ausente. Execute o seed.", "TELEPHONY_FOUNDATION_MISSING", 404);
      if (input.revision && input.revision !== profile.connection.revision) fail("A configuração mudou. Atualize a página.", "TELEPHONY_CONFIGURATION_CONFLICT");
      const config = { originatorLabel: input.originatorLabel, timeZone: "America/Sao_Paulo", contactWindowStartMinute: input.contactWindowStartMinute, contactWindowEndMinute: input.contactWindowEndMinute, contactWeekdays: [...new Set(input.contactWeekdays)].sort(), recordingEnabled: false, transcriptionEnabled: false, externalEgress: false };
      const nextVersion = profile.connection.currentConfigVersion + 1;
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, version: nextVersion, schemaVersion: TELEPHONY_CONTRACT_VERSION, config, configHash: sha256(canonicalJson(config)), createdByActorId: context.actorId } });
      await tx.telephonyConnectionProfile.update({ where: { id: profile.id }, data: { originatorLabel: input.originatorLabel, contactWindowStartMinute: input.contactWindowStartMinute, contactWindowEndMinute: input.contactWindowEndMinute, contactWeekdays: config.contactWeekdays, recordingEnabled: false, transcriptionEnabled: false, configuredAt: options.now(), updatedByActorId: context.actorId } });
      await tx.integrationConnection.update({ where: { id: profile.connectionId }, data: { currentConfigVersion: nextVersion, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.local_configuration_updated", entityType: "TelephonyConnectionProfile", entityId: profile.id, changes: config } });
      return { id: profile.id, revision: profile.connection.revision + 1, externalEgress: false };
    });
  }

  async function setPaused(context: AuthenticatedContext, paused: boolean, revision: number) {
    await authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_CONFIGURE, workspaceResource(context));
    const profile = await currentProfile(options.database, context.workspaceId);
    if (!profile) fail("Telefonia local não configurada.", "TELEPHONY_FOUNDATION_MISSING", 404);
    if (profile.connection.revision !== revision) fail("A configuração mudou. Atualize a página.", "TELEPHONY_CONFIGURATION_CONFLICT");
    return options.database.$transaction(async (tx) => {
      await tx.integrationConnection.update({ where: { id: profile.connectionId }, data: { enabled: !paused, status: paused ? "PAUSED" : "ACTIVE_LOCAL", revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.telephonyConnectionProfile.update({ where: { id: profile.id }, data: { operatingMode: paused ? "PAUSED" : "LOCAL_SIMULATOR", pausedReason: paused ? "Pausa manual autorizada." : null, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: paused ? "telephony.local_paused" : "telephony.local_resumed", entityType: "TelephonyConnectionProfile", entityId: profile.id, changes: { externalEgress: false } } });
      return { operatingMode: paused ? "PAUSED" as const : "LOCAL_SIMULATOR" as const, revision: revision + 1 };
    });
  }

  async function ingestSignedLocalCallback(workspaceId: string, rawBody: Buffer, signature: string | null) {
    if (!verifyLocalTelephonyCallback(workspaceId, rawBody, signature)) fail("Assinatura local de telefonia inválida.", "TELEPHONY_SIGNATURE_INVALID", 401);
    let decoded: unknown;
    try { decoded = JSON.parse(rawBody.toString("utf8")); } catch { fail("Payload local de telefonia inválido.", "TELEPHONY_CALLBACK_INVALID", 400); }
    const event = telephonyCallbackSchema.parse(decoded);
    return options.database.$transaction(async (tx) => {
      const call = await tx.phoneCall.findFirst({ where: { id: event.callId, workspaceId }, include: { profile: true } });
      if (!call) fail("Ligação não encontrada neste workspace.", "TELEPHONY_CALL_NOT_FOUND", 404);
      const foundation = await systemFoundation(tx, workspaceId);
      const existingInbox = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId, connectionId: call.profile.connectionId, providerEventId: event.eventId } } });
      if (existingInbox) return { status: "DUPLICATE" as const, inboxId: existingInbox.id };
      const inbox = await tx.webhookInbox.create({ data: { workspaceId, connectionId: call.profile.connectionId, providerEventId: event.eventId, eventType: "telephony.call.status", contractVersion: TELEPHONY_CONTRACT_VERSION, payloadHash: createHash("sha256").update(rawBody).digest("hex"), nonceHash: sha256(`telephony:${workspaceId}:${event.eventId}`), payloadSizeBytes: rawBody.byteLength, payload: json({ callId: event.callId, status: event.status, sequence: event.sequence, metadata: sanitizeTelephonyMetadata(event.metadata), externalEgress: false }), dataClass: "OPERATIONAL", signatureStatus: "VERIFIED", externalOccurredAt: event.occurredAt, receivedAt: options.now(), status: "PROCESSED", attempts: 1, processedAt: options.now(), correlationId: event.eventId, messageId: call.messageId } });
      const result = await applyTelephonyEventInTransaction(tx, { workspaceId, actorId: foundation.actor.id, event, source: "LOCAL_SIMULATOR" });
      return { ...result, inboxId: inbox.id };
    });
  }

  return Object.freeze({ screen, startOutbound, setDisposition, cancel, replay, configureLocal, setPaused, ingestSignedLocalCallback });
}

let service: ReturnType<typeof createTelephonyService> | undefined;
export function getTelephonyService() {
  service ??= createTelephonyService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
