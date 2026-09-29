import { createHash } from "node:crypto";
import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { WHATSAPP_CUSTOMER_SERVICE_WINDOW_SECONDS } from "@/modules/integrations/domain/whatsapp-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<AuthorizationDecision>;
  assertAuthorized: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<void>;
}>;

export const WHATSAPP_WINDOW_BACKFILL_RULE_VERSION = "crm44-whatsapp-window-backfill-v1";
const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,120}$/) }).strict();

function fingerprint(rows: readonly Readonly<{ id: string; occurredAt: Date }>[] | readonly Readonly<{ id: string; occurredAt: Date }>[]): string {
  return createHash("sha256").update(rows.map((row) => `${row.id}:${row.occurredAt.toISOString()}`).join("|")).digest("hex");
}

export function createWhatsAppBackfillService(options: Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EXECUTE, { workspaceId: context.workspaceId, resourceType: "WhatsAppBackfillRun", ownerMemberId: context.memberId });
    const profile = await options.database.whatsAppConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "asc" } });
    if (!profile) throw new Error("WHATSAPP_NOT_CONFIGURED");
    const existing = await options.database.integrationSyncRun.findUnique({ where: { workspaceId_connectionId_direction_objectType_correlationId: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: "whatsapp_service_window_backfill", correlationId: input.runKey } } });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await options.database.conversation.findMany({
      where: { workspaceId: context.workspaceId, channel: "WHATSAPP", deletedAt: null, lastCustomerInboundAt: null, messages: { some: { direction: "INBOUND" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, messages: { where: { direction: "INBOUND" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1, select: { occurredAt: true } } },
    });
    const facts = candidates.flatMap((candidate) => candidate.messages[0] ? [{ id: candidate.id, occurredAt: candidate.messages[0].occurredAt }] : []);
    const sourceFingerprint = fingerprint(facts);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-window-backfill:${context.workspaceId}:${input.runKey}`}, 0))`;
      const duplicate = await tx.integrationSyncRun.findUnique({ where: { workspaceId_connectionId_direction_objectType_correlationId: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: "whatsapp_service_window_backfill", correlationId: input.runKey } } });
      if (duplicate) return { ...duplicate, idempotent: true };
      const run = await tx.integrationSyncRun.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: "whatsapp_service_window_backfill", status: "RUNNING", readCount: facts.length, attempts: 1, correlationId: input.runKey, executionMode: input.mode, requestedByActorId: context.actorId, startedAt: options.now() } });
      let updatedCount = 0;
      if (input.mode === "EXECUTE") {
        for (const fact of facts) {
          const updated = await tx.conversation.updateMany({ where: { id: fact.id, workspaceId: context.workspaceId, lastCustomerInboundAt: null }, data: { lastCustomerInboundAt: fact.occurredAt, serviceWindowExpiresAt: new Date(fact.occurredAt.getTime() + WHATSAPP_CUSTOMER_SERVICE_WINDOW_SECONDS * 1_000), updatedByActorId: context.actorId, revision: { increment: 1 } } });
          updatedCount += updated.count;
        }
      }
      const completed = await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", updatedCount, ignoredCount: input.mode === "DRY_RUN" ? facts.length : facts.length - updatedCount, watermark: options.now(), finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.whatsapp.window_backfill_completed", entityType: "IntegrationSyncRun", entityId: run.id, changes: { mode: input.mode, ruleVersion: WHATSAPP_WINDOW_BACKFILL_RULE_VERSION, sourceFingerprint, candidates: facts.length, updatedCount, externalEgress: false } } });
      return { ...completed, idempotent: false, sourceFingerprint };
    }, { isolationLevel: "Serializable" });
  }

  return Object.freeze({ run });
}

let service: ReturnType<typeof createWhatsAppBackfillService> | undefined;
export function getWhatsAppBackfillService() {
  service ??= createWhatsAppBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
