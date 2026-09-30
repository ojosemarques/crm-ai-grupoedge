-- Extend the existing approval ledger for operational actions. Configuration
-- publications still require their immutable version references.
BEGIN;
ALTER TABLE "ai_assistant_proposals"
  DROP CONSTRAINT "ai_assistant_proposals_type_check",
  DROP CONSTRAINT "ai_assistant_proposals_status_check",
  DROP CONSTRAINT "ai_assistant_proposals_published_state_check",
  ADD CONSTRAINT "ai_assistant_proposals_type_check" CHECK (
    "type" IN ('AGENT','PIPELINE_MODEL','AUTOMATION','CHART',
      'CLOSE_SALE','CREATE_TASK','UPDATE_CUSTOMER','CREATE_EXPENSE','RECORD_PAYMENT')
  ),
  ADD CONSTRAINT "ai_assistant_proposals_status_check" CHECK (
    "status" IN ('DRAFT','PUBLISHING','PUBLISH_FAILED','PUBLISHED','CANCELLED',
      'UNDOING','UNDO_FAILED','UNDONE','EXECUTING','EXECUTION_FAILED')
  ),
  ADD CONSTRAINT "ai_assistant_proposals_published_state_check" CHECK (
    "status" NOT IN ('PUBLISHED','UNDOING','UNDO_FAILED','UNDONE') OR (
      "publishedTargetType" IS NOT NULL AND "publishedTargetId" IS NOT NULL AND (
        "type" IN ('CLOSE_SALE','CREATE_TASK','UPDATE_CUSTOMER','CREATE_EXPENSE','RECORD_PAYMENT') OR
        ("publishedTargetVersionId" IS NOT NULL AND "publishedVersionId" IS NOT NULL)
      )
    )
  );
COMMIT;
