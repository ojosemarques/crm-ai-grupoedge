import type { PrismaClient } from "@/generated/prisma/client";
import {
  decryptGoogleCalendarSecretWithFallback,
  encryptGoogleCalendarSecret,
  googleCalendarCiphertextUsesKey,
} from "@/modules/integrations/application/google-calendar-crypto";
import { loadGoogleCalendarConfiguration } from "@/modules/integrations/domain/google-calendar-contracts";

type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

type CipherFields = Readonly<{
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  pullSyncTokenCiphertext: string | null;
  pullPageTokenCiphertext: string | null;
}>;

function values(fields: CipherFields) {
  return [fields.accessTokenCiphertext, fields.refreshTokenCiphertext, fields.pullSyncTokenCiphertext, fields.pullPageTokenCiphertext]
    .filter((value): value is string => Boolean(value));
}

export function rotateGoogleCalendarCipherFields(fields: CipherFields, currentKey: string, nextKey: string) {
  if (values(fields).every((value) => googleCalendarCiphertextUsesKey(value, nextKey))) return null;
  const rotate = (value: string | null) => value
    ? encryptGoogleCalendarSecret(decryptGoogleCalendarSecretWithFallback(value, [nextKey, currentKey]), nextKey)
    : null;
  return {
    accessTokenCiphertext: rotate(fields.accessTokenCiphertext)!,
    refreshTokenCiphertext: rotate(fields.refreshTokenCiphertext)!,
    pullSyncTokenCiphertext: rotate(fields.pullSyncTokenCiphertext),
    pullPageTokenCiphertext: rotate(fields.pullPageTokenCiphertext),
  };
}

export function createGoogleCalendarKeyRotationWorker(options: Options) {
  return Object.freeze({
    async processNext() {
      const configuration = loadGoogleCalendarConfiguration();
      const nextKey = configuration.nextEncryptionKey;
      if (!nextKey || nextKey === configuration.encryptionKey) return { status: "IDLE" as const };

      const accounts = await options.database.googleCalendarAccount.findMany({
        select: {
          id: true,
          workspaceId: true,
          updatedAt: true,
          updatedByActorId: true,
          accessTokenCiphertext: true,
          refreshTokenCiphertext: true,
          pullSyncTokenCiphertext: true,
          pullPageTokenCiphertext: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      });
      for (const account of accounts) {
        const rotated = rotateGoogleCalendarCipherFields(account, configuration.encryptionKey, nextKey);
        if (!rotated) continue;
        const changed = await options.database.$transaction(async (tx) => {
          const update = await tx.googleCalendarAccount.updateMany({
            where: { id: account.id, workspaceId: account.workspaceId, updatedAt: account.updatedAt },
            data: rotated,
          });
          if (update.count === 1) await tx.auditLog.create({ data: {
            workspaceId: account.workspaceId,
            actorId: account.updatedByActorId,
            action: "google_calendar.token_key_rotated",
            entityType: "GoogleCalendarAccount",
            entityId: account.id,
            origin: "SYSTEM",
            changes: { algorithm: "AES-256-GCM", version: "v1", rotatedAt: options.now().toISOString() },
          } });
          return update.count;
        });
        return { status: changed === 1 ? "REKEYED" as const : "RETRY_PENDING" as const };
      }

      const oauthState = await options.database.googleCalendarOAuthState.findFirst({
        where: { consumedAt: null, expiresAt: { gt: options.now() } },
        select: { id: true, codeVerifierCiphertext: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!oauthState || googleCalendarCiphertextUsesKey(oauthState.codeVerifierCiphertext, nextKey)) return { status: "IDLE" as const };
      const codeVerifierCiphertext = encryptGoogleCalendarSecret(
        decryptGoogleCalendarSecretWithFallback(oauthState.codeVerifierCiphertext, [nextKey, configuration.encryptionKey]),
        nextKey,
      );
      const changed = await options.database.googleCalendarOAuthState.updateMany({
        where: {
          id: oauthState.id,
          codeVerifierCiphertext: oauthState.codeVerifierCiphertext,
          consumedAt: null,
          expiresAt: { gt: options.now() },
        },
        data: { codeVerifierCiphertext },
      });
      return { status: changed.count === 1 ? "REKEYED" as const : "RETRY_PENDING" as const };
    },
  });
}
