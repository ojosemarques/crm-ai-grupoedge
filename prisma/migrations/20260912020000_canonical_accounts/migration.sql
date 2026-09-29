-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MERGED');

-- CreateEnum
CREATE TYPE "AccountOrigin" AS ENUM ('MANUAL', 'LEAD_REVIEW', 'IMPORT', 'SEED');

-- CreateEnum
CREATE TYPE "AccountQuality" AS ENUM ('UNKNOWN', 'CONFIRMED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AccountSegment" AS ENUM ('PUBLIC_SECTOR', 'POLITICAL', 'PRIVATE_SECTOR', 'NONPROFIT', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AccountSize" AS ENUM ('SOLO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AccountContactRoleType" AS ENUM ('DECISION_MAKER', 'CHAMPION', 'INFLUENCER', 'USER', 'FINANCE', 'PROCUREMENT', 'TECHNICAL', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "InfluenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AuthorityLevel" AS ENUM ('NONE', 'CONSULTED', 'INFLUENCER', 'APPROVER', 'FINAL_DECISION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AccountRoleSource" AS ENUM ('MANUAL', 'FORM', 'SDR', 'CLOSER', 'AI_SUGGESTION');

-- CreateEnum
CREATE TYPE "BuyingCommitteeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BuyingCommitteeStance" AS ENUM ('SUPPORTER', 'NEUTRAL', 'BLOCKER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AccountIdentityReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AccountIdentityReviewDecision" AS ENUM ('CREATE_ACCOUNT', 'LINK_EXISTING', 'KEEP_UNLINKED', 'DISMISS');

-- CreateEnum
CREATE TYPE "AccountBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "AccountBackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AccountBackfillOutcome" AS ENUM ('CANDIDATE_CREATED', 'ALREADY_REVIEWED', 'NO_ORGANIZATION', 'FAILED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "accountId" UUID;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "accountId" UUID;

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "legalName" TEXT,
    "originalDocument" TEXT,
    "normalizedDocument" TEXT,
    "documentType" TEXT,
    "documentCountryCode" TEXT,
    "originalDomain" TEXT,
    "normalizedDomain" TEXT,
    "segment" "AccountSegment" NOT NULL DEFAULT 'UNKNOWN',
    "size" "AccountSize" NOT NULL DEFAULT 'UNKNOWN',
    "parentAccountId" UUID,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "origin" "AccountOrigin" NOT NULL,
    "quality" "AccountQuality" NOT NULL DEFAULT 'UNKNOWN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_contact_roles" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "roleType" "AccountContactRoleType" NOT NULL,
    "roleTitle" TEXT,
    "influence" "InfluenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "authority" "AuthorityLevel" NOT NULL DEFAULT 'UNKNOWN',
    "source" "AccountRoleSource" NOT NULL,
    "evidence" TEXT,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "endedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_contact_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buying_committees" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BuyingCommitteeStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "buying_committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buying_committee_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "buyingCommitteeId" UUID NOT NULL,
    "accountContactRoleId" UUID NOT NULL,
    "stance" "BuyingCommitteeStance" NOT NULL DEFAULT 'UNKNOWN',
    "roleDescription" TEXT,
    "influence" "InfluenceLevel",
    "authority" "AuthorityLevel",
    "risk" TEXT,
    "objection" TEXT,
    "interest" TEXT,
    "evidence" TEXT,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "endedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buying_committee_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_identity_reviews" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "contactId" UUID,
    "candidateAccountId" UUID,
    "normalizedName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "AccountIdentityReviewStatus" NOT NULL DEFAULT 'OPEN',
    "decision" "AccountIdentityReviewDecision",
    "resolutionReason" TEXT,
    "createdByActorId" UUID NOT NULL,
    "resolvedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "account_identity_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_candidates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "accountId" UUID,
    "name" TEXT NOT NULL,
    "scoreBps" INTEGER,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_backfill_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runKey" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "mode" "AccountBackfillMode" NOT NULL,
    "status" "AccountBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "batchSize" INTEGER NOT NULL DEFAULT 100,
    "cursorLeadId" UUID,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewsCreated" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "requestedByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_backfill_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "reviewId" UUID,
    "ruleVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" "AccountBackfillOutcome" NOT NULL,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_backfill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_workspaceId_normalizedName_status_deletedAt_idx" ON "accounts"("workspaceId", "normalizedName", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_normalizedDocument_deletedAt_idx" ON "accounts"("workspaceId", "normalizedDocument", "deletedAt");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_normalizedDomain_deletedAt_idx" ON "accounts"("workspaceId", "normalizedDomain", "deletedAt");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_segment_size_quality_status_idx" ON "accounts"("workspaceId", "segment", "size", "quality", "status");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_parentAccountId_idx" ON "accounts"("workspaceId", "parentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_workspaceId_id_key" ON "accounts"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "account_contact_roles_workspaceId_accountId_roleType_validT_idx" ON "account_contact_roles"("workspaceId", "accountId", "roleType", "validTo");

-- CreateIndex
CREATE INDEX "account_contact_roles_workspaceId_contactId_validTo_idx" ON "account_contact_roles"("workspaceId", "contactId", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "account_contact_roles_workspaceId_id_key" ON "account_contact_roles"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "buying_committees_workspaceId_opportunityId_status_idx" ON "buying_committees"("workspaceId", "opportunityId", "status");

-- CreateIndex
CREATE INDEX "buying_committees_workspaceId_accountId_status_idx" ON "buying_committees"("workspaceId", "accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "buying_committees_workspaceId_id_key" ON "buying_committees"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "buying_committee_members_workspaceId_buyingCommitteeId_vali_idx" ON "buying_committee_members"("workspaceId", "buyingCommitteeId", "validTo");

-- CreateIndex
CREATE INDEX "buying_committee_members_workspaceId_accountContactRoleId_v_idx" ON "buying_committee_members"("workspaceId", "accountContactRoleId", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "buying_committee_members_workspaceId_id_key" ON "buying_committee_members"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "account_identity_reviews_workspaceId_status_createdAt_idx" ON "account_identity_reviews"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "account_identity_reviews_workspaceId_normalizedName_status_idx" ON "account_identity_reviews"("workspaceId", "normalizedName", "status");

-- CreateIndex
CREATE UNIQUE INDEX "account_identity_reviews_workspaceId_id_key" ON "account_identity_reviews"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_identity_reviews_workspaceId_fingerprint_key" ON "account_identity_reviews"("workspaceId", "fingerprint");

-- CreateIndex
CREATE INDEX "account_candidates_workspaceId_reviewId_idx" ON "account_candidates"("workspaceId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "account_candidates_workspaceId_id_key" ON "account_candidates"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_candidates_workspaceId_reviewId_accountId_key" ON "account_candidates"("workspaceId", "reviewId", "accountId");

-- CreateIndex
CREATE INDEX "account_backfill_runs_workspaceId_status_createdAt_idx" ON "account_backfill_runs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "account_backfill_runs_workspaceId_id_key" ON "account_backfill_runs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_backfill_runs_workspaceId_runKey_key" ON "account_backfill_runs"("workspaceId", "runKey");

-- CreateIndex
CREATE INDEX "account_backfill_items_workspaceId_runId_outcome_idx" ON "account_backfill_items"("workspaceId", "runId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "account_backfill_items_workspaceId_id_key" ON "account_backfill_items"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_backfill_items_workspaceId_idempotencyKey_key" ON "account_backfill_items"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "account_backfill_items_workspaceId_runId_leadId_key" ON "account_backfill_items"("workspaceId", "runId", "leadId");

-- CreateIndex
CREATE INDEX "leads_workspaceId_accountId_deletedAt_idx" ON "leads"("workspaceId", "accountId", "deletedAt");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_accountId_status_createdAt_idx" ON "opportunities"("workspaceId", "accountId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_parentAccountId_fkey" FOREIGN KEY ("workspaceId", "parentAccountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contact_roles" ADD CONSTRAINT "account_contact_roles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contact_roles" ADD CONSTRAINT "account_contact_roles_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contact_roles" ADD CONSTRAINT "account_contact_roles_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contact_roles" ADD CONSTRAINT "account_contact_roles_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contact_roles" ADD CONSTRAINT "account_contact_roles_workspaceId_endedByActorId_fkey" FOREIGN KEY ("workspaceId", "endedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committees" ADD CONSTRAINT "buying_committees_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committees" ADD CONSTRAINT "buying_committees_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committees" ADD CONSTRAINT "buying_committees_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committees" ADD CONSTRAINT "buying_committees_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committees" ADD CONSTRAINT "buying_committees_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committee_members" ADD CONSTRAINT "buying_committee_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committee_members" ADD CONSTRAINT "buying_committee_members_workspaceId_buyingCommitteeId_fkey" FOREIGN KEY ("workspaceId", "buyingCommitteeId") REFERENCES "buying_committees"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committee_members" ADD CONSTRAINT "buying_committee_members_workspaceId_accountContactRoleId_fkey" FOREIGN KEY ("workspaceId", "accountContactRoleId") REFERENCES "account_contact_roles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committee_members" ADD CONSTRAINT "buying_committee_members_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buying_committee_members" ADD CONSTRAINT "buying_committee_members_workspaceId_endedByActorId_fkey" FOREIGN KEY ("workspaceId", "endedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity_reviews" ADD CONSTRAINT "account_identity_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity_reviews" ADD CONSTRAINT "account_identity_reviews_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity_reviews" ADD CONSTRAINT "account_identity_reviews_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity_reviews" ADD CONSTRAINT "account_identity_reviews_workspaceId_candidateAccountId_fkey" FOREIGN KEY ("workspaceId", "candidateAccountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity_reviews" ADD CONSTRAINT "account_identity_reviews_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity_reviews" ADD CONSTRAINT "account_identity_reviews_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_candidates" ADD CONSTRAINT "account_candidates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_candidates" ADD CONSTRAINT "account_candidates_workspaceId_reviewId_fkey" FOREIGN KEY ("workspaceId", "reviewId") REFERENCES "account_identity_reviews"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_candidates" ADD CONSTRAINT "account_candidates_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_runs" ADD CONSTRAINT "account_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_runs" ADD CONSTRAINT "account_backfill_runs_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_runs" ADD CONSTRAINT "account_backfill_runs_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_items" ADD CONSTRAINT "account_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_items" ADD CONSTRAINT "account_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "account_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_items" ADD CONSTRAINT "account_backfill_items_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_backfill_items" ADD CONSTRAINT "account_backfill_items_workspaceId_reviewId_fkey" FOREIGN KEY ("workspaceId", "reviewId") REFERENCES "account_identity_reviews"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants not expressible in Prisma's schema language.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_not_self_check"
  CHECK ("parentAccountId" IS NULL OR "parentAccountId" <> "id");
ALTER TABLE "account_contact_roles" ADD CONSTRAINT "account_contact_roles_validity_check"
  CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "buying_committee_members" ADD CONSTRAINT "buying_committee_members_validity_check"
  CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

CREATE UNIQUE INDEX "accounts_workspace_document_active_key"
  ON "accounts"("workspaceId", "normalizedDocument")
  WHERE "normalizedDocument" IS NOT NULL AND "deletedAt" IS NULL AND "status" <> 'MERGED';
CREATE UNIQUE INDEX "account_contact_roles_active_identity_key"
  ON "account_contact_roles"("workspaceId", "accountId", "contactId", "roleType")
  WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX "buying_committees_one_active_per_opportunity_key"
  ON "buying_committees"("workspaceId", "opportunityId")
  WHERE "status" IN ('DRAFT', 'ACTIVE');
CREATE UNIQUE INDEX "buying_committee_members_active_role_key"
  ON "buying_committee_members"("workspaceId", "buyingCommitteeId", "accountContactRoleId")
  WHERE "validTo" IS NULL;
