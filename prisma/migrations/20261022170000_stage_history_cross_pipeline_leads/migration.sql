-- A lead may be transferred between pipelines while its immutable stage history
-- keeps the pipeline where each interval occurred. The previous composite FK
-- incorrectly required every historical row to match the lead's current pipeline.
ALTER TABLE "stage_history"
  DROP CONSTRAINT "stage_history_workspaceId_pipelineId_leadId_fkey";

ALTER TABLE "stage_history"
  ADD CONSTRAINT "stage_history_workspaceId_leadId_fkey"
  FOREIGN KEY ("workspaceId", "leadId")
  REFERENCES "leads"("workspaceId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
