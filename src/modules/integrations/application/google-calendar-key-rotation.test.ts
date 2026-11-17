import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptGoogleCalendarSecret, encryptGoogleCalendarSecret } from "@/modules/integrations/application/google-calendar-crypto";
import { createGoogleCalendarKeyRotationWorker, rotateGoogleCalendarCipherFields } from "@/modules/integrations/application/google-calendar-key-rotation";

describe("rotação da chave Google Calendar", () => {
  const currentKey = "current-production-grade-key-with-at-least-32-characters";
  const nextKey = "next-production-grade-key-with-at-least-32-characters";

  afterEach(() => vi.unstubAllEnvs());

  it("recriptografa tokens e cursores sem alterar o conteúdo", () => {
    const rotated = rotateGoogleCalendarCipherFields({
      accessTokenCiphertext: encryptGoogleCalendarSecret("access", currentKey),
      refreshTokenCiphertext: encryptGoogleCalendarSecret("refresh", currentKey),
      pullSyncTokenCiphertext: encryptGoogleCalendarSecret("sync", currentKey),
      pullPageTokenCiphertext: null,
    }, currentKey, nextKey);
    expect(rotated).not.toBeNull();
    expect(decryptGoogleCalendarSecret(rotated!.accessTokenCiphertext, nextKey)).toBe("access");
    expect(decryptGoogleCalendarSecret(rotated!.refreshTokenCiphertext, nextKey)).toBe("refresh");
    expect(decryptGoogleCalendarSecret(rotated!.pullSyncTokenCiphertext!, nextKey)).toBe("sync");
    expect(rotated!.pullPageTokenCiphertext).toBeNull();
  });

  it("é idempotente quando todos os valores já usam a nova chave", () => {
    expect(rotateGoogleCalendarCipherFields({
      accessTokenCiphertext: encryptGoogleCalendarSecret("access", nextKey),
      refreshTokenCiphertext: encryptGoogleCalendarSecret("refresh", nextKey),
      pullSyncTokenCiphertext: null,
      pullPageTokenCiphertext: null,
    }, currentKey, nextKey)).toBeNull();
  });

  it("converge depois de uma rotação parcial", () => {
    const rotated = rotateGoogleCalendarCipherFields({
      accessTokenCiphertext: encryptGoogleCalendarSecret("access", nextKey),
      refreshTokenCiphertext: encryptGoogleCalendarSecret("refresh", currentKey),
      pullSyncTokenCiphertext: null,
      pullPageTokenCiphertext: null,
    }, currentKey, nextKey);
    expect(decryptGoogleCalendarSecret(rotated!.accessTokenCiphertext, nextKey)).toBe("access");
    expect(decryptGoogleCalendarSecret(rotated!.refreshTokenCiphertext, nextKey)).toBe("refresh");
  });

  it("persiste uma conta por passo com guarda de concorrência e auditoria sem tokens", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "calendar-client-id-with-enough-characters");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "calendar-client-secret-with-enough-characters");
    vi.stubEnv("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY", currentKey);
    vi.stubEnv("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY_NEXT", nextKey);
    vi.stubEnv("APP_CANONICAL_URL", "https://crm.example");
    const account = {
      id: "account-id",
      workspaceId: "workspace-id",
      updatedAt: new Date("2026-11-17T12:00:00.000Z"),
      updatedByActorId: "actor-id",
      accessTokenCiphertext: encryptGoogleCalendarSecret("access", currentKey),
      refreshTokenCiphertext: encryptGoogleCalendarSecret("refresh", currentKey),
      pullSyncTokenCiphertext: null,
      pullPageTokenCiphertext: null,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createAudit = vi.fn().mockResolvedValue({ id: "audit-id" });
    const database = {
      googleCalendarAccount: { findMany: vi.fn().mockResolvedValue([account]) },
      googleCalendarOAuthState: { findFirst: vi.fn() },
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
        googleCalendarAccount: { updateMany },
        auditLog: { create: createAudit },
      })),
    };
    const result = await createGoogleCalendarKeyRotationWorker({
      database: database as never,
      now: () => new Date("2026-11-17T12:01:00.000Z"),
    }).processNext();
    expect(result).toEqual({ status: "REKEYED" });
    const data = updateMany.mock.calls[0]![0].data;
    expect(decryptGoogleCalendarSecret(data.accessTokenCiphertext, nextKey)).toBe("access");
    expect(decryptGoogleCalendarSecret(data.refreshTokenCiphertext, nextKey)).toBe("refresh");
    expect(updateMany.mock.calls[0]![0].where).toEqual({
      id: account.id,
      workspaceId: account.workspaceId,
      updatedAt: account.updatedAt,
    });
    expect(JSON.stringify(createAudit.mock.calls[0]![0])).not.toContain("access");
    expect(JSON.stringify(createAudit.mock.calls[0]![0])).not.toContain("refresh");
  });
});
