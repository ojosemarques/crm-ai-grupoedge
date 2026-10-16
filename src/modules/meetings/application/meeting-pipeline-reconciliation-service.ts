import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { transitionLeadStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { AccessRoleKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const inputSchema = z.object({ mode: z.enum(["DRY_RUN", "APPLY"]) }).strict();

type CandidateRow = Readonly<{
  pipelineId: string;
  leadId: string;
  meetingId: string;
  status: "COMPLETED" | "CANCELLED" | "NO_SHOW";
  occurredAt: Date;
  currentStageId: string;
  targetStageId: string;
  currentHistoryId: string | null;
  currentEnteredAt: Date | null;
}>;

type ReconciliationSummary = Readonly<{
  consideredCount: number;
  eligibleCount: number;
  completedCount: number;
  noShowCount: number;
  cancelledCount: number;
  alreadyCorrectCount: number;
  protectedByNewerStageCount: number;
  inconsistentHistoryCount: number;
}>;

function assertAdministrator(context: AuthenticatedContext) {
  if (context.roleKey !== AccessRoleKeys.ADMINISTRATOR) {
    throw new ApplicationError("A reconciliação exige perfil administrador.", {
      code: "FORBIDDEN",
      statusCode: 403,
      expose: true,
    });
  }
}

function summarize(rows: readonly CandidateRow[]): ReconciliationSummary {
  let eligibleCount = 0;
  let completedCount = 0;
  let noShowCount = 0;
  let cancelledCount = 0;
  let alreadyCorrectCount = 0;
  let protectedByNewerStageCount = 0;
  let inconsistentHistoryCount = 0;
  for (const row of rows) {
    if (row.currentStageId === row.targetStageId) {
      alreadyCorrectCount += 1;
      continue;
    }
    if (!row.currentHistoryId || !row.currentEnteredAt) {
      inconsistentHistoryCount += 1;
      continue;
    }
    if (row.currentEnteredAt > row.occurredAt) {
      protectedByNewerStageCount += 1;
      continue;
    }
    eligibleCount += 1;
    if (row.status === "COMPLETED") completedCount += 1;
    else if (row.status === "NO_SHOW") noShowCount += 1;
    else cancelledCount += 1;
  }
  return Object.freeze({
    consideredCount: rows.length,
    eligibleCount,
    completedCount,
    noShowCount,
    cancelledCount,
    alreadyCorrectCount,
    protectedByNewerStageCount,
    inconsistentHistoryCount,
  });
}

async function loadRows(database: PrismaClient | Prisma.TransactionClient, workspaceId: string) {
  return database.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH latest_meeting_event AS (
      SELECT DISTINCT ON (history."leadId")
        history."leadId",
        history."meetingId",
        meeting."status"::text AS status,
        history."occurredAt"
      FROM "meeting_history" history
      JOIN "meetings" meeting
        ON meeting."workspaceId" = history."workspaceId"
       AND meeting."id" = history."meetingId"
       AND meeting."deletedAt" IS NULL
      WHERE history."workspaceId" = ${workspaceId}::uuid
      ORDER BY history."leadId", history."occurredAt" DESC, history."meetingRevision" DESC, history."id" DESC
    )
    SELECT
      lead."pipelineId" AS "pipelineId",
      lead."id" AS "leadId",
      latest."meetingId" AS "meetingId",
      latest.status,
      latest."occurredAt" AS "occurredAt",
      lead."currentStageId" AS "currentStageId",
      target_stage."id" AS "targetStageId",
      current_history."id" AS "currentHistoryId",
      current_history."enteredAt" AS "currentEnteredAt"
    FROM latest_meeting_event latest
    JOIN "leads" lead
      ON lead."workspaceId" = ${workspaceId}::uuid
     AND lead."id" = latest."leadId"
     AND lead."deletedAt" IS NULL
    JOIN "pipelines" pipeline
      ON pipeline."workspaceId" = lead."workspaceId"
     AND pipeline."id" = lead."pipelineId"
     AND pipeline."entityType"::text = 'LEAD'
     AND pipeline."name" = 'Prospecção Ativa'
     AND pipeline."deletedAt" IS NULL
    JOIN "pipeline_stages" target_stage
      ON target_stage."workspaceId" = lead."workspaceId"
     AND target_stage."pipelineId" = lead."pipelineId"
     AND target_stage."stableKey" = CASE
       WHEN latest.status = 'COMPLETED' THEN 'active-prospecting.meeting-completed'
       ELSE 'active-prospecting.meeting-no-show'
     END
     AND target_stage."deletedAt" IS NULL
    LEFT JOIN LATERAL (
      SELECT history."id", history."enteredAt"
      FROM "stage_history" history
      WHERE history."workspaceId" = lead."workspaceId"
        AND history."leadId" = lead."id"
        AND history."stageId" = lead."currentStageId"
        AND history."exitedAt" IS NULL
      ORDER BY history."enteredAt" DESC, history."id" DESC
      LIMIT 1
    ) current_history ON TRUE
    WHERE latest.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
    ORDER BY latest."occurredAt", lead."id"
  `);
}

export function createMeetingPipelineReconciliationService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function ensureConfiguration(workspaceId: string) {
    const pipeline = await options.database.pipeline.findFirst({
      where: { workspaceId, entityType: "LEAD", name: "Prospecção Ativa", deletedAt: null },
      select: {
        id: true,
        stages: {
          where: {
            stableKey: { in: ["active-prospecting.meeting-no-show", "active-prospecting.meeting-completed"] },
            deletedAt: null,
          },
          select: { stableKey: true },
        },
      },
    });
    if (!pipeline || pipeline.stages.length !== 2) {
      throw new ApplicationError("As etapas Noshow e Reunião feita não estão configuradas na Prospecção Ativa.", {
        code: "PIPELINE_CONFIGURATION_INVALID",
        statusCode: 409,
        expose: true,
      });
    }
  }

  async function run(context: AuthenticatedContext, raw: unknown) {
    assertAdministrator(context);
    const input = inputSchema.parse(raw);
    await ensureConfiguration(context.workspaceId);
    if (input.mode === "DRY_RUN") {
      const summary = summarize(await loadRows(options.database, context.workspaceId));
      return Object.freeze({ mode: input.mode, movedCount: 0, ...summary });
    }

    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`meeting-pipeline-reconciliation:${context.workspaceId}`}, 0))
      `;
      const rows = await loadRows(transaction, context.workspaceId);
      const summary = summarize(rows);
      const eligible = rows.filter((row) =>
        row.currentStageId !== row.targetStageId &&
        row.currentHistoryId !== null &&
        row.currentEnteredAt !== null &&
        row.currentEnteredAt <= row.occurredAt,
      );
      const reconciledAt = options.now();
      for (const row of eligible) {
        await transitionLeadStageInTransaction(transaction, context, {
          leadId: row.leadId,
          targetStageId: row.targetStageId,
          reason: `Reconciliação histórica da reunião ${row.meetingId} com status ${row.status}.`,
          origin: "SYSTEM",
          managerCorrection: true,
          confirmed: true,
        }, reconciledAt);
      }
      return Object.freeze({ mode: input.mode, movedCount: eligible.length, ...summary });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
  }

  return Object.freeze({ run });
}

let singleton: ReturnType<typeof createMeetingPipelineReconciliationService> | undefined;

export function getMeetingPipelineReconciliationService() {
  singleton ??= createMeetingPipelineReconciliationService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
