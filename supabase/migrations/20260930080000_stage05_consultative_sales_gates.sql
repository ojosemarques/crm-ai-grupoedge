SET search_path TO crm, public;
CREATE TYPE "SalesGateProfile" AS ENUM ('STANDARD', 'MANDATO');
CREATE TYPE "ConsultativeEvidenceType" AS ENUM ('DIAGNOSIS', 'ECONOMIC_BUYER', 'SPONSOR', 'USE_CASE', 'PILOT_CRITERIA', 'PROPOSAL_SCOPE', 'DECISION');
CREATE TYPE "StageActivityReentryPolicy" AS ENUM ('RECREATE_ON_REENTRY', 'ONCE_PER_OPPORTUNITY');
CREATE TYPE "StageActivityInstanceStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'SUPERSEDED');

ALTER TYPE "ProcessViolationType" ADD VALUE 'OPPORTUNITY_STAGNANT';
ALTER TYPE "ProcessViolationType" ADD VALUE 'OPPORTUNITY_STAGE_OVERDUE';
ALTER TYPE "ProcessViolationType" ADD VALUE 'OPPORTUNITY_VALUE_UNCERTAIN';
ALTER TYPE "ProcessViolationType" ADD VALUE 'OPPORTUNITY_DECISION_MAKER_UNCERTAIN';

ALTER TABLE "products" ADD COLUMN "salesGateProfile" "SalesGateProfile" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "pipeline_template_activity_definitions" ADD COLUMN "reentryPolicy" "StageActivityReentryPolicy" NOT NULL DEFAULT 'RECREATE_ON_REENTRY';

UPDATE "products"
SET "salesGateProfile" = 'MANDATO'
WHERE lower("name") LIKE '%mandato%' OR lower("sku") LIKE '%mandato%';

CREATE TABLE "opportunity_evidence" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "type" "ConsultativeEvidenceType" NOT NULL,
  "version" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "stakeholderName" TEXT,
  "sourceUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedByActorId" UUID NOT NULL,
  "supersededAt" TIMESTAMPTZ(3),
  "supersededByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "opportunity_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_evidence_version_check" CHECK ("version" > 0),
  CONSTRAINT "opportunity_evidence_supersede_check" CHECK (("supersededAt" IS NULL) = ("supersededByActorId" IS NULL))
);
CREATE UNIQUE INDEX "opportunity_evidence_workspaceId_id_key" ON "opportunity_evidence"("workspaceId", "id");
CREATE UNIQUE INDEX "opportunity_evidence_workspaceId_opportunityId_type_version_key" ON "opportunity_evidence"("workspaceId", "opportunityId", "type", "version");
CREATE UNIQUE INDEX "opportunity_evidence_workspaceId_idempotencyKey_key" ON "opportunity_evidence"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "opportunity_evidence_one_active_type_key" ON "opportunity_evidence"("workspaceId", "opportunityId", "type") WHERE "supersededAt" IS NULL;
CREATE INDEX "opportunity_evidence_workspaceId_opportunityId_type_supersededAt_idx" ON "opportunity_evidence"("workspaceId", "opportunityId", "type", "supersededAt");

CREATE TABLE "opportunity_stage_activity_instances" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "stageHistoryId" UUID NOT NULL,
  "definitionId" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "entrySequence" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "script" TEXT,
  "activityType" TEXT NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "reentryPolicy" "StageActivityReentryPolicy" NOT NULL,
  "status" "StageActivityInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
  "completedAt" TIMESTAMPTZ(3),
  "supersededAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "opportunity_stage_activity_instances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stage_activity_entry_sequence_check" CHECK ("entrySequence" > 0),
  CONSTRAINT "stage_activity_status_dates_check" CHECK (("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL) AND ("status" <> 'SUPERSEDED' OR "supersededAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "opportunity_stage_activity_instances_taskId_key" ON "opportunity_stage_activity_instances"("taskId");
CREATE UNIQUE INDEX "opportunity_stage_activity_instances_workspaceId_id_key" ON "opportunity_stage_activity_instances"("workspaceId", "id");
CREATE UNIQUE INDEX "opportunity_stage_activity_instances_workspaceId_stageHistoryId_definitionId_key" ON "opportunity_stage_activity_instances"("workspaceId", "stageHistoryId", "definitionId");
CREATE UNIQUE INDEX "stage_activity_entry_sequence_key" ON "opportunity_stage_activity_instances"("workspaceId", "opportunityId", "definitionId", "entrySequence");
CREATE UNIQUE INDEX "stage_activity_task_key" ON "opportunity_stage_activity_instances"("workspaceId", "opportunityId", "taskId");
CREATE INDEX "opportunity_stage_activity_instances_workspaceId_opportunityId_status_dueAt_idx" ON "opportunity_stage_activity_instances"("workspaceId", "opportunityId", "status", "dueAt");
CREATE INDEX "opportunity_stage_activity_instances_workspaceId_taskId_idx" ON "opportunity_stage_activity_instances"("workspaceId", "taskId");

CREATE TABLE "opportunity_gate_evaluations" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "stageHistoryId" UUID NOT NULL,
  "pactoRevisionId" UUID,
  "salesGateProfile" "SalesGateProfile" NOT NULL,
  "targetStageCode" "OpportunityPipelineStageCode" NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "evaluatedByActorId" UUID NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "opportunity_gate_evaluations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "opportunity_gate_evaluations_stageHistoryId_key" ON "opportunity_gate_evaluations"("stageHistoryId");
CREATE UNIQUE INDEX "opportunity_gate_evaluations_workspaceId_id_key" ON "opportunity_gate_evaluations"("workspaceId", "id");
CREATE UNIQUE INDEX "opportunity_gate_evaluations_workspaceId_stageHistoryId_key" ON "opportunity_gate_evaluations"("workspaceId", "stageHistoryId");
CREATE INDEX "opportunity_gate_evaluations_workspaceId_opportunityId_evaluatedAt_idx" ON "opportunity_gate_evaluations"("workspaceId", "opportunityId", "evaluatedAt");
CREATE INDEX "opportunity_gate_evaluations_workspaceId_pactoRevisionId_idx" ON "opportunity_gate_evaluations"("workspaceId", "pactoRevisionId");

CREATE TABLE "opportunity_deferrals" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewAt" TIMESTAMPTZ(3) NOT NULL,
  "taskId" UUID NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "opportunity_deferrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_deferrals_reason_check" CHECK (length(trim("reason")) >= 3)
);
CREATE UNIQUE INDEX "opportunity_deferrals_taskId_key" ON "opportunity_deferrals"("taskId");
CREATE UNIQUE INDEX "opportunity_deferrals_workspaceId_id_key" ON "opportunity_deferrals"("workspaceId", "id");
CREATE UNIQUE INDEX "opportunity_deferrals_workspaceId_opportunityId_taskId_key" ON "opportunity_deferrals"("workspaceId", "opportunityId", "taskId");
CREATE INDEX "opportunity_deferrals_workspaceId_opportunityId_reviewAt_idx" ON "opportunity_deferrals"("workspaceId", "opportunityId", "reviewAt");
CREATE INDEX "opportunity_deferrals_workspaceId_ownerMemberId_reviewAt_idx" ON "opportunity_deferrals"("workspaceId", "ownerMemberId", "reviewAt");

ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_workspaceId_recordedByActorId_fkey" FOREIGN KEY ("workspaceId", "recordedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_workspaceId_supersededByActorId_fkey" FOREIGN KEY ("workspaceId", "supersededByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opportunity_stage_activity_instances" ADD CONSTRAINT "opportunity_stage_activity_instances_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_stage_activity_instances" ADD CONSTRAINT "stage_activity_opportunity_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_stage_activity_instances" ADD CONSTRAINT "opportunity_stage_activity_instances_workspaceId_stageHistoryId_fkey" FOREIGN KEY ("workspaceId", "stageHistoryId") REFERENCES "stage_history"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_stage_activity_instances" ADD CONSTRAINT "opportunity_stage_activity_instances_workspaceId_definitionId_fkey" FOREIGN KEY ("workspaceId", "definitionId") REFERENCES "pipeline_template_activity_definitions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_stage_activity_instances" ADD CONSTRAINT "stage_activity_task_fkey" FOREIGN KEY ("workspaceId", "opportunityId", "taskId") REFERENCES "tasks"("workspaceId", "opportunityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opportunity_gate_evaluations" ADD CONSTRAINT "opportunity_gate_evaluations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_gate_evaluations" ADD CONSTRAINT "opportunity_gate_evaluations_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_gate_evaluations" ADD CONSTRAINT "opportunity_gate_evaluations_workspaceId_stageHistoryId_fkey" FOREIGN KEY ("workspaceId", "stageHistoryId") REFERENCES "stage_history"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_gate_evaluations" ADD CONSTRAINT "opportunity_gate_evaluations_workspaceId_pactoRevisionId_fkey" FOREIGN KEY ("workspaceId", "pactoRevisionId") REFERENCES "pacto_revisions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_gate_evaluations" ADD CONSTRAINT "opportunity_gate_evaluations_workspaceId_evaluatedByActorId_fkey" FOREIGN KEY ("workspaceId", "evaluatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opportunity_deferrals" ADD CONSTRAINT "opportunity_deferrals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_deferrals" ADD CONSTRAINT "opportunity_deferrals_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_deferrals" ADD CONSTRAINT "opportunity_deferrals_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_deferrals" ADD CONSTRAINT "opportunity_deferrals_workspaceId_opportunityId_taskId_fkey" FOREIGN KEY ("workspaceId", "opportunityId", "taskId") REFERENCES "tasks"("workspaceId", "opportunityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_deferrals" ADD CONSTRAINT "opportunity_deferrals_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_stage05_append_only_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "opportunity_gate_evaluations_append_only" BEFORE UPDATE OR DELETE ON "opportunity_gate_evaluations" FOR EACH ROW EXECUTE FUNCTION "prevent_stage05_append_only_mutation"();
CREATE TRIGGER "opportunity_deferrals_append_only" BEFORE UPDATE OR DELETE ON "opportunity_deferrals" FOR EACH ROW EXECUTE FUNCTION "prevent_stage05_append_only_mutation"();

GRANT SELECT,INSERT,UPDATE,DELETE ON crm.opportunity_evidence, crm.opportunity_stage_activity_instances, crm.opportunity_gate_evaluations, crm.opportunity_deferrals TO crm_politizai_runtime;

INSERT INTO crm._prisma_migrations (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count) SELECT '63000700-0000-4000-8000-000000000005','22e07787a046182e7814d08ae5f53d65e06b1f916b0d8d3b5c88def8a0020dbd',CURRENT_TIMESTAMP,'20260930070000_stage05_consultative_sales_gates',NULL,NULL,CURRENT_TIMESTAMP,1 WHERE NOT EXISTS (SELECT 1 FROM crm._prisma_migrations WHERE migration_name='20260930070000_stage05_consultative_sales_gates');
