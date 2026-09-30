import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createAcquisitionWebhookService } from "@/modules/acquisition-api/application/acquisition-webhook-service";
import { ApplicationError } from "@/shared/core/errors/application-error";

function service(secret: string | null) {
  const database = { integrationConnection: { findFirst: vi.fn().mockResolvedValue({ secrets: [{ referenceKey: "META_ADS_WEBHOOK_SECRET" }] }) } } as unknown as PrismaClient;
  return createAcquisitionWebhookService({ database, secrets: { resolve: vi.fn().mockResolvedValue(secret) }, now: () => new Date("2026-09-30T12:00:00Z"), intake: { intake: vi.fn() } as never, fetcher: vi.fn() as never });
}

describe("challenge Meta Lead Ads", () => {
  it("devolve o challenge sem expor o segredo quando token confere", async () => {
    await expect(service("verify-secret").verifyMetaChallenge({ workspaceSlug: "acme", connectionKey: "meta-leads", mode: "subscribe", token: "verify-secret", challenge: "123456" })).resolves.toBe("123456");
  });

  it("rejeita token inválido", async () => {
    await expect(service("verify-secret").verifyMetaChallenge({ workspaceSlug: "acme", connectionKey: "meta-leads", mode: "subscribe", token: "wrong", challenge: "123456" })).rejects.toMatchObject({ code: "META_CHALLENGE_INVALID" } satisfies Partial<ApplicationError>);
  });
});
