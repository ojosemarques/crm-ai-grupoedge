import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]).default("DRY_RUN"), runKey: z.string().trim().min(8).max(200) }).strict();
type Options = Readonly<{ database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date }>;

export function createCustomerSuccessBackfillService(options: Options) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, input.mode === "EXECUTE" ? PermissionKeys.CUSTOMER_SUCCESS_CORRECT : PermissionKeys.CUSTOMER_SUCCESS_READ, { workspaceId: context.workspaceId, resourceType: "CustomerSuccessBackfill", memberId: context.memberId });
    return options.database.$transaction(async (tx) => {
      const replay = await tx.customerSuccessBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
      if (replay) return { ...replay, replay: true, items: await tx.customerSuccessBackfillItem.findMany({ where: { workspaceId: context.workspaceId, runId: replay.id }, orderBy: { accountId: "asc" } }) };
      const candidates = await tx.onboardingCase.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["ACTIVATED", "COMPLETED"] } }, orderBy: [{ accountId: "asc" }, { updatedAt: "desc" }] });
      const latest = new Map(candidates.map((item) => [item.accountId, item]));
      const run = await tx.customerSuccessBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, actorId: context.actorId, eligibleCount: latest.size } });
      const items = [];
      for (const item of latest.values()) {
        const existing = await tx.customerPortfolioAssignment.findFirst({ where: { workspaceId: context.workspaceId, accountId: item.accountId, validTo: null } });
        let outcome: "CREATED" | "SKIPPED" | "REVIEW_REQUIRED" | "CONFLICT" = "SKIPPED";
        let reasonCode = "ALREADY_ASSIGNED";
        let assignmentId = existing?.id ?? null;
        const hasSingleTarget = Boolean(item.ownerMemberId) !== Boolean(item.queueId);
        if (!existing && !hasSingleTarget) { outcome = "REVIEW_REQUIRED"; reasonCode = "OWNER_OR_QUEUE_REQUIRED"; }
        else if (!existing && input.mode === "DRY_RUN") { outcome = "CREATED"; reasonCode = "WOULD_CREATE"; }
        else if (!existing) {
          const key = `crm52-backfill:${input.runKey}:${item.accountId}`;
          const assignment = await tx.customerPortfolioAssignment.create({ data: { workspaceId: context.workspaceId, accountId: item.accountId, ownerMemberId: item.ownerMemberId, teamId: item.teamId, queueId: item.queueId, state: "ACTIVE", reason: "Backfill conservador a partir de onboarding ativado ou concluído.", priority: 2, nextActionDescription: item.nextActionDescription, nextActionAt: item.nextActionAt, validFrom: options.now(), idempotencyKey: key, createdByActorId: context.actorId, updatedAt: options.now() } });
          assignmentId = assignment.id; outcome = "CREATED"; reasonCode = "CREATED_FROM_ONBOARDING";
          await tx.customerSuccessEvent.create({ data: { workspaceId: context.workspaceId, accountId: item.accountId, assignmentId: assignment.id, sequence: 1, type: "PORTFOLIO_ASSIGNED", newStatus: "ACTIVE", reason: "Backfill conservador a partir de onboarding.", safeMetadata: { onboardingCaseId: item.id }, actorId: context.actorId, idempotencyKey: `${key}:event`, occurredAt: options.now() } });
          await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_success.backfill.assignment_created", entityType: "CustomerPortfolioAssignment", entityId: assignment.id, reason: "Backfill explícito de onboarding.", changes: { onboardingCaseId: item.id, accountId: item.accountId } } });
        }
        const backfillItem = await tx.customerSuccessBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, accountId: item.accountId, outcome, reasonCode, assignmentId, safeEvidence: { onboardingCaseId: item.id, onboardingStatus: item.status } as Prisma.InputJsonValue } });
        items.push(backfillItem);
      }
      const counts = { createdCount: items.filter((item) => item.outcome === "CREATED").length, skippedCount: items.filter((item) => item.outcome === "SKIPPED").length, reviewCount: items.filter((item) => item.outcome === "REVIEW_REQUIRED").length, conflictCount: items.filter((item) => item.outcome === "CONFLICT").length };
      const completed = await tx.customerSuccessBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: options.now(), ...counts } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `customer_success.backfill.${input.mode.toLowerCase()}`, entityType: "CustomerSuccessBackfillRun", entityId: run.id, changes: { eligibleCount: latest.size, ...counts } } });
      return { ...completed, replay: false, items };
    }, { isolationLevel: "Serializable", timeout: 30_000 }).catch((error) => {
      if (error instanceof ApplicationError) throw error;
      throw error;
    });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createCustomerSuccessBackfillService> | undefined;
export function getCustomerSuccessBackfillService() {
  service ??= createCustomerSuccessBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
