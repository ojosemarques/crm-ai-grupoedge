-- CRM-38: marketing journey and multi-touch attribution foundation.
-- Additive only. Historical facts and calculation results are protected by triggers below.

CREATE TYPE "MarketingDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "MarketingSessionIdentityState" AS ENUM ('ANONYMOUS', 'ASSOCIATED');
CREATE TYPE "MarketingEvidenceClass" AS ENUM ('DIRECT', 'DERIVED', 'LEGACY_REVIEW_REQUIRED', 'UNKNOWN');
CREATE TYPE "MarketingTouchpointKind" AS ENUM ('PAGE_VIEW', 'FORM_VIEW', 'FORM_SUBMIT', 'AD_CLICK', 'ORGANIC_VISIT', 'REFERRAL', 'DIRECT', 'OTHER');
CREATE TYPE "AttributionConversionKind" AS ENUM ('LEAD_RECEIVED', 'QUALIFIED', 'MEETING_HELD', 'OPPORTUNITY_CREATED', 'WON', 'LOST', 'DISQUALIFIED');
CREATE TYPE "AttributionFactStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'CORRECTED');
CREATE TYPE "AttributionModelAlgorithm" AS ENUM ('FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR');
CREATE TYPE "AttributionModelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "AttributionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "AttributionCoverageState" AS ENUM ('COMPLETE', 'PARTIAL', 'UNATTRIBUTED');
CREATE TYPE "AcquisitionReviewStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "MarketingBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');
CREATE TYPE "MarketingBackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "MarketingBackfillOutcome" AS ENUM ('CREATED', 'ALREADY_EXISTS', 'DIVERGENT', 'SKIPPED', 'FAILED');

ALTER TABLE "lead_form_submissions"
  ADD COLUMN "marketingSessionId" UUID,
  ADD COLUMN "marketingFormId" UUID,
  ADD COLUMN "marketingFormVersionId" UUID,
  ADD COLUMN "marketingTouchpointId" UUID,
  ADD COLUMN "attributionConversionId" UUID;

CREATE TABLE "landing_pages" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL,
  "name" TEXT NOT NULL, "canonicalUrl" TEXT NOT NULL,
  "status" "MarketingDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "currentVersion" INTEGER NOT NULL DEFAULT 1, "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "landing_pages_version_check" CHECK ("currentVersion" > 0)
);
CREATE TABLE "landing_page_versions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "landingPageId" UUID NOT NULL,
  "version" INTEGER NOT NULL, "canonicalUrl" TEXT NOT NULL, "title" TEXT,
  "schemaVersion" TEXT NOT NULL, "definition" JSONB NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "landing_page_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "landing_page_versions_version_check" CHECK ("version" > 0)
);
CREATE TABLE "marketing_forms" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "MarketingDefinitionStatus" NOT NULL DEFAULT 'DRAFT', "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3), CONSTRAINT "marketing_forms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_forms_version_check" CHECK ("currentVersion" > 0)
);
CREATE TABLE "marketing_form_versions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "marketingFormId" UUID NOT NULL,
  "landingPageId" UUID, "version" INTEGER NOT NULL, "schemaVersion" TEXT NOT NULL,
  "definition" JSONB NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_form_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_form_versions_version_check" CHECK ("version" > 0)
);
CREATE TABLE "marketing_sessions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "publicId" TEXT NOT NULL, "contactId" UUID,
  "identityState" "MarketingSessionIdentityState" NOT NULL DEFAULT 'ANONYMOUS',
  "startedAt" TIMESTAMPTZ(3) NOT NULL, "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3), "anonymousTokenHash" TEXT, "locale" TEXT, "timeZone" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_sessions_time_check" CHECK ("lastSeenAt" >= "startedAt")
);
CREATE TABLE "marketing_touchpoints" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "sessionId" UUID, "contactId" UUID,
  "leadId" UUID, "submissionId" UUID, "landingPageId" UUID, "landingPageVersionId" UUID,
  "marketingFormId" UUID, "marketingFormVersionId" UUID, "sourceId" UUID, "campaignId" UUID,
  "creativeId" UUID, "kind" "MarketingTouchpointKind" NOT NULL,
  "evidenceClass" "MarketingEvidenceClass" NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "referrerHost" TEXT, "landingPath" TEXT, "utmSource" TEXT, "utmMedium" TEXT,
  "utmCampaign" TEXT, "utmContent" TEXT, "utmTerm" TEXT, "clickIdType" TEXT,
  "clickIdHash" TEXT, "privacyDecision" "PrivacyDecisionOutcome" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "attributionEligible" BOOLEAN NOT NULL DEFAULT false, "idempotencyKey" TEXT NOT NULL,
  "evidence" JSONB, "correlationId" TEXT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_touchpoints_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "attribution_conversions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "kind" "AttributionConversionKind" NOT NULL,
  "status" "AttributionFactStatus" NOT NULL DEFAULT 'ACTIVE', "contactId" UUID, "leadId" UUID,
  "submissionId" UUID, "meetingId" UUID, "opportunityId" UUID, "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "valueCents" BIGINT, "supersedesConversionId" UUID, "sourceEventType" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "evidenceClass" "MarketingEvidenceClass" NOT NULL, "evidence" JSONB, "correlationId" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attribution_conversions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attribution_conversions_value_check" CHECK ("valueCents" IS NULL OR "valueCents" >= 0)
);
CREATE TABLE "attribution_models" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "AttributionModelStatus" NOT NULL DEFAULT 'DRAFT', "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "retiredAt" TIMESTAMPTZ(3), CONSTRAINT "attribution_models_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attribution_models_version_check" CHECK ("currentVersion" > 0)
);
CREATE TABLE "attribution_model_versions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "attributionModelId" UUID NOT NULL,
  "version" INTEGER NOT NULL, "algorithm" "AttributionModelAlgorithm" NOT NULL,
  "lookbackDays" INTEGER NOT NULL, "schemaVersion" TEXT NOT NULL, "config" JSONB NOT NULL,
  "configHash" TEXT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attribution_model_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attribution_model_versions_values_check" CHECK ("version" > 0 AND "lookbackDays" BETWEEN 1 AND 3650)
);
CREATE TABLE "attribution_runs" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "attributionModelId" UUID NOT NULL,
  "modelVersionId" UUID NOT NULL, "status" "AttributionRunStatus" NOT NULL DEFAULT 'RUNNING',
  "periodStart" TIMESTAMPTZ(3) NOT NULL, "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL, "finishedAt" TIMESTAMPTZ(3),
  "conversionCount" INTEGER NOT NULL DEFAULT 0, "attributedCount" INTEGER NOT NULL DEFAULT 0,
  "partialCount" INTEGER NOT NULL DEFAULT 0, "unattributedCount" INTEGER NOT NULL DEFAULT 0,
  "coverageBps" INTEGER NOT NULL DEFAULT 0, "divergenceCount" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "requestedByActorId" UUID NOT NULL,
  "errorCode" TEXT, "errorMessage" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attribution_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attribution_runs_values_check" CHECK (
    "periodEnd" >= "periodStart" AND "conversionCount" >= 0 AND "attributedCount" >= 0
    AND "partialCount" >= 0 AND "unattributedCount" >= 0 AND "coverageBps" BETWEEN 0 AND 10000
    AND "divergenceCount" >= 0
  )
);
CREATE TABLE "attribution_credits" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "attributionRunId" UUID NOT NULL,
  "conversionId" UUID NOT NULL, "touchpointId" UUID, "coverageState" "AttributionCoverageState" NOT NULL,
  "creditBps" INTEGER NOT NULL, "reasonCode" TEXT NOT NULL, "explanation" TEXT NOT NULL,
  "evidence" JSONB, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attribution_credits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attribution_credits_bps_check" CHECK ("creditBps" BETWEEN 0 AND 10000),
  CONSTRAINT "attribution_credits_unknown_check" CHECK (
    ("touchpointId" IS NULL AND "coverageState" = 'UNATTRIBUTED' AND "creditBps" = 10000)
    OR ("touchpointId" IS NOT NULL AND "coverageState" <> 'UNATTRIBUTED' AND "creditBps" > 0)
  )
);
CREATE TABLE "acquisition_data_quality_issues" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "issueCode" TEXT NOT NULL, "severity" TEXT NOT NULL,
  "status" "AcquisitionReviewStatus" NOT NULL DEFAULT 'OPEN', "evidence" JSONB,
  "detectedAt" TIMESTAMPTZ(3) NOT NULL, "acknowledgedAt" TIMESTAMPTZ(3),
  "acknowledgedByActorId" UUID, "resolvedAt" TIMESTAMPTZ(3), "resolvedByActorId" UUID,
  "resolutionReason" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acquisition_data_quality_issues_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "marketing_backfill_runs" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "mode" "MarketingBackfillMode" NOT NULL,
  "status" "MarketingBackfillStatus" NOT NULL DEFAULT 'PENDING', "ruleVersion" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL DEFAULT 0, "createdCount" INTEGER NOT NULL DEFAULT 0,
  "existingCount" INTEGER NOT NULL DEFAULT 0, "divergentCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0, "failedCount" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "requestedByActorId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3), "finishedAt" TIMESTAMPTZ(3), "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_backfill_runs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "marketing_backfill_items" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "runId" UUID NOT NULL,
  "submissionId" UUID NOT NULL, "touchpointId" UUID, "conversionId" UUID,
  "outcome" "MarketingBackfillOutcome" NOT NULL, "reasonCode" TEXT, "evidence" JSONB,
  "idempotencyKey" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_backfill_items_pkey" PRIMARY KEY ("id")
);

-- Workspace-scoped uniqueness and query indexes.
CREATE UNIQUE INDEX "landing_pages_workspaceId_id_key" ON "landing_pages"("workspaceId", "id");
CREATE UNIQUE INDEX "landing_pages_workspaceId_key_key" ON "landing_pages"("workspaceId", "key");
CREATE INDEX "landing_pages_workspaceId_status_deletedAt_idx" ON "landing_pages"("workspaceId", "status", "deletedAt");
CREATE UNIQUE INDEX "landing_page_versions_workspaceId_id_key" ON "landing_page_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "landing_page_versions_workspaceId_landingPageId_version_key" ON "landing_page_versions"("workspaceId", "landingPageId", "version");
CREATE INDEX "landing_page_versions_workspaceId_landingPageId_createdAt_idx" ON "landing_page_versions"("workspaceId", "landingPageId", "createdAt");
CREATE UNIQUE INDEX "marketing_forms_workspaceId_id_key" ON "marketing_forms"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_forms_workspaceId_key_key" ON "marketing_forms"("workspaceId", "key");
CREATE INDEX "marketing_forms_workspaceId_status_deletedAt_idx" ON "marketing_forms"("workspaceId", "status", "deletedAt");
CREATE UNIQUE INDEX "marketing_form_versions_workspaceId_id_key" ON "marketing_form_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_form_versions_workspaceId_marketingFormId_version_key" ON "marketing_form_versions"("workspaceId", "marketingFormId", "version");
CREATE INDEX "marketing_form_versions_workspaceId_marketingFormId_created_idx" ON "marketing_form_versions"("workspaceId", "marketingFormId", "createdAt");
CREATE UNIQUE INDEX "marketing_sessions_workspaceId_id_key" ON "marketing_sessions"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_sessions_workspaceId_publicId_key" ON "marketing_sessions"("workspaceId", "publicId");
CREATE INDEX "marketing_sessions_workspaceId_contactId_startedAt_idx" ON "marketing_sessions"("workspaceId", "contactId", "startedAt");
CREATE INDEX "marketing_sessions_workspaceId_identityState_lastSeenAt_idx" ON "marketing_sessions"("workspaceId", "identityState", "lastSeenAt");
CREATE UNIQUE INDEX "marketing_touchpoints_workspaceId_id_key" ON "marketing_touchpoints"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_touchpoints_workspaceId_idempotencyKey_key" ON "marketing_touchpoints"("workspaceId", "idempotencyKey");
CREATE INDEX "marketing_touchpoints_workspaceId_sessionId_occurredAt_idx" ON "marketing_touchpoints"("workspaceId", "sessionId", "occurredAt");
CREATE INDEX "marketing_touchpoints_workspaceId_contactId_occurredAt_idx" ON "marketing_touchpoints"("workspaceId", "contactId", "occurredAt");
CREATE INDEX "marketing_touchpoints_workspaceId_leadId_occurredAt_idx" ON "marketing_touchpoints"("workspaceId", "leadId", "occurredAt");
CREATE INDEX "marketing_touchpoints_workspaceId_acquisition_occurredAt_idx" ON "marketing_touchpoints"("workspaceId", "sourceId", "campaignId", "creativeId", "occurredAt");
CREATE INDEX "marketing_touchpoints_workspaceId_evidence_privacy_idx" ON "marketing_touchpoints"("workspaceId", "evidenceClass", "privacyDecision", "attributionEligible");
CREATE UNIQUE INDEX "attribution_conversions_workspaceId_id_key" ON "attribution_conversions"("workspaceId", "id");
CREATE UNIQUE INDEX "attribution_conversions_workspaceId_idempotencyKey_key" ON "attribution_conversions"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "attribution_conversions_workspaceId_source_event_key" ON "attribution_conversions"("workspaceId", "sourceEventType", "sourceEventId", "kind");
CREATE INDEX "attribution_conversions_workspaceId_kind_status_occurredAt_idx" ON "attribution_conversions"("workspaceId", "kind", "status", "occurredAt");
CREATE INDEX "attribution_conversions_workspaceId_leadId_occurredAt_idx" ON "attribution_conversions"("workspaceId", "leadId", "occurredAt");
CREATE INDEX "attribution_conversions_workspaceId_opportunityId_occurredAt_idx" ON "attribution_conversions"("workspaceId", "opportunityId", "occurredAt");
CREATE UNIQUE INDEX "attribution_models_workspaceId_id_key" ON "attribution_models"("workspaceId", "id");
CREATE UNIQUE INDEX "attribution_models_workspaceId_key_key" ON "attribution_models"("workspaceId", "key");
CREATE INDEX "attribution_models_workspaceId_status_retiredAt_idx" ON "attribution_models"("workspaceId", "status", "retiredAt");
CREATE UNIQUE INDEX "attribution_model_versions_workspaceId_id_key" ON "attribution_model_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "attribution_model_versions_workspaceId_model_version_key" ON "attribution_model_versions"("workspaceId", "attributionModelId", "version");
CREATE UNIQUE INDEX "attribution_runs_workspaceId_id_key" ON "attribution_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "attribution_runs_workspaceId_idempotencyKey_key" ON "attribution_runs"("workspaceId", "idempotencyKey");
CREATE INDEX "attribution_runs_workspaceId_model_startedAt_idx" ON "attribution_runs"("workspaceId", "attributionModelId", "startedAt");
CREATE INDEX "attribution_runs_workspaceId_status_startedAt_idx" ON "attribution_runs"("workspaceId", "status", "startedAt");
CREATE UNIQUE INDEX "attribution_credits_workspaceId_id_key" ON "attribution_credits"("workspaceId", "id");
CREATE UNIQUE INDEX "attribution_credits_workspaceId_run_conversion_touch_key" ON "attribution_credits"("workspaceId", "attributionRunId", "conversionId", "touchpointId") NULLS NOT DISTINCT;
CREATE INDEX "attribution_credits_workspaceId_run_coverage_idx" ON "attribution_credits"("workspaceId", "attributionRunId", "coverageState");
CREATE UNIQUE INDEX "acquisition_issues_workspaceId_id_key" ON "acquisition_data_quality_issues"("workspaceId", "id");
CREATE UNIQUE INDEX "acquisition_issues_workspace_entity_issue_key" ON "acquisition_data_quality_issues"("workspaceId", "entityType", "entityId", "issueCode");
CREATE INDEX "acquisition_issues_workspace_status_severity_idx" ON "acquisition_data_quality_issues"("workspaceId", "status", "severity", "detectedAt");
CREATE UNIQUE INDEX "marketing_backfill_runs_workspaceId_id_key" ON "marketing_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_backfill_runs_workspaceId_idempotencyKey_key" ON "marketing_backfill_runs"("workspaceId", "idempotencyKey");
CREATE INDEX "marketing_backfill_runs_workspace_status_created_idx" ON "marketing_backfill_runs"("workspaceId", "status", "createdAt");
CREATE UNIQUE INDEX "marketing_backfill_items_workspaceId_id_key" ON "marketing_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_backfill_items_workspaceId_idempotencyKey_key" ON "marketing_backfill_items"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "marketing_backfill_items_workspace_run_submission_key" ON "marketing_backfill_items"("workspaceId", "runId", "submissionId");

CREATE INDEX "lead_form_submissions_workspaceId_marketingSessionId_submit_idx" ON "lead_form_submissions"("workspaceId", "marketingSessionId", "submittedAt");
CREATE INDEX "lead_form_submissions_workspaceId_marketingForm_version_submit_idx" ON "lead_form_submissions"("workspaceId", "marketingFormId", "marketingFormVersionId", "submittedAt");
CREATE INDEX "lead_form_submissions_workspaceId_marketingTouchpointId_idx" ON "lead_form_submissions"("workspaceId", "marketingTouchpointId");
CREATE INDEX "lead_form_submissions_workspaceId_attributionConversionId_idx" ON "lead_form_submissions"("workspaceId", "attributionConversionId");

-- Workspace integrity. Every reference carries workspaceId to prevent cross-tenant links.
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "landing_page_versions" ADD CONSTRAINT "landing_page_versions_page_fkey" FOREIGN KEY ("workspaceId", "landingPageId") REFERENCES "landing_pages"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "landing_page_versions" ADD CONSTRAINT "landing_page_versions_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_versions" ADD CONSTRAINT "marketing_form_versions_form_fkey" FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_versions" ADD CONSTRAINT "marketing_form_versions_page_fkey" FOREIGN KEY ("workspaceId", "landingPageId") REFERENCES "landing_pages"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_versions" ADD CONSTRAINT "marketing_form_versions_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_sessions" ADD CONSTRAINT "marketing_sessions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "marketing_sessions" ADD CONSTRAINT "marketing_sessions_contact_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_session_fkey" FOREIGN KEY ("workspaceId", "sessionId") REFERENCES "marketing_sessions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_contact_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_lead_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_submission_fkey" FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_page_fkey" FOREIGN KEY ("workspaceId", "landingPageId") REFERENCES "landing_pages"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_page_version_fkey" FOREIGN KEY ("workspaceId", "landingPageVersionId") REFERENCES "landing_page_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_form_fkey" FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_form_version_fkey" FOREIGN KEY ("workspaceId", "marketingFormVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_source_fkey" FOREIGN KEY ("workspaceId", "sourceId") REFERENCES "lead_sources"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_campaign_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "acquisition_campaigns"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_creative_fkey" FOREIGN KEY ("workspaceId", "campaignId", "creativeId") REFERENCES "acquisition_creatives"("workspaceId", "campaignId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_contact_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_lead_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_submission_fkey" FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_meeting_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_opportunity_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_supersedes_fkey" FOREIGN KEY ("workspaceId", "supersedesConversionId") REFERENCES "attribution_conversions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_models" ADD CONSTRAINT "attribution_models_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "attribution_models" ADD CONSTRAINT "attribution_models_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_models" ADD CONSTRAINT "attribution_models_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_model_versions" ADD CONSTRAINT "attribution_model_versions_model_fkey" FOREIGN KEY ("workspaceId", "attributionModelId") REFERENCES "attribution_models"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_model_versions" ADD CONSTRAINT "attribution_model_versions_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_runs" ADD CONSTRAINT "attribution_runs_model_fkey" FOREIGN KEY ("workspaceId", "attributionModelId") REFERENCES "attribution_models"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_runs" ADD CONSTRAINT "attribution_runs_model_version_fkey" FOREIGN KEY ("workspaceId", "modelVersionId") REFERENCES "attribution_model_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_runs" ADD CONSTRAINT "attribution_runs_actor_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_credits" ADD CONSTRAINT "attribution_credits_run_fkey" FOREIGN KEY ("workspaceId", "attributionRunId") REFERENCES "attribution_runs"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_credits" ADD CONSTRAINT "attribution_credits_conversion_fkey" FOREIGN KEY ("workspaceId", "conversionId") REFERENCES "attribution_conversions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "attribution_credits" ADD CONSTRAINT "attribution_credits_touchpoint_fkey" FOREIGN KEY ("workspaceId", "touchpointId") REFERENCES "marketing_touchpoints"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "acquisition_data_quality_issues" ADD CONSTRAINT "acquisition_issues_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "acquisition_data_quality_issues" ADD CONSTRAINT "acquisition_issues_ack_actor_fkey" FOREIGN KEY ("workspaceId", "acknowledgedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "acquisition_data_quality_issues" ADD CONSTRAINT "acquisition_issues_resolved_actor_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_backfill_runs" ADD CONSTRAINT "marketing_backfill_runs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "marketing_backfill_runs" ADD CONSTRAINT "marketing_backfill_runs_actor_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_backfill_items" ADD CONSTRAINT "marketing_backfill_items_run_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "marketing_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_backfill_items" ADD CONSTRAINT "marketing_backfill_items_submission_fkey" FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_backfill_items" ADD CONSTRAINT "marketing_backfill_items_touchpoint_fkey" FOREIGN KEY ("workspaceId", "touchpointId") REFERENCES "marketing_touchpoints"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_backfill_items" ADD CONSTRAINT "marketing_backfill_items_conversion_fkey" FOREIGN KEY ("workspaceId", "conversionId") REFERENCES "attribution_conversions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_marketing_session_fkey" FOREIGN KEY ("workspaceId", "marketingSessionId") REFERENCES "marketing_sessions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_marketing_form_fkey" FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_marketing_form_version_fkey" FOREIGN KEY ("workspaceId", "marketingFormVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_touchpoint_fkey" FOREIGN KEY ("workspaceId", "marketingTouchpointId") REFERENCES "marketing_touchpoints"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_conversion_fkey" FOREIGN KEY ("workspaceId", "attributionConversionId") REFERENCES "attribution_conversions"("workspaceId", "id") ON DELETE RESTRICT;

-- Append-only historical facts and result artifacts.
CREATE OR REPLACE FUNCTION reject_marketing_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketing history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER landing_page_versions_append_only BEFORE UPDATE OR DELETE ON "landing_page_versions" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();
CREATE TRIGGER marketing_form_versions_append_only BEFORE UPDATE OR DELETE ON "marketing_form_versions" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();
CREATE TRIGGER marketing_touchpoints_append_only BEFORE UPDATE OR DELETE ON "marketing_touchpoints" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();
CREATE TRIGGER attribution_conversions_append_only BEFORE UPDATE OR DELETE ON "attribution_conversions" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();
CREATE TRIGGER attribution_model_versions_append_only BEFORE UPDATE OR DELETE ON "attribution_model_versions" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();
CREATE TRIGGER attribution_credits_append_only BEFORE UPDATE OR DELETE ON "attribution_credits" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();
CREATE TRIGGER marketing_backfill_items_append_only BEFORE UPDATE OR DELETE ON "marketing_backfill_items" FOR EACH ROW EXECUTE FUNCTION reject_marketing_history_mutation();

-- Every conversion in a completed/partial run must total exactly 10,000 bps.
CREATE OR REPLACE FUNCTION validate_attribution_run_credit_totals() RETURNS trigger AS $$
DECLARE invalid_count INTEGER;
BEGIN
  IF NEW."status" IN ('COMPLETED', 'PARTIAL') THEN
    SELECT COUNT(*) INTO invalid_count
    FROM (
      SELECT c."id"
      FROM "attribution_conversions" c
      LEFT JOIN "attribution_credits" cr
        ON cr."workspaceId" = c."workspaceId" AND cr."conversionId" = c."id"
        AND cr."attributionRunId" = NEW."id"
      WHERE c."workspaceId" = NEW."workspaceId"
        AND c."occurredAt" >= NEW."periodStart" AND c."occurredAt" < NEW."periodEnd"
        AND c."status" = 'ACTIVE'
      GROUP BY c."id"
      HAVING COALESCE(SUM(cr."creditBps"), 0) <> 10000
    ) invalid;
    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'attribution credits must total 10000 bps for every conversion';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER attribution_run_credit_total_check
AFTER INSERT OR UPDATE OF "status" ON "attribution_runs"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_attribution_run_credit_totals();
