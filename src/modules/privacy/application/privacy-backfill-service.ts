import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { ensurePrivacyFoundation, legacySignal, recordLegacySignalInTransaction } from "@/modules/privacy/application/privacy-foundation";
import { PRIVACY_RULE_VERSION } from "@/modules/privacy/domain/privacy-policy";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision>;
  assertAuthorized(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<void>;
}>;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;
const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]), batchSize: z.number().int().min(1).max(500).default(100) }).strict();

export function createPrivacyBackfillService(options: Options) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.PRIVACY_BACKFILL, { workspaceId: context.workspaceId, resourceType: "PrivacyBackfill" });
    const leads = await options.database.lead.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null, contactId: { not: null } },
      orderBy: [{ id: "asc" }],
      select: { id: true, contactId: true, normalizedPhone: true, contactPreference: true, contactPreferenceUpdatedAt: true, createdAt: true },
    });
    const run = await options.database.privacyBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: `privacy:${input.mode.toLowerCase()}:${options.now().toISOString()}`, ruleVersion: PRIVACY_RULE_VERSION, mode: input.mode, status: "RUNNING", batchSize: input.batchSize, eligibleCount: leads.length, requestedByActorId: context.actorId, startedAt: options.now() } });
    if (input.mode === "DRY_RUN") {
      const priorItems = await options.database.privacyBackfillItem.findMany({
        where: {
          workspaceId: context.workspaceId,
          outcome: { in: ["CREATED", "DIVERGENT", "SKIPPED", "ALREADY_EXISTS"] },
        },
        select: { leadId: true, legacySignal: true },
        distinct: ["leadId", "legacySignal"],
      });
      const reconciled = new Set(priorItems.map((item) => `${item.leadId}:${item.legacySignal}`));
      const existingCount = leads.filter((lead) => reconciled.has(`${lead.id}:${lead.contactPreference}`)).length;
      const signalsByContact = new Map<string, Set<string>>();
      for (const lead of leads) {
        if (lead.contactPreference === "UNKNOWN") continue;
        const signals = signalsByContact.get(lead.contactId!) ?? new Set<string>();
        signals.add(lead.contactPreference);
        signalsByContact.set(lead.contactId!, signals);
      }
      const divergentCount = leads.filter((lead) => (signalsByContact.get(lead.contactId!)?.size ?? 0) > 1).length;
      return options.database.privacyBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", processedCount: leads.length, createdCount: leads.length - existingCount, existingCount, divergentCount, finishedAt: options.now() } });
    }
    try {
      return await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-backfill:${context.workspaceId}`}, 0))`;
      const foundation = await ensurePrivacyFoundation(tx, context.workspaceId, context.actorId);
      let createdCount = 0;
      let existingCount = 0;
      let divergentCount = 0;
      let skippedCount = 0;
      for (const lead of leads) {
        const contactId = lead.contactId!;
        const idempotencyKey = `privacy-backfill:v1:lead:${lead.id}:${lead.contactPreference}`;
        const mapped = legacySignal(lead.contactPreference);
        const priorEvent = await tx.consentEvent.findUnique({
          where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey } },
          select: { id: true },
        });
        const priorItem = await tx.privacyBackfillItem.findFirst({
          where: {
            workspaceId: context.workspaceId,
            leadId: lead.id,
            legacySignal: lead.contactPreference,
            outcome: { in: ["CREATED", "DIVERGENT", "SKIPPED", "ALREADY_EXISTS"] },
          },
          orderBy: { createdAt: "asc" },
          select: { consentEventId: true, projectedState: true },
        });
        const prior = priorEvent ?? priorItem;
        if (prior) {
          existingCount += 1;
          await tx.privacyBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, contactId, consentEventId: "consentEventId" in prior ? prior.consentEventId : prior.id, outcome: "ALREADY_EXISTS", legacySignal: lead.contactPreference, projectedState: priorItem?.projectedState ?? mapped.state, reasonCode: "REPLAY_ALREADY_RECONCILED", idempotencyKey: `${run.id}:${lead.id}` } });
          continue;
        }
        const point = await tx.contactPoint.findFirst({ where: { workspaceId: context.workspaceId, contactId, type: "PHONE", ...(lead.normalizedPhone ? { normalizedValue: lead.normalizedPhone } : {}), deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, doNotContact: true } });
        const result = await recordLegacySignalInTransaction(tx, { workspaceId: context.workspaceId, actorId: context.actorId, contactId, contactPointId: point?.id ?? null, preference: point?.doNotContact ? "DO_NOT_CONTACT" : lead.contactPreference, occurredAt: lead.contactPreferenceUpdatedAt ?? lead.createdAt, source: "LEGACY_BACKFILL", idempotencyKey, correlationId: run.id, foundation });
        const siblingSignals = await tx.lead.findMany({ where: { workspaceId: context.workspaceId, contactId, id: { not: lead.id }, deletedAt: null }, select: { contactPreference: true } });
        const divergent = siblingSignals.some((item) => item.contactPreference !== lead.contactPreference && item.contactPreference !== "UNKNOWN" && lead.contactPreference !== "UNKNOWN");
        if (divergent) divergentCount += 1;
        if (!result.event) skippedCount += 1;
        else createdCount += 1;
        await tx.privacyBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, contactId, consentEventId: result.event?.id ?? null, outcome: divergent ? "DIVERGENT" : result.event ? "CREATED" : "SKIPPED", legacySignal: lead.contactPreference, projectedState: result.state.state, reasonCode: divergent ? "CONTACT_HAS_DIVERGENT_LEGACY_SIGNALS" : mapped.reasonCode, idempotencyKey: `${run.id}:${lead.id}` } });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.backfill.completed", entityType: "PrivacyBackfillRun", entityId: run.id, changes: { eligibleCount: leads.length, createdCount, existingCount, divergentCount, skippedCount, ruleVersion: PRIVACY_RULE_VERSION } } });
      return tx.privacyBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", processedCount: leads.length, createdCount, existingCount, divergentCount, skippedCount, cursorLeadId: leads.at(-1)?.id ?? null, finishedAt: options.now() } });
      }, { isolationLevel: "Serializable", timeout: 120_000 });
    } catch (error) {
      await options.database.privacyBackfillRun.update({
        where: { id: run.id },
        data: { status: "FAILED", failedCount: leads.length, lastError: error instanceof Error ? error.message.slice(0, 2_000) : "Falha desconhecida", finishedAt: options.now() },
      });
      throw error;
    }
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createPrivacyBackfillService> | undefined;
export function getPrivacyBackfillService() {
  service ??= createPrivacyBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
