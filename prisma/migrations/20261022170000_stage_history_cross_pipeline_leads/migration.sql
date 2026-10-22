-- A lead may be transferred between pipelines while its immutable stage history
-- keeps the pipeline where each interval occurred. The previous composite FK
-- incorrectly required every historical row to match the lead's current pipeline.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stage_history'::regclass
      AND conname = 'stage_history_workspaceId_pipelineId_leadId_fkey'
  ) THEN
    ALTER TABLE "stage_history"
      DROP CONSTRAINT "stage_history_workspaceId_pipelineId_leadId_fkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stage_history'::regclass
      AND conname = 'stage_history_workspaceId_leadId_fkey'
  ) THEN
    ALTER TABLE "stage_history"
      ADD CONSTRAINT "stage_history_workspaceId_leadId_fkey"
      FOREIGN KEY ("workspaceId", "leadId")
      REFERENCES "leads"("workspaceId", "id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END;
$$;
