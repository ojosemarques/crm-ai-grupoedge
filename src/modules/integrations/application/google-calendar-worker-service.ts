import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { decryptGoogleCalendarSecret, encryptGoogleCalendarSecret } from "@/modules/integrations/application/google-calendar-crypto";
import { loadGoogleCalendarConfiguration } from "@/modules/integrations/domain/google-calendar-contracts";
import { calculateRetryDelaySeconds } from "@/modules/integrations/domain/integration-policy";

type Options = Readonly<{ database: PrismaClient; now: () => Date; lockTimeoutSeconds?: number; backoffBaseSeconds?: number }>;
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

async function googleJson(response: Response) {
  const text = await response.text();
  if (Buffer.byteLength(text) > 128 * 1024) throw new GoogleCalendarWorkerError("GOOGLE_CALENDAR_RESPONSE_TOO_LARGE", false);
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
    const response = await fetch("https://oauth2.googleapis.com/token", {
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
      response = await fetch(eventUrl, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
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
      response = await fetch(destination, {
        method: exists ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!exists && response.status === 409) {
        response = await fetch(eventUrl, {
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
    if (!job) return { status: "IDLE" as const };
    try { return await push(job, workerId, payload(job.payload)); }
    catch (error) { return failJob(job, workerId, error); }
  }

  return Object.freeze({ processNext });
}
