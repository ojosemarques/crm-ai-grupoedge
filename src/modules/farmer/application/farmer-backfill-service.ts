import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { farmerBackfillSchema } from "@/modules/farmer/domain/farmer-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type Authorization = ReturnType<typeof getAuthorizationService>;

export function createFarmerBackfillService(options: {
  database: PrismaClient;
  authorization: Authorization;
  now: () => Date;
}) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = farmerBackfillSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.FARMER_CONFIG_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "FarmerBackfill",
    });
    const prior = await options.database.farmerBackfillRun.findUnique({
      where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } },
    });
    if (prior) return { ...prior, replay: true };

    return options.database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.workspaceId}:farmer-backfill`}))::text`,
      );
      const replay = await transaction.farmerBackfillRun.findUnique({
        where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } },
      });
      if (replay) return { ...replay, replay: true };

      const run = await transaction.farmerBackfillRun.create({
        data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, actorId: context.actorId },
      });
      const subscriptions = await transaction.subscription.findMany({
        where: { workspaceId: context.workspaceId, status: { in: ["ACTIVE", "CANCELLATION_SCHEDULED"] } },
        orderBy: { id: "asc" },
      });
      let eligible = 0; let created = 0; let skipped = 0; let review = 0;

      for (const subscription of subscriptions) {
        const existing = await transaction.renewal.findFirst({
          where: {
            workspaceId: context.workspaceId,
            subscriptionId: subscription.id,
            ...(subscription.endsAt ? { targetDate: subscription.endsAt } : {}),
          },
        });
        if (existing) {
          skipped += 1;
          await transaction.farmerBackfillItem.create({ data: {
            workspaceId: context.workspaceId, runId: run.id, accountId: subscription.accountId,
            subscriptionId: subscription.id, outcome: "SKIPPED", reasonCode: "RENEWAL_ALREADY_EXISTS",
            renewalId: existing.id, safeEvidence: { subscriptionNumber: subscription.subscriptionNumber },
          } });
          continue;
        }
        if (!subscription.endsAt) {
          review += 1;
          await transaction.farmerBackfillItem.create({ data: {
            workspaceId: context.workspaceId, runId: run.id, accountId: subscription.accountId,
            subscriptionId: subscription.id, outcome: "REVIEW_REQUIRED", reasonCode: "NO_CONTRACT_END_DATE",
            safeEvidence: { subscriptionNumber: subscription.subscriptionNumber, note: "Ausência de data não foi inferida como churn." },
          } });
          continue;
        }

        eligible += 1;
        if (input.mode === "DRY_RUN") {
          await transaction.farmerBackfillItem.create({ data: {
            workspaceId: context.workspaceId, runId: run.id, accountId: subscription.accountId,
            subscriptionId: subscription.id, outcome: "CANDIDATE", reasonCode: "ACTIVE_SUBSCRIPTION_WITH_END_DATE",
            safeEvidence: { targetDate: subscription.endsAt.toISOString(), note: "Somente candidato; nenhuma decisão financeira." },
          } });
          continue;
        }

        const portfolio = await transaction.customerPortfolioAssignment.findFirst({
          where: { workspaceId: context.workspaceId, accountId: subscription.accountId, validTo: null, ownerMemberId: { not: null } },
        });
        if (!portfolio) {
          review += 1;
          await transaction.farmerBackfillItem.create({ data: {
            workspaceId: context.workspaceId, runId: run.id, accountId: subscription.accountId,
            subscriptionId: subscription.id, outcome: "REVIEW_REQUIRED", reasonCode: "HUMAN_OWNER_REQUIRED",
            safeEvidence: { targetDate: subscription.endsAt.toISOString() },
          } });
          continue;
        }

        const now = options.now();
        const renewal = await transaction.renewal.create({ data: {
          workspaceId: context.workspaceId, accountId: subscription.accountId, subscriptionId: subscription.id,
          contractId: subscription.contractId, portfolioAssignmentId: portfolio.id, ownerMemberId: portfolio.ownerMemberId!,
          teamId: portfolio.teamId, targetDate: subscription.endsAt, baseMrrCents: subscription.currentMrrCents,
          baseTcvCents: subscription.currentMrrCents * 12n, currency: "BRL",
          nextActionDescription: "Revisar renovação com evidências", nextActionAt: now,
          snapshot: { source: "CRM54_BACKFILL", subscriptionNumber: subscription.subscriptionNumber, note: "Candidato criado sem decisão, risco ou churn inferido." },
          idempotencyKey: `crm54:backfill:renewal:${subscription.id}:${subscription.endsAt.toISOString()}`,
          createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: now,
        } });
        await transaction.renewalEvent.create({ data: {
          workspaceId: context.workspaceId, renewalId: renewal.id, accountId: subscription.accountId,
          sequence: 1, type: "CREATED", newStatus: "IN_REVIEW",
          reason: "Candidato criado por backfill conservador para revisão humana.", actorId: context.actorId,
          idempotencyKey: `${renewal.id}:created`, occurredAt: now,
        } });
        created += 1;
        await transaction.farmerBackfillItem.create({ data: {
          workspaceId: context.workspaceId, runId: run.id, accountId: subscription.accountId,
          subscriptionId: subscription.id, outcome: "CREATED", reasonCode: "REVIEW_CANDIDATE_CREATED",
          renewalId: renewal.id, safeEvidence: { targetDate: subscription.endsAt.toISOString(), status: "IN_REVIEW" },
        } });
      }

      const completed = await transaction.farmerBackfillRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED", eligibleCount: eligible, createdCount: created, skippedCount: skipped, reviewCount: review, completedAt: options.now() },
      });
      await transaction.auditLog.create({ data: {
        workspaceId: context.workspaceId, actorId: context.actorId, action: "farmer.backfill.completed",
        entityType: "FarmerBackfillRun", entityId: run.id, changes: { mode: input.mode, eligible, created, skipped, review },
      } });
      return { ...completed, replay: false };
    }, { isolationLevel: "ReadCommitted" });
  }

  return { run };
}

export const getFarmerBackfillService = () => createFarmerBackfillService({
  database: getDatabaseClient(),
  authorization: getAuthorizationService(),
  now: () => new Date(),
});
