-- CreateEnum
CREATE TYPE "PrivacyPolicyStatus" AS ENUM ('DRAFT', 'PENDING_LEGAL', 'APPROVED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "PrivacyChannel" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'SMS', 'IN_APP', 'OTHER');

-- CreateEnum
CREATE TYPE "DataSensitivity" AS ENUM ('STANDARD', 'SENSITIVE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'DENIED', 'REVOKED', 'OPTED_OUT', 'CORRECTED');

-- CreateEnum
CREATE TYPE "ConsentEffect" AS ENUM ('GRANTED', 'DENIED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ConsentStateValue" AS ENUM ('UNKNOWN', 'GRANTED', 'DENIED', 'REVOKED', 'OPTED_OUT', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ConsentEventSource" AS ENUM ('FORM', 'IMPORT', 'MANUAL', 'API', 'SIMULATOR', 'LEGACY_BACKFILL', 'CUSTOMER_REQUEST', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConsentEvidenceQuality" AS ENUM ('MISSING', 'LEGACY_SIGNAL', 'REFERENCED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "PrivacyDecisionOutcome" AS ENUM ('ALLOW', 'DENY', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PrivacyEvaluationMode" AS ENUM ('SHADOW_LOCAL', 'ENFORCED');

-- CreateEnum
CREATE TYPE "RetentionActionType" AS ENUM ('REVIEW', 'MINIMIZE', 'ANONYMIZE', 'RESTRICT', 'DELETE_WHEN_ALLOWED');

-- CreateEnum
CREATE TYPE "RetentionActionStatus" AS ENUM ('IDENTIFIED', 'PLANNED', 'BLOCKED', 'APPROVED', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LegalHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'PORTABILITY', 'OPPOSITION', 'REVOCATION', 'DELETION');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'IDENTITY_PENDING', 'IN_REVIEW', 'ACTION_REQUIRED', 'BLOCKED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrivacyBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "PrivacyBackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrivacyBackfillOutcome" AS ENUM ('CREATED', 'ALREADY_EXISTS', 'DIVERGENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "data_categories" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sensitivity" "DataSensitivity" NOT NULL DEFAULT 'STANDARD',
    "sourceSystems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_bases" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "basisType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'BR',
    "status" "PrivacyPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "approvalReference" TEXT,
    "approvedByActorId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "supersedesId" UUID,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_purposes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "processing_purposes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purpose_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "purposeId" UUID NOT NULL,
    "legalBasisId" UUID,
    "version" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "allowedChannels" "PrivacyChannel"[] DEFAULT ARRAY[]::"PrivacyChannel"[],
    "noticeText" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "status" "PrivacyPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "materiallyChanged" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "ownerMemberId" UUID,
    "approvedByActorId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "supersedesId" UUID,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purpose_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purpose_data_categories" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "purposeVersionId" UUID NOT NULL,
    "dataCategoryId" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purpose_data_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "contactPointId" UUID,
    "purposeVersionId" UUID NOT NULL,
    "channel" "PrivacyChannel" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "effect" "ConsentEffect" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ConsentEventSource" NOT NULL,
    "noticeVersion" TEXT,
    "evidenceReference" TEXT,
    "evidenceQuality" "ConsentEvidenceQuality" NOT NULL DEFAULT 'MISSING',
    "correctionOfId" UUID,
    "actorId" UUID NOT NULL,
    "correlationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_states" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "contactPointId" UUID,
    "purposeId" UUID NOT NULL,
    "channel" "PrivacyChannel" NOT NULL,
    "state" "ConsentStateValue" NOT NULL DEFAULT 'UNKNOWN',
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "sourceEventId" UUID,
    "policyVersion" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "consent_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "contactPointId" UUID,
    "purposeVersionId" UUID,
    "channel" "PrivacyChannel" NOT NULL,
    "intendedAction" TEXT NOT NULL,
    "outcome" "PrivacyDecisionOutcome" NOT NULL,
    "mode" "PrivacyEvaluationMode" NOT NULL,
    "legalBasisStatus" "PrivacyPolicyStatus",
    "consentState" "ConsentStateValue" NOT NULL,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ruleVersion" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT,

    CONSTRAINT "privacy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "purposeVersionId" UUID,
    "legalBasisId" UUID,
    "version" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "durationDays" INTEGER,
    "action" "RetentionActionType" NOT NULL,
    "exceptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PrivacyPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "ownerMemberId" UUID,
    "approvedByActorId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy_categories" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "retentionPolicyVersionId" UUID NOT NULL,
    "dataCategoryId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_policy_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedChannel" "PrivacyChannel" NOT NULL,
    "verificationStatus" "IdentityVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "verificationMethod" TEXT,
    "verificationReference" TEXT,
    "ownerMemberId" UUID,
    "queueId" UUID,
    "reason" TEXT,
    "decision" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "dueAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_request_categories" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "dataCategoryId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_subject_request_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID,
    "accountId" UUID,
    "requestId" UUID,
    "dataCategoryId" UUID,
    "scopeType" TEXT NOT NULL,
    "scopeReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authorityReference" TEXT NOT NULL,
    "status" "LegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "releasedByActorId" UUID,
    "releasedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_actions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "retentionPolicyVersionId" UUID,
    "contactId" UUID,
    "accountId" UUID,
    "requestId" UUID,
    "dataCategoryId" UUID,
    "action" "RetentionActionType" NOT NULL,
    "status" "RetentionActionStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "dueAt" TIMESTAMPTZ(3),
    "preview" JSONB NOT NULL,
    "blockerCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "approvedByActorId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "executedByActorId" UUID,
    "executedAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retention_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_backfill_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runKey" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "mode" "PrivacyBackfillMode" NOT NULL,
    "status" "PrivacyBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "batchSize" INTEGER NOT NULL DEFAULT 100,
    "cursorLeadId" UUID,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "existingCount" INTEGER NOT NULL DEFAULT 0,
    "divergentCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "requestedByActorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "privacy_backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_backfill_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "consentEventId" UUID,
    "outcome" "PrivacyBackfillOutcome" NOT NULL,
    "legacySignal" "ContactPreference" NOT NULL,
    "projectedState" "ConsentStateValue" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_backfill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_categories_workspaceId_code_active_idx" ON "data_categories"("workspaceId", "code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "data_categories_workspaceId_id_key" ON "data_categories"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "data_categories_workspaceId_code_version_key" ON "data_categories"("workspaceId", "code", "version");

-- CreateIndex
CREATE INDEX "legal_bases_workspaceId_status_code_idx" ON "legal_bases"("workspaceId", "status", "code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_bases_workspaceId_id_key" ON "legal_bases"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_bases_workspaceId_code_version_key" ON "legal_bases"("workspaceId", "code", "version");

-- CreateIndex
CREATE INDEX "processing_purposes_workspaceId_active_code_idx" ON "processing_purposes"("workspaceId", "active", "code");

-- CreateIndex
CREATE UNIQUE INDEX "processing_purposes_workspaceId_id_key" ON "processing_purposes"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "processing_purposes_workspaceId_code_key" ON "processing_purposes"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "purpose_versions_workspaceId_status_validFrom_validTo_idx" ON "purpose_versions"("workspaceId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "purpose_versions_workspaceId_id_key" ON "purpose_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purpose_versions_workspaceId_purposeId_version_key" ON "purpose_versions"("workspaceId", "purposeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "purpose_data_categories_workspaceId_id_key" ON "purpose_data_categories"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purpose_data_categories_workspaceId_purposeVersionId_dataCa_key" ON "purpose_data_categories"("workspaceId", "purposeVersionId", "dataCategoryId");

-- CreateIndex
CREATE INDEX "consent_events_workspaceId_contactId_channel_occurredAt_idx" ON "consent_events"("workspaceId", "contactId", "channel", "occurredAt");

-- CreateIndex
CREATE INDEX "consent_events_workspaceId_purposeVersionId_action_occurred_idx" ON "consent_events"("workspaceId", "purposeVersionId", "action", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "consent_events_workspaceId_id_key" ON "consent_events"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_events_workspaceId_idempotencyKey_key" ON "consent_events"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "consent_states_workspaceId_contactId_purposeId_channel_stat_idx" ON "consent_states"("workspaceId", "contactId", "purposeId", "channel", "state");

-- CreateIndex
CREATE INDEX "consent_states_workspaceId_state_updatedAt_idx" ON "consent_states"("workspaceId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "consent_states_workspaceId_id_key" ON "consent_states"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "privacy_decisions_workspaceId_outcome_evaluatedAt_idx" ON "privacy_decisions"("workspaceId", "outcome", "evaluatedAt");

-- CreateIndex
CREATE INDEX "privacy_decisions_workspaceId_contactId_channel_evaluatedAt_idx" ON "privacy_decisions"("workspaceId", "contactId", "channel", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_decisions_workspaceId_id_key" ON "privacy_decisions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_workspaceId_id_key" ON "retention_policies"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_workspaceId_code_key" ON "retention_policies"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "retention_policy_versions_workspaceId_status_validFrom_vali_idx" ON "retention_policy_versions"("workspaceId", "status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_versions_workspaceId_id_key" ON "retention_policy_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_versions_workspaceId_policyId_version_key" ON "retention_policy_versions"("workspaceId", "policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_categories_workspaceId_id_key" ON "retention_policy_categories"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_categories_workspaceId_retentionPolicyVers_key" ON "retention_policy_categories"("workspaceId", "retentionPolicyVersionId", "dataCategoryId");

-- CreateIndex
CREATE INDEX "data_subject_requests_workspaceId_status_dueAt_idx" ON "data_subject_requests"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "data_subject_requests_workspaceId_contactId_requestedAt_idx" ON "data_subject_requests"("workspaceId", "contactId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_workspaceId_id_key" ON "data_subject_requests"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_request_categories_workspaceId_id_key" ON "data_subject_request_categories"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_request_categories_workspaceId_requestId_dataC_key" ON "data_subject_request_categories"("workspaceId", "requestId", "dataCategoryId");

-- CreateIndex
CREATE INDEX "legal_holds_workspaceId_status_endsAt_idx" ON "legal_holds"("workspaceId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "legal_holds_workspaceId_contactId_status_idx" ON "legal_holds"("workspaceId", "contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_holds_workspaceId_id_key" ON "legal_holds"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "retention_actions_workspaceId_status_dueAt_idx" ON "retention_actions"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "retention_actions_workspaceId_contactId_status_idx" ON "retention_actions"("workspaceId", "contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "retention_actions_workspaceId_id_key" ON "retention_actions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_actions_workspaceId_idempotencyKey_key" ON "retention_actions"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "privacy_backfill_runs_workspaceId_status_createdAt_idx" ON "privacy_backfill_runs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_backfill_runs_workspaceId_id_key" ON "privacy_backfill_runs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_backfill_runs_workspaceId_runKey_key" ON "privacy_backfill_runs"("workspaceId", "runKey");

-- CreateIndex
CREATE INDEX "privacy_backfill_items_workspaceId_runId_outcome_idx" ON "privacy_backfill_items"("workspaceId", "runId", "outcome");

-- CreateIndex
CREATE INDEX "privacy_backfill_items_workspaceId_contactId_projectedState_idx" ON "privacy_backfill_items"("workspaceId", "contactId", "projectedState");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_backfill_items_workspaceId_id_key" ON "privacy_backfill_items"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_backfill_items_workspaceId_idempotencyKey_key" ON "privacy_backfill_items"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_backfill_items_workspaceId_runId_leadId_key" ON "privacy_backfill_items"("workspaceId", "runId", "leadId");

-- AddForeignKey
ALTER TABLE "data_categories" ADD CONSTRAINT "data_categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_bases" ADD CONSTRAINT "legal_bases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_purposes" ADD CONSTRAINT "processing_purposes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_workspaceId_purposeId_fkey" FOREIGN KEY ("workspaceId", "purposeId") REFERENCES "processing_purposes"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_workspaceId_legalBasisId_fkey" FOREIGN KEY ("workspaceId", "legalBasisId") REFERENCES "legal_bases"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purpose_data_categories" ADD CONSTRAINT "purpose_data_categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purpose_data_categories" ADD CONSTRAINT "purpose_data_categories_workspaceId_purposeVersionId_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purpose_data_categories" ADD CONSTRAINT "purpose_data_categories_workspaceId_dataCategoryId_fkey" FOREIGN KEY ("workspaceId", "dataCategoryId") REFERENCES "data_categories"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_workspaceId_purposeVersionId_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_workspaceId_purposeId_fkey" FOREIGN KEY ("workspaceId", "purposeId") REFERENCES "processing_purposes"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_workspaceId_sourceEventId_fkey" FOREIGN KEY ("workspaceId", "sourceEventId") REFERENCES "consent_events"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_decisions" ADD CONSTRAINT "privacy_decisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_workspaceId_policyId_fkey" FOREIGN KEY ("workspaceId", "policyId") REFERENCES "retention_policies"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_workspaceId_purposeVersionId_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_workspaceId_legalBasisId_fkey" FOREIGN KEY ("workspaceId", "legalBasisId") REFERENCES "legal_bases"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_categories" ADD CONSTRAINT "retention_policy_categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_categories" ADD CONSTRAINT "retention_policy_categories_workspaceId_retentionPolicyVer_fkey" FOREIGN KEY ("workspaceId", "retentionPolicyVersionId") REFERENCES "retention_policy_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy_categories" ADD CONSTRAINT "retention_policy_categories_workspaceId_dataCategoryId_fkey" FOREIGN KEY ("workspaceId", "dataCategoryId") REFERENCES "data_categories"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request_categories" ADD CONSTRAINT "data_subject_request_categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request_categories" ADD CONSTRAINT "data_subject_request_categories_workspaceId_requestId_fkey" FOREIGN KEY ("workspaceId", "requestId") REFERENCES "data_subject_requests"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request_categories" ADD CONSTRAINT "data_subject_request_categories_workspaceId_dataCategoryId_fkey" FOREIGN KEY ("workspaceId", "dataCategoryId") REFERENCES "data_categories"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_workspaceId_dataCategoryId_fkey" FOREIGN KEY ("workspaceId", "dataCategoryId") REFERENCES "data_categories"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_workspaceId_retentionPolicyVersionId_fkey" FOREIGN KEY ("workspaceId", "retentionPolicyVersionId") REFERENCES "retention_policy_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_workspaceId_dataCategoryId_fkey" FOREIGN KEY ("workspaceId", "dataCategoryId") REFERENCES "data_categories"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_backfill_runs" ADD CONSTRAINT "privacy_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_backfill_items" ADD CONSTRAINT "privacy_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_backfill_items" ADD CONSTRAINT "privacy_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "privacy_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CRM-36 invariants and cross-workspace references not expressible by the Prisma model alone.
ALTER TABLE "legal_bases" ADD CONSTRAINT "legal_bases_approval_check" CHECK (
  ("status" IN ('DRAFT', 'PENDING_LEGAL', 'RETIRED') AND "approvedAt" IS NULL AND "approvedByActorId" IS NULL)
  OR ("status" IN ('APPROVED', 'ACTIVE') AND "approvedAt" IS NOT NULL AND "approvedByActorId" IS NOT NULL AND "approvalReference" IS NOT NULL)
);
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_approval_check" CHECK (
  ("status" IN ('DRAFT', 'PENDING_LEGAL', 'RETIRED') AND "approvedAt" IS NULL AND "approvedByActorId" IS NULL)
  OR ("status" IN ('APPROVED', 'ACTIVE') AND "approvedAt" IS NOT NULL AND "approvedByActorId" IS NOT NULL)
);
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_approval_check" CHECK (
  ("status" IN ('DRAFT', 'PENDING_LEGAL', 'RETIRED') AND "approvedAt" IS NULL AND "approvedByActorId" IS NULL)
  OR ("status" IN ('APPROVED', 'ACTIVE') AND "approvedAt" IS NOT NULL AND "approvedByActorId" IS NOT NULL)
);
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_duration_check" CHECK ("durationDays" IS NULL OR "durationDays" > 0);
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_grant_evidence_check" CHECK (
  "action" <> 'GRANTED' OR ("noticeVersion" IS NOT NULL AND "evidenceQuality" <> 'MISSING')
);
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_time_check" CHECK ("capturedAt" >= "occurredAt" - interval '24 hours');
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_owner_check" CHECK (("ownerMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL));
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_verification_check" CHECK (
  ("verificationStatus" = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "verificationMethod" IS NOT NULL)
  OR ("verificationStatus" <> 'VERIFIED' AND "verifiedAt" IS NULL)
);
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_scope_check" CHECK (
  "contactId" IS NOT NULL OR "accountId" IS NOT NULL OR "requestId" IS NOT NULL
);
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_period_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_target_check" CHECK (
  "contactId" IS NOT NULL OR "accountId" IS NOT NULL OR "requestId" IS NOT NULL
);

CREATE UNIQUE INDEX "consent_states_current_with_point_key"
  ON "consent_states"("workspaceId", "contactId", "contactPointId", "purposeId", "channel")
  WHERE "contactPointId" IS NOT NULL;
CREATE UNIQUE INDEX "consent_states_current_without_point_key"
  ON "consent_states"("workspaceId", "contactId", "purposeId", "channel")
  WHERE "contactPointId" IS NULL;

ALTER TABLE "legal_bases" ADD CONSTRAINT "legal_bases_approvedByActor_fkey" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_approvedByActor_fkey" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_actor_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "privacy_decisions" ADD CONSTRAINT "privacy_decisions_contact_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "privacy_decisions" ADD CONSTRAINT "privacy_decisions_contactPoint_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "privacy_decisions" ADD CONSTRAINT "privacy_decisions_purposeVersion_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "privacy_decisions" ADD CONSTRAINT "privacy_decisions_actor_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_approvedByActor_fkey" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_queue_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_request_fkey" FOREIGN KEY ("workspaceId", "requestId") REFERENCES "data_subject_requests"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_request_fkey" FOREIGN KEY ("workspaceId", "requestId") REFERENCES "data_subject_requests"("workspaceId", "id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION crm36_reject_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_events_append_only_update BEFORE UPDATE OR DELETE ON "consent_events"
FOR EACH ROW EXECUTE FUNCTION crm36_reject_append_only_change();

CREATE OR REPLACE FUNCTION crm36_reject_published_policy_change() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'published policy versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_bases_published_immutable BEFORE UPDATE OR DELETE ON "legal_bases"
FOR EACH ROW EXECUTE FUNCTION crm36_reject_published_policy_change();
CREATE TRIGGER purpose_versions_published_immutable BEFORE UPDATE OR DELETE ON "purpose_versions"
FOR EACH ROW EXECUTE FUNCTION crm36_reject_published_policy_change();
CREATE TRIGGER retention_policy_versions_published_immutable BEFORE UPDATE OR DELETE ON "retention_policy_versions"
FOR EACH ROW EXECUTE FUNCTION crm36_reject_published_policy_change();
