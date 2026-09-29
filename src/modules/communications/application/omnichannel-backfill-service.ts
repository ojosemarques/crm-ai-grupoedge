import { createHash } from "node:crypto";
import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { OMNICHANNEL_BACKFILL_RULE_VERSION } from "@/modules/communications/domain/omnichannel-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<AuthorizationDecision>;
  assertAuthorized: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<void>;
}>;

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,120}$/) }).strict();

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createOmnichannelBackfillService(options: Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.CONVERSATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "OmnichannelBackfillRun", ownerMemberId: context.memberId });
    const existing = await options.database.omnichannelBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } }, include: { items: true } });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await options.database.conversation.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, messages: { some: {} } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { contactPoint: true, messages: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }], include: { statusEvents: true } }, participants: true } });
    const fingerprint = hash(candidates.map((row) => `${row.id}:${row.messages.length}:${row.participants.length}`).join("|"));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`omnichannel-backfill:${context.workspaceId}:${input.runKey}`}, 0))`;
      const duplicate = await tx.omnichannelBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } }, include: { items: true } });
      if (duplicate) return { ...duplicate, idempotent: true };
      const run = await tx.omnichannelBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, status: "RUNNING", totalEligible: candidates.length, fingerprint, requestedByActorId: context.actorId, startedAt: options.now() } });
      let migratedCount = 0;
      let existingCount = 0;
      let reviewCount = 0;
      let skippedCount = 0;
      for (const candidate of candidates) {
        let outcome: "MIGRATED" | "ALREADY_MIGRATED" | "REVIEW_REQUIRED" | "SKIPPED" = "ALREADY_MIGRATED";
        let reasonCode = "CANONICAL_FACTS_PRESENT";
        const missingStatus = candidate.messages.filter((message) => message.statusEvents.length === 0);
        const missingParticipant = candidate.participants.length === 0;
        if (input.mode === "DRY_RUN" && (missingStatus.length > 0 || missingParticipant)) {
          outcome = "SKIPPED";
          reasonCode = "DRY_RUN_CANDIDATE";
          skippedCount += 1;
        } else if (input.mode === "EXECUTE" && (missingStatus.length > 0 || missingParticipant)) {
          if (missingParticipant) {
            await tx.conversationParticipant.create({ data: { workspaceId: context.workspaceId, conversationId: candidate.id, role: candidate.contactId ? "CONTACT" : "UNKNOWN_EXTERNAL", contactId: candidate.contactId, contactPointId: candidate.contactPointId, identifierKey: hash(`backfill:${candidate.id}:${candidate.contactPointId ?? "unknown"}`), externalAddressMasked: candidate.contactPoint ? `${candidate.contactPoint.normalizedValue.slice(0, 4)}••••${candidate.contactPoint.normalizedValue.slice(-4)}` : null, activeFrom: candidate.openedAt } });
          }
          for (const message of missingStatus) {
            await tx.messageStatusEvent.create({ data: { workspaceId: context.workspaceId, messageId: message.id, status: message.status, sequence: 1, source: "BACKFILL", providerReported: false, reasonCode: "LEGACY_STATUS_PROJECTION", actorId: context.actorId, ingestedAt: options.now() } });
            if (!message.bodyHash && message.body) await tx.message.update({ where: { id: message.id }, data: { bodyHash: hash(message.body), revision: { increment: 1 } } });
          }
          outcome = candidate.contactId || candidate.leadId ? "MIGRATED" : "REVIEW_REQUIRED";
          reasonCode = outcome === "MIGRATED" ? "LEGACY_FACTS_CANONICALIZED" : "LEGACY_IDENTITY_UNRESOLVED";
          if (outcome === "MIGRATED") migratedCount += 1;
          else reviewCount += 1;
        } else {
          existingCount += 1;
        }
        await tx.omnichannelBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, conversationId: candidate.id, messageId: candidate.messages[0]?.id ?? null, outcome, reasonCode, idempotencyKey: `${input.runKey}:${candidate.id}` } });
      }
      const finished = await tx.omnichannelBackfillRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", migratedCount, existingCount, reviewCount, skippedCount, finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "communication.backfill.completed", entityType: "OmnichannelBackfillRun", entityId: run.id, changes: { mode: input.mode, ruleVersion: OMNICHANNEL_BACKFILL_RULE_VERSION, totalEligible: candidates.length, migratedCount, existingCount, reviewCount, skippedCount } } });
      return { ...finished, idempotent: false };
    }, { isolationLevel: "Serializable" });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createOmnichannelBackfillService> | undefined;
export function getOmnichannelBackfillService() {
  service ??= createOmnichannelBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
