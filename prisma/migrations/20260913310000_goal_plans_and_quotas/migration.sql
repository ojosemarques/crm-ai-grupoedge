-- CRM-55: metas e quotas versionadas.
-- Estritamente aditiva: não remove, renomeia ou reinterpreta fatos anteriores.

CREATE TYPE "GoalPlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "GoalQuotaTargetType" AS ENUM ('MEMBER', 'TEAM', 'FUNCTION');
CREATE TYPE "GoalQuotaUnit" AS ENUM ('COUNT', 'BASIS_POINTS', 'CURRENCY_CENTS');
CREATE TYPE "GoalMetricKey" AS ENUM ('LEADS_ASSIGNED', 'HUMAN_ATTEMPTS', 'MEETINGS_HELD', 'OPPORTUNITIES_WON', 'REVENUE_WON_CENTS', 'NEW_MRR_CENTS', 'EXPANSION_MRR_CENTS', 'RENEWALS_COMPLETED', 'LEAD_TO_SALE_BPS');
CREATE TYPE "GoalPlanEventType" AS ENUM ('DRAFT_CREATED', 'DRAFT_UPDATED', 'PUBLISHED', 'SUPERSEDED', 'RETIRED');
CREATE TYPE "GoalBackfillStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "GoalBackfillOutcome" AS ENUM ('REVIEW_REQUIRED', 'SKIPPED');

CREATE TABLE "goal_plans" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "status" "GoalPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "supersedesPlanId" UUID,
  "publishedAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "goal_plan_version_ck" CHECK ("version" > 0 AND "revision" > 0),
  CONSTRAINT "goal_plan_period_ck" CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "goal_plan_key_ck" CHECK ("key" ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
  CONSTRAINT "goal_plan_status_dates_ck" CHECK (("status" = 'DRAFT' AND "publishedAt" IS NULL AND "retiredAt" IS NULL) OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL AND "retiredAt" IS NULL) OR ("status" = 'RETIRED' AND "publishedAt" IS NOT NULL AND "retiredAt" IS NOT NULL))
);

CREATE TABLE "goal_quotas" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "targetType" "GoalQuotaTargetType" NOT NULL,
  "targetKey" TEXT NOT NULL,
  "memberId" UUID,
  "teamId" UUID,
  "function" "OwnershipFunction",
  "metricKey" "GoalMetricKey" NOT NULL,
  "unit" "GoalQuotaUnit" NOT NULL,
  "targetValue" BIGINT NOT NULL,
  "currency" "Currency",
  "targetLabel" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "goal_quota_value_ck" CHECK ("targetValue" >= 0),
  CONSTRAINT "goal_quota_target_ck" CHECK (("targetType" = 'MEMBER' AND "memberId" IS NOT NULL AND "teamId" IS NULL AND "function" IS NULL AND "targetKey" = 'MEMBER:' || "memberId"::text) OR ("targetType" = 'TEAM' AND "memberId" IS NULL AND "teamId" IS NOT NULL AND "function" IS NULL AND "targetKey" = 'TEAM:' || "teamId"::text) OR ("targetType" = 'FUNCTION' AND "memberId" IS NULL AND "teamId" IS NULL AND "function" IS NOT NULL AND "targetKey" = 'FUNCTION:' || "function"::text)),
  CONSTRAINT "goal_quota_unit_ck" CHECK (("metricKey" IN ('REVENUE_WON_CENTS','NEW_MRR_CENTS','EXPANSION_MRR_CENTS') AND "unit" = 'CURRENCY_CENTS' AND "currency" = 'BRL') OR ("metricKey" = 'LEAD_TO_SALE_BPS' AND "unit" = 'BASIS_POINTS' AND "targetValue" <= 10000 AND "currency" IS NULL) OR ("metricKey" IN ('LEADS_ASSIGNED','HUMAN_ATTEMPTS','MEETINGS_HELD','OPPORTUNITIES_WON','RENEWALS_COMPLETED') AND "unit" = 'COUNT' AND "currency" IS NULL))
);

CREATE TABLE "goal_plan_events" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "GoalPlanEventType" NOT NULL,
  "reason" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "actorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "goal_event_sequence_ck" CHECK ("sequence" > 0)
);

CREATE TABLE "goal_backfill_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "GoalBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "goal_backfill_mode_ck" CHECK ("mode" IN ('DRY_RUN','EXECUTE')),
  CONSTRAINT "goal_backfill_counts_ck" CHECK ("candidateCount" >= 0 AND "reviewCount" >= 0 AND "skippedCount" >= 0)
);

CREATE TABLE "goal_backfill_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "outcome" "GoalBackfillOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "safeEvidence" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "goal_plans_workspace_id_key" ON "goal_plans"("workspaceId","id");
CREATE UNIQUE INDEX "goal_plans_workspace_key_version_key" ON "goal_plans"("workspaceId","key","version");
CREATE UNIQUE INDEX "goal_plans_workspace_idempotency_key" ON "goal_plans"("workspaceId","idempotencyKey");
CREATE INDEX "goal_plans_workspace_status_period_idx" ON "goal_plans"("workspaceId","status","periodStart","periodEnd");
CREATE UNIQUE INDEX "goal_quotas_workspace_id_key" ON "goal_quotas"("workspaceId","id");
CREATE UNIQUE INDEX "goal_quotas_workspace_plan_metric_target_key" ON "goal_quotas"("workspaceId","planId","metricKey","targetKey");
CREATE INDEX "goal_quotas_workspace_member_metric_idx" ON "goal_quotas"("workspaceId","memberId","metricKey");
CREATE INDEX "goal_quotas_workspace_team_metric_idx" ON "goal_quotas"("workspaceId","teamId","metricKey");
CREATE INDEX "goal_quotas_workspace_function_metric_idx" ON "goal_quotas"("workspaceId","function","metricKey");
CREATE UNIQUE INDEX "goal_events_workspace_id_key" ON "goal_plan_events"("workspaceId","id");
CREATE UNIQUE INDEX "goal_events_workspace_idempotency_key" ON "goal_plan_events"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "goal_events_workspace_plan_sequence_key" ON "goal_plan_events"("workspaceId","planId","sequence");
CREATE INDEX "goal_events_workspace_plan_occurred_idx" ON "goal_plan_events"("workspaceId","planId","occurredAt");
CREATE UNIQUE INDEX "goal_backfill_runs_workspace_id_key" ON "goal_backfill_runs"("workspaceId","id");
CREATE UNIQUE INDEX "goal_backfill_runs_workspace_run_key" ON "goal_backfill_runs"("workspaceId","runKey");
CREATE UNIQUE INDEX "goal_backfill_items_workspace_id_key" ON "goal_backfill_items"("workspaceId","id");
CREATE UNIQUE INDEX "goal_backfill_items_workspace_run_source_key" ON "goal_backfill_items"("workspaceId","runId","sourceType","sourceKey");

ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plan_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plan_supersedes_fk" FOREIGN KEY ("workspaceId","supersedesPlanId") REFERENCES "goal_plans"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plan_created_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plan_updated_actor_fk" FOREIGN KEY ("workspaceId","updatedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_quotas" ADD CONSTRAINT "goal_quota_plan_fk" FOREIGN KEY ("workspaceId","planId") REFERENCES "goal_plans"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_quotas" ADD CONSTRAINT "goal_quota_member_fk" FOREIGN KEY ("workspaceId","memberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_quotas" ADD CONSTRAINT "goal_quota_team_fk" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_quotas" ADD CONSTRAINT "goal_quota_created_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_quotas" ADD CONSTRAINT "goal_quota_updated_actor_fk" FOREIGN KEY ("workspaceId","updatedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_plan_events" ADD CONSTRAINT "goal_event_plan_fk" FOREIGN KEY ("workspaceId","planId") REFERENCES "goal_plans"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_plan_events" ADD CONSTRAINT "goal_event_actor_fk" FOREIGN KEY ("workspaceId","actorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_backfill_runs" ADD CONSTRAINT "goal_backfill_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "goal_backfill_runs" ADD CONSTRAINT "goal_backfill_actor_fk" FOREIGN KEY ("workspaceId","actorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "goal_backfill_items" ADD CONSTRAINT "goal_backfill_run_fk" FOREIGN KEY ("workspaceId","runId") REFERENCES "goal_backfill_runs"("workspaceId","id") ON DELETE RESTRICT;

CREATE FUNCTION crm55_reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM-55 historical records are append-only';
END;
$$;

CREATE FUNCTION crm55_protect_published_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND ROW(NEW."key", NEW."version", NEW."name", NEW."description", NEW."periodStart", NEW."periodEnd", NEW."timeZone", NEW."supersedesPlanId", NEW."idempotencyKey", NEW."createdByActorId") IS DISTINCT FROM ROW(OLD."key", OLD."version", OLD."name", OLD."description", OLD."periodStart", OLD."periodEnd", OLD."timeZone", OLD."supersedesPlanId", OLD."idempotencyKey", OLD."createdByActorId") THEN
    RAISE EXCEPTION 'published goal plan material fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION crm55_protect_published_quota() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "goal_plans" p WHERE p."workspaceId" = OLD."workspaceId" AND p."id" = OLD."planId" AND p."status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'published goal quotas are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "goal_plan_events_append_only" BEFORE UPDATE OR DELETE ON "goal_plan_events" FOR EACH ROW EXECUTE FUNCTION crm55_reject_append_only_mutation();
CREATE TRIGGER "goal_backfill_items_append_only" BEFORE UPDATE OR DELETE ON "goal_backfill_items" FOR EACH ROW EXECUTE FUNCTION crm55_reject_append_only_mutation();
CREATE TRIGGER "goal_plans_published_immutable" BEFORE UPDATE ON "goal_plans" FOR EACH ROW EXECUTE FUNCTION crm55_protect_published_plan();
CREATE TRIGGER "goal_quotas_published_immutable" BEFORE UPDATE OR DELETE ON "goal_quotas" FOR EACH ROW EXECUTE FUNCTION crm55_protect_published_quota();
