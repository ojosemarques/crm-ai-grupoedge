-- CreateEnum
CREATE TYPE "LeadIntakeChannel" AS ENUM ('MANUAL', 'CSV', 'LOCAL_WEBHOOK', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "LeadIntakeOutcome" AS ENUM ('CREATED', 'ATTACHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContactPreference" AS ENUM ('UNKNOWN', 'CONSENTED', 'NOT_CONSENTED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "LeadIdentityReviewReason" AS ENUM ('DUPLICATE_PHONE');

-- CreateEnum
CREATE TYPE "LeadIdentityReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "LeadDivergenceField" AS ENUM ('FULL_NAME', 'EMAIL', 'JOB_TITLE', 'ORGANIZATION', 'CITY', 'STATE', 'INTEREST', 'BUDGET', 'CONTACT_PREFERENCE', 'SOURCE', 'CAMPAIGN', 'CREATIVE');

-- AlterTable
ALTER TABLE "lead_form_submissions" ADD COLUMN     "channel" "LeadIntakeChannel",
ADD COLUMN     "intakeOutcome" "LeadIntakeOutcome",
ADD COLUMN     "submittedBudgetCents" BIGINT,
ADD COLUMN     "submittedCity" TEXT,
ADD COLUMN     "submittedContactPreference" "ContactPreference",
ADD COLUMN     "submittedEmail" TEXT,
ADD COLUMN     "submittedFullName" TEXT,
ADD COLUMN     "submittedInterestSummary" TEXT,
ADD COLUMN     "submittedJobTitle" TEXT,
ADD COLUMN     "submittedOrganizationName" TEXT,
ADD COLUMN     "submittedPhone" TEXT,
ADD COLUMN     "submittedStateCode" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "budgetCents" BIGINT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactPreference" "ContactPreference" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "contactPreferenceUpdatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "conversionCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "interestSummary" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "latestCampaignId" UUID,
ADD COLUMN     "latestCreativeId" UUID,
ADD COLUMN     "latestInterestSummary" TEXT,
ADD COLUMN     "latestSourceId" UUID,
ADD COLUMN     "latestSubmissionAt" TIMESTAMPTZ(3),
ADD COLUMN     "needsIdentityReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationName" TEXT,
ADD COLUMN     "stateCode" TEXT;

-- CreateTable
CREATE TABLE "lead_identity_reviews" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "assignedTeamId" UUID,
    "reason" "LeadIdentityReviewReason" NOT NULL,
    "status" "LeadIdentityReviewStatus" NOT NULL DEFAULT 'OPEN',
    "divergenceFields" "LeadDivergenceField"[] NOT NULL DEFAULT ARRAY[]::"LeadDivergenceField"[],
    "evidence" JSONB NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "resolvedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "lead_identity_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_identity_reviews_workspaceId_leadId_status_createdAt_idx" ON "lead_identity_reviews"("workspaceId", "leadId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "lead_identity_reviews_workspaceId_assignedTeamId_status_cre_idx" ON "lead_identity_reviews"("workspaceId", "assignedTeamId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_identity_reviews_workspaceId_id_key" ON "lead_identity_reviews"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_identity_reviews_workspaceId_submissionId_key" ON "lead_identity_reviews"("workspaceId", "submissionId");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_channel_intakeOutcome_sub_idx" ON "lead_form_submissions"("workspaceId", "channel", "intakeOutcome", "submittedAt");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_normalizedPhone_submitted_idx" ON "lead_form_submissions"("workspaceId", "normalizedPhone", "submittedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_latestSourceId_latestSubmissionAt_idx" ON "leads"("workspaceId", "latestSourceId", "latestSubmissionAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_latestCampaignId_latestCreativeId_latestS_idx" ON "leads"("workspaceId", "latestCampaignId", "latestCreativeId", "latestSubmissionAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_contactPreference_deletedAt_idx" ON "leads"("workspaceId", "contactPreference", "deletedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_needsIdentityReview_updatedAt_idx" ON "leads"("workspaceId", "needsIdentityReview", "updatedAt");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_latestSourceId_fkey" FOREIGN KEY ("workspaceId", "latestSourceId") REFERENCES "lead_sources"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_latestCampaignId_fkey" FOREIGN KEY ("workspaceId", "latestCampaignId") REFERENCES "acquisition_campaigns"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_latestCampaignId_latestCreativeId_fkey" FOREIGN KEY ("workspaceId", "latestCampaignId", "latestCreativeId") REFERENCES "acquisition_creatives"("workspaceId", "campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identity_reviews" ADD CONSTRAINT "lead_identity_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identity_reviews" ADD CONSTRAINT "lead_identity_reviews_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identity_reviews" ADD CONSTRAINT "lead_identity_reviews_workspaceId_submissionId_fkey" FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identity_reviews" ADD CONSTRAINT "lead_identity_reviews_workspaceId_assignedTeamId_fkey" FOREIGN KEY ("workspaceId", "assignedTeamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identity_reviews" ADD CONSTRAINT "lead_identity_reviews_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identity_reviews" ADD CONSTRAINT "lead_identity_reviews_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CRM-05 invariants that are not expressible in Prisma's schema language.
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_latest_campaign_creative_check"
  CHECK ("latestCreativeId" IS NULL OR "latestCampaignId" IS NOT NULL),
  ADD CONSTRAINT "leads_budget_check"
  CHECK ("budgetCents" IS NULL OR "budgetCents" >= 0),
  ADD CONSTRAINT "leads_conversion_count_check"
  CHECK ("conversionCount" >= 1),
  ADD CONSTRAINT "leads_state_code_check"
  CHECK ("stateCode" IS NULL OR "stateCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "leads_contact_preference_time_check"
  CHECK (
    ("contactPreference" = 'UNKNOWN' AND "contactPreferenceUpdatedAt" IS NULL)
    OR ("contactPreference" <> 'UNKNOWN' AND "contactPreferenceUpdatedAt" IS NOT NULL)
  );

ALTER TABLE "lead_form_submissions"
  ADD CONSTRAINT "submissions_budget_check"
  CHECK ("submittedBudgetCents" IS NULL OR "submittedBudgetCents" >= 0),
  ADD CONSTRAINT "submissions_state_code_check"
  CHECK ("submittedStateCode" IS NULL OR "submittedStateCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "submissions_intake_metadata_check"
  CHECK (
    ("channel" IS NULL AND "intakeOutcome" IS NULL)
    OR (
      "channel" IS NOT NULL
      AND (
        ("status" IN ('RECEIVED', 'NORMALIZED') AND "intakeOutcome" IS NULL)
        OR
        ("status" = 'LINKED' AND "intakeOutcome" IN ('CREATED', 'ATTACHED'))
        OR ("status" = 'REJECTED' AND "intakeOutcome" = 'REJECTED')
      )
    )
  );

ALTER TABLE "lead_identity_reviews"
  ADD CONSTRAINT "identity_reviews_resolution_check"
  CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedByActorId" IS NULL)
    OR (
      "status" IN ('RESOLVED', 'DISMISSED')
      AND "resolvedAt" IS NOT NULL
      AND "resolvedByActorId" IS NOT NULL
    )
  );
