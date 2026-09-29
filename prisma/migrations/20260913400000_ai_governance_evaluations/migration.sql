-- CRM-59: governança versionada, rastreabilidade e avaliações locais de IA.
-- Migration estritamente aditiva; não ativa provedor externo nem altera fatos comerciais.

CREATE TYPE "AIGovernanceStatus" AS ENUM ('DRAFT', 'EVALUATED', 'APPROVED', 'DISABLED');
CREATE TYPE "AIRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "AIExecutionStatus" AS ENUM ('REQUESTED', 'RUNNING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'FALLBACK');
CREATE TYPE "AIHumanDecisionType" AS ENUM ('ACCEPTED', 'EDITED', 'REJECTED');
CREATE TYPE "AIEvaluationStatus" AS ENUM ('RUNNING', 'PASSED', 'FAILED');

CREATE TABLE "ai_use_case_versions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "ownerMemberId" UUID NOT NULL,
  "riskLevel" "AIRiskLevel" NOT NULL,
  "agentType" "AIAgentType" NOT NULL,
  "logicalProviderKey" TEXT NOT NULL,
  "logicalModel" TEXT NOT NULL,
  "promptKey" TEXT NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "configurationVersion" INTEGER NOT NULL,
  "inputSchemaVersion" INTEGER NOT NULL,
  "outputSchemaVersion" INTEGER NOT NULL,
  "allowedInputFields" JSONB NOT NULL,
  "forbiddenInputFields" JSONB NOT NULL,
  "confidenceThresholdBps" INTEGER NOT NULL,
  "fallbackPolicy" TEXT NOT NULL,
  "timeoutMs" INTEGER NOT NULL,
  "maxRetries" INTEGER NOT NULL,
  "rateLimitPerMinute" INTEGER NOT NULL,
  "maxInputTokens" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "maxEstimatedCostCents" INTEGER NOT NULL,
  "status" "AIGovernanceStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedByActorId" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "approvalReason" TEXT,
  "supersedesVersionId" UUID,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_use_case_version_numbers_ck" CHECK ("version" > 0 AND "promptVersion" > 0 AND "configurationVersion" > 0 AND "inputSchemaVersion" > 0 AND "outputSchemaVersion" > 0),
  CONSTRAINT "ai_use_case_confidence_ck" CHECK ("confidenceThresholdBps" BETWEEN 0 AND 10000),
  CONSTRAINT "ai_use_case_limits_ck" CHECK ("timeoutMs" BETWEEN 100 AND 120000 AND "maxRetries" BETWEEN 0 AND 3 AND "rateLimitPerMinute" BETWEEN 1 AND 10000 AND "maxInputTokens" BETWEEN 1 AND 100000 AND "maxOutputTokens" BETWEEN 1 AND 100000 AND "maxEstimatedCostCents" >= 0),
  CONSTRAINT "ai_use_case_key_ck" CHECK ("key" ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  CONSTRAINT "ai_use_case_approval_ck" CHECK (("status" = 'APPROVED' AND "approvedByActorId" IS NOT NULL AND "approvedAt" IS NOT NULL AND length("approvalReason") >= 3) OR "status" <> 'APPROVED')
);

CREATE TABLE "ai_governance_events" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "useCaseVersionId" UUID NOT NULL,
  "fromStatus" "AIGovernanceStatus",
  "toStatus" "AIGovernanceStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "rollbackTargetVersionId" UUID,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_governance_reason_ck" CHECK (length("reason") >= 3)
);

CREATE TABLE "ai_execution_traces" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "useCaseVersionId" UUID NOT NULL,
  "aiInsightId" UUID,
  "status" "AIExecutionStatus" NOT NULL DEFAULT 'REQUESTED',
  "targetType" "InsightTargetType" NOT NULL,
  "targetId" UUID NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "inputFingerprint" CHAR(64) NOT NULL,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptKey" TEXT NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "configurationVersion" INTEGER NOT NULL,
  "allowedFieldCount" INTEGER NOT NULL,
  "blockedFieldCount" INTEGER NOT NULL,
  "redactionMetadata" JSONB NOT NULL,
  "confidenceBps" INTEGER,
  "durationMs" INTEGER,
  "estimatedInputTokens" INTEGER NOT NULL,
  "estimatedOutputTokens" INTEGER,
  "estimatedCostCents" INTEGER,
  "providerFailureCode" TEXT,
  "fallbackReason" TEXT,
  "requestedByActorId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_execution_counts_ck" CHECK ("allowedFieldCount" >= 0 AND "blockedFieldCount" >= 0 AND "estimatedInputTokens" >= 0 AND ("estimatedOutputTokens" IS NULL OR "estimatedOutputTokens" >= 0) AND ("estimatedCostCents" IS NULL OR "estimatedCostCents" >= 0)),
  CONSTRAINT "ai_execution_metrics_ck" CHECK (("confidenceBps" IS NULL OR "confidenceBps" BETWEEN 0 AND 10000) AND ("durationMs" IS NULL OR "durationMs" >= 0))
);

CREATE TABLE "ai_human_decisions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "executionTraceId" UUID NOT NULL,
  "aiInsightId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "decision" "AIHumanDecisionType" NOT NULL,
  "reason" TEXT NOT NULL,
  "proposedDraft" JSONB,
  "originalInputFingerprint" CHAR(64) NOT NULL,
  "currentInputFingerprint" CHAR(64) NOT NULL,
  "stale" BOOLEAN NOT NULL DEFAULT false,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_human_decision_reason_ck" CHECK (length("reason") >= 3)
);

CREATE TABLE "ai_evaluation_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "useCaseVersionId" UUID NOT NULL,
  "datasetKey" TEXT NOT NULL,
  "datasetVersion" INTEGER NOT NULL,
  "status" "AIEvaluationStatus" NOT NULL DEFAULT 'RUNNING',
  "totalCases" INTEGER NOT NULL,
  "passedCases" INTEGER NOT NULL,
  "failedCases" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "inputFingerprint" CHAR(64) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ai_evaluation_counts_ck" CHECK ("datasetVersion" > 0 AND "totalCases" >= 0 AND "passedCases" >= 0 AND "failedCases" >= 0 AND "passedCases" + "failedCases" = "totalCases" AND "durationMs" >= 0)
);

CREATE TABLE "ai_evaluation_results" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "caseKey" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "safeEvidence" JSONB,
  "durationMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_result_duration_ck" CHECK ("durationMs" >= 0)
);

CREATE UNIQUE INDEX "ai_use_case_versions_workspace_id_key" ON "ai_use_case_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "ai_use_case_versions_workspace_key_version_key" ON "ai_use_case_versions"("workspaceId", "key", "version");
CREATE INDEX "ai_use_case_versions_workspace_key_status_version_idx" ON "ai_use_case_versions"("workspaceId", "key", "status", "version");
CREATE INDEX "ai_use_case_versions_workspace_owner_status_idx" ON "ai_use_case_versions"("workspaceId", "ownerMemberId", "status");
CREATE UNIQUE INDEX "ai_governance_events_workspace_id_key" ON "ai_governance_events"("workspaceId", "id");
CREATE INDEX "ai_governance_events_workspace_version_created_idx" ON "ai_governance_events"("workspaceId", "useCaseVersionId", "createdAt");
CREATE UNIQUE INDEX "ai_execution_traces_workspace_id_key" ON "ai_execution_traces"("workspaceId", "id");
CREATE INDEX "ai_execution_traces_workspace_version_status_created_idx" ON "ai_execution_traces"("workspaceId", "useCaseVersionId", "status", "createdAt");
CREATE INDEX "ai_execution_traces_workspace_target_created_idx" ON "ai_execution_traces"("workspaceId", "targetType", "targetId", "createdAt");
CREATE INDEX "ai_execution_traces_workspace_provider_status_created_idx" ON "ai_execution_traces"("workspaceId", "providerKey", "status", "createdAt");
CREATE UNIQUE INDEX "ai_human_decisions_workspace_id_key" ON "ai_human_decisions"("workspaceId", "id");
CREATE UNIQUE INDEX "ai_human_decisions_workspace_idempotency_key" ON "ai_human_decisions"("workspaceId", "idempotencyKey");
CREATE INDEX "ai_human_decisions_workspace_trace_created_idx" ON "ai_human_decisions"("workspaceId", "executionTraceId", "createdAt");
CREATE INDEX "ai_human_decisions_workspace_decision_stale_created_idx" ON "ai_human_decisions"("workspaceId", "decision", "stale", "createdAt");
CREATE UNIQUE INDEX "ai_evaluation_runs_workspace_id_key" ON "ai_evaluation_runs"("workspaceId", "id");
CREATE INDEX "ai_evaluation_runs_workspace_version_status_created_idx" ON "ai_evaluation_runs"("workspaceId", "useCaseVersionId", "status", "createdAt");
CREATE UNIQUE INDEX "ai_evaluation_results_workspace_id_key" ON "ai_evaluation_results"("workspaceId", "id");
CREATE UNIQUE INDEX "ai_evaluation_results_workspace_run_case_key" ON "ai_evaluation_results"("workspaceId", "runId", "caseKey");
CREATE INDEX "ai_evaluation_results_workspace_category_passed_created_idx" ON "ai_evaluation_results"("workspaceId", "category", "passed", "createdAt");

ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_owner_fk" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_approved_actor_fk" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_use_case_versions" ADD CONSTRAINT "ai_use_case_supersedes_fk" FOREIGN KEY ("workspaceId", "supersedesVersionId") REFERENCES "ai_use_case_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_governance_events" ADD CONSTRAINT "ai_governance_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_governance_events" ADD CONSTRAINT "ai_governance_version_fk" FOREIGN KEY ("workspaceId", "useCaseVersionId") REFERENCES "ai_use_case_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_governance_events" ADD CONSTRAINT "ai_governance_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_execution_traces" ADD CONSTRAINT "ai_execution_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_execution_traces" ADD CONSTRAINT "ai_execution_version_fk" FOREIGN KEY ("workspaceId", "useCaseVersionId") REFERENCES "ai_use_case_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_execution_traces" ADD CONSTRAINT "ai_execution_insight_fk" FOREIGN KEY ("workspaceId", "aiInsightId") REFERENCES "ai_insights"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_execution_traces" ADD CONSTRAINT "ai_execution_actor_fk" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_human_decisions" ADD CONSTRAINT "ai_human_decision_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_human_decisions" ADD CONSTRAINT "ai_human_decision_trace_fk" FOREIGN KEY ("workspaceId", "executionTraceId") REFERENCES "ai_execution_traces"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_human_decisions" ADD CONSTRAINT "ai_human_decision_insight_fk" FOREIGN KEY ("workspaceId", "aiInsightId") REFERENCES "ai_insights"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_human_decisions" ADD CONSTRAINT "ai_human_decision_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_run_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_run_version_fk" FOREIGN KEY ("workspaceId", "useCaseVersionId") REFERENCES "ai_use_case_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_run_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_result_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_result_run_fk" FOREIGN KEY ("workspaceId", "runId") REFERENCES "ai_evaluation_runs"("workspaceId", "id") ON DELETE RESTRICT;

CREATE FUNCTION prevent_ai_governance_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI governance history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_governance_events_append_only BEFORE UPDATE OR DELETE ON "ai_governance_events" FOR EACH ROW EXECUTE FUNCTION prevent_ai_governance_append_only_mutation();
CREATE TRIGGER ai_human_decisions_append_only BEFORE UPDATE OR DELETE ON "ai_human_decisions" FOR EACH ROW EXECUTE FUNCTION prevent_ai_governance_append_only_mutation();
CREATE TRIGGER ai_evaluation_results_append_only BEFORE UPDATE OR DELETE ON "ai_evaluation_results" FOR EACH ROW EXECUTE FUNCTION prevent_ai_governance_append_only_mutation();

CREATE FUNCTION protect_ai_use_case_version() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."key" IS DISTINCT FROM OLD."key" OR NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."name" IS DISTINCT FROM OLD."name" OR NEW."description" IS DISTINCT FROM OLD."description" OR
    NEW."ownerMemberId" IS DISTINCT FROM OLD."ownerMemberId" OR NEW."riskLevel" IS DISTINCT FROM OLD."riskLevel" OR
    NEW."agentType" IS DISTINCT FROM OLD."agentType" OR NEW."logicalProviderKey" IS DISTINCT FROM OLD."logicalProviderKey" OR
    NEW."logicalModel" IS DISTINCT FROM OLD."logicalModel" OR NEW."promptKey" IS DISTINCT FROM OLD."promptKey" OR
    NEW."promptVersion" IS DISTINCT FROM OLD."promptVersion" OR NEW."configurationVersion" IS DISTINCT FROM OLD."configurationVersion" OR
    NEW."inputSchemaVersion" IS DISTINCT FROM OLD."inputSchemaVersion" OR NEW."outputSchemaVersion" IS DISTINCT FROM OLD."outputSchemaVersion" OR
    NEW."allowedInputFields" IS DISTINCT FROM OLD."allowedInputFields" OR NEW."forbiddenInputFields" IS DISTINCT FROM OLD."forbiddenInputFields" OR
    NEW."confidenceThresholdBps" IS DISTINCT FROM OLD."confidenceThresholdBps" OR NEW."fallbackPolicy" IS DISTINCT FROM OLD."fallbackPolicy" OR
    NEW."timeoutMs" IS DISTINCT FROM OLD."timeoutMs" OR NEW."maxRetries" IS DISTINCT FROM OLD."maxRetries" OR
    NEW."rateLimitPerMinute" IS DISTINCT FROM OLD."rateLimitPerMinute" OR NEW."maxInputTokens" IS DISTINCT FROM OLD."maxInputTokens" OR
    NEW."maxOutputTokens" IS DISTINCT FROM OLD."maxOutputTokens" OR NEW."maxEstimatedCostCents" IS DISTINCT FROM OLD."maxEstimatedCostCents" OR
    NEW."supersedesVersionId" IS DISTINCT FROM OLD."supersedesVersionId" OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId" OR
    NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'published AI use case versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_use_case_version_immutable BEFORE UPDATE ON "ai_use_case_versions" FOR EACH ROW EXECUTE FUNCTION protect_ai_use_case_version();
