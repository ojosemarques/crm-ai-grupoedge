-- CRM-19: snapshots financeiros imutáveis e índices para métricas históricas.

BEGIN;

ALTER TABLE "stage_history"
  ADD CONSTRAINT "stage_history_workspaceId_opportunityId_id_key"
  UNIQUE ("workspaceId", "opportunityId", "id");

CREATE TABLE "opportunity_outcome_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "stageHistoryId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL,
  "productId" UUID,
  "status" "OpportunityStatus" NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "mrrCents" BIGINT NOT NULL,
  "tcvCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "lossReasonId" UUID,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "opportunity_outcome_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_outcome_snapshot_status_check"
    CHECK ("status" IN ('WON', 'LOST')),
  CONSTRAINT "opportunity_outcome_snapshot_money_check"
    CHECK ("amountCents" >= 0 AND "mrrCents" >= 0 AND "tcvCents" >= 0),
  CONSTRAINT "opportunity_outcome_snapshot_won_check"
    CHECK (
      "status" <> 'WON'
      OR ("productId" IS NOT NULL AND "amountCents" > 0 AND "tcvCents" > 0
          AND "lossReasonId" IS NULL)
    )
);

CREATE UNIQUE INDEX "opportunity_outcome_snapshots_workspaceId_id_key"
  ON "opportunity_outcome_snapshots" ("workspaceId", "id");
CREATE UNIQUE INDEX "opportunity_outcome_snapshots_workspaceId_stageHistoryId_key"
  ON "opportunity_outcome_snapshots" ("workspaceId", "stageHistoryId");
CREATE UNIQUE INDEX "opportunity_outcome_snapshots_workspaceId_opportunityId_stageHistoryId_key"
  ON "opportunity_outcome_snapshots" ("workspaceId", "opportunityId", "stageHistoryId");
CREATE INDEX "opportunity_outcome_snapshots_workspaceId_status_occurredAt_idx"
  ON "opportunity_outcome_snapshots" ("workspaceId", "status", "occurredAt");
CREATE INDEX "opportunity_outcome_snapshots_workspaceId_leadId_occurredAt_idx"
  ON "opportunity_outcome_snapshots" ("workspaceId", "leadId", "occurredAt");
CREATE INDEX "opportunity_outcome_snapshots_workspaceId_ownerMemberId_occurredAt_idx"
  ON "opportunity_outcome_snapshots" ("workspaceId", "ownerMemberId", "occurredAt");
CREATE INDEX "opportunity_outcome_snapshots_workspaceId_productId_occurredAt_idx"
  ON "opportunity_outcome_snapshots" ("workspaceId", "productId", "occurredAt");
CREATE INDEX "meeting_history_workspaceId_newStartsAt_action_idx"
  ON "meeting_history" ("workspaceId", "newStartsAt", "action");
CREATE INDEX "activities_workspaceId_leadId_createdByActorId_occurredAt_idx"
  ON "activities" ("workspaceId", "leadId", "createdByActorId", "occurredAt");

ALTER TABLE "opportunity_outcome_snapshots"
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_leadId_opportunityId_fkey"
    FOREIGN KEY ("workspaceId", "leadId", "opportunityId")
    REFERENCES "opportunities" ("workspaceId", "leadId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_leadId_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads" ("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_opportunityId_stageHistoryId_fkey"
    FOREIGN KEY ("workspaceId", "opportunityId", "stageHistoryId")
    REFERENCES "stage_history" ("workspaceId", "opportunityId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_ownerMemberId_fkey"
    FOREIGN KEY ("workspaceId", "ownerMemberId")
    REFERENCES "workspace_members" ("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_productId_fkey"
    FOREIGN KEY ("workspaceId", "productId") REFERENCES "products" ("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_lossReasonId_fkey"
    FOREIGN KEY ("workspaceId", "lossReasonId") REFERENCES "loss_reasons" ("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunity_outcome_snapshots_workspaceId_createdByActorId_fkey"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors" ("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill conservador: congela a melhor representação relacional disponível
-- no momento da migration. Fechamentos posteriores sempre são exatos porque o
-- serviço grava o snapshot no mesmo commit da transição.
INSERT INTO "opportunity_outcome_snapshots" (
  "workspaceId", "opportunityId", "leadId", "stageHistoryId",
  "ownerMemberId", "productId", "status", "amountCents", "mrrCents",
  "tcvCents", "currency", "lossReasonId", "occurredAt",
  "createdByActorId", "createdAt"
)
SELECT
  history."workspaceId",
  opportunity."id",
  opportunity."leadId",
  history."id",
  opportunity."ownerMemberId",
  opportunity."productId",
  CASE stage."opportunityStageCode"::text
    WHEN 'WON' THEN 'WON'::"OpportunityStatus"
    ELSE 'LOST'::"OpportunityStatus"
  END,
  opportunity."amountCents",
  opportunity."mrrCents",
  opportunity."tcvCents",
  opportunity."currency",
  CASE WHEN stage."opportunityStageCode"::text = 'LOST'
    THEN opportunity."lossReasonId" ELSE NULL END,
  history."enteredAt",
  history."enteredByActorId",
  history."createdAt"
FROM "stage_history" history
JOIN "pipeline_stages" stage
  ON stage."workspaceId" = history."workspaceId"
 AND stage."pipelineId" = history."pipelineId"
 AND stage."id" = history."stageId"
JOIN "opportunities" opportunity
  ON opportunity."workspaceId" = history."workspaceId"
 AND opportunity."id" = history."opportunityId"
WHERE history."opportunityId" IS NOT NULL
  AND stage."opportunityStageCode"::text IN ('WON', 'LOST')
  AND (
    stage."opportunityStageCode"::text = 'LOST'
    OR (opportunity."productId" IS NOT NULL
        AND opportunity."amountCents" > 0
        AND opportunity."tcvCents" > 0)
  )
ON CONFLICT ("workspaceId", "stageHistoryId") DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_opportunity_outcome_snapshot_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'opportunity outcome snapshots are append-only'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "opportunity_outcome_snapshots_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "opportunity_outcome_snapshots"
  FOR EACH ROW EXECUTE FUNCTION enforce_opportunity_outcome_snapshot_append_only();
CREATE TRIGGER "opportunity_outcome_snapshots_no_truncate_trigger"
  BEFORE TRUNCATE ON "opportunity_outcome_snapshots"
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_opportunity_outcome_snapshot_append_only();

COMMIT;
