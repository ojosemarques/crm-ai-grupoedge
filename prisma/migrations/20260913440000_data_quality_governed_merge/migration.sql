-- CRM-61: qualidade de dados, reconciliação e merge governado.
-- Migration estritamente aditiva. Nenhum registro existente é mesclado.

CREATE TYPE "DataQualityDimension" AS ENUM ('COMPLETENESS', 'VALIDITY', 'CONSISTENCY', 'UNIQUENESS', 'REFERENTIAL_INTEGRITY', 'FRESHNESS', 'CONSENT', 'ATTRIBUTION', 'FINANCIAL_RECONCILIATION');
CREATE TYPE "DataQualityRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED');
CREATE TYPE "DataQualitySeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');
CREATE TYPE "DataQualityIssueEventType" AS ENUM ('DETECTED', 'REOPENED', 'ASSIGNED', 'COMMENTED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "DataQualityScanMode" AS ENUM ('DRY_RUN', 'EXECUTE');
CREATE TYPE "DataQualityScanStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'MISSING', 'STALE', 'PARTIAL', 'UNAVAILABLE');
CREATE TYPE "DuplicateStrength" AS ENUM ('STRONG', 'POSSIBLE', 'INSUFFICIENT');
CREATE TYPE "DuplicateDecisionStatus" AS ENUM ('OPEN', 'NOT_DUPLICATE', 'MERGE_PLANNED', 'MERGED');
CREATE TYPE "MergeEntityType" AS ENUM ('CONTACT', 'ACCOUNT');
CREATE TYPE "MergePlanStatus" AS ENUM ('DRAFT', 'READY', 'APPLIED', 'REVERSED', 'BLOCKED');
CREATE TYPE "MergeExecutionType" AS ENUM ('APPLY', 'ROLLBACK');

ALTER TABLE "accounts" ADD COLUMN "mergedIntoAccountId" UUID;
CREATE INDEX "accounts_workspace_merged_into_idx" ON "accounts"("workspaceId", "mergedIntoAccountId");
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_merged_into_fkey" FOREIGN KEY ("workspaceId", "mergedIntoAccountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_no_self_merge_check" CHECK ("mergedIntoAccountId" IS NULL OR "mergedIntoAccountId" <> "id");

CREATE TABLE "data_quality_rule_versions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "entityType" TEXT NOT NULL,
  "fieldPath" TEXT,
  "dimension" "DataQualityDimension" NOT NULL,
  "severity" "DataQualitySeverity" NOT NULL,
  "status" "DataQualityRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "conditionKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "remediation" TEXT NOT NULL,
  "ownerMemberId" UUID,
  "queueId" UUID,
  "slaSeconds" INTEGER,
  "scope" JSONB,
  "evidencePolicy" JSONB NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "approvedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_quality_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dq_rule_responsible_check" CHECK (("ownerMemberId" IS NOT NULL)::int + ("queueId" IS NOT NULL)::int = 1),
  CONSTRAINT "dq_rule_sla_check" CHECK ("slaSeconds" IS NULL OR "slaSeconds" >= 0)
);
CREATE UNIQUE INDEX "dq_rules_workspace_id_key" ON "data_quality_rule_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "dq_rules_workspace_key_version_key" ON "data_quality_rule_versions"("workspaceId", "key", "version");
CREATE INDEX "dq_rules_status_dimension_entity_idx" ON "data_quality_rule_versions"("workspaceId", "status", "dimension", "entityType");
CREATE INDEX "dq_rules_owner_status_idx" ON "data_quality_rule_versions"("workspaceId", "ownerMemberId", "status");
CREATE INDEX "dq_rules_queue_status_idx" ON "data_quality_rule_versions"("workspaceId", "queueId", "status");

CREATE TABLE "data_quality_scan_runs" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "mode" "DataQualityScanMode" NOT NULL,
  "status" "DataQualityScanStatus" NOT NULL DEFAULT 'RUNNING',
  "idempotencyKey" TEXT NOT NULL,
  "requestedByActorId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3),
  "checkpoint" TEXT,
  "scannedCount" INTEGER NOT NULL DEFAULT 0,
  "detectedCount" INTEGER NOT NULL DEFAULT 0,
  "reopenedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "result" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_quality_scan_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dq_scan_workspace_id_key" ON "data_quality_scan_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "dq_scan_workspace_idempotency_key" ON "data_quality_scan_runs"("workspaceId", "idempotencyKey");
CREATE INDEX "dq_scan_status_started_idx" ON "data_quality_scan_runs"("workspaceId", "status", "startedAt");

CREATE TABLE "data_quality_issues" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "observedFingerprint" TEXT NOT NULL,
  "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "DataQualitySeverity" NOT NULL,
  "impactScore" INTEGER NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL,
  "evidenceSummary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "ownerMemberId" UUID,
  "queueId" UUID,
  "detectedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL,
  "dueAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedByActorId" UUID,
  "resolutionReason" TEXT,
  "correlationId" TEXT,
  "causationId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "data_quality_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dq_issue_responsible_check" CHECK (("ownerMemberId" IS NOT NULL)::int + ("queueId" IS NOT NULL)::int = 1),
  CONSTRAINT "dq_issue_impact_check" CHECK ("impactScore" BETWEEN 0 AND 100),
  CONSTRAINT "dq_issue_priority_check" CHECK ("priority" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "dq_issues_workspace_id_key" ON "data_quality_issues"("workspaceId", "id");
CREATE UNIQUE INDEX "dq_issues_workspace_fingerprint_key" ON "data_quality_issues"("workspaceId", "fingerprint");
CREATE INDEX "dq_issues_status_severity_priority_idx" ON "data_quality_issues"("workspaceId", "status", "severity", "priority", "detectedAt");
CREATE INDEX "dq_issues_rule_status_idx" ON "data_quality_issues"("workspaceId", "ruleVersionId", "status", "detectedAt");
CREATE INDEX "dq_issues_entity_status_idx" ON "data_quality_issues"("workspaceId", "entityType", "entityId", "status");
CREATE INDEX "dq_issues_owner_due_idx" ON "data_quality_issues"("workspaceId", "ownerMemberId", "status", "dueAt");
CREATE INDEX "dq_issues_queue_due_idx" ON "data_quality_issues"("workspaceId", "queueId", "status", "dueAt");

CREATE TABLE "data_quality_issue_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "issueId" UUID NOT NULL,
  "type" "DataQualityIssueEventType" NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "previousStatus" "DataQualityIssueStatus",
  "nextStatus" "DataQualityIssueStatus",
  "details" JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_quality_issue_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dq_issue_events_workspace_id_key" ON "data_quality_issue_events"("workspaceId", "id");
CREATE INDEX "dq_issue_events_issue_timeline_idx" ON "data_quality_issue_events"("workspaceId", "issueId", "occurredAt");
CREATE INDEX "dq_issue_events_actor_idx" ON "data_quality_issue_events"("workspaceId", "actorId", "occurredAt");

CREATE TABLE "data_reconciliation_results" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "reconciliationKey" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID,
  "sourceSystem" TEXT NOT NULL,
  "targetSystem" TEXT NOT NULL,
  "status" "ReconciliationStatus" NOT NULL,
  "discrepancyCode" TEXT,
  "summary" TEXT NOT NULL,
  "canonicalSource" TEXT NOT NULL,
  "precedenceRule" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_reconciliation_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dq_reconciliation_workspace_id_key" ON "data_reconciliation_results"("workspaceId", "id");
CREATE INDEX "dq_reconciliation_key_status_idx" ON "data_reconciliation_results"("workspaceId", "reconciliationKey", "status", "asOf");
CREATE INDEX "dq_reconciliation_entity_idx" ON "data_reconciliation_results"("workspaceId", "entityType", "entityId", "asOf");

CREATE TABLE "duplicate_candidates" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "entityType" "MergeEntityType" NOT NULL,
  "leftEntityId" UUID NOT NULL,
  "rightEntityId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "strength" "DuplicateStrength" NOT NULL,
  "confidenceBps" INTEGER,
  "status" "DuplicateDecisionStatus" NOT NULL DEFAULT 'OPEN',
  "evidence" JSONB NOT NULL,
  "detectedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3),
  "decidedByActorId" UUID,
  "decisionReason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "duplicate_pair_order_check" CHECK ("leftEntityId"::text < "rightEntityId"::text),
  CONSTRAINT "duplicate_confidence_check" CHECK ("confidenceBps" IS NULL OR "confidenceBps" BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX "duplicate_candidates_workspace_id_key" ON "duplicate_candidates"("workspaceId", "id");
CREATE UNIQUE INDEX "duplicate_candidates_workspace_fingerprint_key" ON "duplicate_candidates"("workspaceId", "fingerprint");
CREATE INDEX "duplicate_candidates_status_idx" ON "duplicate_candidates"("workspaceId", "entityType", "status", "strength", "detectedAt");
CREATE INDEX "duplicate_candidates_pair_idx" ON "duplicate_candidates"("workspaceId", "leftEntityId", "rightEntityId");

CREATE TABLE "merge_plans" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "candidateId" UUID,
  "entityType" "MergeEntityType" NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "survivorEntityId" UUID NOT NULL,
  "status" "MergePlanStatus" NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT NOT NULL,
  "previewFingerprint" TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "survivorRevision" TEXT NOT NULL,
  "blockedReasons" JSONB,
  "createdByActorId" UUID NOT NULL,
  "appliedByActorId" UUID,
  "appliedAt" TIMESTAMPTZ(3),
  "reversedByActorId" UUID,
  "reversedAt" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "merge_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merge_plan_distinct_entities_check" CHECK ("sourceEntityId" <> "survivorEntityId")
);
CREATE UNIQUE INDEX "merge_plans_workspace_id_key" ON "merge_plans"("workspaceId", "id");
CREATE INDEX "merge_plans_status_idx" ON "merge_plans"("workspaceId", "entityType", "status", "createdAt");
CREATE INDEX "merge_plans_candidate_idx" ON "merge_plans"("workspaceId", "candidateId", "status");
CREATE INDEX "merge_plans_entities_idx" ON "merge_plans"("workspaceId", "sourceEntityId", "survivorEntityId");

CREATE TABLE "merge_field_decisions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "mergePlanId" UUID NOT NULL,
  "fieldPath" TEXT NOT NULL,
  "sourceValue" JSONB,
  "survivorValue" JSONB,
  "selectedValue" JSONB,
  "strategy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merge_field_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "merge_field_decisions_workspace_id_key" ON "merge_field_decisions"("workspaceId", "id");
CREATE UNIQUE INDEX "merge_field_decisions_plan_field_key" ON "merge_field_decisions"("workspaceId", "mergePlanId", "fieldPath");
CREATE INDEX "merge_field_decisions_plan_idx" ON "merge_field_decisions"("workspaceId", "mergePlanId");

CREATE TABLE "merge_executions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "mergePlanId" UUID NOT NULL,
  "type" "MergeExecutionType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "survivorSnapshot" JSONB NOT NULL,
  "relationLedger" JSONB NOT NULL,
  "preconditionFingerprint" TEXT NOT NULL,
  "resultFingerprint" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merge_executions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "merge_executions_workspace_id_key" ON "merge_executions"("workspaceId", "id");
CREATE UNIQUE INDEX "merge_executions_workspace_idempotency_key" ON "merge_executions"("workspaceId", "idempotencyKey");
CREATE INDEX "merge_executions_plan_timeline_idx" ON "merge_executions"("workspaceId", "mergePlanId", "occurredAt");

ALTER TABLE "data_quality_rule_versions" ADD CONSTRAINT "dq_rules_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_rule_versions" ADD CONSTRAINT "dq_rules_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_rule_versions" ADD CONSTRAINT "dq_rules_queue_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_rule_versions" ADD CONSTRAINT "dq_rules_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_rule_versions" ADD CONSTRAINT "dq_rules_approved_actor_fkey" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_scan_runs" ADD CONSTRAINT "dq_scan_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_scan_runs" ADD CONSTRAINT "dq_scan_actor_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "dq_issue_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "dq_issue_rule_fkey" FOREIGN KEY ("workspaceId", "ruleVersionId") REFERENCES "data_quality_rule_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "dq_issue_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "dq_issue_queue_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "dq_issue_resolved_actor_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issue_events" ADD CONSTRAINT "dq_issue_event_issue_fkey" FOREIGN KEY ("workspaceId", "issueId") REFERENCES "data_quality_issues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_quality_issue_events" ADD CONSTRAINT "dq_issue_event_actor_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_reconciliation_results" ADD CONSTRAINT "dq_reconciliation_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "data_reconciliation_results" ADD CONSTRAINT "dq_reconciliation_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidate_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidate_decided_actor_fkey" FOREIGN KEY ("workspaceId", "decidedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_plans" ADD CONSTRAINT "merge_plan_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "merge_plans" ADD CONSTRAINT "merge_plan_candidate_fkey" FOREIGN KEY ("workspaceId", "candidateId") REFERENCES "duplicate_candidates"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_plans" ADD CONSTRAINT "merge_plan_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_plans" ADD CONSTRAINT "merge_plan_applied_actor_fkey" FOREIGN KEY ("workspaceId", "appliedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_plans" ADD CONSTRAINT "merge_plan_reversed_actor_fkey" FOREIGN KEY ("workspaceId", "reversedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_field_decisions" ADD CONSTRAINT "merge_field_decision_plan_fkey" FOREIGN KEY ("workspaceId", "mergePlanId") REFERENCES "merge_plans"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_executions" ADD CONSTRAINT "merge_execution_plan_fkey" FOREIGN KEY ("workspaceId", "mergePlanId") REFERENCES "merge_plans"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "merge_executions" ADD CONSTRAINT "merge_execution_actor_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

CREATE FUNCTION "prevent_data_quality_append_only_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CRM-61 append-only record cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dq_issue_events_append_only" BEFORE UPDATE OR DELETE ON "data_quality_issue_events" FOR EACH ROW EXECUTE FUNCTION "prevent_data_quality_append_only_mutation"();
CREATE TRIGGER "dq_reconciliation_append_only" BEFORE UPDATE OR DELETE ON "data_reconciliation_results" FOR EACH ROW EXECUTE FUNCTION "prevent_data_quality_append_only_mutation"();
CREATE TRIGGER "merge_executions_append_only" BEFORE UPDATE OR DELETE ON "merge_executions" FOR EACH ROW EXECUTE FUNCTION "prevent_data_quality_append_only_mutation"();

CREATE FUNCTION "protect_data_quality_rule_definition"() RETURNS trigger AS $$
BEGIN
  IF OLD."key" IS DISTINCT FROM NEW."key"
    OR OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."entityType" IS DISTINCT FROM NEW."entityType"
    OR OLD."fieldPath" IS DISTINCT FROM NEW."fieldPath"
    OR OLD."dimension" IS DISTINCT FROM NEW."dimension"
    OR OLD."severity" IS DISTINCT FROM NEW."severity"
    OR OLD."conditionKey" IS DISTINCT FROM NEW."conditionKey"
    OR OLD."title" IS DISTINCT FROM NEW."title"
    OR OLD."description" IS DISTINCT FROM NEW."description"
    OR OLD."remediation" IS DISTINCT FROM NEW."remediation"
    OR OLD."slaSeconds" IS DISTINCT FROM NEW."slaSeconds"
    OR OLD."scope" IS DISTINCT FROM NEW."scope"
    OR OLD."evidencePolicy" IS DISTINCT FROM NEW."evidencePolicy"
  THEN
    RAISE EXCEPTION 'CRM-61 published rule definitions are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "dq_rule_definition_immutable" BEFORE UPDATE ON "data_quality_rule_versions" FOR EACH ROW WHEN (OLD."status" <> 'DRAFT') EXECUTE FUNCTION "protect_data_quality_rule_definition"();
