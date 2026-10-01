-- Extend the existing confirmation ledger with conversational domain actions.
-- Configuration publications keep their immutable-version requirements.
BEGIN;
ALTER TABLE "ai_assistant_proposals"
  DROP CONSTRAINT "ai_assistant_proposals_type_check",
  DROP CONSTRAINT "ai_assistant_proposals_published_state_check",
  ADD CONSTRAINT "ai_assistant_proposals_type_check" CHECK (
    "type" IN ('AGENT','PIPELINE_MODEL','AUTOMATION','CHART',
      'CLOSE_SALE','CREATE_TASK','UPDATE_CUSTOMER','CREATE_EXPENSE','RECORD_PAYMENT','ACTION_PLAN','CREATE_LEAD','MOVE_LEAD','CREATE_CUSTOMER','CREATE_INCOME','CREATE_INDICATOR')
  ),
  ADD CONSTRAINT "ai_assistant_proposals_published_state_check" CHECK (
    "status" NOT IN ('PUBLISHED','UNDOING','UNDO_FAILED','UNDONE') OR (
      "publishedTargetType" IS NOT NULL AND "publishedTargetId" IS NOT NULL AND (
        "type" IN ('CLOSE_SALE','CREATE_TASK','UPDATE_CUSTOMER','CREATE_EXPENSE','RECORD_PAYMENT','ACTION_PLAN','CREATE_LEAD','MOVE_LEAD','CREATE_CUSTOMER','CREATE_INCOME','CREATE_INDICATOR') OR
        ("publishedTargetVersionId" IS NOT NULL AND "publishedVersionId" IS NOT NULL)
      )
    )
  );
COMMIT;
