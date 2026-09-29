import { createHash } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService, type createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { assertSafeOperationalRuntime } from "@/modules/operations/domain/runtime-guards";

const inputSchema = z.object({
  mode: z.enum(["DRY_RUN", "EXECUTE"]),
  batchSize: z.number().int().min(1).max(500).default(100),
}).strict();

type Options = Readonly<{
  database: PrismaClient;
  authorization?: ReturnType<typeof createAuthorizationService>;
  now: () => Date;
}>;

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function createOperationsBackfillService(options: Options) {
  const authorization = options.authorization ?? getAuthorizationService();

  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "OperationsBackfill",
    });
    assertSafeOperationalRuntime();

    const candidates = await options.database.dataSubjectRequest.findMany({
      where: { workspaceId: context.workspaceId, events: { none: { kind: "CREATED" } } },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      take: input.batchSize,
      select: { id: true, status: true, verificationStatus: true, requestedAt: true },
    });
    if (input.mode === "DRY_RUN") {
      return { mode: input.mode, candidateCount: candidates.length, createdCount: 0, bounded: candidates.length === input.batchSize, destructive: false } as const;
    }

    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm62-backfill:${context.workspaceId}`}, 0))`;
      let createdCount = 0;
      for (const candidate of candidates) {
        const id = stableUuid(`crm62:dsr-created-event:${context.workspaceId}:${candidate.id}`);
        const exists = await tx.dataSubjectRequestEvent.findUnique({ where: { id }, select: { id: true } });
        if (exists) continue;
        const alreadyCreated = await tx.dataSubjectRequestEvent.findFirst({ where: { workspaceId: context.workspaceId, requestId: candidate.id, kind: "CREATED" }, select: { id: true } });
        if (alreadyCreated) continue;
        await tx.dataSubjectRequestEvent.create({
          data: {
            id,
            workspaceId: context.workspaceId,
            requestId: candidate.id,
            kind: "CREATED",
            toStatus: candidate.status,
            reason: "Evento inicial reconstruído de forma conservadora pela CRM-62.",
            evidence: { source: "existing_data_subject_request", verificationStatus: candidate.verificationStatus, requestedAt: candidate.requestedAt.toISOString() },
            result: { historicalBackfill: true, inferredBusinessFacts: false },
            actorId: context.actorId,
            occurredAt: candidate.requestedAt,
          },
        });
        createdCount += 1;
      }
      const auditId = stableUuid(`crm62:backfill-audit:${context.workspaceId}:${candidates.map((item) => item.id).join(":")}`);
      if (!(await tx.auditLog.findUnique({ where: { id: auditId }, select: { id: true } }))) {
        await tx.auditLog.create({
          data: {
            id: auditId,
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "operations.backfill.completed_local",
            entityType: "Workspace",
            entityId: context.workspaceId,
            changes: { candidateCount: candidates.length, createdCount, destructive: false, bounded: candidates.length === input.batchSize },
            occurredAt: options.now(),
          },
        });
      }
      return { mode: input.mode, candidateCount: candidates.length, createdCount, bounded: candidates.length === input.batchSize, destructive: false } as const;
    }, { isolationLevel: "Serializable" });
  }

  return Object.freeze({ run });
}

let singleton: ReturnType<typeof createOperationsBackfillService> | undefined;
export function getOperationsBackfillService() {
  singleton ??= createOperationsBackfillService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
