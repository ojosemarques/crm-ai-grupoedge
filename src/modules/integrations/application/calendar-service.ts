import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import {
  CALENDAR_CONTRACT_VERSION,
  CALENDAR_JOB_MAX_ATTEMPTS,
  CALENDAR_PROVIDER_KEY,
  calendarCallbackSchema,
  calendarConfigureSchema,
  calendarPayloadHash,
  calendarSyncMeetingSchema,
  verifyLocalCalendarCallback,
  type CalendarCallback,
} from "@/modules/integrations/domain/calendar-contracts";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { createAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const CALENDAR_OBJECT_TYPE = "calendar_event";

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: Pick<AuthenticatedContext, "workspaceId" | "memberId">, id?: string, ownerMemberId?: string | null): ResourceScope {
  return { workspaceId: context.workspaceId, resourceType: "Calendar", resourceId: id ?? context.workspaceId, ...(ownerMemberId === undefined ? {} : { ownerMemberId }), memberId: context.memberId };
}

async function profileFor(database: PrismaClient | Tx, workspaceId: string) {
  return database.calendarConnectionProfile.findFirst({
    where: { workspaceId },
    include: { connection: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function systemActor(tx: Tx, workspaceId: string) {
  const actor = await tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM", userId: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!actor) fail("Ator Sistema não configurado.", "CALENDAR_SYSTEM_ACTOR_MISSING");
  return actor;
}

function operationFromMeeting(meeting: Readonly<{ status: string; revision: number; history: readonly Readonly<{ action: string }>[] }>, linked: boolean) {
  if (!linked) return "CREATE" as const;
  if (meeting.status === "CANCELLED") return "CANCEL" as const;
  return meeting.history[0]?.action === "RESCHEDULED" ? "RESCHEDULE" as const : "UPDATE" as const;
}

export async function resolveCalendarOperatorContext(database: PrismaClient, workspaceId: string): Promise<AuthenticatedContext> {
  const row = await database.workspaceMember.findFirst({
    where: {
      workspaceId, status: "ACTIVE", deletedAt: null,
      user: { status: "ACTIVE", deletedAt: null, actors: { some: { workspaceId, type: "HUMAN" } } },
      role: { deletedAt: null, permissions: { some: { workspaceId, permission: { key: PermissionKeys.CALENDAR_SYNC } } } },
    },
    orderBy: [{ role: { key: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
    include: { workspace: { select: { slug: true, timeZone: true } }, role: true, user: { include: { actors: { where: { workspaceId, type: "HUMAN" }, take: 1, orderBy: { createdAt: "asc" } } } } },
  });
  const actor = row?.user.actors[0];
  if (!row || !actor) fail("Não existe principal humano autorizado para o serviço de calendário.", "CALENDAR_OPERATOR_MISSING");
  return Object.freeze({
    workspaceId, workspaceSlug: row.workspace.slug, timeZone: row.workspace.timeZone,
    sessionId: `calendar-service:${workspaceId}`, userId: row.userId, memberId: row.id,
    actorId: actor.id, roleId: row.roleId, roleKey: row.role.key, roleName: row.role.name,
    displayName: `${row.user.displayName} · principal técnico do calendário`,
  });
}

export function createCalendarService(options: Options) {
  const authorization = createAuthorizationService({ database: options.database });

  async function visibleMeetingWhere(context: AuthenticatedContext) {
    const decision = await authorization.authorize(context, PermissionKeys.CALENDAR_READ, resource(context));
    if (!decision.allowed) {
      await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_READ, resource(context));
      fail("Acesso ao calendário não autorizado.", "CALENDAR_READ_DENIED", 403);
    }
    if (decision.scope === "WORKSPACE") return {};
    if (decision.scope === "OWN") return { ownerMemberId: context.memberId };
    const memberships = await options.database.teamMember.findMany({
      where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null },
      select: { teamId: true },
    });
    const memberIds = await options.database.teamMember.findMany({
      where: { workspaceId: context.workspaceId, teamId: { in: memberships.map(({ teamId }) => teamId) }, deletedAt: null },
      select: { workspaceMemberId: true },
    });
    return { ownerMemberId: { in: memberIds.map(({ workspaceMemberId }) => workspaceMemberId) } };
  }

  async function screen(context: AuthenticatedContext) {
    const meetingWhere = await visibleMeetingWhere(context);
    const profile = await profileFor(options.database, context.workspaceId);
    const conflictRead = await authorization.authorize(context, PermissionKeys.CALENDAR_CONFLICT_READ, resource(context));
    const [links, events, conflicts, pendingJobs, permissions] = await Promise.all([
      options.database.calendarEventLink.findMany({
        where: { workspaceId: context.workspaceId, meeting: meetingWhere }, orderBy: { updatedAt: "desc" }, take: 40,
        include: { meeting: { include: { lead: { select: { fullName: true } }, owner: { include: { user: { select: { displayName: true } } } } } } },
      }),
      options.database.calendarSyncEvent.findMany({ where: { workspaceId: context.workspaceId, meeting: meetingWhere }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 50 }),
      conflictRead.allowed
        ? options.database.calendarSyncConflict.findMany({ where: { workspaceId: context.workspaceId, meeting: meetingWhere }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30 })
        : Promise.resolve([]),
      options.database.calendarSyncEvent.count({ where: { workspaceId: context.workspaceId, meeting: meetingWhere, status: { in: ["ACCEPTED", "RETRY_PENDING"] } } }),
      Promise.all([
        authorization.authorize(context, PermissionKeys.CALENDAR_CONFIGURE, resource(context)),
        authorization.authorize(context, PermissionKeys.CALENDAR_SYNC, resource(context)),
        authorization.authorize(context, PermissionKeys.CALENDAR_REPLAY, resource(context)),
        authorization.authorize(context, PermissionKeys.CALENDAR_CONFLICT_RESOLVE, resource(context)),
      ]),
    ]);
    return {
      generatedAt: options.now().toISOString(), externalEgress: false as const,
      activationStatus: profile?.operatingMode ?? "EXTERNAL_DISABLED",
      profile: profile ? { id: profile.id, displayName: profile.displayName, timeZone: profile.timeZone, syncPastDays: profile.syncPastDays, syncFutureDays: profile.syncFutureDays, maxItemsPerRun: profile.maxItemsPerRun, revision: profile.connection.revision, lastSyncAt: profile.lastSyncAt?.toISOString() ?? null, lastSuccessAt: profile.lastSuccessAt?.toISOString() ?? null } : null,
      metrics: { linked: links.length, pending: pendingJobs, conflicts: conflicts.filter((item) => item.status === "OPEN").length, failed: events.filter((item) => item.status === "FAILED_PERMANENT").length },
      links: links.map((item) => ({ id: item.id, meetingId: item.meetingId, leadName: item.meeting.lead.fullName, closerName: item.meeting.owner.user.displayName, title: item.meeting.title, startsAt: item.meeting.startsAt.toISOString(), meetingStatus: item.meeting.status, meetingRevision: item.meeting.revision, syncState: item.syncState, externalEventId: item.externalEventId, externalVersion: item.externalVersion, lastPushedAt: item.lastPushedAt?.toISOString() ?? null, lastPulledAt: item.lastPulledAt?.toISOString() ?? null })),
      events: events.map((item) => ({ id: item.id, meetingId: item.meetingId, direction: item.direction, operation: item.operation, status: item.status, origin: item.origin, occurredAt: item.occurredAt.toISOString(), processedAt: item.processedAt?.toISOString() ?? null, errorCode: item.errorCode })),
      conflicts: conflicts.map((item) => ({ id: item.id, meetingId: item.meetingId, type: item.type, status: item.status, eventKey: item.eventKey, createdAt: item.createdAt.toISOString(), resolvedAt: item.resolvedAt?.toISOString() ?? null })),
      permissions: { configure: permissions[0].allowed, sync: permissions[1].allowed, replay: permissions[2].allowed, readConflicts: conflictRead.allowed, resolveConflict: permissions[3].allowed },
      checklist: ["provider e conta aprovados", "OAuth e escopos mínimos", "política de conflito homologada", "webhook público protegido", "reconciliação contra calendário real"],
    };
  }

  async function enqueueMeetingSync(context: AuthenticatedContext, raw: unknown) {
    const input = calendarSyncMeetingSchema.parse(raw);
    const meeting = await options.database.meeting.findFirst({
      where: { id: input.meetingId, workspaceId: context.workspaceId, deletedAt: null },
      include: { history: { orderBy: { meetingRevision: "desc" }, take: 1 }, calendarLinks: { take: 1 } },
    });
    if (!meeting) fail("Reunião não encontrada neste workspace.", "CALENDAR_MEETING_NOT_FOUND", 404);
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_SYNC, resource(context, meeting.id, meeting.ownerMemberId));
    const profile = await profileFor(options.database, context.workspaceId);
    if (!profile) fail("Fundação local de calendário ausente. Execute o seed.", "CALENDAR_FOUNDATION_MISSING", 404);
    if (profile.operatingMode !== "LOCAL_SANDBOX" || !profile.connection.enabled) fail("O calendário local está pausado ou desativado.", "CALENDAR_LOCAL_INACTIVE");
    const operation = operationFromMeeting(meeting, meeting.calendarLinks.length > 0);
    const eventKey = `push:${meeting.id}:r${meeting.revision}:${operation}`;
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`calendar-sync:${context.workspaceId}:${meeting.id}`}, 0))`;
      const existing = await tx.calendarSyncEvent.findUnique({ where: { workspaceId_profileId_eventKey: { workspaceId: context.workspaceId, profileId: profile.id, eventKey } } });
      if (existing) return { status: existing.status, eventId: existing.id, idempotent: true, externalEgress: false as const };
      const externalEventId = meeting.calendarLinks[0]?.externalEventId ?? `local-event:${meeting.id}`;
      const link = await tx.calendarEventLink.upsert({
        where: { workspaceId_profileId_meetingId: { workspaceId: context.workspaceId, profileId: profile.id, meetingId: meeting.id } },
        create: { workspaceId: context.workspaceId, profileId: profile.id, meetingId: meeting.id, providerKey: CALENDAR_PROVIDER_KEY, externalCalendarId: profile.externalCalendarId, externalEventId, syncState: "PENDING_PUSH", lastMeetingRevision: meeting.revision, createdByActorId: context.actorId, updatedByActorId: context.actorId },
        update: { syncState: "PENDING_PUSH", lastMeetingRevision: meeting.revision, lastErrorCode: null, lastErrorMessage: null, updatedByActorId: context.actorId },
      });
      const payload = { meetingId: meeting.id, linkId: link.id, operation, meetingRevision: meeting.revision, scenario: input.scenario, externalEventId, externalEgress: false };
      const cursor = await tx.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PUSH", objectType: CALENDAR_OBJECT_TYPE } } });
      const syncRun = await tx.integrationSyncRun.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PUSH", objectType: CALENDAR_OBJECT_TYPE, status: "PENDING", previousCursor: cursor?.cursor ?? null, correlationId: input.correlationId, executionMode: "LOCAL_EVENT", requestedByActorId: context.actorId } });
      const outbox = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, eventType: `calendar.meeting.${operation.toLowerCase()}`, eventVersion: CALENDAR_CONTRACT_VERSION, aggregateType: "Meeting", aggregateId: meeting.id, correlationId: input.correlationId, idempotencyKey: `calendar-outbox:${eventKey}`, payload: json(payload), payloadHash: sha256(canonicalJson(payload)), createdByActorId: context.actorId } });
      const event = await tx.calendarSyncEvent.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, linkId: link.id, meetingId: meeting.id, outboxId: outbox.id, syncRunId: syncRun.id, eventKey, direction: "PUSH", operation, origin: "CRM", status: "ACCEPTED", correlationId: input.correlationId, idempotencyKey: `calendar-event:${input.idempotencyKey}`, baseMeetingRevision: meeting.revision, payloadHash: calendarPayloadHash(payload), occurredAt: options.now(), safeMetadata: { simulated: true, externalEgress: false }, createdByActorId: context.actorId } });
      const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "CALENDAR_SYNC", idempotencyKey: `calendar-job:${input.idempotencyKey}`, priority: 60, runAt: options.now(), payload: { direction: "PUSH", eventId: event.id, outboxId: outbox.id, scenario: input.scenario, externalEgress: false }, maxAttempts: CALENDAR_JOB_MAX_ATTEMPTS, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "calendar.meeting.sync_queued_local", entityType: "Meeting", entityId: meeting.id, origin: "DOMAIN", changes: { operation, meetingRevision: meeting.revision, eventId: event.id, jobId: job.id, externalEgress: false } } });
      return { status: "QUEUED" as const, eventId: event.id, jobId: job.id, idempotent: false, externalEgress: false as const };
    });
  }

  async function ingestSignedLocalCallback(workspaceId: string, rawBody: Buffer, timestamp: string | null, signature: string | null) {
    const verified = verifyLocalCalendarCallback({ workspaceId, rawBody, timestamp, signature, now: options.now() });
    if (!verified.valid) fail("Assinatura ou timestamp local do calendário inválido.", `CALENDAR_${verified.reason}`, 401);
    let decoded: unknown;
    try { decoded = JSON.parse(rawBody.toString("utf8")); } catch { fail("Payload local de calendário inválido.", "CALENDAR_CALLBACK_INVALID", 400); }
    const callback = calendarCallbackSchema.parse(decoded);
    return options.database.$transaction(async (tx) => {
      const profile = await profileFor(tx, workspaceId);
      if (!profile) fail("Calendário não configurado neste workspace.", "CALENDAR_FOUNDATION_MISSING", 404);
      if (profile.operatingMode !== "LOCAL_SANDBOX" || !profile.connection.enabled) fail("Callback recusado porque o calendário local está inativo.", "CALENDAR_LOCAL_INACTIVE", 409);
      const actor = await systemActor(tx, workspaceId);
      const existing = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId, connectionId: profile.connectionId, providerEventId: callback.eventId } } });
      if (existing) return { status: "DUPLICATE" as const, inboxId: existing.id, externalEgress: false as const };
      const bodyHash = sha256(rawBody);
      const inbox = await tx.webhookInbox.create({ data: { workspaceId, connectionId: profile.connectionId, providerEventId: callback.eventId, eventType: `calendar.event.${callback.operation.toLowerCase()}`, contractVersion: CALENDAR_CONTRACT_VERSION, payloadHash: bodyHash, nonceHash: sha256(`calendar:${workspaceId}:${callback.nonce}`), payloadSizeBytes: rawBody.byteLength, payload: json({ ...callback, occurredAt: callback.occurredAt.toISOString(), startsAt: callback.startsAt?.toISOString() ?? null, endsAt: callback.endsAt?.toISOString() ?? null, externalEgress: false }), dataClass: "OPERATIONAL", signatureStatus: "VERIFIED", externalOccurredAt: callback.occurredAt, receivedAt: options.now(), status: "RECEIVED", attempts: 0, correlationId: callback.eventId } });
      const cursor = await tx.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: { workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: CALENDAR_OBJECT_TYPE } } });
      const syncRun = await tx.integrationSyncRun.create({ data: { workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: CALENDAR_OBJECT_TYPE, status: "PENDING", previousCursor: cursor?.cursor ?? null, correlationId: callback.eventId, executionMode: "LOCAL_CALLBACK", requestedByActorId: actor.id } });
      const event = await tx.calendarSyncEvent.create({ data: { workspaceId, profileId: profile.id, meetingId: callback.meetingId ?? null, webhookInboxId: inbox.id, syncRunId: syncRun.id, eventKey: `pull:${callback.eventId}`, direction: "PULL", operation: callback.operation, origin: "LOCAL_SANDBOX", status: "ACCEPTED", correlationId: callback.eventId, idempotencyKey: `calendar-callback:${callback.eventId}`, baseMeetingRevision: callback.baseMeetingRevision ?? null, externalVersion: callback.externalVersion, externalEtag: callback.externalEtag ?? null, payloadHash: bodyHash, occurredAt: callback.occurredAt, safeMetadata: { simulated: true, externalEgress: false }, createdByActorId: actor.id } });
      const job = await tx.job.create({ data: { workspaceId, type: "CALENDAR_SYNC", idempotencyKey: `calendar-callback-job:${callback.eventId}`, priority: 70, runAt: options.now(), payload: { direction: "PULL", eventId: event.id, inboxId: inbox.id, forceExternal: false, externalEgress: false }, maxAttempts: CALENDAR_JOB_MAX_ATTEMPTS, createdByActorId: actor.id, updatedByActorId: actor.id } });
      await tx.auditLog.create({ data: { workspaceId, actorId: actor.id, action: "calendar.callback.accepted_local", entityType: "WebhookInbox", entityId: inbox.id, origin: "SYSTEM", changes: { operation: callback.operation, eventId: event.id, jobId: job.id, externalEgress: false } } });
      return { status: "ACCEPTED" as const, inboxId: inbox.id, eventId: event.id, jobId: job.id, externalEgress: false as const };
    });
  }

  async function configureLocal(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_CONFIGURE, resource(context));
    const input = calendarConfigureSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const profile = await profileFor(tx, context.workspaceId);
      if (!profile) fail("Fundação local de calendário ausente. Execute o seed.", "CALENDAR_FOUNDATION_MISSING", 404);
      if (input.revision && input.revision !== profile.connection.revision) fail("A configuração mudou. Atualize a página.", "CALENDAR_CONFIGURATION_CONFLICT");
      const config = { operatingMode: "LOCAL_SANDBOX", displayName: input.displayName, timeZone: "America/Sao_Paulo", syncPastDays: input.syncPastDays, syncFutureDays: input.syncFutureDays, maxItemsPerRun: input.maxItemsPerRun, externalEgress: false };
      const nextVersion = profile.connection.currentConfigVersion + 1;
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, version: nextVersion, schemaVersion: CALENDAR_CONTRACT_VERSION, config, configHash: sha256(canonicalJson(config)), createdByActorId: context.actorId } });
      await tx.calendarConnectionProfile.update({ where: { id: profile.id }, data: { displayName: input.displayName, syncPastDays: input.syncPastDays, syncFutureDays: input.syncFutureDays, maxItemsPerRun: input.maxItemsPerRun, configuredAt: options.now(), updatedByActorId: context.actorId } });
      await tx.integrationConnection.update({ where: { id: profile.connectionId }, data: { currentConfigVersion: nextVersion, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "calendar.local_configuration_updated", entityType: "CalendarConnectionProfile", entityId: profile.id, changes: config } });
      return { id: profile.id, revision: profile.connection.revision + 1, externalEgress: false as const };
    });
  }

  async function setPaused(context: AuthenticatedContext, paused: boolean, revision: number) {
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_CONFIGURE, resource(context));
    const profile = await profileFor(options.database, context.workspaceId);
    if (!profile) fail("Calendário local não configurado.", "CALENDAR_FOUNDATION_MISSING", 404);
    if (profile.connection.revision !== revision) fail("A configuração mudou. Atualize a página.", "CALENDAR_CONFIGURATION_CONFLICT");
    return options.database.$transaction(async (tx) => {
      await tx.integrationConnection.update({ where: { id: profile.connectionId }, data: { enabled: !paused, status: paused ? "PAUSED" : "ACTIVE_LOCAL", revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.calendarConnectionProfile.update({ where: { id: profile.id }, data: { operatingMode: paused ? "PAUSED" : "LOCAL_SANDBOX", pausedReason: paused ? "Pausa manual autorizada." : null, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: paused ? "calendar.local_paused" : "calendar.local_resumed", entityType: "CalendarConnectionProfile", entityId: profile.id, changes: { externalEgress: false } } });
      return { operatingMode: paused ? "PAUSED" as const : "LOCAL_SANDBOX" as const, revision: revision + 1 };
    });
  }

  async function replay(context: AuthenticatedContext, eventId: string) {
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_REPLAY, resource(context, eventId));
    const event = await options.database.calendarSyncEvent.findFirst({ where: { id: eventId, workspaceId: context.workspaceId, status: "FAILED_PERMANENT" } });
    if (!event) fail("Somente evento em falha terminal pode ser reprocessado.", "CALENDAR_REPLAY_NOT_ALLOWED");
    const job = await options.database.job.findFirst({ where: { workspaceId: context.workspaceId, type: "CALENDAR_SYNC", payload: { path: ["eventId"], equals: event.id } }, orderBy: { createdAt: "desc" } });
    if (!job || job.status !== "FAILED") fail("Job terminal do calendário não encontrado.", "CALENDAR_REPLAY_JOB_NOT_FOUND");
    return options.database.$transaction(async (tx) => {
      await tx.job.update({ where: { id: job.id }, data: { status: "PENDING", attempts: 0, runAt: options.now(), finishedAt: null, errorCode: null, lastError: null, updatedByActorId: context.actorId } });
      await tx.calendarSyncEvent.update({ where: { id: event.id }, data: { status: "RETRY_PENDING", errorCode: null } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "calendar.event.replay_requested", entityType: "CalendarSyncEvent", entityId: event.id, changes: { externalEgress: false } } });
      return { eventId: event.id, status: "PENDING" as const };
    });
  }

  async function resolveConflict(context: AuthenticatedContext, conflictId: string, resolution: "KEEP_CRM" | "APPLY_EXTERNAL", reason: string) {
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_CONFLICT_RESOLVE, resource(context, conflictId));
    if (reason.trim().length < 8) fail("Informe um motivo com ao menos 8 caracteres.", "CALENDAR_RESOLUTION_REASON_REQUIRED", 400);
    const conflict = await options.database.calendarSyncConflict.findFirst({ where: { id: conflictId, workspaceId: context.workspaceId, status: "OPEN" }, include: { webhookInbox: true, meeting: { include: { history: { orderBy: { meetingRevision: "desc" }, take: 1 }, calendarLinks: { take: 1, orderBy: { createdAt: "asc" } } } } } });
    if (!conflict) fail("Conflito aberto não encontrado.", "CALENDAR_CONFLICT_NOT_FOUND", 404);
    return options.database.$transaction(async (tx) => {
      const actor = context.actorId;
      const updated = await tx.calendarSyncConflict.update({ where: { id: conflict.id }, data: { status: resolution === "KEEP_CRM" ? "RESOLVED_KEEP_CRM" : "RESOLVED_APPLY_EXTERNAL", resolutionReason: reason.trim(), resolvedByActorId: actor, resolvedAt: options.now() } });
      let jobId: string | null = null;
      if (resolution === "APPLY_EXTERNAL" && conflict.webhookInboxId) {
        const event = await tx.calendarSyncEvent.findFirstOrThrow({ where: { workspaceId: context.workspaceId, webhookInboxId: conflict.webhookInboxId } });
        const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "CALENDAR_SYNC", idempotencyKey: `calendar-conflict-resolution:${conflict.id}`, priority: 90, runAt: options.now(), payload: { direction: "PULL", eventId: event.id, inboxId: conflict.webhookInboxId, forceExternal: true, externalEgress: false }, maxAttempts: CALENDAR_JOB_MAX_ATTEMPTS, createdByActorId: actor, updatedByActorId: actor } });
        await tx.calendarSyncEvent.update({ where: { id: event.id }, data: { status: "RETRY_PENDING", errorCode: null } });
        jobId = job.id;
      } else if (resolution === "KEEP_CRM") {
        if (!conflict.meeting) fail("O conflito não possui reunião suficiente para reprojetar o CRM.", "CALENDAR_KEEP_CRM_NOT_LINKED");
        const calendarLink = conflict.meeting.calendarLinks[0];
        if (!calendarLink) fail("O conflito não possui vínculo suficiente para reprojetar o CRM.", "CALENDAR_KEEP_CRM_NOT_LINKED");
        const profile = await profileFor(tx, context.workspaceId);
        if (!profile) fail("Fundação local de calendário ausente.", "CALENDAR_FOUNDATION_MISSING", 404);
        const meeting = conflict.meeting;
        const link = calendarLink;
        const operation = meeting.status === "CANCELLED" ? "CANCEL" as const : "UPDATE" as const;
        const eventKey = `push:${meeting.id}:r${meeting.revision}:${operation}:conflict:${conflict.id}`;
        const correlationId = `calendar-conflict-keep:${conflict.id}`;
        const payload = { meetingId: meeting.id, linkId: link.id, operation, meetingRevision: meeting.revision, scenario: "SUCCESS", externalEventId: link.externalEventId, conflictId: conflict.id, externalEgress: false };
        const cursor = await tx.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PUSH", objectType: CALENDAR_OBJECT_TYPE } } });
        const syncRun = await tx.integrationSyncRun.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PUSH", objectType: CALENDAR_OBJECT_TYPE, status: "PENDING", previousCursor: cursor?.cursor ?? null, correlationId, executionMode: "CONFLICT_RESOLUTION", requestedByActorId: actor } });
        const outbox = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, eventType: `calendar.meeting.${operation.toLowerCase()}`, eventVersion: CALENDAR_CONTRACT_VERSION, aggregateType: "Meeting", aggregateId: meeting.id, correlationId, idempotencyKey: `calendar-conflict-keep-outbox:${conflict.id}`, payload: json(payload), payloadHash: sha256(canonicalJson(payload)), createdByActorId: actor } });
        const event = await tx.calendarSyncEvent.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, linkId: link.id, meetingId: meeting.id, outboxId: outbox.id, syncRunId: syncRun.id, eventKey, direction: "PUSH", operation, origin: "REPLAY", status: "ACCEPTED", correlationId, causationId: conflict.eventKey, idempotencyKey: `calendar-conflict-keep-event:${conflict.id}`, baseMeetingRevision: meeting.revision, payloadHash: calendarPayloadHash(payload), occurredAt: options.now(), safeMetadata: { conflictId: conflict.id, simulated: true, externalEgress: false }, createdByActorId: actor } });
        const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "CALENDAR_SYNC", idempotencyKey: `calendar-conflict-keep-job:${conflict.id}`, priority: 90, runAt: options.now(), payload: { direction: "PUSH", eventId: event.id, outboxId: outbox.id, scenario: "SUCCESS", externalEgress: false }, maxAttempts: CALENDAR_JOB_MAX_ATTEMPTS, createdByActorId: actor, updatedByActorId: actor } });
        await tx.calendarEventLink.update({ where: { id: link.id }, data: { syncState: "PENDING_PUSH", lastMeetingRevision: meeting.revision, lastErrorCode: null, lastErrorMessage: null, updatedByActorId: actor } });
        jobId = job.id;
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: actor, action: "calendar.conflict.resolved", entityType: "CalendarSyncConflict", entityId: conflict.id, reason: reason.trim(), changes: { resolution, jobId, externalEgress: false } } });
      return { id: updated.id, status: updated.status, jobId };
    });
  }

  return Object.freeze({ screen, enqueueMeetingSync, ingestSignedLocalCallback, configureLocal, setPaused, replay, resolveConflict });
}

let service: ReturnType<typeof createCalendarService> | undefined;
export function getCalendarService() {
  service ??= createCalendarService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}

export function createCalendarMeetingDomainService(database: PrismaClient, now: () => Date) {
  const authorization = createAuthorizationService({ database });
  return createMeetingService({
    database,
    authorization,
    now,
    automationPublisher: createAutomationEngineService({ database, authorization, now }),
  });
}

export type CalendarInboundEvent = CalendarCallback;
