ALTER TABLE "commercial_settings_versions"
  ADD COLUMN "cadenceTemplateKey" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "cadenceStopOnReply" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cadenceStopOnMeetingScheduled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cadenceStopOnStageChange" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "cadence_steps"
  ADD COLUMN "timeOfDay" TEXT,
  ADD COLUMN "message" TEXT,
  ADD COLUMN "assigneeMemberId" UUID,
  ADD COLUMN "targetStageId" UUID,
  ADD CONSTRAINT "cadence_steps_time_of_day_check"
    CHECK ("timeOfDay" IS NULL OR "timeOfDay" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "cadence_steps_message_length_check"
    CHECK ("message" IS NULL OR char_length("message") <= 2000),
  ADD CONSTRAINT "cadence_steps_assignee_fkey"
    FOREIGN KEY ("workspaceId", "assigneeMemberId")
    REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cadence_steps_target_stage_fkey"
    FOREIGN KEY ("workspaceId", "targetStageId")
    REFERENCES "pipeline_stages"("workspaceId", "id") ON DELETE RESTRICT;

CREATE INDEX "cadence_steps_workspaceId_assigneeMemberId_idx"
  ON "cadence_steps"("workspaceId", "assigneeMemberId");

CREATE INDEX "cadence_steps_workspaceId_targetStageId_idx"
  ON "cadence_steps"("workspaceId", "targetStageId");
