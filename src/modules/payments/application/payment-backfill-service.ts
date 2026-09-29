import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { paymentBackfillSchema } from "@/modules/payments/domain/payment-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

export function createPaymentBackfillService(database: PrismaClient = getDatabaseClient()) {
  const authorization = getAuthorizationService();
  return Object.freeze({
    async run(context: AuthenticatedContext, raw: unknown) {
      const input = paymentBackfillSchema.parse(raw);
      await authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_RECONCILE, { workspaceId: context.workspaceId, resourceType: "PaymentBackfill", memberId: context.memberId });
      const replay = await database.paymentBackfillRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) return { ...replay, items: await database.paymentBackfillItem.findMany({ where: { workspaceId: context.workspaceId, runId: replay.id } }), replayed: true };
      return database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-backfill:${context.workspaceId}`}, 0))`;
        const subscriptions = await tx.subscription.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["ACTIVE", "CANCELLATION_SCHEDULED"] } }, select: { id: true } });
        const run = await tx.paymentBackfillRun.create({ data: { workspaceId: context.workspaceId, mode: input.mode, status: "RUNNING", idempotencyKey: input.idempotencyKey, actorId: context.actorId } });
        let reviewRequired = 0;
        for (const subscription of subscriptions) {
          const existing = await tx.invoice.findFirst({ where: { workspaceId: context.workspaceId, subscriptionId: subscription.id } });
          if (!existing) reviewRequired += 1;
          await tx.paymentBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, subscriptionId: subscription.id, status: existing ? "SKIPPED" : "REVIEW_REQUIRED", reason: existing ? "A assinatura já possui cobrança registrada." : "Competência, vencimento e emissão exigem confirmação humana; nenhuma cobrança ou pagamento foi inventado." } });
        }
        const summary = { subscriptions: subscriptions.length, invoicesCreated: 0, paymentsCreated: 0, reviewRequired };
        const completed = await tx.paymentBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), summary } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "payment.backfill.completed", entityType: "PaymentBackfillRun", entityId: run.id, origin: "SYSTEM", changes: { mode: input.mode, ...summary, externalEgress: false } } });
        return { ...completed, items: await tx.paymentBackfillItem.findMany({ where: { workspaceId: context.workspaceId, runId: run.id } }), replayed: false };
      });
    },
  });
}

export const getPaymentBackfillService = () => createPaymentBackfillService();
