import { createHash } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const CALENDAR_BACKFILL_RULE_VERSION = "crm47-calendar-links-v1";
const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,120}$/) }).strict();

function fingerprint(rows: readonly Readonly<{ id: string; revision: number; updatedAt: Date }>[]) {
  return createHash("sha256").update(rows.map((row) => `${row.id}:${row.revision}:${row.updatedAt.toISOString()}`).join("|")).digest("hex");
}
export function createCalendarBackfillService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  const authorization = createAuthorizationService({ database: options.database });
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await authorization.assertAuthorized(context, PermissionKeys.CALENDAR_CONFIGURE, { workspaceId: context.workspaceId, resourceType: "CalendarBackfillRun", memberId: context.memberId });
    const profile = await options.database.calendarConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "asc" } });
    if (!profile) throw new ApplicationError("Calendário local não configurado.", { code: "CALENDAR_FOUNDATION_MISSING", statusCode: 404, expose: true });
    const existing = await options.database.calendarBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await options.database.meeting.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, calendarLinks: { none: {} } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, revision: true, updatedAt: true } });
    const sourceFingerprint = fingerprint(candidates);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`calendar-backfill:${context.workspaceId}:${input.runKey}`}, 0))`;
      const duplicate = await tx.calendarBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
      if (duplicate) return { ...duplicate, idempotent: true };
      const run = await tx.calendarBackfillRun.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, runKey: input.runKey, mode: input.mode, status: "RUNNING", totalEligible: candidates.length, fingerprint: sourceFingerprint, requestedByActorId: context.actorId, startedAt: options.now() } });
      let reviewCount = 0;
      let existingCount = 0;
      if (input.mode === "EXECUTE") {
        for (const candidate of candidates) {
          const prior = await tx.calendarBackfillItem.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: `calendar-backfill:${candidate.id}` } } });
          if (prior) { existingCount += 1; continue; }
          await tx.calendarBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, meetingId: candidate.id, outcome: "REVIEW_REQUIRED", reasonCode: "NOT_LINKED_NO_EXTERNAL_EVIDENCE", idempotencyKey: `calendar-backfill:${candidate.id}` } });
          reviewCount += 1;
        }
      } else reviewCount = candidates.length;
      const completed = await tx.calendarBackfillRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", reviewCount, existingCount, linkedCount: 0, finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "calendar.backfill.completed", entityType: "CalendarBackfillRun", entityId: run.id, changes: { mode: input.mode, ruleVersion: CALENDAR_BACKFILL_RULE_VERSION, sourceFingerprint, candidates: candidates.length, linkedCount: 0, reviewCount, existingCount, externalIdsInvented: false, externalEgress: false } } });
      return { ...completed, idempotent: false, sourceFingerprint };
    }, { isolationLevel: "Serializable" });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createCalendarBackfillService> | undefined;
export function getCalendarBackfillService() {
  service ??= createCalendarBackfillService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
