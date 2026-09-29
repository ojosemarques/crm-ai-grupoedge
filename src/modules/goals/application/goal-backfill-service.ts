import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { z } from "zod";

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().min(8).max(200) }).strict();

export function createGoalBackfillService(options: { database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date }) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.GOALS_BACKFILL, { workspaceId: context.workspaceId, resourceType: "GoalBackfill" });
    const existing = await options.database.goalBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
    if (existing) return { ...existing, replay: true };
    return options.database.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`crm55:${context.workspaceId}:goal-backfill`}))::text`);
      const replay = await tx.goalBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
      if (replay) return { ...replay, replay: true };
      const run = await tx.goalBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, actorId: context.actorId } });
      const legacySignals = await tx.auditLog.findMany({ where: { workspaceId: context.workspaceId, OR: [{ action: { contains: "goal", mode: "insensitive" } }, { action: { contains: "quota", mode: "insensitive" } }] }, orderBy: { occurredAt: "asc" }, select: { id: true, action: true, entityType: true, entityId: true } });
      for (const signal of legacySignals) await tx.goalBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, sourceType: signal.entityType, sourceKey: signal.id, outcome: "REVIEW_REQUIRED", reasonCode: "LEGACY_SIGNAL_WITHOUT_VERSIONED_PERIOD", safeEvidence: { action: signal.action, entityId: signal.entityId, note: "Nenhuma data, alvo ou valor foi inferido." } } });
      const completed = await tx.goalBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", candidateCount: legacySignals.length, reviewCount: legacySignals.length, skippedCount: 0, completedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "goals.backfill.completed", entityType: "GoalBackfillRun", entityId: run.id, changes: { mode: input.mode, candidates: legacySignals.length, createdPlans: 0 }, metadata: { runKey: input.runKey, policy: "review-only; no official quota inferred" } } });
      return { ...completed, replay: false };
    }, { isolationLevel: "Serializable" });
  }
  return Object.freeze({ run });
}

export const getGoalBackfillService = () => createGoalBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
