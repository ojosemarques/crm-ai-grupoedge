-- CRM-16: oportunidades, propostas e pipeline comercial explicável.

DO $$
BEGIN
  CREATE TYPE "OpportunityPipelineStageCode" AS ENUM (
    'MEETING_SCHEDULED',
    'MEETING_HELD',
    'OPPORTUNITY_CONFIRMED',
    'PROPOSAL',
    'NEGOTIATION',
    'WON',
    'LOST'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Valores novos precisam ser confirmados antes do uso na mesma migration.
ALTER TYPE "StageTransitionOrigin" ADD VALUE IF NOT EXISTS 'OPPORTUNITY_BOARD';
ALTER TYPE "StageTransitionOrigin" ADD VALUE IF NOT EXISTS 'OPPORTUNITY_LIST';
ALTER TYPE "StageTransitionOrigin" ADD VALUE IF NOT EXISTS 'OPPORTUNITY_CARD';

BEGIN;

ALTER TABLE "pipeline_stages"
  ADD COLUMN "opportunityStageCode" "OpportunityPipelineStageCode";

ALTER TABLE "opportunities"
  ADD COLUMN "productId" UUID,
  ADD COLUMN "interestDescription" TEXT,
  ADD COLUMN "mrrCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "tcvCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "nextActionTaskId" UUID,
  ADD COLUMN "nextActionAt" TIMESTAMPTZ(3),
  ADD COLUMN "nextActionDescription" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "offers"
  ADD COLUMN "justification" TEXT;

-- Registros anteriores são mantidos sem transformar ausência em um fato comercial.
UPDATE "opportunities" opportunity
SET
  "interestDescription" = COALESCE(
    NULLIF(trim(lead."interestSummary"), ''),
    'Não informado no registro anterior à CRM-16'
  ),
  "tcvCents" = opportunity."amountCents"
FROM "leads" lead
WHERE lead."workspaceId" = opportunity."workspaceId"
  AND lead."id" = opportunity."leadId";

-- Converte apenas o pipeline estrutural criado pelo seed antigo. Configurações
-- manuais divergentes continuam intactas e serão acusadas pelo serviço.
CREATE TEMP TABLE "_crm16_seed_pipelines" ON COMMIT DROP AS
SELECT pipeline."workspaceId", pipeline."id" AS "pipelineId", pipeline."updatedByActorId"
FROM "pipelines" pipeline
WHERE pipeline."entityType" = 'OPPORTUNITY'
  AND pipeline."isDefault" = TRUE
  AND pipeline."deletedAt" IS NULL
  AND (
    SELECT count(*)
    FROM "pipeline_stages" stage
    WHERE stage."workspaceId" = pipeline."workspaceId"
      AND stage."pipelineId" = pipeline."id"
      AND stage."deletedAt" IS NULL
  ) = 6
  AND NOT EXISTS (
    SELECT 1
    FROM "pipeline_stages" stage
    WHERE stage."workspaceId" = pipeline."workspaceId"
      AND stage."pipelineId" = pipeline."id"
      AND stage."deletedAt" IS NULL
      AND (stage."position", stage."name") NOT IN (
        (0, 'Reunião agendada'),
        (1, 'Diagnóstico realizado'),
        (2, 'Proposta enviada'),
        (3, 'Negociação'),
        (4, 'Ganho'),
        (5, 'Perdido')
      )
  );

UPDATE "pipeline_stages" stage
SET
  -- O deslocamento temporário evita colisão com o índice único de posição.
  "position" = stage."position" + 1000,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_crm16_seed_pipelines" pipeline
WHERE stage."workspaceId" = pipeline."workspaceId"
  AND stage."pipelineId" = pipeline."pipelineId"
  AND stage."position" >= 2
  AND stage."deletedAt" IS NULL;

UPDATE "pipeline_stages" stage
SET
  "position" = stage."position" - 999,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_crm16_seed_pipelines" pipeline
WHERE stage."workspaceId" = pipeline."workspaceId"
  AND stage."pipelineId" = pipeline."pipelineId"
  AND stage."position" >= 1002
  AND stage."deletedAt" IS NULL;

UPDATE "pipeline_stages" stage
SET
  "name" = mapping."newName",
  "type" = mapping."stageType"::"StageType",
  "opportunityStageCode" = mapping."code"::"OpportunityPipelineStageCode",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_crm16_seed_pipelines" pipeline,
  (VALUES
    (0, 'Reunião agendada', 'OPEN', 'MEETING_SCHEDULED'),
    (1, 'Reunião realizada', 'OPEN', 'MEETING_HELD'),
    (3, 'Proposta', 'OPEN', 'PROPOSAL'),
    (4, 'Negociação', 'OPEN', 'NEGOTIATION'),
    (5, 'Ganho', 'WON', 'WON'),
    (6, 'Perdido', 'LOST', 'LOST')
  ) AS mapping("position", "newName", "stageType", "code")
WHERE stage."workspaceId" = pipeline."workspaceId"
  AND stage."pipelineId" = pipeline."pipelineId"
  AND stage."position" = mapping."position"
  AND stage."deletedAt" IS NULL;

INSERT INTO "pipeline_stages" (
  "id", "workspaceId", "pipelineId", "name", "position", "type",
  "opportunityStageCode", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), pipeline."workspaceId", pipeline."pipelineId",
  'Oportunidade confirmada', 2, 'OPEN', 'OPPORTUNITY_CONFIRMED',
  pipeline."updatedByActorId", pipeline."updatedByActorId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_crm16_seed_pipelines" pipeline;

CREATE UNIQUE INDEX "pipeline_stages_opportunity_code_active_key"
  ON "pipeline_stages" ("workspaceId", "pipelineId", "opportunityStageCode")
  WHERE "opportunityStageCode" IS NOT NULL AND "deletedAt" IS NULL;
CREATE INDEX "pipeline_stages_workspaceId_pipelineId_opportunityStageCode_deletedAt_idx"
  ON "pipeline_stages" ("workspaceId", "pipelineId", "opportunityStageCode", "deletedAt");

CREATE UNIQUE INDEX "tasks_workspaceId_opportunityId_id_key"
  ON "tasks" ("workspaceId", "opportunityId", "id");

CREATE INDEX "opportunities_workspaceId_productId_status_deletedAt_idx"
  ON "opportunities" ("workspaceId", "productId", "status", "deletedAt");
CREATE INDEX "opportunities_workspaceId_status_nextActionAt_idx"
  ON "opportunities" ("workspaceId", "status", "nextActionAt");
CREATE UNIQUE INDEX "opportunities_workspaceId_id_nextActionTaskId_key"
  ON "opportunities" ("workspaceId", "id", "nextActionTaskId");

ALTER TABLE "opportunities"
  DROP CONSTRAINT "opportunities_amount_check",
  DROP CONSTRAINT "opportunities_closed_state_check",
  ADD CONSTRAINT "opportunities_money_check"
    CHECK ("amountCents" >= 0 AND "mrrCents" >= 0 AND "tcvCents" >= 0),
  ADD CONSTRAINT "opportunities_product_or_interest_check"
    CHECK (
      "productId" IS NOT NULL
      OR COALESCE(length(trim("interestDescription")), 0) >= 2
    ),
  ADD CONSTRAINT "opportunities_closed_state_check"
    CHECK (
      ("status" = 'OPEN' AND "closedAt" IS NULL AND "lossReasonId" IS NULL)
      OR ("status" = 'WON' AND "closedAt" IS NOT NULL AND "lossReasonId" IS NULL
          AND "productId" IS NOT NULL AND "amountCents" > 0 AND "tcvCents" > 0)
      OR ("status" = 'LOST' AND "closedAt" IS NOT NULL AND "lossReasonId" IS NOT NULL)
      OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "opportunities_next_action_projection_check"
    CHECK (
      ("nextActionTaskId" IS NULL AND "nextActionAt" IS NULL AND "nextActionDescription" IS NULL)
      OR ("nextActionTaskId" IS NOT NULL AND "nextActionAt" IS NOT NULL
          AND length(trim("nextActionDescription")) >= 2)
    ),
  ADD CONSTRAINT "opportunities_revision_check" CHECK ("revision" > 0);

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_value_or_justification_check"
    CHECK (
      "totalCents" > 0
      OR COALESCE(length(trim("justification")), 0) >= 3
    );

ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_workspaceId_productId_fkey"
    FOREIGN KEY ("workspaceId", "productId")
    REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "opportunities_next_action_task_fkey"
    FOREIGN KEY ("workspaceId", "id", "nextActionTaskId")
    REFERENCES "tasks"("workspaceId", "opportunityId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_pipeline_stage_code_type()
RETURNS trigger AS $$
DECLARE
  pipeline_type "PipelineEntityType";
BEGIN
  SELECT "entityType" INTO pipeline_type
  FROM "pipelines"
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."pipelineId";

  IF pipeline_type = 'LEAD' AND NEW."opportunityStageCode" IS NOT NULL THEN
    RAISE EXCEPTION 'opportunity stage code is invalid for a lead pipeline'
      USING ERRCODE = '23514';
  END IF;
  IF pipeline_type = 'OPPORTUNITY' AND NEW."leadStageCode" IS NOT NULL THEN
    RAISE EXCEPTION 'lead stage code is invalid for an opportunity pipeline'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pipeline_stage_code_type_trigger"
  BEFORE INSERT OR UPDATE OF "workspaceId", "pipelineId", "leadStageCode", "opportunityStageCode"
  ON "pipeline_stages"
  FOR EACH ROW EXECUTE FUNCTION enforce_pipeline_stage_code_type();

COMMIT;
