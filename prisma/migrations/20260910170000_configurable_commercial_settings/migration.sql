-- CRM-17: configurações comerciais tipadas, versionadas e auditáveis.

CREATE TYPE "DistributionStrategy" AS ENUM ('ROUND_ROBIN');

ALTER TABLE "workspaces"
  ADD COLUMN "defaultMeetingDurationMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "distributionStrategy" "DistributionStrategy" NOT NULL DEFAULT 'ROUND_ROBIN',
  ADD COLUMN "maxOpenLeadsPerSdr" INTEGER,
  ADD COLUMN "leadStagnationDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "leadWithoutActivityDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "commercialSettingsRevision" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "workspaces_commercial_settings_check" CHECK (
    "defaultMeetingDurationMinutes" IN (30, 40)
    AND ("maxOpenLeadsPerSdr" IS NULL OR "maxOpenLeadsPerSdr" BETWEEN 1 AND 10000)
    AND "leadStagnationDays" BETWEEN 1 AND 365
    AND "leadWithoutActivityDays" BETWEEN 1 AND 365
    AND "commercialSettingsRevision" > 0
  );

ALTER TABLE "sla_policies"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesPolicyId" UUID,
  ADD CONSTRAINT "sla_policies_version_check" CHECK ("version" > 0);

DROP INDEX "sla_policies_workspace_key_active_key";
CREATE UNIQUE INDEX "sla_policies_workspace_key_active_key"
  ON "sla_policies" ("workspaceId", lower("key"))
  WHERE "active" = TRUE AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "sla_policies_workspaceId_key_version_key"
  ON "sla_policies" ("workspaceId", "key", "version");
ALTER TABLE "sla_policies"
  ADD CONSTRAINT "sla_policies_supersedes_fkey"
    FOREIGN KEY ("workspaceId", "supersedesPolicyId")
    REFERENCES "sla_policies"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "priority_bands_workspace_code_active_key";
DROP INDEX "priority_bands_workspace_position_active_key";
CREATE UNIQUE INDEX "priority_bands_workspace_code_active_key"
  ON "lead_priority_bands" ("workspaceId", "code")
  WHERE "active" = TRUE AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "priority_bands_workspace_position_active_key"
  ON "lead_priority_bands" ("workspaceId", "position")
  WHERE "active" = TRUE AND "deletedAt" IS NULL;

CREATE TABLE "commercial_settings_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "pactoMinimumInvestigatedDimensions" INTEGER NOT NULL,
  "defaultMeetingDurationMinutes" INTEGER NOT NULL,
  "distributionStrategy" "DistributionStrategy" NOT NULL DEFAULT 'ROUND_ROBIN',
  "maxOpenLeadsPerSdr" INTEGER,
  "leadStagnationDays" INTEGER NOT NULL,
  "leadWithoutActivityDays" INTEGER NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_settings_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commercial_settings_values_check" CHECK (
    "revision" > 0
    AND "pactoMinimumInvestigatedDimensions" BETWEEN 1 AND 5
    AND "defaultMeetingDurationMinutes" IN (30, 40)
    AND ("maxOpenLeadsPerSdr" IS NULL OR "maxOpenLeadsPerSdr" BETWEEN 1 AND 10000)
    AND "leadStagnationDays" BETWEEN 1 AND 365
    AND "leadWithoutActivityDays" BETWEEN 1 AND 365
  )
);
CREATE UNIQUE INDEX "commercial_settings_versions_workspaceId_id_key"
  ON "commercial_settings_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "commercial_settings_versions_workspaceId_revision_key"
  ON "commercial_settings_versions"("workspaceId", "revision");
CREATE INDEX "commercial_settings_versions_workspaceId_createdAt_idx"
  ON "commercial_settings_versions"("workspaceId", "createdAt");
ALTER TABLE "commercial_settings_versions"
  ADD CONSTRAINT "commercial_settings_versions_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "commercial_settings_versions_actor_fkey"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cadence_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "settingsVersionId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "dayOffset" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cadence_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cadence_steps_values_check" CHECK (
    "attemptNumber" BETWEEN 1 AND 15 AND "dayOffset" BETWEEN 0 AND 90
  )
);
CREATE UNIQUE INDEX "cadence_steps_workspaceId_id_key"
  ON "cadence_steps"("workspaceId", "id");
CREATE UNIQUE INDEX "cadence_steps_workspaceId_settingsVersionId_attemptNumber_key"
  ON "cadence_steps"("workspaceId", "settingsVersionId", "attemptNumber");
CREATE UNIQUE INDEX "cadence_steps_workspaceId_settingsVersionId_dayOffset_key"
  ON "cadence_steps"("workspaceId", "settingsVersionId", "dayOffset");
CREATE INDEX "cadence_steps_workspaceId_settingsVersionId_dayOffset_idx"
  ON "cadence_steps"("workspaceId", "settingsVersionId", "dayOffset");
ALTER TABLE "cadence_steps"
  ADD CONSTRAINT "cadence_steps_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cadence_steps_settings_version_fkey"
    FOREIGN KEY ("workspaceId", "settingsVersionId")
    REFERENCES "commercial_settings_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "commercial_settings_versions" (
  "id", "workspaceId", "revision", "pactoMinimumInvestigatedDimensions",
  "defaultMeetingDurationMinutes", "distributionStrategy", "maxOpenLeadsPerSdr",
  "leadStagnationDays", "leadWithoutActivityDays", "createdByActorId"
)
SELECT gen_random_uuid(), workspace."id", 1,
  workspace."pactoMinimumInvestigatedDimensions", 30, 'ROUND_ROBIN', NULL, 7, 3,
  actor."id"
FROM "workspaces" workspace
CROSS JOIN LATERAL (
  SELECT candidate."id"
  FROM "actors" candidate
  WHERE candidate."workspaceId" = workspace."id"
  ORDER BY CASE WHEN candidate."type" = 'SYSTEM' THEN 0 ELSE 1 END, candidate."createdAt", candidate."id"
  LIMIT 1
) actor
ON CONFLICT ("workspaceId", "revision") DO NOTHING;

INSERT INTO "cadence_steps" (
  "id", "workspaceId", "settingsVersionId", "attemptNumber", "dayOffset"
)
SELECT gen_random_uuid(), settings."workspaceId", settings."id", cadence."attemptNumber", cadence."dayOffset"
FROM "commercial_settings_versions" settings
CROSS JOIN (VALUES (1, 0), (2, 1), (3, 3), (4, 7), (5, 14), (6, 21), (7, 30))
  AS cadence("attemptNumber", "dayOffset")
WHERE settings."revision" = 1
ON CONFLICT ("workspaceId", "settingsVersionId", "attemptNumber") DO NOTHING;

CREATE TABLE "pipeline_stage_transitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "pipelineId" UUID NOT NULL,
  "fromStageId" UUID NOT NULL,
  "toStageId" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_stage_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_stage_transitions_distinct_check" CHECK ("fromStageId" <> "toStageId")
);
CREATE UNIQUE INDEX "pipeline_stage_transitions_workspaceId_id_key"
  ON "pipeline_stage_transitions"("workspaceId", "id");
CREATE UNIQUE INDEX "pipeline_stage_transitions_workspaceId_pipelineId_fromStageId_toStageId_key"
  ON "pipeline_stage_transitions"("workspaceId", "pipelineId", "fromStageId", "toStageId");
CREATE INDEX "pipeline_stage_transitions_workspaceId_pipelineId_fromStageId_active_idx"
  ON "pipeline_stage_transitions"("workspaceId", "pipelineId", "fromStageId", "active");
CREATE INDEX "pipeline_stage_transitions_workspaceId_pipelineId_toStageId_active_idx"
  ON "pipeline_stage_transitions"("workspaceId", "pipelineId", "toStageId", "active");
ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stage_transitions_pipeline_fkey"
    FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stage_transitions_from_stage_fkey"
    FOREIGN KEY ("workspaceId", "pipelineId", "fromStageId") REFERENCES "pipeline_stages"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stage_transitions_to_stage_fkey"
    FOREIGN KEY ("workspaceId", "pipelineId", "toStageId") REFERENCES "pipeline_stages"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stage_transitions_created_actor_fkey"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_stage_transitions_updated_actor_fkey"
    FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH allowed("entityType", "fromCode", "toCode") AS (
  VALUES
    ('LEAD', 'NEW', 'TRYING_CONTACT'), ('LEAD', 'NEW', 'CONNECTED'), ('LEAD', 'NEW', 'DISQUALIFIED'),
    ('LEAD', 'TRYING_CONTACT', 'CONNECTED'), ('LEAD', 'TRYING_CONTACT', 'NURTURING'), ('LEAD', 'TRYING_CONTACT', 'DISQUALIFIED'),
    ('LEAD', 'CONNECTED', 'IN_QUALIFICATION'), ('LEAD', 'CONNECTED', 'NURTURING'), ('LEAD', 'CONNECTED', 'DISQUALIFIED'),
    ('LEAD', 'IN_QUALIFICATION', 'CONNECTED'), ('LEAD', 'IN_QUALIFICATION', 'QUALIFIED'), ('LEAD', 'IN_QUALIFICATION', 'NURTURING'), ('LEAD', 'IN_QUALIFICATION', 'DISQUALIFIED'),
    ('LEAD', 'QUALIFIED', 'MEETING_SCHEDULED'), ('LEAD', 'QUALIFIED', 'NURTURING'), ('LEAD', 'QUALIFIED', 'DISQUALIFIED'),
    ('LEAD', 'MEETING_SCHEDULED', 'QUALIFIED'), ('LEAD', 'MEETING_SCHEDULED', 'NURTURING'), ('LEAD', 'MEETING_SCHEDULED', 'DISQUALIFIED'),
    ('LEAD', 'NURTURING', 'TRYING_CONTACT'), ('LEAD', 'NURTURING', 'CONNECTED'), ('LEAD', 'NURTURING', 'IN_QUALIFICATION'), ('LEAD', 'NURTURING', 'DISQUALIFIED'),
    ('OPPORTUNITY', 'MEETING_SCHEDULED', 'MEETING_HELD'), ('OPPORTUNITY', 'MEETING_SCHEDULED', 'LOST'),
    ('OPPORTUNITY', 'MEETING_HELD', 'OPPORTUNITY_CONFIRMED'), ('OPPORTUNITY', 'MEETING_HELD', 'LOST'),
    ('OPPORTUNITY', 'OPPORTUNITY_CONFIRMED', 'PROPOSAL'), ('OPPORTUNITY', 'OPPORTUNITY_CONFIRMED', 'LOST'),
    ('OPPORTUNITY', 'PROPOSAL', 'NEGOTIATION'), ('OPPORTUNITY', 'PROPOSAL', 'LOST'),
    ('OPPORTUNITY', 'NEGOTIATION', 'WON'), ('OPPORTUNITY', 'NEGOTIATION', 'LOST')
)
INSERT INTO "pipeline_stage_transitions" (
  "id", "workspaceId", "pipelineId", "fromStageId", "toStageId",
  "createdByActorId", "updatedByActorId"
)
SELECT gen_random_uuid(), pipeline."workspaceId", pipeline."id", source."id", target."id", actor."id", actor."id"
FROM "pipelines" pipeline
JOIN allowed ON allowed."entityType" = pipeline."entityType"::text
JOIN "pipeline_stages" source ON source."workspaceId" = pipeline."workspaceId" AND source."pipelineId" = pipeline."id" AND source."deletedAt" IS NULL
JOIN "pipeline_stages" target ON target."workspaceId" = pipeline."workspaceId" AND target."pipelineId" = pipeline."id" AND target."deletedAt" IS NULL
CROSS JOIN LATERAL (
  SELECT candidate."id"
  FROM "actors" candidate
  WHERE candidate."workspaceId" = pipeline."workspaceId"
  ORDER BY CASE WHEN candidate."type" = 'SYSTEM' THEN 0 ELSE 1 END, candidate."createdAt", candidate."id"
  LIMIT 1
) actor
WHERE (
    pipeline."entityType" = 'LEAD'
    AND source."leadStageCode"::text = allowed."fromCode"
    AND target."leadStageCode"::text = allowed."toCode"
  ) OR (
    pipeline."entityType" = 'OPPORTUNITY'
    AND source."opportunityStageCode"::text = allowed."fromCode"
    AND target."opportunityStageCode"::text = allowed."toCode"
  )
ON CONFLICT ("workspaceId", "pipelineId", "fromStageId", "toStageId") DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_commercial_settings_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commercial settings history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "commercial_settings_versions_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "commercial_settings_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_commercial_settings_history_mutation();
CREATE TRIGGER "commercial_settings_versions_no_truncate_trigger"
  BEFORE TRUNCATE ON "commercial_settings_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_commercial_settings_history_mutation();
CREATE TRIGGER "cadence_steps_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "cadence_steps"
  FOR EACH ROW EXECUTE FUNCTION prevent_commercial_settings_history_mutation();
CREATE TRIGGER "cadence_steps_no_truncate_trigger"
  BEFORE TRUNCATE ON "cadence_steps"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_commercial_settings_history_mutation();
