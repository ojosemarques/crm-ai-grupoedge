-- Integra proposta e venda ao pipeline operacional da Prospecção Ativa.

ALTER TYPE "LeadPipelineStageCode" ADD VALUE IF NOT EXISTS 'PROPOSAL';
ALTER TYPE "LeadPipelineStageCode" ADD VALUE IF NOT EXISTS 'CLIENT';

-- PostgreSQL exige commit dos novos valores de enum antes de usá-los.
BEGIN;

UPDATE "pipeline_stages" stage
SET
  "position" = CASE stage."stableKey"
    WHEN 'active-prospecting.closed-no-response' THEN 9
    WHEN 'active-prospecting.discarded' THEN 10
    ELSE stage."position"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "pipelines" pipeline
WHERE pipeline."id" = stage."pipelineId"
  AND pipeline."workspaceId" = stage."workspaceId"
  AND pipeline."entityType" = 'LEAD'::"PipelineEntityType"
  AND pipeline."name" = 'Prospecção Ativa'
  AND pipeline."deletedAt" IS NULL
  AND stage."stableKey" IN (
    'active-prospecting.closed-no-response',
    'active-prospecting.discarded'
  );

INSERT INTO "pipeline_stages" (
  "id", "workspaceId", "pipelineId", "stableKey", "name", "position", "type",
  "leadStageCode", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), pipeline."workspaceId", pipeline."id", definition.stable_key,
  definition.name, definition.position, definition.stage_type::"StageType",
  definition.stage_code::"LeadPipelineStageCode", pipeline."updatedByActorId",
  pipeline."updatedByActorId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pipelines" pipeline
CROSS JOIN (VALUES
  ('active-prospecting.proposal', 'Proposta', 7, 'OPEN', 'PROPOSAL'),
  ('active-prospecting.client', 'Cliente', 8, 'WON', 'CLIENT')
) AS definition(stable_key, name, position, stage_type, stage_code)
WHERE pipeline."entityType" = 'LEAD'::"PipelineEntityType"
  AND pipeline."name" = 'Prospecção Ativa'
  AND pipeline."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "pipelineId", "stableKey") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "type" = EXCLUDED."type",
  "leadStageCode" = EXCLUDED."leadStageCode",
  "updatedByActorId" = EXCLUDED."updatedByActorId",
  "updatedAt" = CURRENT_TIMESTAMP,
  "deletedAt" = NULL;

WITH commercial_transitions(from_key, to_key) AS (
  VALUES
    ('active-prospecting.meeting-completed', 'active-prospecting.proposal'),
    ('active-prospecting.proposal', 'active-prospecting.client'),
    ('active-prospecting.proposal', 'active-prospecting.meeting-scheduled'),
    ('active-prospecting.proposal', 'active-prospecting.closed-no-response'),
    ('active-prospecting.proposal', 'active-prospecting.discarded')
)
INSERT INTO "pipeline_stage_transitions" (
  "id", "workspaceId", "pipelineId", "fromStageId", "toStageId",
  "active", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), pipeline."workspaceId", pipeline."id", source_stage."id", target_stage."id",
  TRUE, pipeline."updatedByActorId", pipeline."updatedByActorId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pipelines" pipeline
JOIN commercial_transitions ON TRUE
JOIN "pipeline_stages" source_stage
  ON source_stage."workspaceId" = pipeline."workspaceId"
 AND source_stage."pipelineId" = pipeline."id"
 AND source_stage."stableKey" = commercial_transitions.from_key
 AND source_stage."deletedAt" IS NULL
JOIN "pipeline_stages" target_stage
  ON target_stage."workspaceId" = pipeline."workspaceId"
 AND target_stage."pipelineId" = pipeline."id"
 AND target_stage."stableKey" = commercial_transitions.to_key
 AND target_stage."deletedAt" IS NULL
WHERE pipeline."entityType" = 'LEAD'::"PipelineEntityType"
  AND pipeline."name" = 'Prospecção Ativa'
  AND pipeline."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "pipelineId", "fromStageId", "toStageId") DO UPDATE
SET
  "active" = TRUE,
  "updatedByActorId" = EXCLUDED."updatedByActorId",
  "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
