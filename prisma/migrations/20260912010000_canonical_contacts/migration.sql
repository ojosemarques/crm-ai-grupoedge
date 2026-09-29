-- CRM-33: Contact and ContactPoint canonical identity foundation.
-- Expand-only migration: legacy Lead identity columns and every historical row remain intact.

BEGIN;

CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'MERGED', 'INACTIVE');
CREATE TYPE "ContactOrigin" AS ENUM ('LEAD_INTAKE', 'LEAD_BACKFILL', 'MANUAL');
CREATE TYPE "ContactQuality" AS ENUM ('UNKNOWN', 'CONFIRMED', 'NEEDS_REVIEW');
CREATE TYPE "ContactPointType" AS ENUM ('PHONE', 'EMAIL');
CREATE TYPE "ContactPointVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'INVALID');
CREATE TYPE "ContactPointQuality" AS ENUM ('UNKNOWN', 'VALID', 'SUSPECT', 'INVALID');
CREATE TYPE "ContactIdentityReviewReason" AS ENUM (
  'SHARED_PHONE', 'SHARED_EMAIL', 'PHONE_DIVERGENCE', 'EMAIL_DIVERGENCE', 'NAME_DIVERGENCE',
  'JOB_TITLE_DIVERGENCE', 'MULTIPLE_CANDIDATES'
);
CREATE TYPE "ContactIdentityReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ContactBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');
CREATE TYPE "ContactBackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ContactBackfillOutcome" AS ENUM (
  'DRY_RUN_CANDIDATE', 'CREATED', 'LINKED', 'REVIEW_OPENED', 'IGNORED', 'ALREADY_LINKED', 'FAILED'
);

CREATE TABLE "contacts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "preferredName" TEXT NOT NULL,
  "legalName" TEXT,
  "jobTitle" TEXT,
  "timeZone" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'pt-BR',
  "origin" "ContactOrigin" NOT NULL,
  "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
  "quality" "ContactQuality" NOT NULL DEFAULT 'UNKNOWN',
  "mergedIntoContactId" UUID,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contacts_name_check" CHECK (length(btrim("preferredName")) >= 2),
  CONSTRAINT "contacts_merge_state_check" CHECK (
    ("status" = 'MERGED' AND "mergedIntoContactId" IS NOT NULL)
    OR ("status" <> 'MERGED' AND "mergedIntoContactId" IS NULL)
  ),
  CONSTRAINT "contacts_no_self_merge_check" CHECK ("mergedIntoContactId" IS NULL OR "mergedIntoContactId" <> "id")
);

CREATE TABLE "contact_points" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "contactId" UUID NOT NULL,
  "type" "ContactPointType" NOT NULL,
  "originalValue" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "countryCode" TEXT,
  "label" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "verificationStatus" "ContactPointVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "quality" "ContactPointQuality" NOT NULL DEFAULT 'UNKNOWN',
  "source" "ContactOrigin" NOT NULL,
  "doNotContact" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "contact_points_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_points_values_check" CHECK (
    length(btrim("originalValue")) > 0 AND length(btrim("normalizedValue")) > 0
  ),
  CONSTRAINT "contact_points_phone_check" CHECK (
    "type" <> 'PHONE' OR "normalizedValue" ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT "contact_points_email_check" CHECK (
    "type" <> 'EMAIL' OR "normalizedValue" = lower(btrim("normalizedValue"))
  ),
  CONSTRAINT "contact_points_verification_check" CHECK (
    ("verificationStatus" = 'VERIFIED' AND "verifiedAt" IS NOT NULL)
    OR ("verificationStatus" <> 'VERIFIED')
  )
);

CREATE TABLE "contact_identity_reviews" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "contactId" UUID NOT NULL,
  "candidateContactId" UUID,
  "leadIdentityReviewId" UUID,
  "reason" "ContactIdentityReviewReason" NOT NULL,
  "status" "ContactIdentityReviewStatus" NOT NULL DEFAULT 'OPEN',
  "divergenceFields" "LeadDivergenceField"[] NOT NULL DEFAULT ARRAY[]::"LeadDivergenceField"[],
  "fingerprint" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "resolution" TEXT,
  "createdByActorId" UUID NOT NULL,
  "resolvedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "contact_identity_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_identity_reviews_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedByActorId" IS NULL)
    OR ("status" <> 'OPEN' AND "resolvedAt" IS NOT NULL AND "resolvedByActorId" IS NOT NULL)
  ),
  CONSTRAINT "contact_identity_reviews_distinct_candidate_check" CHECK (
    "candidateContactId" IS NULL OR "candidateContactId" <> "contactId"
  )
);

CREATE TABLE "contact_backfill_runs" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "mode" "ContactBackfillMode" NOT NULL,
  "status" "ContactBackfillStatus" NOT NULL DEFAULT 'PENDING',
  "batchSize" INTEGER NOT NULL DEFAULT 100,
  "cursorLeadId" UUID,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "contactsCreated" INTEGER NOT NULL DEFAULT 0,
  "pointsCreated" INTEGER NOT NULL DEFAULT 0,
  "leadsLinked" INTEGER NOT NULL DEFAULT 0,
  "reviewsOpened" INTEGER NOT NULL DEFAULT 0,
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
  CONSTRAINT "contact_backfill_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_backfill_runs_batch_check" CHECK ("batchSize" BETWEEN 1 AND 500),
  CONSTRAINT "contact_backfill_runs_counts_check" CHECK (
    "eligibleCount" >= 0 AND "processedCount" >= 0 AND "contactsCreated" >= 0
    AND "pointsCreated" >= 0 AND "leadsLinked" >= 0 AND "reviewsOpened" >= 0
    AND "ignoredCount" >= 0 AND "failedCount" >= 0
  )
);

CREATE TABLE "contact_backfill_items" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "contactId" UUID,
  "reviewId" UUID,
  "ruleVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "outcome" "ContactBackfillOutcome" NOT NULL,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_backfill_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "leads" ADD COLUMN "contactId" UUID;
ALTER TABLE "lead_form_submissions" ADD COLUMN "contactId" UUID;

CREATE UNIQUE INDEX "contacts_workspaceId_id_key" ON "contacts"("workspaceId", "id");
CREATE INDEX "contacts_workspaceId_preferredName_status_deletedAt_idx" ON "contacts"("workspaceId", "preferredName", "status", "deletedAt");
CREATE INDEX "contacts_workspaceId_quality_status_deletedAt_idx" ON "contacts"("workspaceId", "quality", "status", "deletedAt");
CREATE INDEX "contacts_workspaceId_mergedIntoContactId_idx" ON "contacts"("workspaceId", "mergedIntoContactId");

CREATE UNIQUE INDEX "contact_points_workspaceId_id_key" ON "contact_points"("workspaceId", "id");
CREATE UNIQUE INDEX "contact_points_active_value_key" ON "contact_points"("workspaceId", "contactId", "type", "normalizedValue") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "contact_points_active_primary_key" ON "contact_points"("workspaceId", "contactId", "type") WHERE "isPrimary" = true AND "deletedAt" IS NULL;
CREATE INDEX "contact_points_workspaceId_contactId_type_deletedAt_idx" ON "contact_points"("workspaceId", "contactId", "type", "deletedAt");
CREATE INDEX "contact_points_workspaceId_type_normalizedValue_deletedAt_idx" ON "contact_points"("workspaceId", "type", "normalizedValue", "deletedAt");
CREATE INDEX "contact_points_workspaceId_verificationStatus_quality_delet_idx" ON "contact_points"("workspaceId", "verificationStatus", "quality", "deletedAt");
CREATE INDEX "contact_points_workspaceId_doNotContact_deletedAt_idx" ON "contact_points"("workspaceId", "doNotContact", "deletedAt");

CREATE UNIQUE INDEX "contact_identity_reviews_workspaceId_id_key" ON "contact_identity_reviews"("workspaceId", "id");
CREATE UNIQUE INDEX "contact_identity_reviews_workspaceId_fingerprint_key" ON "contact_identity_reviews"("workspaceId", "fingerprint");
CREATE INDEX "contact_identity_reviews_workspaceId_status_reason_createdA_idx" ON "contact_identity_reviews"("workspaceId", "status", "reason", "createdAt");
CREATE INDEX "contact_identity_reviews_workspaceId_leadId_status_createdA_idx" ON "contact_identity_reviews"("workspaceId", "leadId", "status", "createdAt");
CREATE INDEX "contact_identity_reviews_workspaceId_contactId_status_creat_idx" ON "contact_identity_reviews"("workspaceId", "contactId", "status", "createdAt");
CREATE INDEX "contact_identity_reviews_workspaceId_candidateContactId_sta_idx" ON "contact_identity_reviews"("workspaceId", "candidateContactId", "status", "createdAt");

CREATE UNIQUE INDEX "contact_backfill_runs_workspaceId_id_key" ON "contact_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "contact_backfill_runs_workspaceId_runKey_key" ON "contact_backfill_runs"("workspaceId", "runKey");
CREATE INDEX "contact_backfill_runs_workspaceId_status_createdAt_idx" ON "contact_backfill_runs"("workspaceId", "status", "createdAt");
CREATE UNIQUE INDEX "contact_backfill_items_workspaceId_id_key" ON "contact_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "contact_backfill_items_workspaceId_idempotencyKey_key" ON "contact_backfill_items"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "contact_backfill_items_workspaceId_runId_leadId_key" ON "contact_backfill_items"("workspaceId", "runId", "leadId");
CREATE INDEX "contact_backfill_items_workspaceId_runId_outcome_createdAt_idx" ON "contact_backfill_items"("workspaceId", "runId", "outcome", "createdAt");
CREATE INDEX "contact_backfill_items_workspaceId_leadId_ruleVersion_idx" ON "contact_backfill_items"("workspaceId", "leadId", "ruleVersion");
CREATE INDEX "lead_form_submissions_workspaceId_contactId_submittedAt_idx" ON "lead_form_submissions"("workspaceId", "contactId", "submittedAt");
CREATE INDEX "leads_workspaceId_contactId_deletedAt_idx" ON "leads"("workspaceId", "contactId", "deletedAt");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspaceId_mergedIntoContactId_fkey" FOREIGN KEY ("workspaceId", "mergedIntoContactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_candidateContactId_fkey" FOREIGN KEY ("workspaceId", "candidateContactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_leadIdentityReviewId_fkey" FOREIGN KEY ("workspaceId", "leadIdentityReviewId") REFERENCES "lead_identity_reviews"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_identity_reviews" ADD CONSTRAINT "contact_identity_reviews_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_runs" ADD CONSTRAINT "contact_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_runs" ADD CONSTRAINT "contact_backfill_runs_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_runs" ADD CONSTRAINT "contact_backfill_runs_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_items" ADD CONSTRAINT "contact_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_items" ADD CONSTRAINT "contact_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "contact_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_items" ADD CONSTRAINT "contact_backfill_items_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_items" ADD CONSTRAINT "contact_backfill_items_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_backfill_items" ADD CONSTRAINT "contact_backfill_items_workspaceId_reviewId_fkey" FOREIGN KEY ("workspaceId", "reviewId") REFERENCES "contact_identity_reviews"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description", "createdAt") VALUES
  (gen_random_uuid(), 'contacts.read', 'Consultar a identidade canônica de contatos', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contacts.review', 'Revisar colisões de identidade sem mesclagem automática', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contacts.backfill', 'Executar e controlar o backfill de contatos', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt"
)
SELECT gen_random_uuid(), role."workspaceId", role."id", permission."id",
  CASE
    WHEN role."key" IN ('administrator', 'viewer') THEN 'WORKSPACE'::"PermissionScope"
    WHEN role."key" = 'commercial_manager' THEN 'TEAM'::"PermissionScope"
    ELSE 'OWN'::"PermissionScope"
  END,
  role."createdByActorId", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."key" = 'contacts.read'
WHERE role."key" IN ('administrator', 'commercial_manager', 'sdr', 'closer', 'viewer')
  AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt"
)
SELECT gen_random_uuid(), role."workspaceId", role."id", permission."id",
  'WORKSPACE'::"PermissionScope",
  role."createdByActorId", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."key" = 'contacts.review'
WHERE role."key" IN ('administrator', 'commercial_manager')
  AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt"
)
SELECT gen_random_uuid(), role."workspaceId", role."id", permission."id", 'WORKSPACE'::"PermissionScope",
  role."createdByActorId", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."key" = 'contacts.backfill'
WHERE role."key" = 'administrator' AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;

COMMIT;
