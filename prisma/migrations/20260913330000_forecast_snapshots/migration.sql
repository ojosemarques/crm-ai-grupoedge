-- CRM-56: forecast humano e snapshots históricos reproduzíveis.
-- Estritamente aditiva: nenhum fato ou contrato anterior é removido ou reinterpretado.

CREATE TYPE "ForecastCycleStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ForecastScopeType" AS ENUM ('WORKSPACE', 'TEAM', 'FUNCTION');
CREATE TYPE "ForecastSubmissionScope" AS ENUM ('MEMBER', 'TEAM');
CREATE TYPE "ForecastSubmissionType" AS ENUM ('INDIVIDUAL', 'MANAGER_OVERRIDE');
CREATE TYPE "ForecastCategory" AS ENUM ('PIPELINE', 'BEST_CASE', 'COMMIT');
CREATE TYPE "ForecastCoverageState" AS ENUM ('COMPLETE', 'PARTIAL', 'NOT_AVAILABLE');
CREATE TYPE "ForecastBackfillStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ForecastBackfillOutcome" AS ENUM ('REVIEW_REQUIRED', 'SKIPPED');

CREATE TABLE "forecast_cycles" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "goalPlanId" UUID,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "scopeType" "ForecastScopeType" NOT NULL,
  "teamId" UUID,
  "function" "OwnershipFunction",
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "status" "ForecastCycleStatus" NOT NULL DEFAULT 'OPEN',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "forecast_cycle_period_ck" CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "forecast_cycle_version_ck" CHECK ("version" > 0 AND "revision" > 0),
  CONSTRAINT "forecast_cycle_key_ck" CHECK ("key" ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
  CONSTRAINT "forecast_cycle_scope_ck" CHECK (("scopeType" = 'WORKSPACE' AND "teamId" IS NULL AND "function" IS NULL) OR ("scopeType" = 'TEAM' AND "teamId" IS NOT NULL AND "function" IS NULL) OR ("scopeType" = 'FUNCTION' AND "teamId" IS NULL AND "function" IS NOT NULL))
);

CREATE TABLE "forecast_submissions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "cycleId" UUID NOT NULL,
  "authorMemberId" UUID NOT NULL,
  "scopeType" "ForecastSubmissionScope" NOT NULL,
  "targetMemberId" UUID,
  "targetTeamId" UUID,
  "type" "ForecastSubmissionType" NOT NULL,
  "category" "ForecastCategory" NOT NULL,
  "declaredValueCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "comment" TEXT,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL,
  "supersedesSubmissionId" UUID,
  "correctionReason" TEXT,
  "fingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forecast_submission_value_ck" CHECK ("declaredValueCents" >= 0 AND "version" > 0),
  CONSTRAINT "forecast_submission_scope_ck" CHECK (("scopeType" = 'MEMBER' AND "targetMemberId" IS NOT NULL AND "targetTeamId" IS NULL AND "type" = 'INDIVIDUAL') OR ("scopeType" = 'TEAM' AND "targetMemberId" IS NULL AND "targetTeamId" IS NOT NULL AND "type" = 'MANAGER_OVERRIDE')),
  CONSTRAINT "forecast_submission_correction_ck" CHECK (("version" = 1 AND "supersedesSubmissionId" IS NULL AND "correctionReason" IS NULL) OR ("version" > 1 AND "supersedesSubmissionId" IS NOT NULL AND length("correctionReason") >= 3))
);

CREATE TABLE "forecast_submission_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "cycleId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "included" BOOLEAN NOT NULL,
  "category" "ForecastCategory",
  "exclusionReason" TEXT,
  "opportunityName" TEXT NOT NULL,
  "leadId" UUID NOT NULL,
  "accountId" UUID,
  "ownerMemberId" UUID NOT NULL,
  "ownerLabel" TEXT NOT NULL,
  "teamId" UUID,
  "teamLabel" TEXT,
  "stageId" UUID NOT NULL,
  "stageKey" TEXT NOT NULL,
  "stageLabel" TEXT NOT NULL,
  "status" "OpportunityStatus" NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL,
  "expectedCloseAt" TIMESTAMPTZ(3),
  "probabilityBps" INTEGER,
  "probabilitySource" TEXT,
  "probabilityActorId" UUID,
  "probabilityRecordedAt" TIMESTAMPTZ(3),
  "opportunityRevision" INTEGER NOT NULL,
  "opportunityUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forecast_submission_item_amount_ck" CHECK ("amountCents" >= 0 AND "opportunityRevision" > 0),
  CONSTRAINT "forecast_submission_item_membership_ck" CHECK (("included" AND "category" IS NOT NULL AND "exclusionReason" IS NULL) OR (NOT "included" AND "category" IS NULL AND "exclusionReason" IS NOT NULL)),
  CONSTRAINT "forecast_submission_item_probability_ck" CHECK ("probabilityBps" IS NULL OR "probabilityBps" BETWEEN 0 AND 10000)
);

CREATE TABLE "forecast_snapshots" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "cycleId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "scopeType" "ForecastScopeType" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "teamId" UUID,
  "function" "OwnershipFunction",
  "currency" "Currency" NOT NULL,
  "realizedCents" BIGINT NOT NULL,
  "goalTargetCents" BIGINT,
  "pipelineCents" BIGINT NOT NULL,
  "bestCaseCents" BIGINT NOT NULL,
  "commitCents" BIGINT NOT NULL,
  "weightedPipelineCents" BIGINT,
  "opportunityCount" INTEGER NOT NULL,
  "coverageState" "ForecastCoverageState" NOT NULL,
  "coverageBps" INTEGER NOT NULL,
  "bottomUpCommitCents" BIGINT NOT NULL,
  "managerOverrideCents" BIGINT,
  "managerOverrideId" UUID,
  "fingerprint" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "sourceSubmissionIds" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forecast_snapshot_period_ck" CHECK ("periodEnd" > "periodStart" AND "sequence" > 0),
  CONSTRAINT "forecast_snapshot_values_ck" CHECK ("realizedCents" >= 0 AND ("goalTargetCents" IS NULL OR "goalTargetCents" >= 0) AND "pipelineCents" >= 0 AND "bestCaseCents" >= 0 AND "commitCents" >= 0 AND ("weightedPipelineCents" IS NULL OR "weightedPipelineCents" >= 0) AND "opportunityCount" >= 0 AND "bottomUpCommitCents" >= 0 AND ("managerOverrideCents" IS NULL OR "managerOverrideCents" >= 0)),
  CONSTRAINT "forecast_snapshot_totals_ck" CHECK ("commitCents" <= "bestCaseCents" AND "bestCaseCents" <= "pipelineCents"),
  CONSTRAINT "forecast_snapshot_coverage_ck" CHECK ("coverageBps" BETWEEN 0 AND 10000 AND (("coverageState" = 'COMPLETE' AND "coverageBps" = 10000 AND "weightedPipelineCents" IS NOT NULL) OR ("coverageState" <> 'COMPLETE' AND "coverageBps" < 10000 AND "weightedPipelineCents" IS NULL))),
  CONSTRAINT "forecast_snapshot_scope_ck" CHECK (("scopeType" = 'WORKSPACE' AND "teamId" IS NULL AND "function" IS NULL AND "scopeKey" = 'WORKSPACE') OR ("scopeType" = 'TEAM' AND "teamId" IS NOT NULL AND "function" IS NULL AND "scopeKey" = 'TEAM:' || "teamId"::text) OR ("scopeType" = 'FUNCTION' AND "teamId" IS NULL AND "function" IS NOT NULL AND "scopeKey" = 'FUNCTION:' || "function"::text)),
  CONSTRAINT "forecast_snapshot_override_ck" CHECK (("managerOverrideCents" IS NULL AND "managerOverrideId" IS NULL) OR ("managerOverrideCents" IS NOT NULL AND "managerOverrideId" IS NOT NULL))
);

CREATE TABLE "forecast_snapshot_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "cycleId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "eligible" BOOLEAN NOT NULL,
  "category" "ForecastCategory",
  "reasonCode" TEXT NOT NULL,
  "opportunityName" TEXT NOT NULL,
  "leadId" UUID NOT NULL,
  "accountId" UUID,
  "ownerMemberId" UUID NOT NULL,
  "ownerLabel" TEXT NOT NULL,
  "teamId" UUID,
  "teamLabel" TEXT,
  "stageId" UUID NOT NULL,
  "stageKey" TEXT NOT NULL,
  "stageLabel" TEXT NOT NULL,
  "status" "OpportunityStatus" NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL,
  "expectedCloseAt" TIMESTAMPTZ(3),
  "probabilityBps" INTEGER,
  "probabilitySource" TEXT,
  "probabilityActorId" UUID,
  "probabilityRecordedAt" TIMESTAMPTZ(3),
  "opportunityRevision" INTEGER NOT NULL,
  "opportunityUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "sourceSubmissionId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forecast_snapshot_item_amount_ck" CHECK ("amountCents" >= 0 AND "opportunityRevision" > 0),
  CONSTRAINT "forecast_snapshot_item_category_ck" CHECK (("eligible" AND "category" IS NOT NULL) OR (NOT "eligible" AND "category" IS NULL)),
  CONSTRAINT "forecast_snapshot_item_probability_ck" CHECK ("probabilityBps" IS NULL OR "probabilityBps" BETWEEN 0 AND 10000)
);

CREATE TABLE "forecast_backfill_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "ForecastBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "forecast_backfill_mode_ck" CHECK ("mode" IN ('DRY_RUN','EXECUTE')),
  CONSTRAINT "forecast_backfill_counts_ck" CHECK ("candidateCount" >= 0 AND "reviewCount" >= 0 AND "skippedCount" >= 0)
);

CREATE TABLE "forecast_backfill_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "outcome" "ForecastBackfillOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "safeEvidence" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "forecast_cycles_workspace_id_key" ON "forecast_cycles"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_cycles_workspace_key_version_key" ON "forecast_cycles"("workspaceId","key","version");
CREATE UNIQUE INDEX "forecast_cycles_workspace_idempotency_key" ON "forecast_cycles"("workspaceId","idempotencyKey");
CREATE INDEX "forecast_cycles_workspace_status_period_idx" ON "forecast_cycles"("workspaceId","status","periodStart","periodEnd");
CREATE INDEX "forecast_cycles_workspace_team_status_idx" ON "forecast_cycles"("workspaceId","teamId","status");
CREATE INDEX "forecast_cycles_workspace_function_status_idx" ON "forecast_cycles"("workspaceId","function","status");
CREATE UNIQUE INDEX "forecast_submissions_workspace_id_key" ON "forecast_submissions"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_submissions_workspace_idempotency_key" ON "forecast_submissions"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "forecast_submissions_workspace_revision_key" ON "forecast_submissions"("workspaceId","cycleId","authorMemberId","scopeType","category","version");
CREATE INDEX "forecast_submissions_workspace_cycle_author_idx" ON "forecast_submissions"("workspaceId","cycleId","authorMemberId","createdAt");
CREATE INDEX "forecast_submissions_workspace_target_member_idx" ON "forecast_submissions"("workspaceId","targetMemberId","category","createdAt");
CREATE INDEX "forecast_submissions_workspace_target_team_idx" ON "forecast_submissions"("workspaceId","targetTeamId","category","createdAt");
CREATE UNIQUE INDEX "forecast_submission_items_workspace_id_key" ON "forecast_submission_items"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_submission_items_workspace_submission_opportunity_key" ON "forecast_submission_items"("workspaceId","submissionId","opportunityId");
CREATE INDEX "forecast_submission_items_workspace_cycle_opportunity_idx" ON "forecast_submission_items"("workspaceId","cycleId","opportunityId");
CREATE INDEX "forecast_submission_items_workspace_owner_category_idx" ON "forecast_submission_items"("workspaceId","ownerMemberId","category");
CREATE UNIQUE INDEX "forecast_snapshots_workspace_id_key" ON "forecast_snapshots"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_snapshots_workspace_idempotency_key" ON "forecast_snapshots"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "forecast_snapshots_workspace_cycle_sequence_key" ON "forecast_snapshots"("workspaceId","cycleId","sequence");
CREATE INDEX "forecast_snapshots_workspace_cycle_asof_idx" ON "forecast_snapshots"("workspaceId","cycleId","asOf");
CREATE INDEX "forecast_snapshots_workspace_team_asof_idx" ON "forecast_snapshots"("workspaceId","teamId","asOf");
CREATE UNIQUE INDEX "forecast_snapshot_items_workspace_id_key" ON "forecast_snapshot_items"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_snapshot_items_workspace_snapshot_opportunity_key" ON "forecast_snapshot_items"("workspaceId","snapshotId","opportunityId");
CREATE INDEX "forecast_snapshot_items_workspace_snapshot_eligible_idx" ON "forecast_snapshot_items"("workspaceId","snapshotId","eligible","category");
CREATE INDEX "forecast_snapshot_items_workspace_opportunity_created_idx" ON "forecast_snapshot_items"("workspaceId","opportunityId","createdAt");
CREATE UNIQUE INDEX "forecast_backfill_runs_workspace_id_key" ON "forecast_backfill_runs"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_backfill_runs_workspace_run_key" ON "forecast_backfill_runs"("workspaceId","runKey");
CREATE UNIQUE INDEX "forecast_backfill_items_workspace_id_key" ON "forecast_backfill_items"("workspaceId","id");
CREATE UNIQUE INDEX "forecast_backfill_items_workspace_run_source_key" ON "forecast_backfill_items"("workspaceId","runId","sourceType","sourceKey");
CREATE INDEX "forecast_backfill_items_workspace_outcome_created_idx" ON "forecast_backfill_items"("workspaceId","outcome","createdAt");

ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycle_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycle_goal_plan_fk" FOREIGN KEY ("workspaceId","goalPlanId") REFERENCES "goal_plans"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycle_team_fk" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycle_created_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycle_updated_actor_fk" FOREIGN KEY ("workspaceId","updatedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submissions" ADD CONSTRAINT "forecast_submission_cycle_fk" FOREIGN KEY ("workspaceId","cycleId") REFERENCES "forecast_cycles"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submissions" ADD CONSTRAINT "forecast_submission_author_fk" FOREIGN KEY ("workspaceId","authorMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submissions" ADD CONSTRAINT "forecast_submission_target_member_fk" FOREIGN KEY ("workspaceId","targetMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submissions" ADD CONSTRAINT "forecast_submission_target_team_fk" FOREIGN KEY ("workspaceId","targetTeamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submissions" ADD CONSTRAINT "forecast_submission_supersedes_fk" FOREIGN KEY ("workspaceId","supersedesSubmissionId") REFERENCES "forecast_submissions"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submissions" ADD CONSTRAINT "forecast_submission_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submission_items" ADD CONSTRAINT "forecast_submission_item_submission_fk" FOREIGN KEY ("workspaceId","submissionId") REFERENCES "forecast_submissions"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submission_items" ADD CONSTRAINT "forecast_submission_item_cycle_fk" FOREIGN KEY ("workspaceId","cycleId") REFERENCES "forecast_cycles"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submission_items" ADD CONSTRAINT "forecast_submission_item_opportunity_fk" FOREIGN KEY ("workspaceId","opportunityId") REFERENCES "opportunities"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submission_items" ADD CONSTRAINT "forecast_submission_item_owner_fk" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_submission_items" ADD CONSTRAINT "forecast_submission_item_team_fk" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshot_cycle_fk" FOREIGN KEY ("workspaceId","cycleId") REFERENCES "forecast_cycles"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshot_team_fk" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshot_override_fk" FOREIGN KEY ("workspaceId","managerOverrideId") REFERENCES "forecast_submissions"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshot_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_item_snapshot_fk" FOREIGN KEY ("workspaceId","snapshotId") REFERENCES "forecast_snapshots"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_item_cycle_fk" FOREIGN KEY ("workspaceId","cycleId") REFERENCES "forecast_cycles"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_item_opportunity_fk" FOREIGN KEY ("workspaceId","opportunityId") REFERENCES "opportunities"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_item_submission_fk" FOREIGN KEY ("workspaceId","sourceSubmissionId") REFERENCES "forecast_submissions"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_item_owner_fk" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_item_team_fk" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_backfill_runs" ADD CONSTRAINT "forecast_backfill_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "forecast_backfill_runs" ADD CONSTRAINT "forecast_backfill_actor_fk" FOREIGN KEY ("workspaceId","actorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "forecast_backfill_items" ADD CONSTRAINT "forecast_backfill_run_fk" FOREIGN KEY ("workspaceId","runId") REFERENCES "forecast_backfill_runs"("workspaceId","id") ON DELETE RESTRICT;

CREATE FUNCTION crm56_reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM-56 forecast historical records are append-only';
END;
$$;

CREATE FUNCTION crm56_protect_cycle_material_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "forecast_snapshots" s WHERE s."workspaceId" = OLD."workspaceId" AND s."cycleId" = OLD."id") AND ROW(NEW."goalPlanId", NEW."key", NEW."version", NEW."periodStart", NEW."periodEnd", NEW."timeZone", NEW."scopeType", NEW."teamId", NEW."function", NEW."currency", NEW."idempotencyKey", NEW."createdByActorId") IS DISTINCT FROM ROW(OLD."goalPlanId", OLD."key", OLD."version", OLD."periodStart", OLD."periodEnd", OLD."timeZone", OLD."scopeType", OLD."teamId", OLD."function", OLD."currency", OLD."idempotencyKey", OLD."createdByActorId") THEN
    RAISE EXCEPTION 'forecast cycle material fields are immutable after first snapshot';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "forecast_submissions_append_only" BEFORE UPDATE OR DELETE ON "forecast_submissions" FOR EACH ROW EXECUTE FUNCTION crm56_reject_append_only_mutation();
CREATE TRIGGER "forecast_submission_items_append_only" BEFORE UPDATE OR DELETE ON "forecast_submission_items" FOR EACH ROW EXECUTE FUNCTION crm56_reject_append_only_mutation();
CREATE TRIGGER "forecast_snapshots_append_only" BEFORE UPDATE OR DELETE ON "forecast_snapshots" FOR EACH ROW EXECUTE FUNCTION crm56_reject_append_only_mutation();
CREATE TRIGGER "forecast_snapshot_items_append_only" BEFORE UPDATE OR DELETE ON "forecast_snapshot_items" FOR EACH ROW EXECUTE FUNCTION crm56_reject_append_only_mutation();
CREATE TRIGGER "forecast_backfill_items_append_only" BEFORE UPDATE OR DELETE ON "forecast_backfill_items" FOR EACH ROW EXECUTE FUNCTION crm56_reject_append_only_mutation();
CREATE TRIGGER "forecast_cycles_material_immutable" BEFORE UPDATE ON "forecast_cycles" FOR EACH ROW EXECUTE FUNCTION crm56_protect_cycle_material_fields();
