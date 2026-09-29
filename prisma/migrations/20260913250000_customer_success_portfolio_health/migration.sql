-- CRM-52: carteira, planos de sucesso e health score versionado.
-- Migration estritamente aditiva; não altera objetos legados.

CREATE TYPE "CustomerPortfolioState" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'REVIEW_REQUIRED');
CREATE TYPE "SuccessPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "SuccessMilestoneStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');
CREATE TYPE "CustomerHealthRuleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "CustomerHealthSignalDirection" AS ENUM ('POSITIVE', 'NEGATIVE');
CREATE TYPE "CustomerHealthStatus" AS ENUM ('HEALTHY', 'ATTENTION', 'RISK', 'INSUFFICIENT');
CREATE TYPE "CustomerHealthFreshness" AS ENUM ('CURRENT', 'STALE', 'MISSING');
CREATE TYPE "CustomerSuccessEventType" AS ENUM ('PORTFOLIO_ASSIGNED', 'PORTFOLIO_REASSIGNED', 'NEXT_ACTION_UPDATED', 'PLAN_CREATED', 'PLAN_ACTIVATED', 'PLAN_BLOCKED', 'PLAN_COMPLETED', 'PLAN_CANCELLED', 'MILESTONE_COMPLETED', 'HEALTH_ASSESSED', 'HEALTH_SUPERSEDED');
CREATE TYPE "CustomerSuccessBackfillStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "CustomerSuccessBackfillOutcome" AS ENUM ('CREATED', 'SKIPPED', 'REVIEW_REQUIRED', 'CONFLICT');

CREATE TABLE "customer_portfolio_assignments" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "ownerMemberId" UUID,
  "teamId" UUID,
  "queueId" UUID,
  "state" "CustomerPortfolioState" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 2,
  "nextActionDescription" TEXT,
  "nextActionAt" TIMESTAMPTZ(3),
  "blockedReason" TEXT,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validTo" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "endedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_portfolio_owner_xor_queue_ck" CHECK (("ownerMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL)),
  CONSTRAINT "customer_portfolio_priority_ck" CHECK ("priority" BETWEEN 1 AND 3),
  CONSTRAINT "customer_portfolio_interval_ck" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom"),
  CONSTRAINT "customer_portfolio_active_action_ck" CHECK ("state" <> 'ACTIVE' OR ("nextActionDescription" IS NOT NULL AND "nextActionAt" IS NOT NULL))
);

CREATE TABLE "success_plan_templates" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currentVersionId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "success_plan_template_versions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CustomerHealthRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "objective" TEXT NOT NULL,
  "defaultDays" INTEGER NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "success_plan_template_version_positive_ck" CHECK ("version" > 0 AND "defaultDays" > 0)
);

CREATE TABLE "success_plan_template_milestones" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "templateVersionId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT TRUE,
  "dependencyKey" TEXT,
  "dueOffsetDays" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "success_plan_template_milestone_position_ck" CHECK ("position" > 0 AND "dueOffsetDays" >= 0)
);

CREATE TABLE "success_plans" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "templateVersionId" UUID,
  "ownerMemberId" UUID,
  "queueId" UUID,
  "title" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "status" "SuccessPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "targetAt" TIMESTAMPTZ(3) NOT NULL,
  "nextActionDescription" TEXT NOT NULL,
  "nextActionAt" TIMESTAMPTZ(3) NOT NULL,
  "blockedReason" TEXT,
  "templateSnapshot" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  CONSTRAINT "success_plan_owner_xor_queue_ck" CHECK (("ownerMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL)),
  CONSTRAINT "success_plan_dates_ck" CHECK ("targetAt" >= "startsAt"),
  CONSTRAINT "success_plan_blocked_reason_ck" CHECK ("status" <> 'BLOCKED' OR "blockedReason" IS NOT NULL)
);

CREATE TABLE "success_plan_milestones" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT TRUE,
  "dependencyKey" TEXT,
  "status" "SuccessMilestoneStatus" NOT NULL DEFAULT 'PENDING',
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "evidence" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "completedByActorId" UUID,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "success_plan_milestone_completion_ck" CHECK ("status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "completedByActorId" IS NOT NULL AND "evidence" IS NOT NULL))
);

CREATE TABLE "customer_health_rule_versions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CustomerHealthRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "healthyMinScore" INTEGER NOT NULL,
  "attentionMinScore" INTEGER NOT NULL,
  "observationWindowDays" INTEGER NOT NULL,
  "formula" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveTo" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_health_thresholds_ck" CHECK ("healthyMinScore" BETWEEN 1 AND 100 AND "attentionMinScore" BETWEEN 0 AND "healthyMinScore" AND "observationWindowDays" > 0),
  CONSTRAINT "customer_health_rule_interval_ck" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "customer_health_signal_definitions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "weight" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT FALSE,
  "direction" "CustomerHealthSignalDirection" NOT NULL,
  "freshnessDays" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_health_signal_weight_ck" CHECK ("weight" > 0 AND "weight" <= 100 AND "freshnessDays" > 0 AND "position" > 0)
);

CREATE TABLE "customer_health_assessments" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "CustomerHealthStatus" NOT NULL,
  "score" INTEGER,
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "missingSignalCount" INTEGER NOT NULL DEFAULT 0,
  "missingSignals" JSONB,
  "formula" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "supersedesId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "assessedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_health_score_ck" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
  CONSTRAINT "customer_health_missing_ck" CHECK ("evidenceCount" >= 0 AND "missingSignalCount" >= 0),
  CONSTRAINT "customer_health_insufficient_ck" CHECK (("status" = 'INSUFFICIENT' AND "score" IS NULL) OR ("status" <> 'INSUFFICIENT' AND "score" IS NOT NULL))
);

CREATE TABLE "customer_health_evidence" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "assessmentId" UUID NOT NULL,
  "signalDefinitionId" UUID NOT NULL,
  "sourceEntityType" TEXT NOT NULL,
  "sourceEntityId" TEXT,
  "factAt" TIMESTAMPTZ(3),
  "observedValue" INTEGER,
  "present" BOOLEAN NOT NULL,
  "freshness" "CustomerHealthFreshness" NOT NULL,
  "explanation" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_health_evidence_value_ck" CHECK ("observedValue" IS NULL OR "observedValue" BETWEEN 0 AND 100),
  CONSTRAINT "customer_health_evidence_missing_ck" CHECK (("freshness" = 'MISSING' AND "present" = FALSE AND "observedValue" IS NULL) OR "freshness" <> 'MISSING')
);

CREATE TABLE "customer_success_events" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "assignmentId" UUID,
  "planId" UUID,
  "milestoneId" UUID,
  "assessmentId" UUID,
  "sequence" INTEGER NOT NULL,
  "type" "CustomerSuccessEventType" NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "safeMetadata" JSONB,
  "actorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_success_event_sequence_ck" CHECK ("sequence" > 0)
);

CREATE TABLE "customer_success_backfill_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "CustomerSuccessBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "customer_success_backfill_mode_ck" CHECK ("mode" IN ('DRY_RUN', 'EXECUTE')),
  CONSTRAINT "customer_success_backfill_counts_ck" CHECK ("eligibleCount" >= 0 AND "createdCount" >= 0 AND "skippedCount" >= 0 AND "reviewCount" >= 0 AND "conflictCount" >= 0)
);

CREATE TABLE "customer_success_backfill_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "outcome" "CustomerSuccessBackfillOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "assignmentId" UUID,
  "safeEvidence" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "customer_portfolio_assignments_workspaceId_id_key" ON "customer_portfolio_assignments"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_portfolio_assignments_workspaceId_idempotencyKey_key" ON "customer_portfolio_assignments"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "customer_portfolio_current_account_key" ON "customer_portfolio_assignments"("workspaceId", "accountId") WHERE "validTo" IS NULL;
CREATE INDEX "customer_portfolio_assignments_workspaceId_accountId_state__idx" ON "customer_portfolio_assignments"("workspaceId", "accountId", "state", "validTo");
CREATE INDEX "customer_portfolio_assignments_workspaceId_ownerMemberId_st_idx" ON "customer_portfolio_assignments"("workspaceId", "ownerMemberId", "state", "nextActionAt");
CREATE INDEX "customer_portfolio_assignments_workspaceId_teamId_state_nex_idx" ON "customer_portfolio_assignments"("workspaceId", "teamId", "state", "nextActionAt");
CREATE INDEX "customer_portfolio_assignments_workspaceId_queueId_state_ne_idx" ON "customer_portfolio_assignments"("workspaceId", "queueId", "state", "nextActionAt");
CREATE UNIQUE INDEX "success_plan_templates_workspaceId_id_key" ON "success_plan_templates"("workspaceId", "id");
CREATE UNIQUE INDEX "success_plan_templates_workspaceId_key_key" ON "success_plan_templates"("workspaceId", "key");
CREATE INDEX "success_plan_templates_workspaceId_active_deletedAt_idx" ON "success_plan_templates"("workspaceId", "active", "deletedAt");
CREATE UNIQUE INDEX "success_plan_template_versions_workspaceId_id_key" ON "success_plan_template_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "success_plan_template_versions_workspaceId_templateId_versi_key" ON "success_plan_template_versions"("workspaceId", "templateId", "version");
CREATE INDEX "success_plan_template_versions_workspaceId_status_createdAt_idx" ON "success_plan_template_versions"("workspaceId", "status", "createdAt");
CREATE UNIQUE INDEX "success_plan_template_milestones_workspaceId_id_key" ON "success_plan_template_milestones"("workspaceId", "id");
CREATE UNIQUE INDEX "success_plan_template_milestones_workspaceId_templateVersio_key" ON "success_plan_template_milestones"("workspaceId", "templateVersionId", "key");
CREATE INDEX "success_plan_template_milestones_workspaceId_templateVersio_idx" ON "success_plan_template_milestones"("workspaceId", "templateVersionId", "position");
CREATE UNIQUE INDEX "success_plans_workspaceId_id_key" ON "success_plans"("workspaceId", "id");
CREATE UNIQUE INDEX "success_plans_workspaceId_idempotencyKey_key" ON "success_plans"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "success_plans_open_account_key" ON "success_plans"("workspaceId", "accountId") WHERE "status" IN ('DRAFT', 'ACTIVE', 'BLOCKED');
CREATE INDEX "success_plans_workspaceId_accountId_status_targetAt_idx" ON "success_plans"("workspaceId", "accountId", "status", "targetAt");
CREATE INDEX "success_plans_workspaceId_ownerMemberId_status_nextActionAt_idx" ON "success_plans"("workspaceId", "ownerMemberId", "status", "nextActionAt");
CREATE INDEX "success_plans_workspaceId_queueId_status_nextActionAt_idx" ON "success_plans"("workspaceId", "queueId", "status", "nextActionAt");
CREATE UNIQUE INDEX "success_plan_milestones_workspaceId_id_key" ON "success_plan_milestones"("workspaceId", "id");
CREATE UNIQUE INDEX "success_plan_milestones_workspaceId_planId_key_key" ON "success_plan_milestones"("workspaceId", "planId", "key");
CREATE INDEX "success_plan_milestones_workspaceId_planId_position_idx" ON "success_plan_milestones"("workspaceId", "planId", "position");
CREATE INDEX "success_plan_milestones_workspaceId_status_dueAt_idx" ON "success_plan_milestones"("workspaceId", "status", "dueAt");
CREATE UNIQUE INDEX "customer_health_rule_versions_workspaceId_id_key" ON "customer_health_rule_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_health_rule_versions_workspaceId_version_key" ON "customer_health_rule_versions"("workspaceId", "version");
CREATE INDEX "customer_health_rule_versions_workspaceId_status_effectiveF_idx" ON "customer_health_rule_versions"("workspaceId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "customer_health_signal_definitions_workspaceId_id_key" ON "customer_health_signal_definitions"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_health_signal_definitions_workspaceId_ruleVersionI_key" ON "customer_health_signal_definitions"("workspaceId", "ruleVersionId", "key");
CREATE INDEX "customer_health_signal_definitions_workspaceId_ruleVersionI_idx" ON "customer_health_signal_definitions"("workspaceId", "ruleVersionId", "position");
CREATE UNIQUE INDEX "customer_health_assessments_workspaceId_id_key" ON "customer_health_assessments"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_health_assessments_workspaceId_idempotencyKey_key" ON "customer_health_assessments"("workspaceId", "idempotencyKey");
CREATE INDEX "customer_health_assessments_workspaceId_accountId_cutoffAt_idx" ON "customer_health_assessments"("workspaceId", "accountId", "cutoffAt");
CREATE INDEX "customer_health_assessments_workspaceId_status_cutoffAt_idx" ON "customer_health_assessments"("workspaceId", "status", "cutoffAt");
CREATE UNIQUE INDEX "customer_health_evidence_workspaceId_id_key" ON "customer_health_evidence"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_health_evidence_workspaceId_assessmentId_signalDef_key" ON "customer_health_evidence"("workspaceId", "assessmentId", "signalDefinitionId");
CREATE INDEX "customer_health_evidence_workspaceId_assessmentId_freshness_idx" ON "customer_health_evidence"("workspaceId", "assessmentId", "freshness");
CREATE UNIQUE INDEX "customer_success_events_workspaceId_id_key" ON "customer_success_events"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_success_events_workspaceId_idempotencyKey_key" ON "customer_success_events"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "customer_success_events_workspaceId_accountId_sequence_key" ON "customer_success_events"("workspaceId", "accountId", "sequence");
CREATE UNIQUE INDEX "customer_success_backfill_runs_workspaceId_id_key" ON "customer_success_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_success_backfill_runs_workspaceId_runKey_key" ON "customer_success_backfill_runs"("workspaceId", "runKey");
CREATE UNIQUE INDEX "customer_success_backfill_items_workspaceId_id_key" ON "customer_success_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_success_backfill_items_workspaceId_runId_accountId_key" ON "customer_success_backfill_items"("workspaceId", "runId", "accountId");
CREATE INDEX "customer_success_backfill_items_workspaceId_outcome_created_idx" ON "customer_success_backfill_items"("workspaceId", "outcome", "createdAt");

ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_team_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_queue_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_portfolio_assignments" ADD CONSTRAINT "customer_portfolio_ended_actor_fkey" FOREIGN KEY ("workspaceId", "endedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "success_plan_templates" ADD CONSTRAINT "success_plan_templates_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "success_plan_template_versions" ADD CONSTRAINT "success_plan_versions_template_fkey" FOREIGN KEY ("workspaceId", "templateId") REFERENCES "success_plan_templates"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plan_template_milestones" ADD CONSTRAINT "success_plan_template_milestones_version_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "success_plan_template_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plan_templates" ADD CONSTRAINT "success_plan_templates_current_version_fkey" FOREIGN KEY ("workspaceId", "currentVersionId") REFERENCES "success_plan_template_versions"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "success_plans" ADD CONSTRAINT "success_plans_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plans" ADD CONSTRAINT "success_plans_assignment_fkey" FOREIGN KEY ("workspaceId", "assignmentId") REFERENCES "customer_portfolio_assignments"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plans" ADD CONSTRAINT "success_plans_template_version_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "success_plan_template_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plans" ADD CONSTRAINT "success_plans_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plans" ADD CONSTRAINT "success_plans_queue_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "success_plan_milestones" ADD CONSTRAINT "success_plan_milestones_plan_fkey" FOREIGN KEY ("workspaceId", "planId") REFERENCES "success_plans"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "customer_health_rule_versions" ADD CONSTRAINT "customer_health_rule_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_health_signal_definitions" ADD CONSTRAINT "customer_health_signals_rule_fkey" FOREIGN KEY ("workspaceId", "ruleVersionId") REFERENCES "customer_health_rule_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_health_assessments" ADD CONSTRAINT "customer_health_assessment_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_health_assessments" ADD CONSTRAINT "customer_health_assessment_rule_fkey" FOREIGN KEY ("workspaceId", "ruleVersionId") REFERENCES "customer_health_rule_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_health_assessments" ADD CONSTRAINT "customer_health_assessment_supersedes_fkey" FOREIGN KEY ("workspaceId", "supersedesId") REFERENCES "customer_health_assessments"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_health_evidence" ADD CONSTRAINT "customer_health_evidence_assessment_fkey" FOREIGN KEY ("workspaceId", "assessmentId") REFERENCES "customer_health_assessments"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_health_evidence" ADD CONSTRAINT "customer_health_evidence_signal_fkey" FOREIGN KEY ("workspaceId", "signalDefinitionId") REFERENCES "customer_health_signal_definitions"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "customer_success_events" ADD CONSTRAINT "customer_success_events_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_events" ADD CONSTRAINT "customer_success_events_assignment_fkey" FOREIGN KEY ("workspaceId", "assignmentId") REFERENCES "customer_portfolio_assignments"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_events" ADD CONSTRAINT "customer_success_events_plan_fkey" FOREIGN KEY ("workspaceId", "planId") REFERENCES "success_plans"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_events" ADD CONSTRAINT "customer_success_events_milestone_fkey" FOREIGN KEY ("workspaceId", "milestoneId") REFERENCES "success_plan_milestones"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_events" ADD CONSTRAINT "customer_success_events_assessment_fkey" FOREIGN KEY ("workspaceId", "assessmentId") REFERENCES "customer_health_assessments"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_backfill_runs" ADD CONSTRAINT "customer_success_backfill_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_backfill_items" ADD CONSTRAINT "customer_success_backfill_items_run_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "customer_success_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_success_backfill_items" ADD CONSTRAINT "customer_success_backfill_items_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;

CREATE FUNCTION crm52_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM-52 historical records are append-only';
END;
$$;

CREATE TRIGGER "customer_health_assessments_append_only" BEFORE UPDATE OR DELETE ON "customer_health_assessments" FOR EACH ROW EXECUTE FUNCTION crm52_reject_mutation();
CREATE TRIGGER "customer_health_evidence_append_only" BEFORE UPDATE OR DELETE ON "customer_health_evidence" FOR EACH ROW EXECUTE FUNCTION crm52_reject_mutation();
CREATE TRIGGER "customer_success_events_append_only" BEFORE UPDATE OR DELETE ON "customer_success_events" FOR EACH ROW EXECUTE FUNCTION crm52_reject_mutation();
CREATE TRIGGER "customer_success_backfill_items_append_only" BEFORE UPDATE OR DELETE ON "customer_success_backfill_items" FOR EACH ROW EXECUTE FUNCTION crm52_reject_mutation();
