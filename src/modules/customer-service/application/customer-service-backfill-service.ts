import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "EXECUTE"]).default("DRY_RUN"), runKey: z.string().trim().min(8).max(200) }).strict();
type Options = Readonly<{ database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date }>;

export function createCustomerServiceBackfillService(options: Options) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_CONFIG_MANAGE, { workspaceId: context.workspaceId, resourceType: "CustomerServiceBackfill", memberId: context.memberId });
    return options.database.$transaction(async (tx) => {
      const replay = await tx.customerServiceBackfillRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
      if (replay) return { ...replay, replay: true, items: await tx.customerServiceBackfillItem.findMany({ where: { workspaceId: context.workspaceId, runId: replay.id }, orderBy: { accountId: "asc" } }) };
      const conversations = await tx.conversation.findMany({ where: { workspaceId: context.workspaceId, accountId: { not: null }, deletedAt: null }, select: { accountId: true, id: true, channel: true, subject: true }, orderBy: [{ accountId: "asc" }, { createdAt: "asc" }] });
      const byAccount = new Map<string, typeof conversations[number]>(); for (const item of conversations) if (item.accountId && !byAccount.has(item.accountId)) byAccount.set(item.accountId, item);
      const existing = new Set((await tx.customerRequest.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: [...byAccount.keys()] } }, select: { accountId: true } })).map((item) => item.accountId));
      const candidates = [...byAccount.entries()].filter(([accountId]) => !existing.has(accountId));
      const run = await tx.customerServiceBackfillRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, mode: input.mode, actorId: context.actorId, eligibleCount: candidates.length } });
      const items = [];
      for (const [accountId, conversation] of candidates) items.push(await tx.customerServiceBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, accountId, outcome: "REVIEW_REQUIRED", reasonCode: "CONVERSATION_IS_NOT_REQUEST_EVIDENCE", safeEvidence: { conversationId: conversation.id, channel: conversation.channel, subjectPresent: Boolean(conversation.subject), mode: input.mode } as Prisma.InputJsonValue } }));
      const completed = await tx.customerServiceBackfillRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: options.now(), skippedCount: 0, reviewCount: items.length } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `customer_service.backfill.${input.mode.toLowerCase()}`, entityType: "CustomerServiceBackfillRun", entityId: run.id, changes: { eligibleCount: candidates.length, reviewCount: items.length, createdRequests: 0 } } });
      return { ...completed, replay: false, items };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  }
  return Object.freeze({ run });
}

let service: ReturnType<typeof createCustomerServiceBackfillService> | undefined;
export function getCustomerServiceBackfillService() { service ??= createCustomerServiceBackfillService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return service; }
