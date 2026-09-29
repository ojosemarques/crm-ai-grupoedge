import { createHash } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<AuthorizationDecision>;
  assertAuthorized: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<void>;
}>;

export const TELEPHONY_BACKFILL_RULE_VERSION = "crm46-telephony-facts-v1";
const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,120}$/) }).strict();

function fingerprint(rows: readonly Readonly<{ id: string; conversationId: string }>[]) {
  return createHash("sha256").update(rows.map((row) => `${row.id}:${row.conversationId}`).join("|")).digest("hex");
}

export function createTelephonyBackfillService(options: Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.TELEPHONY_CONFIGURE, { workspaceId: context.workspaceId, resourceType: "TelephonyBackfillRun", ownerMemberId: context.memberId });
    const profile = await options.database.telephonyConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!profile) throw new Error("TELEPHONY_NOT_CONFIGURED");
    const existing = await options.database.telephonyBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await options.database.message.findMany({ where: { workspaceId: context.workspaceId, type: "CALL_EVENT", conversation: { channel: "PHONE" }, phoneCall: null }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true, conversationId: true } });
    const sourceFingerprint = fingerprint(candidates);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telephony-backfill:${context.workspaceId}:${input.runKey}`}, 0))`;
      const duplicate = await tx.telephonyBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
      if (duplicate) return { ...duplicate, idempotent: true };
      const run = await tx.telephonyBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, status: "RUNNING", totalEligible: candidates.length, fingerprint: sourceFingerprint, requestedByActorId: context.actorId, startedAt: options.now() } });
      let reviewCount = 0;
      let existingCount = 0;
      if (input.mode === "EXECUTE") {
        for (const candidate of candidates) {
          const priorItem = await tx.telephonyBackfillItem.findUnique({
            where: {
              workspaceId_idempotencyKey: {
                workspaceId: context.workspaceId,
                idempotencyKey: `telephony-backfill:${candidate.id}`,
              },
            },
            select: { id: true },
          });
          if (priorItem) {
            existingCount += 1;
            continue;
          }
          await tx.telephonyBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, conversationId: candidate.conversationId, messageId: candidate.id, outcome: "REVIEW_REQUIRED", reasonCode: "LEGACY_CALL_FACTS_INSUFFICIENT", idempotencyKey: `telephony-backfill:${candidate.id}` } });
          await tx.telephonyEventReview.upsert({ where: { workspaceId_profileId_eventKey_reasonCode: { workspaceId: context.workspaceId, profileId: profile.id, eventKey: `backfill:${candidate.id}`, reasonCode: "LEGACY_CALL_FACTS_INSUFFICIENT" } }, create: { workspaceId: context.workspaceId, profileId: profile.id, eventKey: `backfill:${candidate.id}`, reasonCode: "LEGACY_CALL_FACTS_INSUFFICIENT", evidence: { messageId: candidate.id, inferred: false }, createdByActorId: context.actorId }, update: {} });
          reviewCount += 1;
        }
      } else reviewCount = candidates.length;
      const completed = await tx.telephonyBackfillRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", reviewCount, existingCount, finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "telephony.backfill.completed", entityType: "TelephonyBackfillRun", entityId: run.id, changes: { mode: input.mode, ruleVersion: TELEPHONY_BACKFILL_RULE_VERSION, sourceFingerprint, candidates: candidates.length, migratedCount: 0, reviewCount, existingCount, externalEgress: false } } });
      return { ...completed, idempotent: false, sourceFingerprint };
    }, { isolationLevel: "Serializable" });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createTelephonyBackfillService> | undefined;
export function getTelephonyBackfillService() {
  service ??= createTelephonyBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
