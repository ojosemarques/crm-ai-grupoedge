import { z } from "zod";

import type { Prisma, PrismaClient, RevenueLifecycleStage } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { chooseConservativeLifecycle, LIFECYCLE_RULE_KEY, LIFECYCLE_RULE_VERSION } from "@/modules/lifecycle/domain/lifecycle-policy";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision>;
  assertAuthorized(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<void>;
}>;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;
type Tx = Prisma.TransactionClient;

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), batchSize: z.number().int().min(1).max(500).default(100) }).strict();

async function createLifecycle(
  tx: Tx,
  input: Readonly<{ workspaceId: string; contactId?: string; accountId?: string; stage: RevenueLifecycleStage; actorId: string; at: Date; idempotencyKey: string; reason: string }>,
) {
  const where = input.contactId ? { contactId: input.contactId } : { accountId: input.accountId! };
  const current = await tx.revenueLifecycle.findFirst({ where: { workspaceId: input.workspaceId, ...where }, select: { id: true } });
  if (current) return false;
  const history = await tx.lifecycleHistory.create({ data: { workspaceId: input.workspaceId, entityType: input.contactId ? "CONTACT" : "ACCOUNT", contactId: input.contactId ?? null, accountId: input.accountId ?? null, fromStage: null, toStage: input.stage, enteredAt: input.at, reason: input.reason, source: "BACKFILL", ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION, evidence: { conservative: true, noFutureLifecycleInference: true }, idempotencyKey: input.idempotencyKey, createdByActorId: input.actorId } });
  await tx.revenueLifecycle.create({ data: { workspaceId: input.workspaceId, entityType: input.contactId ? "CONTACT" : "ACCOUNT", contactId: input.contactId ?? null, accountId: input.accountId ?? null, stage: input.stage, currentSince: input.at, source: "BACKFILL", ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION, evidenceQuality: input.stage === "UNKNOWN" ? "UNKNOWN" : "INFERRED", lastHistoryId: history.id, createdByActorId: input.actorId, updatedByActorId: input.actorId } });
  return true;
}

async function createAssignment(
  tx: Tx,
  input: Readonly<{ workspaceId: string; entityType: "CONTACT" | "ACCOUNT" | "LEAD" | "OPPORTUNITY"; entityId: string; function: "SDR" | "CLOSER"; memberId: string | null; queueId: string | null; actorId: string; at: Date; idempotencyKey: string; reason: string }>,
) {
  const where = input.entityType === "CONTACT" ? { contactId: input.entityId } : input.entityType === "ACCOUNT" ? { accountId: input.entityId } : input.entityType === "LEAD" ? { leadId: input.entityId } : { opportunityId: input.entityId };
  const current = await tx.ownershipAssignment.findFirst({ where: { workspaceId: input.workspaceId, ...where, function: input.function, status: "ACTIVE" }, select: { id: true } });
  if (current || (!input.memberId && !input.queueId)) return false;
  await tx.ownershipAssignment.create({ data: { workspaceId: input.workspaceId, entityType: input.entityType, contactId: input.entityType === "CONTACT" ? input.entityId : null, accountId: input.entityType === "ACCOUNT" ? input.entityId : null, leadId: input.entityType === "LEAD" ? input.entityId : null, opportunityId: input.entityType === "OPPORTUNITY" ? input.entityId : null, function: input.function, memberId: input.memberId, queueId: input.queueId, validFrom: input.at, reason: input.reason, source: "BACKFILL", idempotencyKey: input.idempotencyKey, assignedByActorId: input.actorId } });
  return true;
}

export function createLifecycleBackfillService(options: Options) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_ADMIN, { workspaceId: context.workspaceId, resourceType: "LifecycleBackfill" });
    const startedAt = options.now();
    const [leads, accounts] = await Promise.all([
      options.database.lead.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, contactId: { not: null } }, orderBy: [{ contactId: "asc" }, { createdAt: "desc" }, { id: "asc" }], select: { id: true, contactId: true, accountId: true, ownerMemberId: true, queueId: true, status: true, createdAt: true, qualification: { select: { status: true } }, opportunities: { where: { deletedAt: null }, select: { id: true, status: true, ownerMemberId: true, accountId: true, createdAt: true }, orderBy: { createdAt: "desc" } } } }),
      options.database.account.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: { id: "asc" }, select: { id: true, createdAt: true, opportunities: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, ownerMemberId: true, createdAt: true } }, leads: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, ownerMemberId: true, queueId: true, qualification: { select: { status: true } } } } } }),
    ]);
    const latestLeadByContact = new Map<string, (typeof leads)[number]>();
    for (const lead of leads) if (lead.contactId && !latestLeadByContact.has(lead.contactId)) latestLeadByContact.set(lead.contactId, lead);
    const totalEligible = latestLeadByContact.size + accounts.length;
    const run = await options.database.lifecycleBackfillRun.create({ data: { workspaceId: context.workspaceId, mode: input.mode, status: "RUNNING", ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION, batchSize: input.batchSize, totalEligible, requestedByActorId: context.actorId, updatedByActorId: context.actorId, startedAt } });
    if (input.mode === "DRY_RUN") {
      const existingCount = await options.database.revenueLifecycle.count({ where: { workspaceId: context.workspaceId } });
      return options.database.lifecycleBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", processedCount: totalEligible, createdCount: Math.max(0, totalEligible - existingCount), existingCount: Math.min(totalEligible, existingCount), finishedAt: options.now(), updatedByActorId: context.actorId } });
    }
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lifecycle-backfill:${context.workspaceId}`}, 0))`;
      let createdCount = 0;
      let existingCount = 0;
      for (const [contactId, lead] of latestLeadByContact) {
        const openOpportunity = lead.opportunities.find((item) => item.status === "OPEN");
        const stage = chooseConservativeLifecycle({ hasLead: true, hasQualifiedHistory: lead.status === "QUALIFIED" || lead.qualification?.status === "COMPLETED", hasOpenOpportunity: Boolean(openOpportunity) });
        const lifecycleCreated = await createLifecycle(tx, { workspaceId: context.workspaceId, contactId, stage, actorId: context.actorId, at: lead.createdAt, idempotencyKey: `backfill:lifecycle:contact:${contactId}`, reason: "Migração conservadora baseada em lead, qualificação e oportunidade persistidos." });
        if (lifecycleCreated) createdCount += 1;
        else existingCount += 1;
        await createAssignment(tx, { workspaceId: context.workspaceId, entityType: "LEAD", entityId: lead.id, function: "SDR", memberId: lead.ownerMemberId, queueId: lead.queueId, actorId: context.actorId, at: lead.createdAt, idempotencyKey: `backfill:ownership:lead:${lead.id}:SDR`, reason: "Responsabilidade operacional vigente do lead." });
        await createAssignment(tx, { workspaceId: context.workspaceId, entityType: "CONTACT", entityId: contactId, function: "SDR", memberId: lead.ownerMemberId, queueId: lead.queueId, actorId: context.actorId, at: lead.createdAt, idempotencyKey: `backfill:ownership:contact:${contactId}:SDR`, reason: "Responsabilidade SDR inferida do lead mais recente." });
        if (openOpportunity) {
          await createAssignment(tx, { workspaceId: context.workspaceId, entityType: "OPPORTUNITY", entityId: openOpportunity.id, function: "CLOSER", memberId: openOpportunity.ownerMemberId, queueId: null, actorId: context.actorId, at: openOpportunity.createdAt, idempotencyKey: `backfill:ownership:opportunity:${openOpportunity.id}:CLOSER`, reason: "Closer vigente da oportunidade aberta." });
          await createAssignment(tx, { workspaceId: context.workspaceId, entityType: "CONTACT", entityId: contactId, function: "CLOSER", memberId: openOpportunity.ownerMemberId, queueId: null, actorId: context.actorId, at: openOpportunity.createdAt, idempotencyKey: `backfill:ownership:contact:${contactId}:CLOSER`, reason: "Responsabilidade closer inferida de oportunidade aberta." });
        }
        await tx.lifecycleBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, contactId, leadId: lead.id, opportunityId: openOpportunity?.id ?? null, outcome: lifecycleCreated ? "CREATED" : "ALREADY_EXISTS", lifecycleStage: stage, idempotencyKey: `${run.id}:contact:${contactId}`, reason: "Contato avaliado pela regra conservadora v1." } });
      }
      for (const account of accounts) {
        const openOpportunity = account.opportunities.find((item) => item.status === "OPEN");
        const latestLead = account.leads[0];
        const stage = chooseConservativeLifecycle({ hasLead: Boolean(latestLead), hasQualifiedHistory: latestLead?.qualification?.status === "COMPLETED", hasOpenOpportunity: Boolean(openOpportunity) });
        const lifecycleCreated = await createLifecycle(tx, { workspaceId: context.workspaceId, accountId: account.id, stage, actorId: context.actorId, at: openOpportunity?.createdAt ?? account.createdAt, idempotencyKey: `backfill:lifecycle:account:${account.id}`, reason: "Migração conservadora da conta baseada em evidências comerciais persistidas." });
        if (lifecycleCreated) createdCount += 1;
        else existingCount += 1;
        if (openOpportunity) await createAssignment(tx, { workspaceId: context.workspaceId, entityType: "ACCOUNT", entityId: account.id, function: "CLOSER", memberId: openOpportunity.ownerMemberId, queueId: null, actorId: context.actorId, at: openOpportunity.createdAt, idempotencyKey: `backfill:ownership:account:${account.id}:CLOSER`, reason: "Responsabilidade closer inferida de oportunidade aberta da conta." });
        if (!openOpportunity && latestLead && (stage === "LEAD" || stage === "QUALIFIED")) await createAssignment(tx, { workspaceId: context.workspaceId, entityType: "ACCOUNT", entityId: account.id, function: "SDR", memberId: latestLead.ownerMemberId, queueId: latestLead.queueId, actorId: context.actorId, at: account.createdAt, idempotencyKey: `backfill:ownership:account:${account.id}:SDR`, reason: "Responsabilidade SDR inferida do lead mais recente da conta." });
        await tx.lifecycleBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, accountId: account.id, opportunityId: openOpportunity?.id ?? null, outcome: lifecycleCreated ? "CREATED" : "ALREADY_EXISTS", lifecycleStage: stage, idempotencyKey: `${run.id}:account:${account.id}`, reason: "Conta avaliada pela regra conservadora v1." } });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "lifecycle.backfill.completed", entityType: "LifecycleBackfillRun", entityId: run.id, changes: { totalEligible, createdCount, existingCount, ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION } } });
      return tx.lifecycleBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", processedCount: totalEligible, createdCount, existingCount, finishedAt: options.now(), updatedByActorId: context.actorId } });
    }, { isolationLevel: "Serializable", timeout: 120_000 });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createLifecycleBackfillService> | undefined;
export function getLifecycleBackfillService() {
  service ??= createLifecycleBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
