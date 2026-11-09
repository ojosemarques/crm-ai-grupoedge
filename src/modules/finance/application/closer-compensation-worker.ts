import type { PrismaClient } from "@/generated/prisma/client";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { reconcileCloserCompensation } from "./closer-compensation-reconciliation";

import { reconcileSdrAdvertisingInTransaction } from "./sdr-advertising-reconciliation";

const action = "commercial.compensation.daily_reconciled";

export function createCloserCompensationWorker({ database, now }: { database: PrismaClient; now: () => Date }) {
  return {
    async processNext() {
      const evaluatedAt = now();
      const policies = await database.commercialCompensationPolicy.findMany({
        where: { workspace: { status: "ACTIVE", deletedAt: null } },
        distinct: ["workspaceId"],
        orderBy: [{ workspaceId: "asc" }, { effectiveDate: "asc" }],
        select: { workspaceId: true, effectiveDate: true, workspace: { select: { timeZone: true } } },
      });
      for (const { workspaceId, effectiveDate, workspace } of policies) {
        const localDate = workspaceDateAt(evaluatedAt, workspace.timeZone);
        if (new Date(localDate) < effectiveDate) continue;
        const { start, end } = workspaceDayRange(localDate, workspace.timeZone);
        const where = { workspaceId, action, occurredAt: { gte: start, lt: end } };
        if (await database.auditLog.findFirst({ where, select: { id: true } })) continue;
        const actor = await database.actor.findFirst({
          where: { workspaceId, type: "SYSTEM" }, orderBy: { createdAt: "asc" }, select: { id: true },
        });
        if (!actor) continue;
        const processed = await database.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-compensation:${workspaceId}`}, 0))`;
          if (await tx.auditLog.findFirst({ where, select: { id: true } })) return false;
          const covered = await reconcileCloserCompensation(tx, workspaceId, evaluatedAt);
          await reconcileSdrAdvertisingInTransaction(tx, workspaceId, workspace.timeZone, evaluatedAt);
          await tx.auditLog.create({ data: {
            workspaceId, actorId: actor.id, action, entityId: workspaceId, entityType: "Workspace",
            origin: "SYSTEM", occurredAt: evaluatedAt, changes: { localDate, coveredSales: covered.size },
          } });
          return true;
        }, { timeout: 35_000 });
        if (processed) return { status: "SUCCEEDED" };
      }
      return { status: "IDLE" };
    },
  };
}
