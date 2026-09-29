import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { forecastBackfillSchema } from "@/modules/forecast/domain/forecast-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

export function createForecastBackfillService(options: { database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date }) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = forecastBackfillSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.FORECAST_BACKFILL, { workspaceId: context.workspaceId, resourceType: "ForecastBackfill" });
    const existing = await options.database.forecastBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } }, include: { items: true } });
    if (existing) return { ...existing, replay: true };
    return options.database.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`crm56:${context.workspaceId}:forecast-backfill`}))::text`);
      const replay = await tx.forecastBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } }, include: { items: true } });
      if (replay) return { ...replay, replay: true };
      const run = await tx.forecastBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, actorId: context.actorId } });
      const signals = await tx.auditLog.findMany({ where: { workspaceId: context.workspaceId, action: { contains: "forecast", mode: "insensitive" }, entityType: { notIn: ["ForecastCycle", "ForecastSubmission", "ForecastSnapshot", "ForecastBackfillRun"] } }, select: { id: true, action: true, entityType: true, entityId: true }, orderBy: { occurredAt: "asc" } });
      const items = [];
      if (input.mode === "EXECUTE") for (const signal of signals) items.push(await tx.forecastBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, sourceType: signal.entityType, sourceKey: signal.id, outcome: "REVIEW_REQUIRED", reasonCode: "LEGACY_SIGNAL_WITHOUT_REPRODUCIBLE_CUT", safeEvidence: { action: signal.action, entityId: signal.entityId, note: "Nenhuma categoria, probabilidade, valor ou corte histórico foi inferido." } } }));
      const completed = await tx.forecastBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", candidateCount: signals.length, reviewCount: input.mode === "EXECUTE" ? signals.length : 0, skippedCount: input.mode === "DRY_RUN" ? signals.length : 0, completedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "forecast.backfill.completed", origin: "SYSTEM", entityType: "ForecastBackfillRun", entityId: run.id, changes: { mode: input.mode, candidateCount: signals.length, reviewCount: completed.reviewCount, plansCreated: 0, submissionsCreated: 0, snapshotsCreated: 0 }, metadata: { runKey: input.runKey } } });
      return { ...completed, items, replay: false };
    });
  }
  return Object.freeze({ run });
}

let singleton: ReturnType<typeof createForecastBackfillService> | undefined;
export function getForecastBackfillService() { singleton ??= createForecastBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return singleton; }
