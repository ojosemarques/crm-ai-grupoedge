-- Adiciona os resultados de reunião ao pipeline da Prospecção Ativa.

ALTER TYPE "LeadPipelineStageCode" ADD VALUE IF NOT EXISTS 'MEETING_NO_SHOW';
ALTER TYPE "LeadPipelineStageCode" ADD VALUE IF NOT EXISTS 'MEETING_COMPLETED';

-- PostgreSQL exige que os novos valores de enum sejam confirmados antes do uso.
BEGIN;

UPDATE "pipeline_stages" stage
SET
  "position" = CASE stage."stableKey"
    WHEN 'active-prospecting.closed-no-response' THEN 7
    WHEN 'active-prospecting.discarded' THEN 8
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
  definition.name, definition.position, 'OPEN'::"StageType",
  definition.stage_code::"LeadPipelineStageCode", pipeline."updatedByActorId",
  pipeline."updatedByActorId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pipelines" pipeline
CROSS JOIN (VALUES
  ('active-prospecting.meeting-no-show', 'Noshow', 5, 'MEETING_NO_SHOW'),
  ('active-prospecting.meeting-completed', 'Reunião feita', 6, 'MEETING_COMPLETED')
) AS definition(stable_key, name, position, stage_code)
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

WITH outcome_transitions(from_key, to_key) AS (
  VALUES
    ('active-prospecting.meeting-scheduled', 'active-prospecting.meeting-no-show'),
    ('active-prospecting.meeting-scheduled', 'active-prospecting.meeting-completed'),
    ('active-prospecting.meeting-no-show', 'active-prospecting.meeting-scheduled'),
    ('active-prospecting.meeting-no-show', 'active-prospecting.meeting-completed'),
    ('active-prospecting.meeting-completed', 'active-prospecting.meeting-scheduled'),
    ('active-prospecting.meeting-completed', 'active-prospecting.meeting-no-show')
)
INSERT INTO "pipeline_stage_transitions" (
  "id", "workspaceId", "pipelineId", "fromStageId", "toStageId",
  "active", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), pipeline."workspaceId", pipeline."id", source_stage."id", target_stage."id",
  TRUE, pipeline."updatedByActorId", pipeline."updatedByActorId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pipelines" pipeline
JOIN outcome_transitions ON TRUE
JOIN "pipeline_stages" source_stage
  ON source_stage."workspaceId" = pipeline."workspaceId"
 AND source_stage."pipelineId" = pipeline."id"
 AND source_stage."stableKey" = outcome_transitions.from_key
 AND source_stage."deletedAt" IS NULL
JOIN "pipeline_stages" target_stage
  ON target_stage."workspaceId" = pipeline."workspaceId"
 AND target_stage."pipelineId" = pipeline."id"
 AND target_stage."stableKey" = outcome_transitions.to_key
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
