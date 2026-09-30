import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { pageTrackingBatchSchema, verifyPageTrackingSignature } from "../domain/page-tracking";

function fail(message: string, code: string, statusCode: number): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }

export function createPageTrackingService(options: { database: PrismaClient; secrets: SecretResolver; now: () => Date }) {
  async function receive(input: { workspaceSlug: string; connectionKey: string; rawBody: string; timestamp: string; signature: string }) {
    const connection = await options.database.integrationConnection.findFirst({
      where: { key: input.connectionKey, providerKey: "LANDING_PAGE", enabled: true, status: { in: ["ACTIVE_LOCAL", "CONNECTED"] }, workspace: { slug: input.workspaceSlug, status: "ACTIVE", deletedAt: null } },
      include: { secrets: { where: { alias: "webhook-hmac", present: true, disabledAt: null }, orderBy: { version: "desc" }, take: 1 } },
    });
    const reference = connection?.secrets[0];
    if (!connection || !reference) fail("Conexão de página indisponível.", "PAGE_TRACKING_NOT_FOUND", 404);
    const secret = await options.secrets.resolve(reference.referenceKey);
    const now = options.now();
    if (!secret || !verifyPageTrackingSignature(secret, input.rawBody, input.timestamp, input.signature, now)) fail("Assinatura inválida ou expirada.", "PAGE_TRACKING_SIGNATURE_INVALID", 401);
    let payload: unknown;
    try { payload = JSON.parse(input.rawBody); } catch { fail("JSON inválido.", "PAGE_TRACKING_PAYLOAD_INVALID", 400); }
    const batch = pageTrackingBatchSchema.parse(payload);
    if (batch.events.some((event) => Math.abs(now.getTime() - new Date(event.occurredAt).getTime()) > 300_000)) fail("Evento fora da janela de coleta.", "PAGE_TRACKING_EVENT_EXPIRED", 422);
    const landing = await options.database.landingPage.findFirst({ where: { workspaceId: connection.workspaceId, key: connection.key, status: "ACTIVE", deletedAt: null } });
    if (!landing || new URL(landing.canonicalUrl).origin !== batch.origin) fail("Origem não corresponde à página configurada.", "PAGE_TRACKING_ORIGIN_INVALID", 403);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`page-tracking:${connection.workspaceId}:${batch.sessionPublicId}`}, 0))`;
      const session = await tx.marketingSession.upsert({
        where: { workspaceId_publicId: { workspaceId: connection.workspaceId, publicId: batch.sessionPublicId } },
        create: { workspaceId: connection.workspaceId, publicId: batch.sessionPublicId, startedAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 30 * 60_000) },
        update: { lastSeenAt: now },
      });
      let accepted = 0;
      for (const event of batch.events) {
        const idempotencyKey = `page:${connection.id}:${event.eventId}`;
        const existing = await tx.marketingTouchpoint.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: connection.workspaceId, idempotencyKey } }, select: { id: true } });
        if (existing) continue;
        await tx.marketingTouchpoint.create({ data: {
          workspaceId: connection.workspaceId, sessionId: session.id, landingPageId: landing.id,
          kind: event.kind === "PAGE_VIEW" ? "PAGE_VIEW" : "OTHER", evidenceClass: "DIRECT", occurredAt: new Date(event.occurredAt),
          landingPath: new URL(landing.canonicalUrl).pathname, utmCampaign: event.utmCampaign ?? null, utmContent: event.utmContent ?? null,
          privacyDecision: "ALLOW", attributionEligible: true, idempotencyKey, correlationId: event.eventId, createdByActorId: connection.createdByActorId,
          evidence: { schemaVersion: "page-tracking-v1", eventType: event.kind, target: event.target ?? null, durationMs: event.durationMs ?? 0, consent: true, provider: "SIGNED_SITE_RELAY", payloadHash: createHash("sha256").update(JSON.stringify(event)).digest("hex") },
        } });
        accepted += 1;
      }
      return { accepted, duplicates: batch.events.length - accepted };
    });
  }
  return { receive };
}

let singleton: ReturnType<typeof createPageTrackingService> | undefined;
export function getPageTrackingService() { return singleton ??= createPageTrackingService({ database: getDatabaseClient(), secrets: environmentSecretResolver, now: () => new Date() }); }

export async function loadPageAnalytics(database: PrismaClient, workspaceId: string, start: Date, end: Date) {
  const [events, pages] = await Promise.all([
    database.marketingTouchpoint.findMany({ where: { workspaceId, occurredAt: { gte: start, lt: end }, privacyDecision: "ALLOW", evidence: { path: ["schemaVersion"], equals: "page-tracking-v1" } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 50_001, select: { landingPageId: true, sessionId: true, utmCampaign: true, utmContent: true, evidence: true } }),
    database.landingPage.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const names = new Map(pages.map((page) => [page.id, page.name]));
  const groups = new Map<string, { key: string; page: string; utmCampaign: string | null; utmContent: string | null; views: number; sessions: Set<string>; activeMs: number; clicks: Map<string, number> }>();
  for (const event of events.slice(0, 50_000)) {
    const key = JSON.stringify([event.landingPageId, event.utmCampaign, event.utmContent]);
    const row = groups.get(key) ?? { key, page: names.get(event.landingPageId ?? "") ?? "Página não identificada", utmCampaign: event.utmCampaign, utmContent: event.utmContent, views: 0, sessions: new Set<string>(), activeMs: 0, clicks: new Map<string, number>() };
    const evidence = event.evidence as { eventType?: string; target?: string; durationMs?: number } | null;
    if (event.sessionId) row.sessions.add(event.sessionId);
    if (evidence?.eventType === "PAGE_VIEW") row.views += 1;
    if (evidence?.eventType === "ENGAGEMENT" && typeof evidence.durationMs === "number") row.activeMs += evidence.durationMs;
    if (evidence?.eventType === "CLICK" && evidence.target) row.clicks.set(evidence.target, (row.clicks.get(evidence.target) ?? 0) + 1);
    groups.set(key, row);
  }
  return { truncated: events.length > 50_000, rows: [...groups.values()].map(({ sessions, clicks, activeMs, ...row }) => ({ ...row, sessions: sessions.size, activeSeconds: Math.round(activeMs / 1000), averageActiveSeconds: sessions.size ? Math.round(activeMs / sessions.size / 1000) : null, clicks: [...clicks].map(([target, count]) => ({ target, count })) })).sort((a, b) => b.views - a.views) };
}
