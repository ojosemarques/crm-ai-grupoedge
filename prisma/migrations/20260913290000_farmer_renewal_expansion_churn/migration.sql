-- CRM-54: Farmer, renovação, expansão, contração e churn.
-- Estritamente aditiva: nenhum objeto ou dado anterior é removido ou renomeado.

CREATE TYPE "RenewalStatus" AS ENUM ('IN_REVIEW', 'RENEWED', 'NOT_RENEWED', 'DEFERRED', 'CANCELLED');
CREATE TYPE "RenewalRiskLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RenewalEventType" AS ENUM ('CREATED', 'RISK_RECORDED', 'NEXT_ACTION_UPDATED', 'OWNER_CHANGED', 'RENEWED', 'NOT_RENEWED', 'DEFERRED', 'CANCELLED', 'REOPENED', 'CORRECTED');
CREATE TYPE "ExpansionSignalStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'LINKED');
CREATE TYPE "FarmerRevenueDecisionType" AS ENUM ('CONTRACTION', 'CHURN');
CREATE TYPE "FarmerRevenueDecisionStatus" AS ENUM ('CONFIRMED', 'REVERSED');
CREATE TYPE "FarmerReasonCategory" AS ENUM ('RENEWAL', 'NON_RENEWAL', 'DEFERMENT', 'CONTRACTION', 'CHURN', 'EXPANSION_REJECTION');
CREATE TYPE "FarmerConfigStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "FarmerBackfillStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "FarmerBackfillOutcome" AS ENUM ('CANDIDATE', 'CREATED', 'SKIPPED', 'REVIEW_REQUIRED');

ALTER TABLE "opportunities" ADD COLUMN "farmerExpansionSignalId" UUID;
CREATE INDEX "opportunities_workspace_farmer_signal_idx" ON "opportunities"("workspaceId", "farmerExpansionSignalId");

CREATE TABLE "renewals" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "contractId" UUID NOT NULL,
  "portfolioAssignmentId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL,
  "teamId" UUID,
  "targetDate" TIMESTAMPTZ(3) NOT NULL,
  "baseMrrCents" BIGINT NOT NULL,
  "baseTcvCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "status" "RenewalStatus" NOT NULL DEFAULT 'IN_REVIEW',
  "riskLevel" "RenewalRiskLevel" NOT NULL DEFAULT 'NONE',
  "riskReasonCode" TEXT,
  "riskEvidence" TEXT,
  "nextActionDescription" TEXT,
  "nextActionAt" TIMESTAMPTZ(3),
  "decidedAt" TIMESTAMPTZ(3),
  "decidedByActorId" UUID,
  "decisionReasonCode" TEXT,
  "decisionComment" TEXT,
  "snapshot" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "renewal_amounts_ck" CHECK ("baseMrrCents" >= 0 AND "baseTcvCents" >= 0),
  CONSTRAINT "renewal_revision_ck" CHECK ("revision" > 0),
  CONSTRAINT "renewal_open_action_ck" CHECK ("status" NOT IN ('IN_REVIEW', 'DEFERRED') OR (length(trim("nextActionDescription")) >= 3 AND "nextActionAt" IS NOT NULL)),
  CONSTRAINT "renewal_decision_ck" CHECK (("status" IN ('IN_REVIEW', 'DEFERRED')) OR ("decidedAt" IS NOT NULL AND "decidedByActorId" IS NOT NULL AND length(trim("decisionReasonCode")) >= 2 AND length(trim("decisionComment")) >= 3)),
  CONSTRAINT "renewal_risk_evidence_ck" CHECK ("riskLevel" = 'NONE' OR (length(trim("riskReasonCode")) >= 2 AND length(trim("riskEvidence")) >= 3))
);

CREATE TABLE "renewal_events" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "renewalId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "RenewalEventType" NOT NULL,
  "previousStatus" "RenewalStatus",
  "newStatus" "RenewalStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "safeMetadata" JSONB,
  "actorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "renewal_event_sequence_ck" CHECK ("sequence" > 0)
);

CREATE TABLE "expansion_signals" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "subscriptionId" UUID,
  "ownerMemberId" UUID NOT NULL,
  "teamId" UUID,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,
  "confidenceBps" INTEGER,
  "validUntil" TIMESTAMPTZ(3),
  "status" "ExpansionSignalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "estimatedMrrCents" BIGINT,
  "estimatedTcvCents" BIGINT,
  "productId" UUID,
  "opportunityId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByActorId" UUID,
  "reviewReasonCode" TEXT,
  "reviewComment" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "expansion_confidence_ck" CHECK ("confidenceBps" IS NULL OR "confidenceBps" BETWEEN 0 AND 10000),
  CONSTRAINT "expansion_values_ck" CHECK (("estimatedMrrCents" IS NULL OR "estimatedMrrCents" >= 0) AND ("estimatedTcvCents" IS NULL OR "estimatedTcvCents" >= 0)),
  CONSTRAINT "expansion_review_ck" CHECK ("status" = 'PENDING_REVIEW' OR ("reviewedAt" IS NOT NULL AND "reviewedByActorId" IS NOT NULL AND length(trim("reviewReasonCode")) >= 2 AND length(trim("reviewComment")) >= 3)),
  CONSTRAINT "expansion_link_ck" CHECK ("status" <> 'LINKED' OR "opportunityId" IS NOT NULL),
  CONSTRAINT "expansion_revision_ck" CHECK ("revision" > 0)
);

CREATE TABLE "farmer_revenue_decisions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "renewalId" UUID,
  "type" "FarmerRevenueDecisionType" NOT NULL,
  "status" "FarmerRevenueDecisionStatus" NOT NULL DEFAULT 'CONFIRMED',
  "previousMrrCents" BIGINT NOT NULL,
  "newMrrCents" BIGINT NOT NULL,
  "deltaMrrCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "logoChurn" BOOLEAN NOT NULL DEFAULT FALSE,
  "revenueChurn" BOOLEAN NOT NULL DEFAULT FALSE,
  "revenueMovementId" UUID NOT NULL,
  "reversesDecisionId" UUID,
  "reversedByDecisionId" UUID,
  "decidedByActorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "farmer_decision_values_ck" CHECK ("previousMrrCents" >= 0 AND "newMrrCents" >= 0 AND "deltaMrrCents" = "newMrrCents" - "previousMrrCents"),
  CONSTRAINT "farmer_decision_contraction_ck" CHECK ("type" <> 'CONTRACTION' OR ("newMrrCents" < "previousMrrCents" AND "deltaMrrCents" < 0 AND NOT "logoChurn")),
  CONSTRAINT "farmer_decision_churn_ck" CHECK ("type" <> 'CHURN' OR ("newMrrCents" = 0 AND "deltaMrrCents" <= 0 AND ("logoChurn" OR "revenueChurn")))
);

CREATE TABLE "churn_events" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "decisionId" UUID NOT NULL,
  "logoChurn" BOOLEAN NOT NULL,
  "revenueChurn" BOOLEAN NOT NULL,
  "previousMrrCents" BIGINT NOT NULL,
  "newMrrCents" BIGINT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "actorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reversesChurnId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "churn_event_type_ck" CHECK ("logoChurn" OR "revenueChurn"),
  CONSTRAINT "churn_event_values_ck" CHECK ("previousMrrCents" >= 0 AND "newMrrCents" >= 0)
);

CREATE TABLE "farmer_reason_code_versions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "category" "FarmerReasonCategory" NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "FarmerConfigStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveTo" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "farmer_reason_version_ck" CHECK ("version" > 0),
  CONSTRAINT "farmer_reason_interval_ck" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "farmer_backfill_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "FarmerBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "farmer_backfill_mode_ck" CHECK ("mode" IN ('DRY_RUN', 'EXECUTE')),
  CONSTRAINT "farmer_backfill_counts_ck" CHECK ("eligibleCount" >= 0 AND "createdCount" >= 0 AND "skippedCount" >= 0 AND "reviewCount" >= 0)
);

CREATE TABLE "farmer_backfill_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "subscriptionId" UUID,
  "outcome" "FarmerBackfillOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "renewalId" UUID,
  "safeEvidence" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "renewals_workspace_id_key" ON "renewals"("workspaceId", "id");
CREATE UNIQUE INDEX "renewals_workspace_idempotency_key" ON "renewals"("workspaceId", "idempotencyKey");
CREATE INDEX "renewals_workspace_owner_status_target_idx" ON "renewals"("workspaceId", "ownerMemberId", "status", "targetDate");
CREATE INDEX "renewals_workspace_team_status_target_idx" ON "renewals"("workspaceId", "teamId", "status", "targetDate");
CREATE INDEX "renewals_workspace_account_target_idx" ON "renewals"("workspaceId", "accountId", "targetDate");
CREATE INDEX "renewals_workspace_subscription_target_idx" ON "renewals"("workspaceId", "subscriptionId", "targetDate");
CREATE INDEX "renewals_workspace_risk_action_idx" ON "renewals"("workspaceId", "riskLevel", "status", "nextActionAt");
CREATE UNIQUE INDEX "renewal_events_workspace_id_key" ON "renewal_events"("workspaceId", "id");
CREATE UNIQUE INDEX "renewal_events_workspace_idempotency_key" ON "renewal_events"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "renewal_events_workspace_sequence_key" ON "renewal_events"("workspaceId", "renewalId", "sequence");
CREATE INDEX "renewal_events_workspace_account_idx" ON "renewal_events"("workspaceId", "accountId", "occurredAt");
CREATE UNIQUE INDEX "expansion_signals_workspace_id_key" ON "expansion_signals"("workspaceId", "id");
CREATE UNIQUE INDEX "expansion_signals_workspace_idempotency_key" ON "expansion_signals"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "expansion_signals_workspace_opportunity_key" ON "expansion_signals"("workspaceId", "opportunityId");
CREATE INDEX "expansion_signals_workspace_owner_status_idx" ON "expansion_signals"("workspaceId", "ownerMemberId", "status", "capturedAt");
CREATE INDEX "expansion_signals_workspace_account_status_idx" ON "expansion_signals"("workspaceId", "accountId", "status", "capturedAt");
CREATE UNIQUE INDEX "farmer_decisions_workspace_id_key" ON "farmer_revenue_decisions"("workspaceId", "id");
CREATE UNIQUE INDEX "farmer_decisions_workspace_idempotency_key" ON "farmer_revenue_decisions"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "farmer_decisions_workspace_movement_key" ON "farmer_revenue_decisions"("workspaceId", "revenueMovementId");
CREATE UNIQUE INDEX "revenue_movements_workspace_id_key" ON "revenue_movements"("workspaceId", "id");
CREATE INDEX "farmer_decisions_workspace_subscription_idx" ON "farmer_revenue_decisions"("workspaceId", "subscriptionId", "type", "effectiveAt");
CREATE UNIQUE INDEX "churn_events_workspace_id_key" ON "churn_events"("workspaceId", "id");
CREATE UNIQUE INDEX "churn_events_workspace_idempotency_key" ON "churn_events"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "churn_events_workspace_decision_key" ON "churn_events"("workspaceId", "decisionId");
CREATE INDEX "churn_events_workspace_account_idx" ON "churn_events"("workspaceId", "accountId", "effectiveAt");
CREATE UNIQUE INDEX "farmer_reason_workspace_id_key" ON "farmer_reason_code_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "farmer_reason_workspace_code_version_key" ON "farmer_reason_code_versions"("workspaceId", "category", "code", "version");
CREATE INDEX "farmer_reason_workspace_status_idx" ON "farmer_reason_code_versions"("workspaceId", "category", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "farmer_backfill_runs_workspace_id_key" ON "farmer_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "farmer_backfill_runs_workspace_key_key" ON "farmer_backfill_runs"("workspaceId", "runKey");
CREATE UNIQUE INDEX "farmer_backfill_items_workspace_id_key" ON "farmer_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "farmer_backfill_items_workspace_run_account_subscription_key" ON "farmer_backfill_items"("workspaceId", "runId", "accountId", "subscriptionId");

ALTER TABLE "renewals" ADD CONSTRAINT "renewal_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_subscription_fk" FOREIGN KEY ("workspaceId", "subscriptionId") REFERENCES "subscriptions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_contract_fk" FOREIGN KEY ("workspaceId", "contractId") REFERENCES "commercial_contracts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_assignment_fk" FOREIGN KEY ("workspaceId", "portfolioAssignmentId") REFERENCES "customer_portfolio_assignments"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_owner_fk" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_team_fk" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_decider_fk" FOREIGN KEY ("workspaceId", "decidedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewals" ADD CONSTRAINT "renewal_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewal_events" ADD CONSTRAINT "renewal_event_renewal_fk" FOREIGN KEY ("workspaceId", "renewalId") REFERENCES "renewals"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewal_events" ADD CONSTRAINT "renewal_event_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "renewal_events" ADD CONSTRAINT "renewal_event_actor_fk" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_subscription_fk" FOREIGN KEY ("workspaceId", "subscriptionId") REFERENCES "subscriptions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_owner_fk" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_team_fk" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_product_fk" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_opportunity_fk" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_reviewer_fk" FOREIGN KEY ("workspaceId", "reviewedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "expansion_signals" ADD CONSTRAINT "expansion_signal_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunity_farmer_signal_fk" FOREIGN KEY ("workspaceId", "farmerExpansionSignalId") REFERENCES "expansion_signals"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_subscription_fk" FOREIGN KEY ("workspaceId", "subscriptionId") REFERENCES "subscriptions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_renewal_fk" FOREIGN KEY ("workspaceId", "renewalId") REFERENCES "renewals"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_movement_fk" FOREIGN KEY ("workspaceId", "revenueMovementId") REFERENCES "revenue_movements"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_actor_fk" FOREIGN KEY ("workspaceId", "decidedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_reverses_fk" FOREIGN KEY ("workspaceId", "reversesDecisionId") REFERENCES "farmer_revenue_decisions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_revenue_decisions" ADD CONSTRAINT "farmer_decision_reversed_by_fk" FOREIGN KEY ("workspaceId", "reversedByDecisionId") REFERENCES "farmer_revenue_decisions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_event_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_event_subscription_fk" FOREIGN KEY ("workspaceId", "subscriptionId") REFERENCES "subscriptions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_event_decision_fk" FOREIGN KEY ("workspaceId", "decisionId") REFERENCES "farmer_revenue_decisions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_event_actor_fk" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_event_reverses_fk" FOREIGN KEY ("workspaceId", "reversesChurnId") REFERENCES "churn_events"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "farmer_reason_code_versions" ADD CONSTRAINT "farmer_reason_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "farmer_reason_code_versions" ADD CONSTRAINT "farmer_reason_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_backfill_runs" ADD CONSTRAINT "farmer_backfill_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "farmer_backfill_runs" ADD CONSTRAINT "farmer_backfill_actor_fk" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_backfill_items" ADD CONSTRAINT "farmer_backfill_run_fk" FOREIGN KEY ("workspaceId", "runId") REFERENCES "farmer_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_backfill_items" ADD CONSTRAINT "farmer_backfill_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_backfill_items" ADD CONSTRAINT "farmer_backfill_subscription_fk" FOREIGN KEY ("workspaceId", "subscriptionId") REFERENCES "subscriptions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "farmer_backfill_items" ADD CONSTRAINT "farmer_backfill_renewal_fk" FOREIGN KEY ("workspaceId", "renewalId") REFERENCES "renewals"("workspaceId", "id") ON DELETE RESTRICT;

CREATE FUNCTION crm54_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM-54 historical records are append-only';
END;
$$;

CREATE TRIGGER "renewal_events_append_only" BEFORE UPDATE OR DELETE ON "renewal_events" FOR EACH ROW EXECUTE FUNCTION crm54_reject_mutation();
CREATE TRIGGER "churn_events_append_only" BEFORE UPDATE OR DELETE ON "churn_events" FOR EACH ROW EXECUTE FUNCTION crm54_reject_mutation();
CREATE TRIGGER "farmer_backfill_items_append_only" BEFORE UPDATE OR DELETE ON "farmer_backfill_items" FOR EACH ROW EXECUTE FUNCTION crm54_reject_mutation();
