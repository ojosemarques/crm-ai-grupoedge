import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { EphemeralSecretResolver } from "@/modules/integrations/application/secret-resolver";
import { createPageTrackingService } from "./page-tracking-service";

const now = new Date("2026-09-30T12:00:00Z");
const batch = { consent: true, sessionPublicId: "5807e645-0ae9-4f91-aa26-4be30bba1300", origin: "https://example.com", events: [{ eventId: "4807e645-0ae9-4f91-aa26-4be30bba1300", kind: "PAGE_VIEW", occurredAt: now.toISOString(), utmContent: "creative-1" }] };
function setup({ enabled = true, duplicate = false } = {}) {
  const tx = { $executeRaw: vi.fn(), marketingSession: { upsert: vi.fn().mockResolvedValue({ id: "session" }) }, marketingTouchpoint: { findUnique: vi.fn().mockResolvedValue(duplicate ? { id: "event" } : null), create: vi.fn() } };
  const database = {
    integrationConnection: { findFirst: vi.fn().mockResolvedValue(enabled ? { id: "connection", workspaceId: "workspace", key: "landing", createdByActorId: "actor", secrets: [{ referenceKey: "ACQUISITION_SITE" }] } : null) },
    landingPage: { findFirst: vi.fn().mockResolvedValue({ id: "page", canonicalUrl: "https://example.com/oferta" }) },
    $transaction: vi.fn().mockImplementation((run) => run(tx)),
  };
  const service = createPageTrackingService({ database: database as unknown as PrismaClient, now: () => now, secrets: new EphemeralSecretResolver({ ACQUISITION_SITE: "secret" }) });
  return { tx, database, service };
}
function request(payload: unknown = batch) {
  const rawBody = JSON.stringify(payload); const timestamp = now.toISOString();
  return { workspaceSlug: "acme", connectionKey: "landing", rawBody, timestamp, signature: createHmac("sha256", "secret").update(`${timestamp}.${rawBody}`).digest("hex") };
}
describe("endpoint de tracking via relay", () => {
  it("rejeita conexão indisponível e assinatura incorreta antes de persistir", async () => {
    const disabled = setup({ enabled: false });
    await expect(disabled.service.receive(request())).rejects.toMatchObject({ code: "PAGE_TRACKING_NOT_FOUND" });
    expect(disabled.database.$transaction).not.toHaveBeenCalled();
    const { service, database } = setup();
    await expect(service.receive({ ...request(), signature: "0".repeat(64) })).rejects.toMatchObject({ code: "PAGE_TRACKING_SIGNATURE_INVALID" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it("rejeita origem divergente e falta de consentimento", async () => {
    const { service, database } = setup();
    await expect(service.receive(request({ ...batch, origin: "https://evil.example" }))).rejects.toMatchObject({ code: "PAGE_TRACKING_ORIGIN_INVALID" });
    await expect(service.receive(request({ ...batch, consent: false }))).rejects.toThrow();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it("persiste evento limitado ao tenant autenticado e preserva UTMs", async () => {
    const { service, database, tx } = setup();
    expect(await service.receive(request())).toEqual({ accepted: 1, duplicates: 0 });
    expect(database.integrationConnection.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerKey: "LANDING_PAGE", enabled: true, workspace: expect.objectContaining({ slug: "acme", status: "ACTIVE" }) }) }));
    expect(tx.marketingTouchpoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workspaceId: "workspace", landingPageId: "page", sessionId: "session", landingPath: "/oferta", utmContent: "creative-1", privacyDecision: "ALLOW" }) });
  });
  it("deduplica evento reenviado", async () => {
    const { service, tx } = setup({ duplicate: true });
    expect(await service.receive(request())).toEqual({ accepted: 0, duplicates: 1 });
    expect(tx.marketingTouchpoint.create).not.toHaveBeenCalled();
  });
});
