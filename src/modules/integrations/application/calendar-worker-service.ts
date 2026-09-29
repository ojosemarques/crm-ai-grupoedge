import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  createCalendarMeetingDomainService,
  resolveCalendarOperatorContext,
} from "@/modules/integrations/application/calendar-service";
import {
  CalendarTransportError,
  LocalCalendarSandboxAdapter,
  type CalendarAdapter,
} from "@/modules/integrations/application/calendar-transport";
import {
  CALENDAR_PROVIDER_KEY,
  calendarCallbackSchema,
  calendarDurationMinutes,
  type CalendarCallback,
  type CalendarScenario,
} from "@/modules/integrations/domain/calendar-contracts";
import { calculateRetryDelaySeconds, canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = Readonly<{ database: PrismaClient; adapter: CalendarAdapter; now: () => Date; lockTimeoutSeconds?: number; backoffBaseSeconds?: number }>;
type Payload = Readonly<{ direction: "PUSH" | "PULL"; eventId: string; outboxId?: string; inboxId?: string; scenario?: CalendarScenario; forceExternal?: boolean; externalEgress: false }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const CALENDAR_OBJECT_TYPE = "calendar_event";

function parsePayload(value: Prisma.JsonValue): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.externalEgress !== false) throw new CalendarTransportError("CALENDAR_JOB_PAYLOAD_INVALID", false);
  if ((value.direction !== "PUSH" && value.direction !== "PULL") || typeof value.eventId !== "string") throw new CalendarTransportError("CALENDAR_JOB_PAYLOAD_INVALID", false);
  if (value.direction === "PUSH" && typeof value.outboxId !== "string") throw new CalendarTransportError("CALENDAR_JOB_PAYLOAD_INVALID", false);
  if (value.direction === "PULL" && typeof value.inboxId !== "string") throw new CalendarTransportError("CALENDAR_JOB_PAYLOAD_INVALID", false);
  return {
    direction: value.direction, eventId: value.eventId,
    ...(typeof value.outboxId === "string" ? { outboxId: value.outboxId } : {}),
    ...(typeof value.inboxId === "string" ? { inboxId: value.inboxId } : {}),
    ...(typeof value.scenario === "string" ? { scenario: value.scenario as CalendarScenario } : {}),
    forceExternal: value.forceExternal === true, externalEgress: false,
  };
}

function localDateTime(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function errorDetails(error: unknown) {
  if (error instanceof CalendarTransportError) return { code: error.code, retryable: error.retryable };
  const maybe = error as { code?: unknown; message?: unknown };
  const code = typeof maybe?.code === "string" ? maybe.code : "CALENDAR_LOCAL_INTERNAL_FAILURE";
  return { code, retryable: false };
}

export function createCalendarWorkerService(options: Options) {
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;

  async function claim(workerId: string) {
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "type" = 'CALENDAR_SYNC'
          AND (("status" = 'PENDING' AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockExpiresAt" < ${now}))
        ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000), attempts: { increment: 1 }, lastAttemptAt: now } });
    }, { isolationLevel: "ReadCommitted" });
  }

  async function foundation(workspaceId: string) {
    const [profile, actor] = await Promise.all([
      options.database.calendarConnectionProfile.findFirst({ where: { workspaceId }, include: { connection: true }, orderBy: { createdAt: "asc" } }),
      options.database.actor.findFirst({ where: { workspaceId, type: "SYSTEM", userId: null }, orderBy: { createdAt: "asc" } }),
    ]);
    if (!profile || !actor) throw new CalendarTransportError("CALENDAR_FOUNDATION_MISSING", false);
    if (profile.operatingMode !== "LOCAL_SANDBOX" || !profile.connection.enabled) throw new CalendarTransportError("CALENDAR_LOCAL_INACTIVE", false);
    if (options.adapter.externalEgress) throw new CalendarTransportError("CALENDAR_EXTERNAL_EGRESS_FORBIDDEN", false);
    return { profile, actor };
  }

  async function markConflict(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, payload: Payload, callback: CalendarCallback, type: "CONCURRENT_MEETING_CHANGE" | "TIME_CONFLICT" | "UNKNOWN_EXTERNAL_EVENT" | "INVALID_IDENTITY" | "INVALID_TRANSITION" | "STALE_EXTERNAL_VERSION", evidence: Record<string, unknown>) {
    const { profile, actor } = await foundation(job.workspaceId);
    const meeting = callback.meetingId ? await options.database.meeting.findFirst({ where: { id: callback.meetingId, workspaceId: job.workspaceId } }) : null;
    return options.database.$transaction(async (tx) => {
      const conflict = await tx.calendarSyncConflict.upsert({
        where: { workspaceId_profileId_eventKey_type: { workspaceId: job.workspaceId, profileId: profile.id, eventKey: `pull:${callback.eventId}`, type } },
        create: { workspaceId: job.workspaceId, profileId: profile.id, meetingId: meeting?.id ?? null, webhookInboxId: payload.inboxId ?? null, eventKey: `pull:${callback.eventId}`, type, baseMeetingRevision: callback.baseMeetingRevision ?? null, currentMeetingRevision: meeting?.revision ?? null, externalVersion: callback.externalVersion, crmSnapshot: meeting ? json({ id: meeting.id, status: meeting.status, title: meeting.title, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), revision: meeting.revision }) : json({ meetingFound: false }), externalSnapshot: json({ ...callback, occurredAt: callback.occurredAt.toISOString(), startsAt: callback.startsAt?.toISOString() ?? null, endsAt: callback.endsAt?.toISOString() ?? null }), evidence: json(evidence), createdByActorId: actor.id },
        update: {},
      });
      await tx.calendarSyncEvent.update({ where: { id: payload.eventId }, data: { status: "CONFLICT", processedAt: options.now(), errorCode: type } });
      const syncEvent = await tx.calendarSyncEvent.findUnique({ where: { id: payload.eventId }, select: { syncRunId: true } });
      if (syncEvent?.syncRunId) await tx.integrationSyncRun.update({ where: { id: syncEvent.syncRunId }, data: { status: "PARTIALLY_SUCCEEDED", readCount: 1, conflictCount: 1, finishedAt: options.now(), errorCode: type, errorMessage: "Conflito preservado para decisão humana." } });
      if (payload.inboxId) await tx.webhookInbox.update({ where: { id: payload.inboxId }, data: { status: "PROCESSED", processedAt: options.now(), attempts: { increment: 1 }, errorCode: type, errorMessage: "Evento preservado para resolução humana." } });
      if (meeting) await tx.calendarEventLink.updateMany({ where: { workspaceId: job.workspaceId, meetingId: meeting.id }, data: { syncState: "CONFLICT", lastErrorCode: type, lastErrorMessage: "Conflito explícito; nenhuma sobrescrita foi aplicada.", updatedByActorId: actor.id } });
      await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: json({ conflictId: conflict.id, type }), finishedAt: options.now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: job.workspaceId, kind: "INBOX", inboxId: payload.inboxId!, attemptNumber: job.attempts, status: "SUCCEEDED", startedAt: job.lockedAt ?? options.now(), finishedAt: options.now(), resultMetadata: { calendarEventId: payload.eventId, conflictId: conflict.id, type, applied: false, externalEgress: false } } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "calendar.sync.conflict_opened", entityType: "CalendarSyncConflict", entityId: conflict.id, origin: "SYSTEM", changes: { type, meetingId: meeting?.id ?? null, applied: false, externalEgress: false } } });
      return { status: "CONFLICT" as const, conflictId: conflict.id, type };
    });
  }

  async function processPush(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, payload: Payload) {
    const { profile, actor } = await foundation(job.workspaceId);
    const event = await options.database.calendarSyncEvent.findFirst({ where: { id: payload.eventId, workspaceId: job.workspaceId, direction: "PUSH" }, include: { meeting: true, link: true } });
    if (!event?.meeting || !event.link || !payload.outboxId) throw new CalendarTransportError("CALENDAR_PUSH_FACTS_MISSING", false);
    if (event.status === "APPLIED") {
      await options.database.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", finishedAt: options.now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
      return { status: "DUPLICATE" as const, eventId: event.id };
    }
    if (event.syncRunId) await options.database.integrationSyncRun.update({ where: { id: event.syncRunId }, data: { status: "RUNNING", startedAt: job.lockedAt ?? options.now(), attempts: job.attempts } });
    const result = await options.adapter.push({ meetingId: event.meeting.id, externalEventId: event.link.externalEventId, operation: event.operation, meetingRevision: event.meeting.revision, title: event.meeting.title, startsAt: event.meeting.startsAt, endsAt: event.meeting.endsAt, timeZone: event.meeting.timeZone, status: event.meeting.status, scenario: payload.scenario ?? "SUCCESS", attempt: job.attempts });
    if (result.externalEgress || !result.simulated) throw new CalendarTransportError("CALENDAR_EXTERNAL_EGRESS_FORBIDDEN", false);
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      const changed = await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: json(result), finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      await tx.calendarEventLink.update({ where: { id: event.link!.id }, data: { syncState: event.meeting!.status === "CANCELLED" ? "CANCELLED" : "SYNCED", externalVersion: result.externalVersion, externalEtag: result.externalEtag, externalHash: sha256(canonicalJson(result)), lastMeetingRevision: event.meeting!.revision, lastPushedMeetingRevision: event.meeting!.revision, lastPushedAt: now, lastErrorCode: null, lastErrorMessage: null, updatedByActorId: actor.id } });
      await tx.calendarSyncEvent.update({ where: { id: event.id }, data: { status: "APPLIED", appliedMeetingRevision: event.meeting!.revision, externalVersion: result.externalVersion, externalEtag: result.externalEtag, processedAt: now, errorCode: null } });
      if (event.syncRunId) {
        await tx.integrationSyncRun.update({ where: { id: event.syncRunId }, data: { status: "SUCCEEDED", candidateCursor: event.eventKey, watermark: now, readCount: 1, updatedCount: event.operation === "CREATE" ? 0 : 1, createdCount: event.operation === "CREATE" ? 1 : 0, finishedAt: now, errorClass: null, errorCode: null, errorMessage: null } });
        await tx.integrationSyncCursor.upsert({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: job.workspaceId, connectionId: profile.connectionId, direction: "PUSH", objectType: CALENDAR_OBJECT_TYPE } }, create: { workspaceId: job.workspaceId, connectionId: profile.connectionId, direction: "PUSH", objectType: CALENDAR_OBJECT_TYPE, cursor: event.eventKey, watermark: now, lastSyncRunId: event.syncRunId, updatedByActorId: actor.id }, update: { cursor: event.eventKey, watermark: now, lastSyncRunId: event.syncRunId, version: { increment: 1 }, updatedByActorId: actor.id } });
      }
      await tx.outboxEvent.update({ where: { id: payload.outboxId! }, data: { status: "DELIVERED_LOCAL", attempts: { increment: 1 }, deliveredLocallyAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorClass: null, errorCode: null, errorMessage: null } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: job.workspaceId, kind: "OUTBOX", outboxId: payload.outboxId!, attemptNumber: job.attempts, status: "SUCCEEDED", startedAt: job.lockedAt ?? now, finishedAt: now, resultMetadata: json({ ...result, calendarEventId: payload.eventId }) } });
      await tx.integrationConnection.update({ where: { id: profile.connectionId }, data: { lastSucceededAt: now, currentErrorClass: null, currentErrorCode: null, currentErrorMessage: null, updatedByActorId: actor.id } });
      await tx.calendarConnectionProfile.update({ where: { id: profile.id }, data: { lastSyncAt: now, lastSuccessAt: now, lastErrorAt: null, lastErrorCode: null, updatedByActorId: actor.id } });
      await tx.externalObjectMapping.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: job.workspaceId, connectionId: profile.connectionId, externalObjectType: "calendar_event", externalId: result.externalEventId } }, create: { workspaceId: job.workspaceId, connectionId: profile.connectionId, externalObjectType: "calendar_event", externalId: result.externalEventId, internalEntityType: "MEETING", internalEntityId: event.meeting!.id, externalVersion: String(result.externalVersion), externalHash: sha256(canonicalJson(result)), firstRecognizedAt: now, lastRecognizedAt: now, createdByActorId: actor.id, updatedByActorId: actor.id }, update: { externalVersion: String(result.externalVersion), externalHash: sha256(canonicalJson(result)), lastRecognizedAt: now, updatedByActorId: actor.id } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "calendar.meeting.projected_local", entityType: "Meeting", entityId: event.meeting!.id, origin: "SYSTEM", changes: { operation: event.operation, meetingRevision: event.meeting!.revision, externalEventId: result.externalEventId, simulated: true, externalEgress: false } } });
      return { status: "SUCCEEDED" as const, meetingId: event.meeting!.id, operation: event.operation, externalEgress: false as const };
    });
  }

  async function processPull(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, payload: Payload) {
    const { profile, actor } = await foundation(job.workspaceId);
    if (!payload.inboxId) throw new CalendarTransportError("CALENDAR_INBOX_MISSING", false);
    const inbox = await options.database.webhookInbox.findFirst({ where: { id: payload.inboxId, workspaceId: job.workspaceId } });
    if (!inbox) throw new CalendarTransportError("CALENDAR_INBOX_MISSING", false);
    const callback = calendarCallbackSchema.parse(inbox.payload);
    let meeting = callback.meetingId ? await options.database.meeting.findFirst({ where: { id: callback.meetingId, workspaceId: job.workspaceId, deletedAt: null } }) : null;
    if (callback.operation === "CREATE" && !meeting) {
      meeting = await options.database.meeting.findFirst({ where: { workspaceId: job.workspaceId, deletedAt: null, observation: `Criada pelo calendário local (${callback.eventId}).` }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    }
    let link = await options.database.calendarEventLink.findFirst({ where: { workspaceId: job.workspaceId, profileId: profile.id, OR: [{ externalEventId: callback.externalEventId }, ...(callback.meetingId ? [{ meetingId: callback.meetingId }] : [])] } });
    if (link && !meeting) meeting = await options.database.meeting.findFirst({ where: { id: link.meetingId, workspaceId: job.workspaceId, deletedAt: null } });
    if (callback.operation !== "CREATE" && (!meeting || !link)) return markConflict(job, workerId, payload, callback, "UNKNOWN_EXTERNAL_EVENT", { reason: "Nenhuma ligação exata entre evento externo e reunião canônica." });
    if (link && callback.externalVersion <= (link.lastPulledExternalVersion ?? 0)) {
      return options.database.$transaction(async (tx) => {
        const now = options.now();
        await tx.calendarSyncEvent.update({ where: { id: payload.eventId }, data: { status: "DUPLICATE", processedAt: now } });
        const syncEvent = await tx.calendarSyncEvent.findUnique({ where: { id: payload.eventId }, select: { syncRunId: true, eventKey: true } });
        if (syncEvent?.syncRunId) await tx.integrationSyncRun.update({ where: { id: syncEvent.syncRunId }, data: { status: "SUCCEEDED", candidateCursor: syncEvent.eventKey, watermark: now, readCount: 1, ignoredCount: 1, finishedAt: now } });
        await tx.webhookInbox.update({ where: { id: inbox.id }, data: { status: "PROCESSED", processedAt: now, attempts: { increment: 1 } } });
        await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: job.workspaceId, kind: "INBOX", inboxId: inbox.id, attemptNumber: job.attempts, status: "SUCCEEDED", startedAt: job.lockedAt ?? now, finishedAt: now, resultMetadata: { calendarEventId: payload.eventId, duplicate: true, externalEgress: false } } });
        return { status: "DUPLICATE" as const, eventId: payload.eventId };
      });
    }
    const recoveredHistory = meeting && callback.operation !== "CREATE"
      ? await options.database.meetingHistory.findFirst({ where: { workspaceId: job.workspaceId, meetingId: meeting.id, reason: { contains: callback.eventId } }, orderBy: [{ meetingRevision: "desc" }, { id: "desc" }] })
      : null;
    if (meeting && !recoveredHistory && !payload.forceExternal && callback.baseMeetingRevision && meeting.revision !== callback.baseMeetingRevision) {
      return markConflict(job, workerId, payload, callback, "CONCURRENT_MEETING_CHANGE", { expectedRevision: callback.baseMeetingRevision, currentRevision: meeting.revision });
    }

    const syncEvent = await options.database.calendarSyncEvent.findUnique({ where: { id: payload.eventId }, select: { syncRunId: true } });
    if (syncEvent?.syncRunId) await options.database.integrationSyncRun.update({ where: { id: syncEvent.syncRunId }, data: { status: "RUNNING", startedAt: job.lockedAt ?? options.now(), attempts: job.attempts } });

    const operator = await resolveCalendarOperatorContext(options.database, job.workspaceId);
    const meetingService = createCalendarMeetingDomainService(options.database, options.now);
    let appliedMeetingId = meeting?.id ?? null;
    try {
      if (callback.operation === "CREATE") {
        if (link) return markConflict(job, workerId, payload, callback, "INVALID_IDENTITY", { reason: "Evento externo já ligado a uma reunião." });
        if (!meeting) {
          const duration = callback.startsAt && callback.endsAt ? calendarDurationMinutes(callback.startsAt, callback.endsAt) : null;
          if (!duration || !callback.leadId || !callback.closerId || !callback.title || !callback.startsAt) return markConflict(job, workerId, payload, callback, "INVALID_IDENTITY", { reason: "Criação sem identidade ou duração suportada." });
          const created = await meetingService.schedule(operator, { leadId: callback.leadId, closerId: callback.closerId, title: callback.title, startsAtLocal: localDateTime(callback.startsAt, callback.timeZone), durationMinutes: duration, observation: `Criada pelo calendário local (${callback.eventId}).` });
          appliedMeetingId = created.meetingId;
          meeting = await options.database.meeting.findFirst({ where: { id: created.meetingId, workspaceId: job.workspaceId } });
        }
      } else if (callback.operation === "RESCHEDULE") {
        const duration = callback.startsAt && callback.endsAt ? calendarDurationMinutes(callback.startsAt, callback.endsAt) : null;
        if (!meeting || !duration || !callback.startsAt) return markConflict(job, workerId, payload, callback, "INVALID_TRANSITION", { reason: "Remarcação sem duração suportada." });
        if (!recoveredHistory) await meetingService.act(operator, { action: "RESCHEDULE", meetingId: meeting.id, expectedRevision: payload.forceExternal ? meeting.revision : callback.baseMeetingRevision ?? meeting.revision, startsAtLocal: localDateTime(callback.startsAt, callback.timeZone), durationMinutes: duration, reason: `Calendário local · ${callback.eventId}: ${callback.reason ?? "remarcação externa"}` });
      } else if (callback.operation === "CANCEL") {
        if (!meeting) return markConflict(job, workerId, payload, callback, "UNKNOWN_EXTERNAL_EVENT", { reason: "Reunião não localizada." });
        const next = new Date(options.now().getTime() + 60 * 60_000);
        if (!recoveredHistory) await meetingService.act(operator, { action: "CANCEL", meetingId: meeting.id, expectedRevision: payload.forceExternal ? meeting.revision : callback.baseMeetingRevision ?? meeting.revision, reason: `Calendário local · ${callback.eventId}: ${callback.reason}`, nextAction: { title: "Revisar cancelamento recebido do calendário", dueAtLocal: localDateTime(next, meeting.timeZone) } });
      } else if (meeting && callback.title && callback.title !== meeting.title) {
        return markConflict(job, workerId, payload, callback, "CONCURRENT_MEETING_CHANGE", { reason: "Título externo divergente exige decisão humana; o CRM permanece canônico." });
      }
    } catch (error) {
      const code = errorDetails(error).code;
      if (["MEETING_TIME_CONFLICT", "LEAD_ALREADY_HAS_ACTIVE_MEETING"].includes(code)) return markConflict(job, workerId, payload, callback, "TIME_CONFLICT", { domainCode: code });
      if (["MEETING_VERSION_CONFLICT", "MEETING_ALREADY_CLOSED", "LEAD_NOT_QUALIFIED", "INVALID_INPUT"].includes(code)) return markConflict(job, workerId, payload, callback, "INVALID_TRANSITION", { domainCode: code });
      throw error;
    }
    if (!appliedMeetingId || !meeting) throw new CalendarTransportError("CALENDAR_MEETING_APPLY_FAILED", false);
    const refreshed = await options.database.meeting.findFirstOrThrow({ where: { id: appliedMeetingId, workspaceId: job.workspaceId } });
    return options.database.$transaction(async (tx) => {
      const now = options.now();
      link = await tx.calendarEventLink.upsert({
        where: { workspaceId_profileId_meetingId: { workspaceId: job.workspaceId, profileId: profile.id, meetingId: refreshed.id } },
        create: { workspaceId: job.workspaceId, profileId: profile.id, meetingId: refreshed.id, providerKey: CALENDAR_PROVIDER_KEY, externalCalendarId: profile.externalCalendarId, externalEventId: callback.externalEventId, syncState: refreshed.status === "CANCELLED" ? "CANCELLED" : "SYNCED", externalVersion: callback.externalVersion, externalEtag: callback.externalEtag ?? null, externalHash: sha256(canonicalJson(inbox.payload)), lastMeetingRevision: refreshed.revision, lastPulledExternalVersion: callback.externalVersion, lastPulledAt: now, createdByActorId: actor.id, updatedByActorId: actor.id },
        update: { syncState: refreshed.status === "CANCELLED" ? "CANCELLED" : "SYNCED", externalVersion: callback.externalVersion, externalEtag: callback.externalEtag ?? null, externalHash: sha256(canonicalJson(inbox.payload)), lastMeetingRevision: refreshed.revision, lastPulledExternalVersion: callback.externalVersion, lastPulledAt: now, lastErrorCode: null, lastErrorMessage: null, updatedByActorId: actor.id },
      });
      await tx.calendarSyncEvent.update({ where: { id: payload.eventId }, data: { linkId: link.id, meetingId: refreshed.id, status: "APPLIED", appliedMeetingRevision: refreshed.revision, processedAt: now, errorCode: null } });
      if (syncEvent?.syncRunId) {
        await tx.integrationSyncRun.update({ where: { id: syncEvent.syncRunId }, data: { status: "SUCCEEDED", candidateCursor: callback.eventId, watermark: callback.occurredAt, readCount: 1, createdCount: callback.operation === "CREATE" ? 1 : 0, updatedCount: callback.operation === "CREATE" ? 0 : 1, finishedAt: now, errorClass: null, errorCode: null, errorMessage: null } });
        await tx.integrationSyncCursor.upsert({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: job.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: CALENDAR_OBJECT_TYPE } }, create: { workspaceId: job.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: CALENDAR_OBJECT_TYPE, cursor: callback.eventId, watermark: callback.occurredAt, lastSyncRunId: syncEvent.syncRunId, updatedByActorId: actor.id }, update: { cursor: callback.eventId, watermark: callback.occurredAt, lastSyncRunId: syncEvent.syncRunId, version: { increment: 1 }, updatedByActorId: actor.id } });
      }
      await tx.webhookInbox.update({ where: { id: inbox.id }, data: { status: "PROCESSED", processedAt: now, attempts: { increment: 1 }, errorCode: null, errorMessage: null } });
      await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result: { meetingId: refreshed.id, operation: callback.operation, externalEgress: false }, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: actor.id } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: job.workspaceId, kind: "INBOX", inboxId: inbox.id, attemptNumber: job.attempts, status: "SUCCEEDED", startedAt: job.lockedAt ?? now, finishedAt: now, resultMetadata: { calendarEventId: payload.eventId, meetingId: refreshed.id, operation: callback.operation, externalEgress: false } } });
      await tx.externalObjectMapping.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: job.workspaceId, connectionId: profile.connectionId, externalObjectType: "calendar_event", externalId: callback.externalEventId } }, create: { workspaceId: job.workspaceId, connectionId: profile.connectionId, externalObjectType: "calendar_event", externalId: callback.externalEventId, internalEntityType: "MEETING", internalEntityId: refreshed.id, externalVersion: String(callback.externalVersion), externalHash: sha256(canonicalJson(inbox.payload)), firstRecognizedAt: now, lastRecognizedAt: now, createdByActorId: actor.id, updatedByActorId: actor.id }, update: { internalEntityId: refreshed.id, externalVersion: String(callback.externalVersion), externalHash: sha256(canonicalJson(inbox.payload)), lastRecognizedAt: now, updatedByActorId: actor.id } });
      await tx.calendarConnectionProfile.update({ where: { id: profile.id }, data: { lastSyncAt: now, lastSuccessAt: now, lastErrorAt: null, lastErrorCode: null, updatedByActorId: actor.id } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: "calendar.callback.applied_via_meeting_service", entityType: "Meeting", entityId: refreshed.id, origin: "SYSTEM", changes: { operation: callback.operation, externalVersion: callback.externalVersion, authorizedPrincipalActorId: operator.actorId, externalEgress: false } } });
      return { status: "SUCCEEDED" as const, meetingId: refreshed.id, operation: callback.operation, externalEgress: false as const };
    });
  }

  async function failJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, payload: Payload, error: unknown) {
    const { code, retryable } = errorDetails(error);
    const terminal = !retryable || job.attempts >= job.maxAttempts;
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const { profile, actor } = await foundation(job.workspaceId).catch(async () => {
      const actor = await options.database.actor.findFirstOrThrow({ where: { workspaceId: job.workspaceId, type: "SYSTEM" } });
      const profile = await options.database.calendarConnectionProfile.findFirstOrThrow({ where: { workspaceId: job.workspaceId } });
      return { profile: { ...profile, connection: null }, actor };
    });
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000), finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: code, lastError: terminal ? "Falha controlada do calendário local." : "Nova tentativa local agendada.", updatedByActorId: actor.id } });
      if (changed.count !== 1) return { status: "LOST_LOCK" as const };
      await tx.calendarSyncEvent.updateMany({ where: { id: payload.eventId, workspaceId: job.workspaceId }, data: { status: terminal ? "FAILED_PERMANENT" : "RETRY_PENDING", errorCode: code, processedAt: terminal ? now : null } });
      const syncEvent = await tx.calendarSyncEvent.findFirst({ where: { id: payload.eventId, workspaceId: job.workspaceId }, select: { syncRunId: true } });
      if (syncEvent?.syncRunId) await tx.integrationSyncRun.update({ where: { id: syncEvent.syncRunId }, data: { status: terminal ? "FAILED" : "RUNNING", failedCount: { increment: 1 }, finishedAt: terminal ? now : null, errorClass: retryable ? "TRANSIENT" : "PERMANENT", errorCode: code, errorMessage: "Falha controlada do calendário local." } });
      await tx.calendarEventLink.updateMany({ where: { workspaceId: job.workspaceId, events: { some: { id: payload.eventId } } }, data: { syncState: "FAILED", lastErrorCode: code, lastErrorMessage: "Falha controlada; consulte o histórico.", updatedByActorId: actor.id } });
      if (payload.outboxId) await tx.outboxEvent.updateMany({ where: { id: payload.outboxId, workspaceId: job.workspaceId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts: { increment: 1 }, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorClass: retryable ? "TRANSIENT" : "PERMANENT", errorCode: code, errorMessage: "Falha controlada do calendário local." } });
      if (payload.inboxId) await tx.webhookInbox.updateMany({ where: { id: payload.inboxId, workspaceId: job.workspaceId }, data: { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts: { increment: 1 }, nextRetryAt: delay === null ? null : new Date(now.getTime() + delay * 1_000), errorClass: retryable ? "TRANSIENT" : "PERMANENT", errorCode: code, errorMessage: "Falha controlada do calendário local." } });
      if (payload.outboxId || payload.inboxId) {
        await tx.integrationDeliveryAttempt.create({ data: { workspaceId: job.workspaceId, kind: payload.direction === "PUSH" ? "OUTBOX" : "INBOX", ...(payload.outboxId ? { outboxId: payload.outboxId } : {}), ...(payload.inboxId ? { inboxId: payload.inboxId } : {}), attemptNumber: job.attempts, status: terminal ? "DEAD_LETTERED" : "FAILED", errorClass: retryable ? "TRANSIENT" : "PERMANENT", errorCode: code, errorMessage: "Falha controlada do calendário local.", retryAfterSeconds: delay, startedAt: job.lockedAt ?? now, finishedAt: now, resultMetadata: { calendarEventId: payload.eventId, externalEgress: false } } });
      }
      await tx.calendarConnectionProfile.update({ where: { id: profile.id }, data: { lastErrorAt: now, lastErrorCode: code, updatedByActorId: actor.id } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: actor.id, action: terminal ? "calendar.sync.dead_lettered" : "calendar.sync.retry_scheduled", entityType: "CalendarSyncEvent", entityId: payload.eventId, origin: "SYSTEM", changes: { code, attempt: job.attempts, nextRetrySeconds: delay, externalEgress: false } } });
      return { status: terminal ? "FAILED" as const : "RETRY_PENDING" as const, code, delaySeconds: delay };
    });
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (!job) return { status: "IDLE" as const };
    let payload: Payload;
    try { payload = parsePayload(job.payload); }
    catch (error) { return failJob(job, workerId, { direction: "PUSH", eventId: "00000000-0000-0000-0000-000000000000", externalEgress: false }, error); }
    try {
      return payload.direction === "PUSH" ? await processPush(job, workerId, payload) : await processPull(job, workerId, payload);
    } catch (error) {
      return failJob(job, workerId, payload, error);
    }
  }

  return Object.freeze({ processNext });
}

let service: ReturnType<typeof createCalendarWorkerService> | undefined;
export function getCalendarWorkerService() {
  service ??= createCalendarWorkerService({ database: getDatabaseClient(), adapter: new LocalCalendarSandboxAdapter(), now: () => new Date() });
  return service;
}
