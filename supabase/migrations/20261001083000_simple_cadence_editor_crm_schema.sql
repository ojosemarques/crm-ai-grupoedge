SET search_path TO crm, public;

ALTER TABLE crm.commercial_settings_versions
  ADD COLUMN IF NOT EXISTS "cadenceTemplateKey" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN IF NOT EXISTS "cadenceStopOnReply" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cadenceStopOnMeetingScheduled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cadenceStopOnStageChange" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE crm.cadence_steps
  ADD COLUMN IF NOT EXISTS "timeOfDay" TEXT,
  ADD COLUMN IF NOT EXISTS "message" TEXT,
  ADD COLUMN IF NOT EXISTS "assigneeMemberId" UUID,
  ADD COLUMN IF NOT EXISTS "targetStageId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'crm.cadence_steps'::regclass
      AND conname = 'cadence_steps_time_of_day_check'
  ) THEN
    ALTER TABLE crm.cadence_steps
      ADD CONSTRAINT cadence_steps_time_of_day_check
      CHECK ("timeOfDay" IS NULL OR "timeOfDay" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'crm.cadence_steps'::regclass
      AND conname = 'cadence_steps_message_length_check'
  ) THEN
    ALTER TABLE crm.cadence_steps
      ADD CONSTRAINT cadence_steps_message_length_check
      CHECK ("message" IS NULL OR char_length("message") <= 2000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'crm.cadence_steps'::regclass
      AND conname = 'cadence_steps_assignee_fkey'
  ) THEN
    ALTER TABLE crm.cadence_steps
      ADD CONSTRAINT cadence_steps_assignee_fkey
      FOREIGN KEY ("workspaceId", "assigneeMemberId")
      REFERENCES crm.workspace_members("workspaceId", "id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'crm.cadence_steps'::regclass
      AND conname = 'cadence_steps_target_stage_fkey'
  ) THEN
    ALTER TABLE crm.cadence_steps
      ADD CONSTRAINT cadence_steps_target_stage_fkey
      FOREIGN KEY ("workspaceId", "targetStageId")
      REFERENCES crm.pipeline_stages("workspaceId", "id") ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cadence_steps_workspaceId_assigneeMemberId_idx"
  ON crm.cadence_steps("workspaceId", "assigneeMemberId");

CREATE INDEX IF NOT EXISTS "cadence_steps_workspaceId_targetStageId_idx"
  ON crm.cadence_steps("workspaceId", "targetStageId");
