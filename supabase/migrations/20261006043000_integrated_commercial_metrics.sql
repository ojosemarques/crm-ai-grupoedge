SET search_path TO crm, public;

BEGIN;

-- IND-006: razão analítico comercial append-only, backfill e reconciliação.
CREATE TYPE "CommercialMetricEventType" AS ENUM (
  'LEAD_CREATED','LEAD_SUBMISSION_ATTACHED','CONTACT_CREATED','CONTACT_POINT_VERIFIED','ACCOUNT_CREATED','ADVISOR_LINKED','LEAD_ASSIGNED','LEAD_REASSIGNED',
  'STAGE_ENTERED','STAGE_EXITED','LEAD_DISQUALIFIED','LEAD_CLOSED_NO_RESPONSE','LEAD_REOPENED','OPPORTUNITY_CREATED','PROPOSAL_REACHED','OPPORTUNITY_WON','OPPORTUNITY_LOST','OPPORTUNITY_REOPENED',
  'TASK_CREATED','TASK_STARTED','TASK_COMPLETED','TASK_CANCELLED','CALL_ATTEMPTED','CALL_CONNECTED','CALL_UNANSWERED','CALL_FAILED','INSTAGRAM_MESSAGE_SENT','INSTAGRAM_FOLLOW_COMPLETED',
  'INBOUND_MESSAGE_RECEIVED','HUMAN_RESPONSE_CONFIRMED','AUTO_RESPONSE_RECEIVED','EMAIL_SCHEDULED','EMAIL_CLAIMED','EMAIL_SENT','EMAIL_DELIVERED','EMAIL_REPLIED','EMAIL_BOUNCED','EMAIL_COMPLAINT','EMAIL_UNSUBSCRIBED','EMAIL_CANCELLED','EMAIL_EXPIRED','EMAIL_FAILED',
  'LEAD_QUALIFIED','PACTO_VALIDATED','MEETING_SCHEDULED','MEETING_RESCHEDULED','MEETING_CONFIRMED','MEETING_COMPLETED','MEETING_NO_SHOW','MEETING_CANCELLED',
  'SALE_WON','CONTRACT_ACCEPTED','SUBSCRIPTION_ACTIVATED','REVENUE_MOVEMENT_POSTED','INVOICE_ISSUED','PAYMENT_CONFIRMED','PAYMENT_REVERSED','CHURN_CONFIRMED','RENEWAL_DECIDED'
);
CREATE TYPE "CommercialMetricExecutionMode" AS ENUM ('MANUAL','AUTOMATION','SYSTEM');
CREATE TYPE "CommercialMetricBackfillMode" AS ENUM ('DRY_RUN','APPLY');
CREATE TYPE "CommercialMetricBackfillStatus" AS ENUM ('RUNNING','COMPLETED','PARTIAL','FAILED');
CREATE TYPE "CommercialMetricBackfillOutcome" AS ENUM ('CREATED','ALREADY_PRESENT','REVIEW_REQUIRED','SKIPPED','FAILED');
CREATE TYPE "CommercialMetricReconciliationStatus" AS ENUM ('RUNNING','COMPLETED','FAILED');
CREATE TYPE "CommercialMetricReconciliationState" AS ENUM ('MATCHED','DIVERGENT');

CREATE TABLE "commercial_metric_facts" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" "CommercialMetricEventType" NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceEntityType" TEXT NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "leadId" UUID,
  "contactId" UUID,
  "accountId" UUID,
  "taskId" UUID,
  "activityId" UUID,
  "messageId" UUID,
  "phoneCallId" UUID,
  "meetingId" UUID,
  "opportunityId" UUID,
  "contractId" UUID,
  "paymentId" UUID,
  "pipelineId" UUID,
  "stageId" UUID,
  "fromStageId" UUID,
  "toStageId" UUID,
  "teamId" UUID,
  "creditedMemberId" UUID,
  "performedByMemberId" UUID,
  "leadOwnerMemberIdAtEvent" UUID,
  "meetingOwnerMemberIdAtEvent" UUID,
  "opportunityOwnerMemberIdAtEvent" UUID,
  "bookedByMemberId" UUID,
  "originatingSdrMemberId" UUID,
  "sourceId" UUID,
  "campaignId" UUID,
  "creativeId" UUID,
  "politicalRole" TEXT,
  "municipality" TEXT,
  "stateCode" TEXT,
  "channel" TEXT,
  "direction" TEXT,
  "taskKind" TEXT,
  "activityType" TEXT,
  "result" TEXT,
  "cadenceInstanceId" UUID,
  "cadenceStepKey" TEXT,
  "cadenceDay" INTEGER,
  "executionMode" "CommercialMetricExecutionMode" NOT NULL DEFAULT 'SYSTEM',
  "valueCents" BIGINT,
  "durationSeconds" INTEGER,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "correctionOfFactId" UUID,
  "reversedAt" TIMESTAMPTZ(3),
  "reversalReason" TEXT,
  "definitionVersion" INTEGER NOT NULL DEFAULT 1,
  "producerVersion" TEXT NOT NULL DEFAULT 'indicators.v1',
  "inputFingerprint" TEXT NOT NULL,
  "safeMetadata" JSONB,
  CONSTRAINT "commercial_metric_facts_source_revision_check" CHECK ("sourceRevision" > 0),
  CONSTRAINT "commercial_metric_facts_definition_version_check" CHECK ("definitionVersion" > 0),
  CONSTRAINT "commercial_metric_facts_quantity_check" CHECK ("quantity" <> 0),
  CONSTRAINT "commercial_metric_facts_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0),
  CONSTRAINT "commercial_metric_facts_cadence_day_check" CHECK ("cadenceDay" IS NULL OR "cadenceDay" BETWEEN 1 AND 365),
  CONSTRAINT "commercial_metric_facts_reversal_check" CHECK (("correctionOfFactId" IS NULL AND "reversalReason" IS NULL) OR ("correctionOfFactId" IS NOT NULL AND "reversalReason" IS NOT NULL))
);

CREATE TABLE "commercial_metric_backfill_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "mode" "CommercialMetricBackfillMode" NOT NULL,
  "status" "CommercialMetricBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "ruleVersion" INTEGER NOT NULL DEFAULT 1,
  "inputFingerprint" TEXT NOT NULL,
  "cursor" TEXT,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "existingCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "requestedByActorId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  "summary" JSONB,
  CONSTRAINT "commercial_metric_backfill_runs_counts_check" CHECK (
    "ruleVersion" > 0 AND "eligibleCount" >= 0 AND "createdCount" >= 0 AND "existingCount" >= 0 AND "reviewCount" >= 0 AND "skippedCount" >= 0 AND "failedCount" >= 0
  )
);

CREATE TABLE "commercial_metric_backfill_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "sourceEntityType" TEXT NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "eventKey" TEXT NOT NULL,
  "outcome" "CommercialMetricBackfillOutcome" NOT NULL,
  "reasonCode" TEXT,
  "factId" UUID,
  "inputFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "commercial_metric_reconciliation_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "status" "CommercialMetricReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
  "ruleVersion" INTEGER NOT NULL DEFAULT 1,
  "expectedCount" INTEGER NOT NULL DEFAULT 0,
  "actualCount" INTEGER NOT NULL DEFAULT 0,
  "gapCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCheckCount" INTEGER NOT NULL DEFAULT 0,
  "divergentCheckCount" INTEGER NOT NULL DEFAULT 0,
  "requestedByActorId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  "summary" JSONB,
  CONSTRAINT "commercial_metric_reconciliation_runs_counts_check" CHECK (
    "ruleVersion" > 0 AND "expectedCount" >= 0 AND "actualCount" >= 0 AND "matchedCheckCount" >= 0 AND "divergentCheckCount" >= 0
  )
);

CREATE TABLE "commercial_metric_reconciliation_checks" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "sourceEntityType" TEXT NOT NULL,
  "eventType" "CommercialMetricEventType" NOT NULL,
  "state" "CommercialMetricReconciliationState" NOT NULL,
  "expectedCount" INTEGER NOT NULL,
  "actualCount" INTEGER NOT NULL,
  "gapCount" INTEGER NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_metric_reconciliation_checks_counts_check" CHECK ("expectedCount" >= 0 AND "actualCount" >= 0)
);

CREATE UNIQUE INDEX "commercial_metric_facts_workspace_id_key" ON "commercial_metric_facts"("workspaceId","id");
CREATE UNIQUE INDEX "commercial_metric_facts_workspace_event_key" ON "commercial_metric_facts"("workspaceId","eventKey");
CREATE INDEX "commercial_metric_facts_workspace_occurred_idx" ON "commercial_metric_facts"("workspaceId","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_type_occurred_idx" ON "commercial_metric_facts"("workspaceId","eventType","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_member_occurred_idx" ON "commercial_metric_facts"("workspaceId","creditedMemberId","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_stage_occurred_idx" ON "commercial_metric_facts"("workspaceId","pipelineId","stageId","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_channel_occurred_idx" ON "commercial_metric_facts"("workspaceId","channel","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_lead_occurred_idx" ON "commercial_metric_facts"("workspaceId","leadId","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_cadence_step_idx" ON "commercial_metric_facts"("workspaceId","cadenceStepKey","occurredAt");
CREATE INDEX "commercial_metric_facts_workspace_source_idx" ON "commercial_metric_facts"("workspaceId","sourceEntityType","sourceEntityId");
CREATE INDEX "commercial_metric_facts_workspace_geo_idx" ON "commercial_metric_facts"("workspaceId","stateCode","municipality","occurredAt");
CREATE UNIQUE INDEX "commercial_metric_backfill_runs_workspace_id_key" ON "commercial_metric_backfill_runs"("workspaceId","id");
CREATE UNIQUE INDEX "commercial_metric_backfill_runs_workspace_mode_fingerprint" ON "commercial_metric_backfill_runs"("workspaceId","mode","inputFingerprint");
CREATE INDEX "commercial_metric_backfill_runs_workspace_status_idx" ON "commercial_metric_backfill_runs"("workspaceId","status","startedAt");
CREATE UNIQUE INDEX "commercial_metric_backfill_items_workspace_id_key" ON "commercial_metric_backfill_items"("workspaceId","id");
CREATE UNIQUE INDEX "commercial_metric_backfill_items_workspace_run_event_key" ON "commercial_metric_backfill_items"("workspaceId","runId","eventKey");
CREATE INDEX "commercial_metric_backfill_items_workspace_outcome_idx" ON "commercial_metric_backfill_items"("workspaceId","runId","outcome");
CREATE INDEX "commercial_metric_backfill_items_workspace_source_idx" ON "commercial_metric_backfill_items"("workspaceId","sourceEntityType","sourceEntityId");
CREATE UNIQUE INDEX "commercial_metric_reconciliation_runs_workspace_id_key" ON "commercial_metric_reconciliation_runs"("workspaceId","id");
CREATE UNIQUE INDEX "commercial_metric_reconciliation_runs_workspace_run_key" ON "commercial_metric_reconciliation_runs"("workspaceId","runKey");
CREATE INDEX "commercial_metric_reconciliation_runs_workspace_status_idx" ON "commercial_metric_reconciliation_runs"("workspaceId","status","startedAt");
CREATE UNIQUE INDEX "commercial_metric_reconciliation_checks_workspace_id_key" ON "commercial_metric_reconciliation_checks"("workspaceId","id");
CREATE UNIQUE INDEX "commercial_metric_reconciliation_checks_workspace_run_source_event" ON "commercial_metric_reconciliation_checks"("workspaceId","runId","sourceEntityType","eventType");
CREATE INDEX "commercial_metric_reconciliation_checks_workspace_state_idx" ON "commercial_metric_reconciliation_checks"("workspaceId","runId","state");

ALTER TABLE "commercial_metric_facts" ADD CONSTRAINT "commercial_metric_facts_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_facts" ADD CONSTRAINT "commercial_metric_facts_correction_fk" FOREIGN KEY ("workspaceId","correctionOfFactId") REFERENCES "commercial_metric_facts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_backfill_runs" ADD CONSTRAINT "commercial_metric_backfill_runs_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_backfill_runs" ADD CONSTRAINT "commercial_metric_backfill_runs_actor_fk" FOREIGN KEY ("workspaceId","requestedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_backfill_items" ADD CONSTRAINT "commercial_metric_backfill_items_run_fk" FOREIGN KEY ("workspaceId","runId") REFERENCES "commercial_metric_backfill_runs"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_backfill_items" ADD CONSTRAINT "commercial_metric_backfill_items_fact_fk" FOREIGN KEY ("workspaceId","factId") REFERENCES "commercial_metric_facts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_reconciliation_runs" ADD CONSTRAINT "commercial_metric_reconciliation_runs_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_reconciliation_runs" ADD CONSTRAINT "commercial_metric_reconciliation_runs_actor_fk" FOREIGN KEY ("workspaceId","requestedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "commercial_metric_reconciliation_checks" ADD CONSTRAINT "commercial_metric_reconciliation_checks_run_fk" FOREIGN KEY ("workspaceId","runId") REFERENCES "commercial_metric_reconciliation_runs"("workspaceId","id") ON DELETE RESTRICT;

CREATE FUNCTION "block_commercial_metric_fact_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial_metric_facts is append-only; record a correcting fact instead';
END;
$$;
CREATE TRIGGER "commercial_metric_facts_append_only"
  BEFORE UPDATE OR DELETE ON "commercial_metric_facts"
  FOR EACH ROW EXECUTE FUNCTION "block_commercial_metric_fact_mutation"();
REVOKE ALL ON FUNCTION "block_commercial_metric_fact_mutation"() FROM PUBLIC;

ALTER TABLE "commercial_metric_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_metric_backfill_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_metric_backfill_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_metric_reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_metric_reconciliation_checks" ENABLE ROW LEVEL SECURITY;

DO $migration$
DECLARE
  target_schema TEXT := current_schema();
  target_table TEXT;
  active_workspace TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    RETURN;
  END IF;

  active_workspace := format('"workspaceId" IN (SELECT id FROM %I.workspaces WHERE status = ''ACTIVE'' AND "deletedAt" IS NULL)', target_schema);
  GRANT SELECT, INSERT ON "commercial_metric_facts" TO crm_politizai_runtime;
  GRANT SELECT, INSERT, UPDATE ON
    "commercial_metric_backfill_runs", "commercial_metric_backfill_items",
    "commercial_metric_reconciliation_runs", "commercial_metric_reconciliation_checks"
    TO crm_politizai_runtime;

  FOREACH target_table IN ARRAY ARRAY[
    'commercial_metric_facts', 'commercial_metric_backfill_runs',
    'commercial_metric_backfill_items', 'commercial_metric_reconciliation_runs',
    'commercial_metric_reconciliation_checks'
  ] LOOP
    EXECUTE format('CREATE POLICY company_runtime_select ON %I.%I FOR SELECT TO crm_politizai_runtime USING (%s)', target_schema, target_table, active_workspace);
    EXECUTE format('CREATE POLICY company_runtime_insert ON %I.%I FOR INSERT TO crm_politizai_runtime WITH CHECK (%s)', target_schema, target_table, active_workspace);
  END LOOP;

  FOREACH target_table IN ARRAY ARRAY[
    'commercial_metric_backfill_runs', 'commercial_metric_backfill_items',
    'commercial_metric_reconciliation_runs', 'commercial_metric_reconciliation_checks'
  ] LOOP
    EXECUTE format('CREATE POLICY company_runtime_update ON %I.%I FOR UPDATE TO crm_politizai_runtime USING (%s) WITH CHECK (%s)', target_schema, target_table, active_workspace, active_workspace);
  END LOOP;
END
$migration$;

REVOKE ALL ON TABLE "commercial_metric_facts", "commercial_metric_backfill_runs", "commercial_metric_backfill_items", "commercial_metric_reconciliation_runs", "commercial_metric_reconciliation_checks" FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'commercial_metric_facts', role_name);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'commercial_metric_backfill_runs', role_name);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'commercial_metric_backfill_items', role_name);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'commercial_metric_reconciliation_runs', role_name);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'commercial_metric_reconciliation_checks', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
