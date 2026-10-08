import { createHash, randomBytes } from "node:crypto";

import { type Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { decryptGoogleCalendarSecret, encryptGoogleCalendarSecret } from "@/modules/integrations/application/google-calendar-crypto";
import {
  GOOGLE_CALENDAR_SCOPES,
  googleCalendarRedirectUri,
  loadGoogleCalendarConfiguration,
} from "@/modules/integrations/domain/google-calendar-contracts";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

async function readJson(response: Response) {
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) fail("O Google retornou uma resposta acima do limite.", "GOOGLE_CALENDAR_RESPONSE_TOO_LARGE", 502);
  try { return JSON.parse(text) as unknown; }
  catch { fail("O Google retornou uma resposta inválida.", "GOOGLE_CALENDAR_INVALID_RESPONSE", 502); }
}

export async function enqueueGoogleCalendarSyncInTransaction(
  tx: Tx,
  input: Readonly<{ workspaceId: string; meetingId: string; ownerMemberId: string; meetingRevision: number; actorId: string; now: Date }>,
) {
  const account = await tx.googleCalendarAccount.findFirst({
    where: { workspaceId: input.workspaceId, memberId: input.ownerMemberId, status: "CONNECTED" },
    select: { id: true },
  });
  if (!account) return { queued: false as const, reason: "OWNER_NOT_CONNECTED" as const };
  const externalEventId = `crm${input.meetingId.replaceAll("-", "")}`;
  const link = await tx.googleCalendarEventLink.upsert({
    where: { workspaceId_meetingId: { workspaceId: input.workspaceId, meetingId: input.meetingId } },
    create: {
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      memberId: input.ownerMemberId,
      accountId: account.id,
      externalEventId,
      syncState: "PENDING_PUSH",
    },
    update: {
      memberId: input.ownerMemberId,
      accountId: account.id,
      syncState: "PENDING_PUSH",
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  const idempotencyKey = `google-calendar:${input.meetingId}:r${input.meetingRevision}`;
  await tx.job.upsert({
    where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } },
    create: {
      workspaceId: input.workspaceId,
      type: "GOOGLE_CALENDAR_SYNC",
      idempotencyKey,
      priority: 80,
      runAt: input.now,
      payload: { meetingId: input.meetingId, meetingRevision: input.meetingRevision, linkId: link.id },
      maxAttempts: 5,
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
    update: {
      status: "PENDING",
      runAt: input.now,
      finishedAt: null,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      lastError: null,
      errorCode: null,
      updatedByActorId: input.actorId,
    },
  });
  return { queued: true as const, linkId: link.id };
}

export function createGoogleCalendarService(options: Options) {
  const authorization = createAuthorizationService({ database: options.database });

  async function authorizeOwn(context: AuthenticatedContext) {
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_SYNC, {
      workspaceId: context.workspaceId,
      resourceType: "GoogleCalendarAccount",
      resourceId: context.memberId,
      ownerMemberId: context.memberId,
      memberId: context.memberId,
    });
  }

  async function screen(context: AuthenticatedContext) {
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_READ, {
      workspaceId: context.workspaceId,
      resourceType: "GoogleCalendarAccount",
      resourceId: context.memberId,
      ownerMemberId: context.memberId,
      memberId: context.memberId,
    });
    const account = await options.database.googleCalendarAccount.findUnique({
      where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } },
      select: { googleEmail: true, status: true, lastSyncAt: true, lastErrorAt: true, lastErrorCode: true, updatedAt: true },
    });
    let configurationReady = true;
    try { loadGoogleCalendarConfiguration(); } catch { configurationReady = false; }
    return {
      configurationReady,
      account: account ? {
        email: account.googleEmail,
        status: account.status,
        lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
        lastErrorAt: account.lastErrorAt?.toISOString() ?? null,
        lastErrorCode: account.lastErrorCode,
        updatedAt: account.updatedAt.toISOString(),
      } : null,
    };
  }

  async function beginConnect(context: AuthenticatedContext) {
    await authorizeOwn(context);
    let configuration;
    try { configuration = loadGoogleCalendarConfiguration(); }
    catch { fail("A integração Google Calendar ainda não está configurada no servidor.", "GOOGLE_CALENDAR_CONFIGURATION_MISSING", 503); }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = digest(verifier);
    await options.database.$transaction(async (tx) => {
      await tx.googleCalendarOAuthState.deleteMany({
        where: { workspaceId: context.workspaceId, memberId: context.memberId, OR: [{ expiresAt: { lte: options.now() } }, { consumedAt: { not: null } }] },
      });
      await tx.googleCalendarOAuthState.create({ data: {
        workspaceId: context.workspaceId,
        memberId: context.memberId,
        stateHash: digest(state),
        codeVerifierCiphertext: encryptGoogleCalendarSecret(verifier, configuration.encryptionKey),
        expiresAt: new Date(options.now().getTime() + 10 * 60_000),
      } });
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", configuration.clientId);
    url.searchParams.set("redirect_uri", googleCalendarRedirectUri(configuration));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (context.email) url.searchParams.set("login_hint", context.email);
    return { authorizationUrl: url.toString() };
  }

  async function completeConnect(context: AuthenticatedContext, state: string, code: string) {
    await authorizeOwn(context);
    let configuration;
    try { configuration = loadGoogleCalendarConfiguration(); }
    catch { fail("A integração Google Calendar não está configurada.", "GOOGLE_CALENDAR_CONFIGURATION_MISSING", 503); }
    const stored = await options.database.googleCalendarOAuthState.findUnique({ where: { stateHash: digest(state) } });
    if (!stored || stored.workspaceId !== context.workspaceId || stored.memberId !== context.memberId || stored.consumedAt || stored.expiresAt <= options.now()) {
      fail("A autorização expirou ou não pertence a esta sessão.", "GOOGLE_CALENDAR_STATE_INVALID", 400);
    }
    const consumed = await options.database.googleCalendarOAuthState.updateMany({
      where: { id: stored.id, consumedAt: null, expiresAt: { gt: options.now() } },
      data: { consumedAt: options.now() },
    });
    if (consumed.count !== 1) fail("A autorização já foi utilizada.", "GOOGLE_CALENDAR_STATE_REPLAY", 400);
    const verifier = decryptGoogleCalendarSecret(stored.codeVerifierCiphertext, configuration.encryptionKey);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        redirect_uri: googleCalendarRedirectUri(configuration),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokenPayload = await readJson(tokenResponse) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") fail("O Google recusou a autorização.", "GOOGLE_CALENDAR_TOKEN_REJECTED", 400);
    const existing = await options.database.googleCalendarAccount.findUnique({
      where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } },
      select: { refreshTokenCiphertext: true },
    });
    const refreshToken = typeof tokenPayload.refresh_token === "string"
      ? tokenPayload.refresh_token
      : existing ? decryptGoogleCalendarSecret(existing.refreshTokenCiphertext, configuration.encryptionKey) : null;
    if (!refreshToken) fail("O Google não forneceu acesso offline. Autorize novamente.", "GOOGLE_CALENDAR_REFRESH_TOKEN_MISSING", 400);
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const user = await readJson(userResponse) as { sub?: unknown; email?: unknown; email_verified?: unknown };
    if (!userResponse.ok || typeof user.sub !== "string" || typeof user.email !== "string" || user.email_verified !== true) {
      fail("Não foi possível validar a conta Google.", "GOOGLE_CALENDAR_IDENTITY_INVALID", 400);
    }
    const expiresIn = typeof tokenPayload.expires_in === "number" ? tokenPayload.expires_in : 3_600;
    const grantedScopes = typeof tokenPayload.scope === "string" ? tokenPayload.scope.split(" ").filter(Boolean) : [...GOOGLE_CALENDAR_SCOPES];
    await options.database.googleCalendarAccount.upsert({
      where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } },
      create: {
        workspaceId: context.workspaceId,
        memberId: context.memberId,
        googleSubject: user.sub,
        googleEmail: user.email,
        accessTokenCiphertext: encryptGoogleCalendarSecret(tokenPayload.access_token, configuration.encryptionKey),
        refreshTokenCiphertext: encryptGoogleCalendarSecret(refreshToken, configuration.encryptionKey),
        tokenExpiresAt: new Date(options.now().getTime() + expiresIn * 1_000),
        grantedScopes,
        status: "CONNECTED",
        createdByActorId: context.actorId,
        updatedByActorId: context.actorId,
      },
      update: {
        googleSubject: user.sub,
        googleEmail: user.email,
        accessTokenCiphertext: encryptGoogleCalendarSecret(tokenPayload.access_token, configuration.encryptionKey),
        refreshTokenCiphertext: encryptGoogleCalendarSecret(refreshToken, configuration.encryptionKey),
        tokenExpiresAt: new Date(options.now().getTime() + expiresIn * 1_000),
        grantedScopes,
        status: "CONNECTED",
        disconnectedAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
        updatedByActorId: context.actorId,
      },
    });
    await options.database.$transaction(async (tx) => {
      const futureMeetings = await tx.meeting.findMany({
        where: { workspaceId: context.workspaceId, ownerMemberId: context.memberId, status: { in: ["SCHEDULED", "CONFIRMED"] }, endsAt: { gt: options.now() }, deletedAt: null },
        select: { id: true, revision: true },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 200,
      });
      for (const meeting of futureMeetings) {
        await enqueueGoogleCalendarSyncInTransaction(tx, {
          workspaceId: context.workspaceId,
          meetingId: meeting.id,
          ownerMemberId: context.memberId,
          meetingRevision: meeting.revision,
          actorId: context.actorId,
          now: options.now(),
        });
      }
    });
    return { connected: true as const, email: user.email };
  }

  async function disconnect(context: AuthenticatedContext) {
    await authorizeOwn(context);
    const account = await options.database.googleCalendarAccount.findUnique({
      where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } },
    });
    if (!account) return { disconnected: true as const };
    try {
      const configuration = loadGoogleCalendarConfiguration();
      const token = decryptGoogleCalendarSecret(account.accessTokenCiphertext, configuration.encryptionKey);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* A revogação remota é best effort; o bloqueio local é imediato. */ }
    await options.database.googleCalendarAccount.update({
      where: { id: account.id },
      data: { status: "DISCONNECTED", disconnectedAt: options.now(), updatedByActorId: context.actorId },
    });
    return { disconnected: true as const };
  }

  return Object.freeze({ screen, beginConnect, completeConnect, disconnect });
}

let service: ReturnType<typeof createGoogleCalendarService> | undefined;
export function getGoogleCalendarService() {
  service ??= createGoogleCalendarService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
