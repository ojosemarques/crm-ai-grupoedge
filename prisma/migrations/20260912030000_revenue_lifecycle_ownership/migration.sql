-- CreateEnum
CREATE TYPE "RevenueLifecycleEntityType" AS ENUM ('CONTACT', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "RevenueLifecycleStage" AS ENUM ('UNKNOWN', 'PROSPECT', 'LEAD', 'QUALIFIED', 'OPPORTUNITY', 'CUSTOMER', 'ONBOARDING', 'ACTIVE', 'RENEWAL', 'CHURN', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LifecycleSource" AS ENUM ('BACKFILL', 'HUMAN', 'LEAD_EVENT', 'OPPORTUNITY_EVENT', 'HANDOFF_EVENT', 'SYSTEM_RULE', 'SEED');

-- CreateEnum
CREATE TYPE "LifecycleEvidenceQuality" AS ENUM ('UNKNOWN', 'INFERRED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "OwnershipEntityType" AS ENUM ('CONTACT', 'ACCOUNT', 'LEAD', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "OwnershipFunction" AS ENUM ('MARKETING', 'SDR', 'CLOSER', 'CUSTOMER_SUCCESS', 'FARMER', 'FINANCE', 'REVOPS');

-- CreateEnum
CREATE TYPE "OwnershipAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "OwnershipSource" AS ENUM ('BACKFILL', 'HUMAN', 'LEAD_ASSIGNMENT', 'OPPORTUNITY_ASSIGNMENT', 'HANDOFF', 'SYSTEM_RULE', 'SEED');

-- CreateEnum
CREATE TYPE "OwnershipTransferStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LifecycleBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "LifecycleBackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LifecycleBackfillOutcome" AS ENUM ('CREATED', 'ALREADY_EXISTS', 'AMBIGUOUS', 'SKIPPED', 'ORPHANED', 'FAILED');

-- CreateTable
CREATE TABLE "revenue_lifecycles" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "RevenueLifecycleEntityType" NOT NULL,
    "contactId" UUID,
    "accountId" UUID,
    "stage" "RevenueLifecycleStage" NOT NULL DEFAULT 'UNKNOWN',
    "currentSince" TIMESTAMPTZ(3) NOT NULL,
    "source" "LifecycleSource" NOT NULL,
    "sourceEntityType" TEXT,
    "sourceEntityId" UUID,
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "evidenceQuality" "LifecycleEvidenceQuality" NOT NULL DEFAULT 'UNKNOWN',
    "lastHistoryId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "revenue_lifecycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycle_history" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "RevenueLifecycleEntityType" NOT NULL,
    "contactId" UUID,
    "accountId" UUID,
    "fromStage" "RevenueLifecycleStage",
    "toStage" "RevenueLifecycleStage" NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL,
    "exitedAt" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "source" "LifecycleSource" NOT NULL,
    "sourceEntityType" TEXT,
    "sourceEntityId" UUID,
    "correlationId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "evidence" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycle_rule_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fromStage" "RevenueLifecycleStage" NOT NULL,
    "toStage" "RevenueLifecycleStage" NOT NULL,
    "requiredFunctions" "OwnershipFunction"[],
    "allowedSources" "LifecycleSource"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_assignments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "OwnershipEntityType" NOT NULL,
    "contactId" UUID,
    "accountId" UUID,
    "leadId" UUID,
    "opportunityId" UUID,
    "function" "OwnershipFunction" NOT NULL,
    "memberId" UUID,
    "queueId" UUID,
    "status" "OwnershipAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "source" "OwnershipSource" NOT NULL,
    "sourceEntityType" TEXT,
    "sourceEntityId" UUID,
    "correlationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "assignedByActorId" UUID NOT NULL,
    "endedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "OwnershipEntityType" NOT NULL,
    "contactId" UUID,
    "accountId" UUID,
    "leadId" UUID,
    "opportunityId" UUID,
    "fromFunction" "OwnershipFunction" NOT NULL,
    "toFunction" "OwnershipFunction" NOT NULL,
    "fromAssignmentId" UUID,
    "targetMemberId" UUID,
    "targetQueueId" UUID,
    "status" "OwnershipTransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "nextActionDescription" TEXT,
    "dueAt" TIMESTAMPTZ(3),
    "requestedByActorId" UUID NOT NULL,
    "respondedByActorId" UUID,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycle_backfill_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "mode" "LifecycleBackfillMode" NOT NULL,
    "status" "LifecycleBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "cursor" TEXT,
    "batchSize" INTEGER NOT NULL,
    "totalEligible" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "existingCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "orphanedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "requestedByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lifecycle_backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycle_backfill_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "contactId" UUID,
    "accountId" UUID,
    "leadId" UUID,
    "opportunityId" UUID,
    "outcome" "LifecycleBackfillOutcome" NOT NULL,
    "lifecycleStage" "RevenueLifecycleStage",
    "ownershipFunction" "OwnershipFunction",
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_backfill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revenue_lifecycles_workspaceId_entityType_stage_currentSinc_idx" ON "revenue_lifecycles"("workspaceId", "entityType", "stage", "currentSince");

-- CreateIndex
CREATE INDEX "revenue_lifecycles_workspaceId_contactId_idx" ON "revenue_lifecycles"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "revenue_lifecycles_workspaceId_accountId_idx" ON "revenue_lifecycles"("workspaceId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_lifecycles_workspaceId_id_key" ON "revenue_lifecycles"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "lifecycle_history_workspaceId_entityType_toStage_enteredAt_idx" ON "lifecycle_history"("workspaceId", "entityType", "toStage", "enteredAt");

-- CreateIndex
CREATE INDEX "lifecycle_history_workspaceId_contactId_enteredAt_idx" ON "lifecycle_history"("workspaceId", "contactId", "enteredAt");

-- CreateIndex
CREATE INDEX "lifecycle_history_workspaceId_accountId_enteredAt_idx" ON "lifecycle_history"("workspaceId", "accountId", "enteredAt");

-- CreateIndex
CREATE INDEX "lifecycle_history_workspaceId_exitedAt_idx" ON "lifecycle_history"("workspaceId", "exitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_history_workspaceId_id_key" ON "lifecycle_history"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_history_workspaceId_idempotencyKey_key" ON "lifecycle_history"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "lifecycle_rule_versions_workspaceId_fromStage_toStage_activ_idx" ON "lifecycle_rule_versions"("workspaceId", "fromStage", "toStage", "active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_rule_versions_workspaceId_id_key" ON "lifecycle_rule_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_rule_versions_workspaceId_key_version_fromStage_toStage_key" ON "lifecycle_rule_versions"("workspaceId", "key", "version", "fromStage", "toStage");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_entityType_function_statu_idx" ON "ownership_assignments"("workspaceId", "entityType", "function", "status", "validFrom");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_memberId_function_status_idx" ON "ownership_assignments"("workspaceId", "memberId", "function", "status");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_queueId_function_status_idx" ON "ownership_assignments"("workspaceId", "queueId", "function", "status");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_contactId_function_status_idx" ON "ownership_assignments"("workspaceId", "contactId", "function", "status");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_accountId_function_status_idx" ON "ownership_assignments"("workspaceId", "accountId", "function", "status");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_leadId_function_status_idx" ON "ownership_assignments"("workspaceId", "leadId", "function", "status");

-- CreateIndex
CREATE INDEX "ownership_assignments_workspaceId_opportunityId_function_st_idx" ON "ownership_assignments"("workspaceId", "opportunityId", "function", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_assignments_workspaceId_id_key" ON "ownership_assignments"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_assignments_workspaceId_idempotencyKey_key" ON "ownership_assignments"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_status_dueAt_requestedAt_idx" ON "ownership_transfers"("workspaceId", "status", "dueAt", "requestedAt");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_targetMemberId_status_reque_idx" ON "ownership_transfers"("workspaceId", "targetMemberId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_targetQueueId_status_reques_idx" ON "ownership_transfers"("workspaceId", "targetQueueId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_contactId_status_idx" ON "ownership_transfers"("workspaceId", "contactId", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_accountId_status_idx" ON "ownership_transfers"("workspaceId", "accountId", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_leadId_status_idx" ON "ownership_transfers"("workspaceId", "leadId", "status");

-- CreateIndex
CREATE INDEX "ownership_transfers_workspaceId_opportunityId_status_idx" ON "ownership_transfers"("workspaceId", "opportunityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_transfers_workspaceId_id_key" ON "ownership_transfers"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_transfers_workspaceId_idempotencyKey_key" ON "ownership_transfers"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "lifecycle_backfill_runs_workspaceId_status_createdAt_idx" ON "lifecycle_backfill_runs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_backfill_runs_workspaceId_id_key" ON "lifecycle_backfill_runs"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "lifecycle_backfill_items_workspaceId_runId_outcome_idx" ON "lifecycle_backfill_items"("workspaceId", "runId", "outcome");

-- CreateIndex
CREATE INDEX "lifecycle_backfill_items_workspaceId_contactId_idx" ON "lifecycle_backfill_items"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "lifecycle_backfill_items_workspaceId_accountId_idx" ON "lifecycle_backfill_items"("workspaceId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_backfill_items_workspaceId_id_key" ON "lifecycle_backfill_items"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lifecycle_backfill_items_workspaceId_idempotencyKey_key" ON "lifecycle_backfill_items"("workspaceId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "revenue_lifecycles" ADD CONSTRAINT "revenue_lifecycles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_lifecycles" ADD CONSTRAINT "revenue_lifecycles_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_lifecycles" ADD CONSTRAINT "revenue_lifecycles_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_lifecycles" ADD CONSTRAINT "revenue_lifecycles_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_lifecycles" ADD CONSTRAINT "revenue_lifecycles_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_history" ADD CONSTRAINT "lifecycle_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_history" ADD CONSTRAINT "lifecycle_history_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_history" ADD CONSTRAINT "lifecycle_history_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_history" ADD CONSTRAINT "lifecycle_history_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_rule_versions" ADD CONSTRAINT "lifecycle_rule_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_rule_versions" ADD CONSTRAINT "lifecycle_rule_versions_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_assignedByActorId_fkey" FOREIGN KEY ("workspaceId", "assignedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_workspaceId_endedByActorId_fkey" FOREIGN KEY ("workspaceId", "endedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_fromAssignmentId_fkey" FOREIGN KEY ("workspaceId", "fromAssignmentId") REFERENCES "ownership_assignments"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_targetMemberId_fkey" FOREIGN KEY ("workspaceId", "targetMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_targetQueueId_fkey" FOREIGN KEY ("workspaceId", "targetQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_workspaceId_respondedByActorId_fkey" FOREIGN KEY ("workspaceId", "respondedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_runs" ADD CONSTRAINT "lifecycle_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_runs" ADD CONSTRAINT "lifecycle_backfill_runs_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_runs" ADD CONSTRAINT "lifecycle_backfill_runs_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_items" ADD CONSTRAINT "lifecycle_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_items" ADD CONSTRAINT "lifecycle_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "lifecycle_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_items" ADD CONSTRAINT "lifecycle_backfill_items_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_items" ADD CONSTRAINT "lifecycle_backfill_items_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_items" ADD CONSTRAINT "lifecycle_backfill_items_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_backfill_items" ADD CONSTRAINT "lifecycle_backfill_items_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain integrity: exactly one canonical lifecycle target.
ALTER TABLE "revenue_lifecycles" ADD CONSTRAINT "revenue_lifecycles_exact_target_check" CHECK (
  ("entityType" = 'CONTACT' AND "contactId" IS NOT NULL AND "accountId" IS NULL) OR
  ("entityType" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "contactId" IS NULL)
);
ALTER TABLE "lifecycle_history" ADD CONSTRAINT "lifecycle_history_exact_target_check" CHECK (
  ("entityType" = 'CONTACT' AND "contactId" IS NOT NULL AND "accountId" IS NULL) OR
  ("entityType" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "contactId" IS NULL)
);
ALTER TABLE "lifecycle_history" ADD CONSTRAINT "lifecycle_history_interval_check" CHECK ("exitedAt" IS NULL OR "exitedAt" >= "enteredAt");
ALTER TABLE "lifecycle_rule_versions" ADD CONSTRAINT "lifecycle_rule_versions_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

CREATE UNIQUE INDEX "revenue_lifecycles_active_contact_key"
  ON "revenue_lifecycles" ("workspaceId", "contactId") WHERE "contactId" IS NOT NULL;
CREATE UNIQUE INDEX "revenue_lifecycles_active_account_key"
  ON "revenue_lifecycles" ("workspaceId", "accountId") WHERE "accountId" IS NOT NULL;
CREATE UNIQUE INDEX "lifecycle_history_open_contact_key"
  ON "lifecycle_history" ("workspaceId", "contactId") WHERE "contactId" IS NOT NULL AND "exitedAt" IS NULL;
CREATE UNIQUE INDEX "lifecycle_history_open_account_key"
  ON "lifecycle_history" ("workspaceId", "accountId") WHERE "accountId" IS NOT NULL AND "exitedAt" IS NULL;

-- Domain integrity: exactly one aggregate and exactly one operational destination.
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_exact_target_check" CHECK (
  ("entityType" = 'CONTACT' AND "contactId" IS NOT NULL AND "accountId" IS NULL AND "leadId" IS NULL AND "opportunityId" IS NULL) OR
  ("entityType" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "contactId" IS NULL AND "leadId" IS NULL AND "opportunityId" IS NULL) OR
  ("entityType" = 'LEAD' AND "leadId" IS NOT NULL AND "contactId" IS NULL AND "accountId" IS NULL AND "opportunityId" IS NULL) OR
  ("entityType" = 'OPPORTUNITY' AND "opportunityId" IS NOT NULL AND "contactId" IS NULL AND "accountId" IS NULL AND "leadId" IS NULL)
);
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_exact_destination_check" CHECK (num_nonnulls("memberId", "queueId") = 1);
ALTER TABLE "ownership_assignments" ADD CONSTRAINT "ownership_assignments_interval_check" CHECK (
  ("status" = 'ACTIVE' AND "validTo" IS NULL AND "endedByActorId" IS NULL) OR
  ("status" = 'ENDED' AND "validTo" IS NOT NULL AND "endedByActorId" IS NOT NULL AND "validTo" >= "validFrom")
);
CREATE UNIQUE INDEX "ownership_active_contact_function_key"
  ON "ownership_assignments" ("workspaceId", "contactId", "function") WHERE "contactId" IS NOT NULL AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "ownership_active_account_function_key"
  ON "ownership_assignments" ("workspaceId", "accountId", "function") WHERE "accountId" IS NOT NULL AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "ownership_active_lead_function_key"
  ON "ownership_assignments" ("workspaceId", "leadId", "function") WHERE "leadId" IS NOT NULL AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "ownership_active_opportunity_function_key"
  ON "ownership_assignments" ("workspaceId", "opportunityId", "function") WHERE "opportunityId" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_exact_target_check" CHECK (
  ("entityType" = 'CONTACT' AND "contactId" IS NOT NULL AND "accountId" IS NULL AND "leadId" IS NULL AND "opportunityId" IS NULL) OR
  ("entityType" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "contactId" IS NULL AND "leadId" IS NULL AND "opportunityId" IS NULL) OR
  ("entityType" = 'LEAD' AND "leadId" IS NOT NULL AND "contactId" IS NULL AND "accountId" IS NULL AND "opportunityId" IS NULL) OR
  ("entityType" = 'OPPORTUNITY' AND "opportunityId" IS NOT NULL AND "contactId" IS NULL AND "accountId" IS NULL AND "leadId" IS NULL)
);
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_exact_destination_check" CHECK (num_nonnulls("targetMemberId", "targetQueueId") = 1);

-- Historical facts cannot be deleted or rewritten. The only permitted update is closing an open interval once.
CREATE OR REPLACE FUNCTION prevent_lifecycle_history_rewrite() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LifecycleHistory is append-only';
  END IF;
  IF OLD."exitedAt" IS NULL AND NEW."exitedAt" IS NOT NULL
     AND NEW."exitedAt" >= OLD."enteredAt"
     AND (to_jsonb(NEW) - 'exitedAt') = (to_jsonb(OLD) - 'exitedAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'LifecycleHistory facts are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER lifecycle_history_append_only
BEFORE UPDATE OR DELETE ON "lifecycle_history"
FOR EACH ROW EXECUTE FUNCTION prevent_lifecycle_history_rewrite();
