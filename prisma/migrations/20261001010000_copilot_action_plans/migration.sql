-- Approval of bounded operational plans reuses the existing proposal ledger.
-- Configuration publications keep their immutable-version requirements.
BEGIN;
ALTER TABLE "ai_assistant_proposals"
  DROP CONSTRAINT "ai_assistant_proposals_type_check",
  DROP CONSTRAINT "ai_assistant_proposals_published_state_check",
  ADD CONSTRAINT "ai_assistant_proposals_type_check" CHECK (
    "type" IN ('AGENT','PIPELINE_MODEL','AUTOMATION','CHART',
      'CLOSE_SALE','CREATE_TASK','UPDATE_CUSTOMER','CREATE_EXPENSE','RECORD_PAYMENT','ACTION_PLAN')
  ),
  ADD CONSTRAINT "ai_assistant_proposals_published_state_check" CHECK (
    "status" NOT IN ('PUBLISHED','UNDOING','UNDO_FAILED','UNDONE') OR (
      "publishedTargetType" IS NOT NULL AND "publishedTargetId" IS NOT NULL AND (
        "type" IN ('CLOSE_SALE','CREATE_TASK','UPDATE_CUSTOMER','CREATE_EXPENSE','RECORD_PAYMENT','ACTION_PLAN') OR
        ("publishedTargetVersionId" IS NOT NULL AND "publishedVersionId" IS NOT NULL)
      )
    )
  );
COMMIT;
