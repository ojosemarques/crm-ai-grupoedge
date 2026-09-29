import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

export function createRevenueBackfillService(database: PrismaClient = getDatabaseClient()) {
  const authorization = getAuthorizationService();
  return {
    async run(context: AuthenticatedContext, input: { mode: "DRY_RUN" | "EXECUTE"; idempotencyKey: string }) {
      await authorization.assertAuthorized(context, PermissionKeys.REVENUE_MANAGE, { workspaceId: context.workspaceId, resourceType: "RevenueBackfill", memberId: context.memberId });
      const replay = await database.revenueBackfillRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) return { ...replay, items: await database.revenueBackfillItem.findMany({ where: { workspaceId: context.workspaceId, runId: replay.id } }), replayed: true };
      return database.$transaction(async (tx) => {
        const contracts = await tx.commercialContract.findMany({ where: { workspaceId: context.workspaceId, status: "ACCEPTED" }, select: { id: true } });
        const run = await tx.revenueBackfillRun.create({ data: { workspaceId: context.workspaceId, mode: input.mode, status: "RUNNING", idempotencyKey: input.idempotencyKey, actorId: context.actorId } });
        for (const contract of contracts) {
          const existing = await tx.subscription.findFirst({ where: { workspaceId: context.workspaceId, contractId: contract.id } });
          await tx.revenueBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, contractId: contract.id, status: existing ? "SKIPPED" : "REVIEW_REQUIRED", reason: existing ? "Assinatura já existe." : "Contrato aceito exige confirmação humana de quantidade, recorrência, competência e ativação; nenhum fato foi inventado.", subscriptionId: existing?.id ?? null } });
        }
        const summary = { contracts: contracts.length, created: 0, reviewRequired: contracts.length };
        const completed = await tx.revenueBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), summary } });
        return { ...completed, items: await tx.revenueBackfillItem.findMany({ where: { runId: run.id } }), replayed: false };
      });
    },
  };
}
export const getRevenueBackfillService = () => createRevenueBackfillService();
