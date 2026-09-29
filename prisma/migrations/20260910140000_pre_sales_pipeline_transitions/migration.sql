-- CRM-14: etapas semânticas de pré-vendas e histórico explicável de transições.

BEGIN;

CREATE TYPE "LeadPipelineStageCode" AS ENUM (
  'NEW',
  'TRYING_CONTACT',
  'CONNECTED',
  'IN_QUALIFICATION',
  'QUALIFIED',
  'MEETING_SCHEDULED',
  'NURTURING',
  'DISQUALIFIED'
);

CREATE TYPE "StageTransitionOrigin" AS ENUM (
  'INTAKE',
  'PIPELINE_BOARD',
  'PIPELINE_LIST',
  'LEAD_CARD',
  'SYSTEM',
  'AUTOMATION'
);

ALTER TABLE "pipeline_stages"
  ADD COLUMN "leadStageCode" "LeadPipelineStageCode";

ALTER TABLE "stage_history"
  ADD COLUMN "transitionOrigin" "StageTransitionOrigin" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "transitionReason" TEXT,
  ADD COLUMN "managerCorrection" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT "stage_history_manager_correction_reason_check"
    CHECK (NOT "managerCorrection" OR length(trim("transitionReason")) >= 3);

-- Atualiza somente o funil estrutural antigo quando o fingerprint completo de
-- seis etapas ainda está intacto. Configurações manuais divergentes não são
-- reescritas pela migration.
CREATE TEMP TABLE "_crm14_seed_pipelines" ON COMMIT DROP AS
SELECT p."workspaceId", p."id" AS "pipelineId", p."updatedByActorId"
FROM "pipelines" p
WHERE p."entityType" = 'LEAD'
  AND p."isDefault" = TRUE
  AND p."deletedAt" IS NULL
  AND (
    SELECT count(*)
    FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId"
      AND s."pipelineId" = p."id"
      AND s."deletedAt" IS NULL
  ) = 6
  AND EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId" AND s."pipelineId" = p."id"
      AND s."position" = 0 AND s."name" = 'Novo' AND s."deletedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId" AND s."pipelineId" = p."id"
      AND s."position" = 1 AND s."name" = 'Tentativa de contato' AND s."deletedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId" AND s."pipelineId" = p."id"
      AND s."position" = 2 AND s."name" = 'Contato realizado' AND s."deletedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId" AND s."pipelineId" = p."id"
      AND s."position" = 3 AND s."name" = 'Qualificação PACTO' AND s."deletedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId" AND s."pipelineId" = p."id"
      AND s."position" = 4 AND s."name" = 'Qualificado para vendas' AND s."deletedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "pipeline_stages" s
    WHERE s."workspaceId" = p."workspaceId" AND s."pipelineId" = p."id"
      AND s."position" = 5 AND s."name" = 'Desqualificado' AND s."deletedAt" IS NULL
  );

UPDATE "pipeline_stages" s
SET
  "position" = 7,
  "leadStageCode" = 'DISQUALIFIED',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_crm14_seed_pipelines" p
WHERE s."workspaceId" = p."workspaceId"
  AND s."pipelineId" = p."pipelineId"
  AND s."position" = 5
  AND s."name" = 'Desqualificado'
  AND s."deletedAt" IS NULL;

UPDATE "pipeline_stages" s
SET
  "name" = mapping."newName",
  "leadStageCode" = mapping."code"::"LeadPipelineStageCode",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_crm14_seed_pipelines" p,
  (VALUES
    (0, 'Novo', 'NEW'),
    (1, 'Tentando contato', 'TRYING_CONTACT'),
    (2, 'Conectado', 'CONNECTED'),
    (3, 'Em qualificação', 'IN_QUALIFICATION'),
    (4, 'Qualificado', 'QUALIFIED')
  ) AS mapping("position", "newName", "code")
WHERE s."workspaceId" = p."workspaceId"
  AND s."pipelineId" = p."pipelineId"
  AND s."position" = mapping."position"
  AND s."deletedAt" IS NULL;

INSERT INTO "pipeline_stages" (
  "id", "workspaceId", "pipelineId", "name", "position", "type",
  "leadStageCode", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), p."workspaceId", p."pipelineId", 'Reunião agendada', 5,
  'OPEN', 'MEETING_SCHEDULED', p."updatedByActorId", p."updatedByActorId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_crm14_seed_pipelines" p;

INSERT INTO "pipeline_stages" (
  "id", "workspaceId", "pipelineId", "name", "position", "type",
  "leadStageCode", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), p."workspaceId", p."pipelineId", 'Nutrição', 6,
  'OPEN', 'NURTURING', p."updatedByActorId", p."updatedByActorId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_crm14_seed_pipelines" p;

CREATE UNIQUE INDEX "pipeline_stages_lead_code_active_key"
  ON "pipeline_stages" ("workspaceId", "pipelineId", "leadStageCode")
  WHERE "leadStageCode" IS NOT NULL AND "deletedAt" IS NULL;
CREATE INDEX "pipeline_stages_workspaceId_pipelineId_leadStageCode_deletedAt_idx"
  ON "pipeline_stages" ("workspaceId", "pipelineId", "leadStageCode", "deletedAt");
CREATE INDEX "stage_history_workspaceId_transitionOrigin_enteredAt_idx"
  ON "stage_history" ("workspaceId", "transitionOrigin", "enteredAt");
CREATE INDEX "stage_history_workspaceId_managerCorrection_enteredAt_idx"
  ON "stage_history" ("workspaceId", "managerCorrection", "enteredAt");

CREATE OR REPLACE FUNCTION enforce_stage_history_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."exitedAt" IS NULL
     AND OLD."exitedByActorId" IS NULL
     AND NEW."exitedAt" IS NOT NULL
     AND NEW."exitedByActorId" IS NOT NULL
     AND (to_jsonb(NEW) - 'exitedAt' - 'exitedByActorId')
       = (to_jsonb(OLD) - 'exitedAt' - 'exitedByActorId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stage history is immutable after its interval is closed'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stage_history_no_rewrite_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "stage_history"
  FOR EACH ROW EXECUTE FUNCTION enforce_stage_history_immutability();
CREATE TRIGGER "stage_history_no_truncate_trigger"
  BEFORE TRUNCATE ON "stage_history"
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_stage_history_immutability();

COMMIT;
