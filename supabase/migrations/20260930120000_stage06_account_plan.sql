SET search_path TO crm, public;
CREATE TYPE "AccountPlanEpisodeType" AS ENUM ('DISCOVERY','SOLUTION','PILOT','CUSTOMER_WAIT','CONTRACTING','INSTITUTIONAL_NURTURE');
CREATE TYPE "AccountPlanTrackType" AS ENUM ('STAKEHOLDER','POLITIZAI_DELIVERY','IMPEDIMENT','DECISION');
CREATE TYPE "AccountPlanCommitmentStatus" AS ENUM ('ACTIVE','COMPLETED','CANCELLED');
CREATE TYPE "AccountPlanWaitStatus" AS ENUM ('PLANNED','RESUMED','CANCELLED');
CREATE TYPE "AccountPlanStakeholderStatus" AS ENUM ('ACTIVE','REPLACED');

CREATE TABLE "opportunity_account_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "opportunity_account_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_account_plans_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "opportunity_account_plans_opportunityId_key" ON "opportunity_account_plans"("opportunityId");
CREATE UNIQUE INDEX "opportunity_account_plans_workspaceId_id_key" ON "opportunity_account_plans"("workspaceId","id");
CREATE UNIQUE INDEX "opportunity_account_plans_workspaceId_opportunityId_key" ON "opportunity_account_plans"("workspaceId","opportunityId");
CREATE UNIQUE INDEX "opportunity_account_plans_workspace_opportunity_id_key" ON "opportunity_account_plans"("workspaceId","opportunityId","id");
CREATE INDEX "opportunity_account_plans_workspaceId_updatedAt_idx" ON "opportunity_account_plans"("workspaceId","updatedAt");
ALTER TABLE "opportunity_account_plans" ADD CONSTRAINT "opportunity_account_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_account_plans" ADD CONSTRAINT "opportunity_account_plans_opportunity_fkey" FOREIGN KEY ("workspaceId","opportunityId") REFERENCES "opportunities"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "opportunity_plan_episodes" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "accountPlanId" UUID NOT NULL,
 "type" "AccountPlanEpisodeType" NOT NULL, "title" TEXT NOT NULL, "objective" TEXT NOT NULL, "artifactUrl" TEXT,
 "ownerMemberId" UUID, "taskId" UUID, "status" "AccountPlanCommitmentStatus" NOT NULL DEFAULT 'ACTIVE', "dueAt" TIMESTAMPTZ(3),
 "startedAt" TIMESTAMPTZ(3) NOT NULL, "completedAt" TIMESTAMPTZ(3), "cancelledAt" TIMESTAMPTZ(3), "cancellationCode" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "opportunity_plan_episodes_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "opportunity_plan_episode_state_check" CHECK (("status"='ACTIVE' AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR ("status"='COMPLETED' AND "completedAt" IS NOT NULL) OR ("status"='CANCELLED' AND "cancelledAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "opportunity_plan_episodes_taskId_key" ON "opportunity_plan_episodes"("taskId");
CREATE UNIQUE INDEX "opportunity_plan_episodes_workspaceId_id_key" ON "opportunity_plan_episodes"("workspaceId","id");
CREATE UNIQUE INDEX "opportunity_plan_episodes_task_context_key" ON "opportunity_plan_episodes"("workspaceId","opportunityId","taskId");
CREATE INDEX "opportunity_plan_episodes_plan_status_due_idx" ON "opportunity_plan_episodes"("workspaceId","accountPlanId","status","dueAt");
CREATE INDEX "opportunity_plan_episodes_owner_status_due_idx" ON "opportunity_plan_episodes"("workspaceId","ownerMemberId","status","dueAt");

CREATE TABLE "opportunity_plan_tracks" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "accountPlanId" UUID NOT NULL,
 "type" "AccountPlanTrackType" NOT NULL, "milestone" TEXT NOT NULL, "artifactTitle" TEXT, "artifactUrl" TEXT, "ownerMemberId" UUID,
 "taskId" UUID, "status" "AccountPlanCommitmentStatus" NOT NULL DEFAULT 'ACTIVE', "dueAt" TIMESTAMPTZ(3) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "completedAt" TIMESTAMPTZ(3), "cancelledAt" TIMESTAMPTZ(3), "cancellationCode" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "opportunity_plan_tracks_pkey" PRIMARY KEY ("id"), CONSTRAINT "opportunity_plan_tracks_revision_check" CHECK ("revision">0),
 CONSTRAINT "opportunity_plan_track_state_check" CHECK (("status"='ACTIVE' AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR ("status"='COMPLETED' AND "completedAt" IS NOT NULL) OR ("status"='CANCELLED' AND "cancelledAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "opportunity_plan_tracks_taskId_key" ON "opportunity_plan_tracks"("taskId");
CREATE UNIQUE INDEX "opportunity_plan_tracks_workspaceId_id_key" ON "opportunity_plan_tracks"("workspaceId","id");
CREATE UNIQUE INDEX "opportunity_plan_tracks_task_context_key" ON "opportunity_plan_tracks"("workspaceId","opportunityId","taskId");
CREATE UNIQUE INDEX "opportunity_plan_tracks_type_key" ON "opportunity_plan_tracks"("workspaceId","accountPlanId","type");
CREATE INDEX "opportunity_plan_tracks_owner_status_due_idx" ON "opportunity_plan_tracks"("workspaceId","ownerMemberId","status","dueAt");

CREATE TABLE "opportunity_plan_track_revisions" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "accountPlanId" UUID NOT NULL,
 "trackId" UUID NOT NULL, "revision" INTEGER NOT NULL, "milestone" TEXT NOT NULL, "artifactTitle" TEXT, "artifactUrl" TEXT,
 "ownerMemberId" UUID, "dueAt" TIMESTAMPTZ(3) NOT NULL, "recordedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "opportunity_plan_track_revisions_pkey" PRIMARY KEY ("id"), CONSTRAINT "opportunity_plan_track_revisions_revision_check" CHECK ("revision">0)
);
CREATE UNIQUE INDEX "opportunity_plan_track_revisions_workspaceId_id_key" ON "opportunity_plan_track_revisions"("workspaceId","id");
CREATE UNIQUE INDEX "opportunity_plan_track_revisions_track_revision_key" ON "opportunity_plan_track_revisions"("workspaceId","trackId","revision");
CREATE INDEX "opportunity_plan_track_revisions_plan_recorded_idx" ON "opportunity_plan_track_revisions"("workspaceId","accountPlanId","recordedAt");

CREATE TABLE "opportunity_planned_waits" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "accountPlanId" UUID NOT NULL,
 "reason" TEXT NOT NULL, "reviewAt" TIMESTAMPTZ(3) NOT NULL, "ownerMemberId" UUID NOT NULL, "taskId" UUID NOT NULL,
 "status" "AccountPlanWaitStatus" NOT NULL DEFAULT 'PLANNED', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "endedAt" TIMESTAMPTZ(3), "cancellationCode" TEXT, CONSTRAINT "opportunity_planned_waits_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "opportunity_planned_wait_state_check" CHECK (("status"='PLANNED' AND "endedAt" IS NULL) OR ("status" IN ('RESUMED','CANCELLED') AND "endedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "opportunity_planned_waits_taskId_key" ON "opportunity_planned_waits"("taskId");
CREATE UNIQUE INDEX "opportunity_planned_waits_workspaceId_id_key" ON "opportunity_planned_waits"("workspaceId","id");
CREATE UNIQUE INDEX "opportunity_planned_waits_task_context_key" ON "opportunity_planned_waits"("workspaceId","opportunityId","taskId");
CREATE UNIQUE INDEX "opportunity_planned_waits_one_active_key" ON "opportunity_planned_waits"("workspaceId","accountPlanId") WHERE "status"='PLANNED';
CREATE INDEX "opportunity_planned_waits_plan_status_review_idx" ON "opportunity_planned_waits"("workspaceId","accountPlanId","status","reviewAt");
CREATE INDEX "opportunity_planned_waits_owner_status_review_idx" ON "opportunity_planned_waits"("workspaceId","ownerMemberId","status","reviewAt");

CREATE TABLE "opportunity_plan_stakeholders" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "accountPlanId" UUID NOT NULL,
 "name" TEXT NOT NULL, "role" TEXT NOT NULL, "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
 "status" "AccountPlanStakeholderStatus" NOT NULL DEFAULT 'ACTIVE', "replacesStakeholderId" UUID,
 "startedAt" TIMESTAMPTZ(3) NOT NULL, "endedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "opportunity_plan_stakeholders_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "opportunity_plan_stakeholder_state_check" CHECK (("status"='ACTIVE' AND "endedAt" IS NULL) OR ("status"='REPLACED' AND "endedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "opportunity_plan_stakeholders_workspaceId_id_key" ON "opportunity_plan_stakeholders"("workspaceId","id");
CREATE INDEX "opportunity_plan_stakeholders_plan_status_started_idx" ON "opportunity_plan_stakeholders"("workspaceId","accountPlanId","status","startedAt");

CREATE TABLE "opportunity_account_plan_commands" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "accountPlanId" UUID NOT NULL,
 "idempotencyKey" TEXT NOT NULL, "action" TEXT NOT NULL, "result" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "opportunity_account_plan_commands_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "opportunity_account_plan_commands_workspaceId_id_key" ON "opportunity_account_plan_commands"("workspaceId","id");
CREATE UNIQUE INDEX "opportunity_account_plan_commands_workspace_idempotency_key" ON "opportunity_account_plan_commands"("workspaceId","idempotencyKey");
CREATE INDEX "opportunity_account_plan_commands_plan_created_idx" ON "opportunity_account_plan_commands"("workspaceId","accountPlanId","createdAt");

ALTER TABLE "opportunity_plan_episodes" ADD CONSTRAINT "opportunity_plan_episodes_plan_fkey" FOREIGN KEY ("workspaceId","opportunityId","accountPlanId") REFERENCES "opportunity_account_plans"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_episodes" ADD CONSTRAINT "opportunity_plan_episodes_task_fkey" FOREIGN KEY ("workspaceId","opportunityId","taskId") REFERENCES "tasks"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_episodes" ADD CONSTRAINT "opportunity_plan_episodes_owner_fkey" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_tracks" ADD CONSTRAINT "opportunity_plan_tracks_plan_fkey" FOREIGN KEY ("workspaceId","opportunityId","accountPlanId") REFERENCES "opportunity_account_plans"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_tracks" ADD CONSTRAINT "opportunity_plan_tracks_task_fkey" FOREIGN KEY ("workspaceId","opportunityId","taskId") REFERENCES "tasks"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_tracks" ADD CONSTRAINT "opportunity_plan_tracks_owner_fkey" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_track_revisions" ADD CONSTRAINT "opportunity_plan_track_revisions_plan_fkey" FOREIGN KEY ("workspaceId","opportunityId","accountPlanId") REFERENCES "opportunity_account_plans"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_track_revisions" ADD CONSTRAINT "opportunity_plan_track_revisions_track_fkey" FOREIGN KEY ("workspaceId","trackId") REFERENCES "opportunity_plan_tracks"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_track_revisions" ADD CONSTRAINT "opportunity_plan_track_revisions_owner_fkey" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_planned_waits" ADD CONSTRAINT "opportunity_planned_waits_plan_fkey" FOREIGN KEY ("workspaceId","opportunityId","accountPlanId") REFERENCES "opportunity_account_plans"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_planned_waits" ADD CONSTRAINT "opportunity_planned_waits_task_fkey" FOREIGN KEY ("workspaceId","opportunityId","taskId") REFERENCES "tasks"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_planned_waits" ADD CONSTRAINT "opportunity_planned_waits_owner_fkey" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_stakeholders" ADD CONSTRAINT "opportunity_plan_stakeholders_plan_fkey" FOREIGN KEY ("workspaceId","opportunityId","accountPlanId") REFERENCES "opportunity_account_plans"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_plan_stakeholders" ADD CONSTRAINT "opportunity_plan_stakeholders_replaces_fkey" FOREIGN KEY ("workspaceId","replacesStakeholderId") REFERENCES "opportunity_plan_stakeholders"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_account_plan_commands" ADD CONSTRAINT "opportunity_account_plan_commands_plan_fkey" FOREIGN KEY ("workspaceId","opportunityId","accountPlanId") REFERENCES "opportunity_account_plans"("workspaceId","opportunityId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_stage06_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000'; END $$;
CREATE TRIGGER "opportunity_plan_track_revisions_append_only" BEFORE UPDATE OR DELETE ON "opportunity_plan_track_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_stage06_append_only_mutation();
CREATE TRIGGER "opportunity_account_plan_commands_append_only" BEFORE UPDATE OR DELETE ON "opportunity_account_plan_commands" FOR EACH ROW EXECUTE FUNCTION prevent_stage06_append_only_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "opportunity_account_plans", "opportunity_plan_episodes", "opportunity_plan_tracks", "opportunity_planned_waits", "opportunity_plan_stakeholders" TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE "opportunity_plan_track_revisions", "opportunity_account_plan_commands" TO authenticated, service_role;
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
SELECT gen_random_uuid()::text, '718f4c386d9709105144b4cfeecff0b1d040eec36e6fa03e1ab4636e6f6e117a', now(), '20260930110000_stage06_account_plan', NULL, NULL, now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name"='20260930110000_stage06_account_plan');
