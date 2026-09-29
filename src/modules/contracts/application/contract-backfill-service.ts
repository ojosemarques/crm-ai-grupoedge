import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { canonicalContractJson, sha256 } from "@/modules/contracts/domain/contract-contracts";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";

export const CONTRACT_BACKFILL_RULE_VERSION = "crm48-contract-candidates-v1";
const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,120}$/) }).strict();

export function createContractBackfillService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  const authorization = createAuthorizationService({ database: options.database });
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await authorization.assertAuthorized(context, PermissionKeys.CONTRACTS_AUDIT_RECONCILE, { workspaceId: context.workspaceId, resourceType: "ContractBackfillRun", memberId: context.memberId });
    const existing = await options.database.contractBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, accountId: true, lead: { select: { contactId: true } }, offers: { where: { deletedAt: null }, select: { id: true }, take: 1 } } });
    const existingContracts = new Set((await options.database.commercialContract.findMany({ where: { workspaceId: context.workspaceId }, select: { opportunityId: true } })).map((item) => item.opportunityId));
    const eligible = candidates.filter((item) => !existingContracts.has(item.id));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-backfill:${context.workspaceId}:${input.runKey}`}, 0))`;
      const duplicate = await tx.contractBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
      if (duplicate) return { ...duplicate, idempotent: true };
      const now = options.now();
      const run = await tx.contractBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, status: "RUNNING", candidateCount: eligible.length, requestedByActorId: context.actorId, startedAt: now } });
      if (input.mode === "EXECUTE") {
        for (const candidate of eligible) {
          const reasonCode = candidate.accountId && candidate.lead.contactId && candidate.offers.length ? "REVIEW_REQUIRED_NO_ACCEPTANCE_EVIDENCE" : "SKIPPED_MISSING_CANONICAL_FOUNDATION";
          await tx.contractBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, opportunityId: candidate.id, action: reasonCode.startsWith("REVIEW") ? "REVIEW_REQUIRED" : "SKIPPED", reasonCode, evidenceHash: sha256(canonicalContractJson({ opportunityId: candidate.id, hasAccount: Boolean(candidate.accountId), hasContact: Boolean(candidate.lead.contactId), hasOffer: candidate.offers.length > 0, ruleVersion: CONTRACT_BACKFILL_RULE_VERSION })) } });
        }
      }
      const reviewRequiredCount = eligible.filter((item) => item.accountId && item.lead.contactId && item.offers.length).length;
      const skippedCount = eligible.length - reviewRequiredCount;
      const completed = await tx.contractBackfillRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", reviewRequiredCount, skippedCount, finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "contract.backfill.completed", entityType: "ContractBackfillRun", entityId: run.id, changes: { mode: input.mode, candidates: eligible.length, reviewRequiredCount, skippedCount, contractsCreated: 0 }, metadata: { ruleVersion: CONTRACT_BACKFILL_RULE_VERSION, conservative: true } } });
      return { ...completed, idempotent: false };
    }, { isolationLevel: "Serializable" });
  }
  return Object.freeze({ run });
}
