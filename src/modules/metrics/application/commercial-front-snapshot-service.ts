import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { commercialFrontClassificationSql } from "./commercial-front-classification-sql";
import { z } from "zod";

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "APPLY"]), batchSize: z.number().int().min(1).max(500).default(250), expectedCount: z.number().int().nonnegative().optional(), recordedBefore: z.coerce.date().optional() }).strict();

// Use the existing correction protocol: reverse the old contribution and append
// its classified replacement. No original fact or fingerprint is ever updated.
export function createCommercialFrontSnapshotService(options: Readonly<{ database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService> }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    const recordedBefore = input.recordedBefore ?? new Date();
    const decision = await options.authorization.authorize(context, PermissionKeys.WORKSPACE_MANAGE, { workspaceId: context.workspaceId, resourceType: "CommercialFrontSnapshot" });
    if (!decision.allowed || decision.scope !== "WORKSPACE") throw new AccessDeniedError();
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-front-snapshot:${context.workspaceId}`}, 0))`;
      const candidates = await tx.$queryRaw<{ id: string; pipelineId: string }[]>(Prisma.sql`
        SELECT f.id, h."pipelineId" FROM commercial_metric_facts f
        LEFT JOIN pipelines original_pipeline ON original_pipeline.id = f."pipelineId" AND original_pipeline."workspaceId" = f."workspaceId"
        JOIN LATERAL (
          SELECT min(sh."pipelineId"::text)::uuid AS "pipelineId"
          FROM stage_history sh JOIN pipelines p ON p.id = sh."pipelineId" AND p."workspaceId" = sh."workspaceId"
          WHERE sh."workspaceId" = f."workspaceId" AND sh."leadId" = f."leadId" AND sh."opportunityId" IS NULL
            AND p."entityType" = 'LEAD' AND sh."enteredAt" <= f."occurredAt"
            AND (sh."exitedAt" IS NULL OR sh."exitedAt" > f."occurredAt")
          HAVING count(DISTINCT sh."pipelineId") = 1
        ) h ON h."pipelineId" IS NOT NULL
        JOIN pipelines front ON front.id = h."pipelineId" AND front."workspaceId" = f."workspaceId" AND front.name IN ('Anúncios', 'Prospecção Ativa')
        WHERE f."workspaceId" = ${context.workspaceId}::uuid
          AND f."recordedAt" <= ${recordedBefore}
          AND (f."pipelineId" IS NULL OR original_pipeline."entityType" = 'OPPORTUNITY')
          AND (f."safeMetadata" IS NULL OR NOT (f."safeMetadata" ? '_commercialFrontPipelineId'))
          AND f."eventKey" NOT LIKE '%:front-classification:%'
          AND NOT EXISTS (SELECT 1 FROM commercial_metric_facts done WHERE done."workspaceId"=f."workspaceId" AND done."eventKey"=f."eventKey" || ':front-classification:reversal:v1')
        ORDER BY f.id LIMIT ${input.batchSize}
      `);
      if (input.mode === "DRY_RUN") return { mode: input.mode, asOf: recordedBefore.toISOString(), eligibleInBatch: candidates.length, batchSize: input.batchSize, updated: 0, ruleVersion: 1 };
      if (input.expectedCount === undefined || candidates.length !== input.expectedCount) throw new ApplicationError("O lote divergiu do dry-run. Refaça a simulação.", { code: "FRONT_SNAPSHOT_DRY_RUN_MISMATCH", statusCode: 409, expose: true });
      const appendedFacts = candidates.length ? await tx.$executeRaw(commercialFrontClassificationSql(context.workspaceId, candidates)) : 0;
      if (appendedFacts !== candidates.length * 2) throw new ApplicationError("Classificação concorrente ou incompleta. Refaça o dry-run.", { code: "FRONT_SNAPSHOT_CONFLICT", statusCode: 409, expose: true });
      const runId = randomUUID();
      if (candidates.length) await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "commercial_metrics.front_snapshots.classified", entityType: "CommercialFrontSnapshotRun", entityId: runId, changes: { ruleVersion: 1, classified: candidates.length, appendedFacts: candidates.length * 2, factIds: candidates.map((row) => row.id), recovery: "Prior app ignores front metadata. Corrections preserve global quantity/value; any later undo must append compensating facts." } } });
      return { mode: input.mode, asOf: recordedBefore.toISOString(), eligibleInBatch: candidates.length, batchSize: input.batchSize, updated: candidates.length, appendedFacts: candidates.length * 2, runId, ruleVersion: 1 };
    }, { timeout: 30_000 });
  }
  return { run };
}
