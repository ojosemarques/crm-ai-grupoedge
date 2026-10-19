import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  createCalendarMeetingDomainService,
  resolveCalendarOperatorContext,
} from "@/modules/integrations/application/calendar-service";
import { decryptGoogleCalendarSecret, encryptGoogleCalendarSecret } from "@/modules/integrations/application/google-calendar-crypto";
import {
  normalizeGoogleCalendarEvent,
  type NormalizedGoogleCalendarEvent,
} from "@/modules/integrations/application/google-calendar-pull";
import { loadGoogleCalendarConfiguration } from "@/modules/integrations/domain/google-calendar-contracts";
import { calculateRetryDelaySeconds } from "@/modules/integrations/domain/integration-policy";

type Options = Readonly<{ database: PrismaClient; now: () => Date; lockTimeoutSeconds?: number; backoffBaseSeconds?: number; fetcher?: typeof fetch; pullIntervalSeconds?: number }>;
type Payload = Readonly<{ meetingId: string; meetingRevision: number; linkId: string }>;

class GoogleCalendarWorkerError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly needsReauth = false) {
    super(code);
  }
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function payload(value: Prisma.JsonValue): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_JOB_INVALID", false);
  if (typeof value.meetingId !== "string" || typeof value.meetingRevision !== "number" || typeof value.linkId !== "string") {
    throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_JOB_INVALID", false);
  }
  return { meetingId: value.meetingId, meetingRevision: value.meetingRevision, linkId: value.linkId };
}

async function googleJson(response: Response, maximumBytes = 128 * 1024) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumBytes) throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_RESPONSE_TOO_LARGE", false);
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_INVALID_RESPONSE", false); }
}

function classify(response: Response, body: Record<string, unknown>) {
  const oauthError = typeof body.error === "string" ? body.error : null;
  if (oauthError === "invalid_grant" || response.status === 401) return new GoogleCalendarWorkerError("GOOGLE_CALENDAR_REAUTH_REQUIRED", false, true);
  if (response.status === 408 || response.status === 429 || response.status >= 500) return new GoogleCalendarWorkerError("GOOGLE_CALENDAR_TRANSIENT", true);
  return new GoogleCalendarWorkerError("GOOGLE_CALENDAR_REQUEST_REJECTED", false);
}

export function createGoogleCalendarWorkerService(options: Options) {
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;
  const pullIntervalSeconds = options.pullIntervalSeconds ?? 60;
  const fetcher = options.fetcher ?? fetch;

  async function claim(workerId: string) {
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "type" = 'GOOGLE_CALENDAR_SYNC'
          AND (("status" = 'PENDING' AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockExpiresAt" < ${now}))
        ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: {
        status: "RUNNING", lockedAt: now, lockedBy: workerId,
        lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000),
        attempts: { increment: 1 }, lastAttemptAt: now,
      } });
    }, { isolationLevel: "ReadCommitted" });
  }

  async function accessToken(account: NonNullable<Awaited<ReturnType<typeof options.database.googleCalendarAccount.findFirst>>>) {
    const configuration = loadGoogleCalendarConfiguration();
    if (account.tokenExpiresAt.getTime() > options.now().getTime() + 60_000) {
      return decryptGoogleCalendarSecret(account.accessTokenCiphertext, configuration.encryptionKey);
    }
    const refreshToken = decryptGoogleCalendarSecret(account.refreshTokenCiphertext, configuration.encryptionKey);
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: configuration.clientId, client_secret: configuration.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await googleJson(response);
    if (!response.ok || typeof body.access_token !== "string") throw classify(response, body);
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3_600;
    await options.database.googleCalendarAccount.update({ where: { id: account.id }, data: {
      accessTokenCiphertext: encryptGoogleCalendarSecret(body.access_token, configuration.encryptionKey),
      tokenExpiresAt: new Date(options.now().getTime() + expiresIn * 1_000),
      status: "CONNECTED", lastErrorAt: null, lastErrorCode: null,
    } });
    return body.access_token;
  }

  async function push(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, data: Payload) {
    const link = await options.database.googleCalendarEventLink.findFirst({
      where: { id: data.linkId, workspaceId: job.workspaceId },
      include: {
        account: true,
        meeting: { include: { lead: { select: { fullName: true } }, owner: { select: { user: { select: { displayName: true } } } } } },
      },
    });
    if (!link || link.meetingId !== data.meetingId) throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_LINK_MISSING", false);
    if (link.account.status !== "CONNECTED") throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_REAUTH_REQUIRED", false, true);
    if (link.syncedRevision !== null && link.syncedRevision >= link.meeting.revision && link.syncState === "SYNCED") {
      await options.database.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", finishedAt: options.now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, result: json({ idempotent: true }) } });
      return { status: "DUPLICATE" as const };
    }
    const token = await accessToken(link.account);
    const eventCollectionUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(link.account.calendarId)}/events`);
    const eventUrl = new URL(`${eventCollectionUrl.toString()}/${encodeURIComponent(link.externalEventId)}`);
    eventUrl.searchParams.set("sendUpdates", "none");
    eventUrl.searchParams.set("conferenceDataVersion", "1");
    const cancelled = link.meeting.status === "CANCELLED";
    const exists = link.syncedRevision !== null;
    let response: Response;
    if (cancelled) {
      response = await fetcher(eventUrl, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok && response.status !== 404 && response.status !== 410) throw classify(response, await googleJson(response));
    } else {
      const body = {
        id: link.externalEventId,
        summary: link.meeting.title,
        description: `Lead: ${link.meeting.lead.fullName}\nResponsável: ${link.meeting.owner.user.displayName}\n\nReunião gerenciada pelo CRM Politizai.`,
        start: { dateTime: link.meeting.startsAt.toISOString(), timeZone: link.meeting.timeZone },
        end: { dateTime: link.meeting.endsAt.toISOString(), timeZone: link.meeting.timeZone },
        extendedProperties: { private: { crmMeetingId: link.meeting.id, crmWorkspaceId: link.meeting.workspaceId } },
        ...(!exists ? { conferenceData: { createRequest: { requestId: `meet-${link.meeting.id}-r${link.meeting.revision}`, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
      };
      const destination = exists ? eventUrl : eventCollectionUrl;
      destination.searchParams.set("sendUpdates", "none");
      destination.searchParams.set("conferenceDataVersion", "1");
      response = await fetcher(destination, {
        method: exists ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!exists && response.status === 409) {
        response = await fetcher(eventUrl, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      }
      if (!response.ok) throw classify(response, await googleJson(response));
    }
    const result = cancelled ? {} : await googleJson(response);
    const conference = result.conferenceData && typeof result.conferenceData === "object" ? result.conferenceData as { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } : null;
    const conferenceUrl = conference?.entryPoints?.find((item) => item.entryPointType === "video")?.uri ?? link.conferenceUrl;
    const now = options.now();
    await options.database.$transaction(async (tx) => {
      const changed = await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, result: json({ externalEventId: link.externalEventId, cancelled }) } });
      if (changed.count !== 1) return;
      await tx.googleCalendarEventLink.update({ where: { id: link.id }, data: {
        syncState: cancelled ? "CANCELLED" : "SYNCED",
        syncedRevision: link.meeting.revision,
        externalEtag: typeof result.etag === "string" ? result.etag : link.externalEtag,
        externalHtmlLink: typeof result.htmlLink === "string" ? result.htmlLink : link.externalHtmlLink,
        conferenceUrl: conferenceUrl ?? null,
        lastPushedAt: now, lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null,
      } });
      await tx.googleCalendarAccount.update({ where: { id: link.account.id }, data: { lastSyncAt: now, lastErrorAt: null, lastErrorCode: null } });
      await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: job.updatedByActorId, action: cancelled ? "google_calendar.meeting.cancelled" : "google_calendar.meeting.synced", entityType: "Meeting", entityId: link.meeting.id, origin: "SYSTEM", changes: { meetingRevision: link.meeting.revision, ownerMemberId: link.memberId, externalEventId: link.externalEventId } } });
    });
    return { status: "SUCCEEDED" as const };
  }

  async function claimPull(workerId: string) {
    const now = options.now();
    return options.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT account."id" FROM "google_calendar_accounts" account
        WHERE account."status" = 'CONNECTED'
          AND account."nextPullAt" <= ${now}
          AND (account."pullLockExpiresAt" IS NULL OR account."pullLockExpiresAt" < ${now})
          AND NOT EXISTS (
            SELECT 1 FROM "jobs" job
            INNER JOIN "google_calendar_event_links" link
              ON link."workspaceId" = job."workspaceId"
              AND link."id"::text = job."payload"->>'linkId'
            WHERE link."accountId" = account."id"
              AND job."type" = 'GOOGLE_CALENDAR_SYNC'
              AND job."status" IN ('PENDING', 'RUNNING')
          )
        ORDER BY account."nextPullAt" ASC, account."createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.googleCalendarAccount.update({
        where: { id: rows[0].id },
        data: {
          pullLockedAt: now,
          pullLockedBy: workerId,
          pullLockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000),
        },
        include: { workspace: { select: { timeZone: true } } },
      });
    }, { isolationLevel: "ReadCommitted" });
  }

  function encryptedCursor(value: string | null, encryptionKey: string) {
    return value ? encryptGoogleCalendarSecret(value, encryptionKey) : null;
  }

  function decryptedCursor(value: string | null, encryptionKey: string) {
    return value ? decryptGoogleCalendarSecret(value, encryptionKey) : null;
  }

  function localDateTime(value: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  }

  function errorCode(error: unknown) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate?.code === "string") return candidate.code;
    if (typeof candidate?.message === "string" && /^[A-Z0-9_]+$/.test(candidate.message)) return candidate.message;
    return "GOOGLE_CALENDAR_PULL_APPLY_FAILED";
  }

  async function markLinkConflict(
    account: NonNullable<Awaited<ReturnType<typeof claimPull>>>,
    linkId: string,
    code: string,
  ) {
    const now = options.now();
    await options.database.googleCalendarEventLink.updateMany({
      where: { id: linkId, workspaceId: account.workspaceId, accountId: account.id },
      data: {
        syncState: "CONFLICT",
        lastPulledAt: now,
        lastErrorAt: now,
        lastErrorCode: code,
        lastErrorMessage: "A alteração recebida do Google exige revisão no CRM.",
      },
    });
  }

  async function applyLinkedEvent(
    account: NonNullable<Awaited<ReturnType<typeof claimPull>>>,
    event: NormalizedGoogleCalendarEvent,
    link: Awaited<ReturnType<typeof options.database.googleCalendarEventLink.findFirst>> & {
      meeting: {
        id: string;
        title: string;
        status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
        startsAt: Date;
        endsAt: Date;
        durationMinutes: number;
        timeZone: string;
        observation: string | null;
        outcome: string | null;
        revision: number;
      };
    },
  ) {
    const now = options.now();
    if (event.kind === "DELETED") {
      if (link.meeting.status === "SCHEDULED" || link.meeting.status === "CONFIRMED") {
        try {
          const operator = await resolveCalendarOperatorContext(options.database, account.workspaceId);
          await createCalendarMeetingDomainService(options.database, options.now).act(operator, {
            action: "CANCEL",
            meetingId: link.meeting.id,
            expectedRevision: link.meeting.revision,
            reason: "Evento removido ou cancelado no Google Calendar.",
            nextAction: {
              title: "Revisar cancelamento recebido do Google Calendar",
              dueAtLocal: localDateTime(new Date(now.getTime() + 60 * 60_000), link.meeting.timeZone),
            },
          });
        } catch (error) {
          await markLinkConflict(account, link.id, errorCode(error));
          return false;
        }
      }
      await options.database.googleCalendarEventLink.updateMany({
        where: { id: link.id, workspaceId: account.workspaceId, accountId: account.id },
        data: { externalEtag: event.externalEtag, lastPulledAt: now },
      });
      return true;
    }

    await options.database.googleCalendarEventLink.updateMany({
      where: { id: link.id, workspaceId: account.workspaceId, accountId: account.id },
      data: {
        externalEtag: event.externalEtag,
        externalHtmlLink: event.htmlLink,
        conferenceUrl: event.conferenceUrl,
        lastPulledAt: now,
      },
    });
    if (event.externalEtag && link.externalEtag === event.externalEtag) return true;
    if (link.meeting.status !== "SCHEDULED" && link.meeting.status !== "CONFIRMED") return true;
    const durationMinutes = Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000);
    const changed = link.meeting.title !== event.title
      || link.meeting.startsAt.getTime() !== event.startsAt.getTime()
      || link.meeting.endsAt.getTime() !== event.endsAt.getTime();
    if (!changed) return true;
    if (durationMinutes !== 30 && durationMinutes !== 40) {
      await markLinkConflict(account, link.id, "GOOGLE_CALENDAR_DURATION_UNSUPPORTED");
      return false;
    }
    try {
      const operator = await resolveCalendarOperatorContext(options.database, account.workspaceId);
      await createCalendarMeetingDomainService(options.database, options.now).act(operator, {
        action: "EDIT",
        meetingId: link.meeting.id,
        expectedRevision: link.meeting.revision,
        title: event.title,
        startsAtLocal: localDateTime(event.startsAt, link.meeting.timeZone),
        durationMinutes,
        status: link.meeting.status,
        observation: link.meeting.observation,
        outcome: link.meeting.outcome,
        reason: "Título ou horário atualizado pelo Google Calendar.",
      });
      return true;
    } catch (error) {
      await markLinkConflict(account, link.id, errorCode(error));
      return false;
    }
  }

  async function resetExpiredPullToken(
    account: NonNullable<Awaited<ReturnType<typeof claimPull>>>,
    workerId: string,
  ) {
    const now = options.now();
    const actor = await options.database.actor.findFirst({
      where: { workspaceId: account.workspaceId, type: "SYSTEM", userId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    await options.database.$transaction(async (tx) => {
      await tx.googleCalendarImportedEvent.updateMany({
        where: { workspaceId: account.workspaceId, accountId: account.id, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
      });
      await tx.googleCalendarAccount.updateMany({
        where: { id: account.id, workspaceId: account.workspaceId, pullLockedBy: workerId },
        data: {
          pullSyncTokenCiphertext: null,
          pullPageTokenCiphertext: null,
          pullStartedAt: null,
          pullLockedAt: null,
          pullLockedBy: null,
          pullLockExpiresAt: null,
          nextPullAt: now,
          lastErrorAt: now,
          lastErrorCode: "GOOGLE_CALENDAR_SYNC_TOKEN_EXPIRED",
        },
      });
      if (actor) await tx.auditLog.create({ data: {
        workspaceId: account.workspaceId,
        actorId: actor.id,
        action: "google_calendar.pull.full_sync_required",
        entityType: "GoogleCalendarAccount",
        entityId: account.id,
        origin: "SYSTEM",
        changes: { reasonCode: "GOOGLE_CALENDAR_SYNC_TOKEN_EXPIRED" },
      } });
    });
    return { status: "RESET_REQUIRED" as const };
  }

  async function pull(
    account: NonNullable<Awaited<ReturnType<typeof claimPull>>>,
    workerId: string,
  ) {
    const configuration = loadGoogleCalendarConfiguration();
    const syncToken = decryptedCursor(account.pullSyncTokenCiphertext, configuration.encryptionKey);
    const pageToken = decryptedCursor(account.pullPageTokenCiphertext, configuration.encryptionKey);
    const fullSync = !syncToken;
    const fullSyncStartedAt = fullSync ? account.pullStartedAt ?? options.now() : null;
    if (fullSync && !account.pullStartedAt) {
      await options.database.googleCalendarAccount.updateMany({
        where: { id: account.id, workspaceId: account.workspaceId, pullLockedBy: workerId },
        data: { pullStartedAt: fullSyncStartedAt },
      });
    }

    const token = await accessToken(account);
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(account.calendarId)}/events`);
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("singleEvents", "true");
    if (syncToken) url.searchParams.set("syncToken", syncToken);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 410 && syncToken) return resetExpiredPullToken(account, workerId);
    const body = await googleJson(response, 2 * 1024 * 1024);
    if (!response.ok) throw classify(response, body);
    const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
    const nextPageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
    const nextSyncToken = typeof body.nextSyncToken === "string" ? body.nextSyncToken : null;
    if (!nextPageToken && !nextSyncToken) throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_CURSOR_MISSING", true);
    const ids = items.flatMap((item) => {
      const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
      return typeof row?.id === "string" ? [row.id.slice(0, 1_024)] : [];
    });
    const links = ids.length > 0 ? await options.database.googleCalendarEventLink.findMany({
      where: { workspaceId: account.workspaceId, accountId: account.id, externalEventId: { in: ids } },
      include: { meeting: true },
    }) : [];
    const linkByExternalId = new Map(links.map((link) => [link.externalEventId, link]));
    let imported = 0;
    let deleted = 0;
    let linked = 0;
    let ignored = 0;
    let conflicts = 0;
    const pageNow = options.now();

    for (const item of items) {
      let event: NormalizedGoogleCalendarEvent;
      try {
        event = normalizeGoogleCalendarEvent(item as Record<string, unknown>, account.workspace.timeZone);
      } catch {
        ignored += 1;
        continue;
      }
      const link = linkByExternalId.get(event.externalEventId);
      if (link) {
        await options.database.googleCalendarImportedEvent.updateMany({
          where: { workspaceId: account.workspaceId, accountId: account.id, externalEventId: event.externalEventId, deletedAt: null },
          data: { deletedAt: pageNow, updatedAt: pageNow },
        });
        const applied = await applyLinkedEvent(account, event, link);
        linked += 1;
        if (!applied) conflicts += 1;
        continue;
      }
      if (event.kind === "DELETED") {
        const result = await options.database.googleCalendarImportedEvent.updateMany({
          where: { workspaceId: account.workspaceId, accountId: account.id, externalEventId: event.externalEventId, deletedAt: null },
          data: { externalEtag: event.externalEtag, lastSeenAt: pageNow, deletedAt: pageNow, updatedAt: pageNow },
        });
        deleted += result.count;
        continue;
      }
      await options.database.googleCalendarImportedEvent.upsert({
        where: { workspaceId_accountId_externalEventId: { workspaceId: account.workspaceId, accountId: account.id, externalEventId: event.externalEventId } },
        create: {
          workspaceId: account.workspaceId,
          accountId: account.id,
          memberId: account.memberId,
          externalEventId: event.externalEventId,
          externalEtag: event.externalEtag,
          title: event.title,
          location: event.location,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          timeZone: event.timeZone,
          externalStatus: event.externalStatus,
          visibility: event.visibility,
          eventType: event.eventType,
          externalHtmlLink: event.htmlLink,
          conferenceUrl: event.conferenceUrl,
          creatorName: event.creatorName,
          creatorEmail: event.creatorEmail,
          sourceUpdatedAt: event.sourceUpdatedAt,
          lastSeenAt: pageNow,
        },
        update: {
          memberId: account.memberId,
          externalEtag: event.externalEtag,
          title: event.title,
          location: event.location,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          timeZone: event.timeZone,
          externalStatus: event.externalStatus,
          visibility: event.visibility,
          eventType: event.eventType,
          externalHtmlLink: event.htmlLink,
          conferenceUrl: event.conferenceUrl,
          creatorName: event.creatorName,
          creatorEmail: event.creatorEmail,
          sourceUpdatedAt: event.sourceUpdatedAt,
          lastSeenAt: pageNow,
          deletedAt: null,
        },
      });
      imported += 1;
    }

    const actor = await options.database.actor.findFirst({
      where: { workspaceId: account.workspaceId, type: "SYSTEM", userId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    await options.database.$transaction(async (tx) => {
      if (!nextPageToken && fullSyncStartedAt) {
        const stale = await tx.googleCalendarImportedEvent.updateMany({
          where: {
            workspaceId: account.workspaceId,
            accountId: account.id,
            deletedAt: null,
            lastSeenAt: { lt: fullSyncStartedAt },
          },
          data: { deletedAt: pageNow, updatedAt: pageNow },
        });
        deleted += stale.count;
      }
      const changed = await tx.googleCalendarAccount.updateMany({
        where: { id: account.id, workspaceId: account.workspaceId, pullLockedBy: workerId },
        data: {
          pullSyncTokenCiphertext: nextPageToken
            ? account.pullSyncTokenCiphertext
            : encryptedCursor(nextSyncToken, configuration.encryptionKey),
          pullPageTokenCiphertext: encryptedCursor(nextPageToken, configuration.encryptionKey),
          pullStartedAt: nextPageToken ? fullSyncStartedAt : null,
          pullLockedAt: null,
          pullLockedBy: null,
          pullLockExpiresAt: null,
          nextPullAt: nextPageToken ? pageNow : new Date(pageNow.getTime() + pullIntervalSeconds * 1_000),
          lastPullAt: nextPageToken ? account.lastPullAt : pageNow,
          lastSyncAt: nextPageToken ? account.lastSyncAt : pageNow,
          lastErrorAt: null,
          lastErrorCode: null,
        },
      });
      if (changed.count !== 1) throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_PULL_LOCK_LOST", true);
      if (actor) await tx.auditLog.create({ data: {
        workspaceId: account.workspaceId,
        actorId: actor.id,
        action: nextPageToken ? "google_calendar.pull.page_processed" : "google_calendar.pull.completed",
        entityType: "GoogleCalendarAccount",
        entityId: account.id,
        origin: "SYSTEM",
        changes: { imported, deleted, linked, ignored, conflicts, hasNextPage: Boolean(nextPageToken), fullSync },
      } });
    });
    return { status: nextPageToken ? "PAGE_SYNCED" as const : "PULLED" as const };
  }

  async function failPull(
    account: NonNullable<Awaited<ReturnType<typeof claimPull>>>,
    workerId: string,
    error: unknown,
  ) {
    const detail = error instanceof GoogleCalendarWorkerError
      ? error
      : new GoogleCalendarWorkerError(error instanceof DOMException && error.name === "TimeoutError" ? "GOOGLE_CALENDAR_TIMEOUT" : "GOOGLE_CALENDAR_INTERNAL", true);
    const now = options.now();
    await options.database.googleCalendarAccount.updateMany({
      where: { id: account.id, workspaceId: account.workspaceId, pullLockedBy: workerId },
      data: {
        status: detail.needsReauth ? "NEEDS_REAUTH" : account.status,
        nextPullAt: new Date(now.getTime() + (detail.retryable ? 5 : 15) * 60_000),
        pullLockedAt: null,
        pullLockedBy: null,
        pullLockExpiresAt: null,
        lastErrorAt: now,
        lastErrorCode: detail.code,
      },
    });
    return { status: detail.needsReauth ? "FAILED" as const : "RETRY_PENDING" as const, code: detail.code };
  }

  async function failJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, error: unknown) {
    const detail = error instanceof GoogleCalendarWorkerError
      ? error
      : new GoogleCalendarWorkerError(error instanceof DOMException && error.name === "TimeoutError" ? "GOOGLE_CALENDAR_TIMEOUT" : "GOOGLE_CALENDAR_INTERNAL", true);
    const terminal = !detail.retryable || job.attempts >= job.maxAttempts;
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const now = options.now();
    const parsed = (() => { try { return payload(job.payload); } catch { return null; } })();
    await options.database.$transaction(async (tx) => {
      await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: {
        status: terminal ? "FAILED" : "PENDING",
        runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000),
        lastError: "Falha controlada na sincronização Google Calendar.", errorCode: detail.code,
        finishedAt: terminal ? now : null, lockedAt: null, lockedBy: null, lockExpiresAt: null,
      } });
      if (parsed) await tx.googleCalendarEventLink.updateMany({ where: { id: parsed.linkId, workspaceId: job.workspaceId }, data: { syncState: "FAILED", lastErrorAt: now, lastErrorCode: detail.code, lastErrorMessage: "Falha controlada; reconecte a conta se solicitado." } });
      if (detail.needsReauth && parsed) {
        const link = await tx.googleCalendarEventLink.findUnique({ where: { id: parsed.linkId }, select: { accountId: true } });
        if (link) await tx.googleCalendarAccount.update({ where: { id: link.accountId }, data: { status: "NEEDS_REAUTH", lastErrorAt: now, lastErrorCode: detail.code } });
      }
    });
    return { status: terminal ? "FAILED" as const : "RETRY_PENDING" as const, code: detail.code };
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (job) {
      try { return await push(job, workerId, payload(job.payload)); }
      catch (error) { return failJob(job, workerId, error); }
    }
    const account = await claimPull(workerId);
    if (!account) return { status: "IDLE" as const };
    try { return await pull(account, workerId); }
    catch (error) { return failPull(account, workerId, error); }
  }

  return Object.freeze({ processNext });
}
