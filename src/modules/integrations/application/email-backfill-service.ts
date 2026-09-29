import { createHash } from "node:crypto";
import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createStableMessageId } from "@/modules/integrations/domain/email-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<AuthorizationDecision>;
  assertAuthorized: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<void>;
}>;

export const EMAIL_BACKFILL_RULE_VERSION = "crm45-email-profile-backfill-v1";
const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,120}$/) }).strict();

function fingerprint(rows: readonly Readonly<{ id: string; bodyHash: string | null }>[]): string {
  return createHash("sha256").update(rows.map((row) => `${row.id}:${row.bodyHash ?? "absent"}`).join("|")).digest("hex");
}

function mask(address: string): string {
  return address.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2");
}

export function createEmailBackfillService(options: Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_EXECUTE, { workspaceId: context.workspaceId, resourceType: "EmailBackfillRun", ownerMemberId: context.memberId });
    const profile = await options.database.emailConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!profile) throw new Error("EMAIL_NOT_CONFIGURED");
    const existing = await options.database.integrationSyncRun.findUnique({ where: { workspaceId_connectionId_direction_objectType_correlationId: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: "email_message_profile_backfill", correlationId: input.runKey } } });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await options.database.message.findMany({ where: { workspaceId: context.workspaceId, conversation: { channel: "EMAIL" }, emailProfile: null }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true, bodyHash: true, conversation: { select: { contactPoint: { select: { normalizedValue: true } } } } } });
    const sourceFingerprint = fingerprint(candidates);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-backfill:${context.workspaceId}:${input.runKey}`}, 0))`;
      const duplicate = await tx.integrationSyncRun.findUnique({ where: { workspaceId_connectionId_direction_objectType_correlationId: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: "email_message_profile_backfill", correlationId: input.runKey } } });
      if (duplicate) return { ...duplicate, idempotent: true };
      const run = await tx.integrationSyncRun.create({ data: { workspaceId: context.workspaceId, connectionId: profile.connectionId, direction: "PULL", objectType: "email_message_profile_backfill", status: "RUNNING", readCount: candidates.length, attempts: 1, correlationId: input.runKey, executionMode: input.mode, requestedByActorId: context.actorId, startedAt: options.now() } });
      let updatedCount = 0;
      let ignoredCount = 0;
      if (input.mode === "EXECUTE") {
        for (const candidate of candidates) {
          const created = await tx.emailMessageProfile.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, messageId: candidate.id, messageIdHeader: createStableMessageId(context.workspaceId, candidate.id, profile.domain), textBodyHash: candidate.bodyHash ?? createHash("sha256").update("").digest("hex"), hasSanitizedHtml: false } });
          const address = candidate.conversation.contactPoint?.normalizedValue;
          if (address?.includes("@")) {
            await tx.emailRecipient.create({ data: { workspaceId: context.workspaceId, emailMessageId: created.id, type: "TO", normalizedAddress: address, maskedAddress: mask(address) } });
          } else {
            ignoredCount += 1;
            await tx.emailEventReview.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, emailMessageId: created.id, messageId: candidate.id, eventKey: `backfill:${candidate.id}`, reasonCode: "RECIPIENT_NOT_RECOVERABLE", evidence: { source: "canonical-message", inferred: false }, createdByActorId: context.actorId } });
          }
          updatedCount += 1;
        }
      } else ignoredCount = candidates.length;
      const completed = await tx.integrationSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", updatedCount, ignoredCount, watermark: options.now(), finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "integration.email.backfill_completed", entityType: "IntegrationSyncRun", entityId: run.id, changes: { mode: input.mode, ruleVersion: EMAIL_BACKFILL_RULE_VERSION, sourceFingerprint, candidates: candidates.length, updatedCount, ignoredCount, externalEgress: false } } });
      return { ...completed, idempotent: false, sourceFingerprint };
    }, { isolationLevel: "Serializable" });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createEmailBackfillService> | undefined;
export function getEmailBackfillService() {
  service ??= createEmailBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
