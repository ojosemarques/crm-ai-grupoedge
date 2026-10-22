-- Lifecycle, immutable publication, idempotent receipts and first-party analytics for marketing forms.
ALTER TYPE "MarketingDefinitionStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

CREATE TYPE "MarketingFormReceiptStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'ACCEPTED', 'FAILED');
CREATE TYPE "MarketingFormEventKind" AS ENUM (
  'FORM_VIEW', 'FORM_START', 'QUESTION_VIEWED', 'QUESTION_ANSWERED',
  'FORM_SUBMITTED', 'FORM_COMPLETED', 'REDIRECT_OPENED'
);

ALTER TABLE "marketing_forms"
  ADD COLUMN "publicSlug" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "draftSchemaVersion" TEXT NOT NULL DEFAULT 'marketing-form.v1',
  ADD COLUMN "draftDefinition" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "publishedVersionId" UUID,
  ADD COLUMN "publishedAt" TIMESTAMPTZ(3),
  ADD COLUMN "pausedAt" TIMESTAMPTZ(3),
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "marketing_forms_revision_check" CHECK ("revision" > 0);

-- Existing attribution definitions receive a collision-resistant internal slug. Admins can rename it later.
UPDATE "marketing_forms"
SET "publicSlug" = trim(both '-' from lower(regexp_replace("key", '[^a-zA-Z0-9]+', '-', 'g')))
  || '-' || substring(replace("id"::text, '-', '') from 1 for 8)
WHERE "publicSlug" IS NULL;

ALTER TABLE "marketing_forms" ALTER COLUMN "publicSlug" SET NOT NULL;

ALTER TABLE "marketing_form_versions"
  ADD COLUMN "publicId" UUID,
  ADD COLUMN "definitionHash" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMPTZ(3),
  ADD COLUMN "publishedByActorId" UUID;

-- The historical table is append-only at runtime. Schema evolution must backfill the
-- new immutable publication metadata before restoring that invariant.
ALTER TABLE "marketing_form_versions" DISABLE TRIGGER "marketing_form_versions_append_only";

UPDATE "marketing_form_versions"
SET
  "publicId" = gen_random_uuid(),
  "definitionHash" = md5("definition"::text),
  "publishedAt" = "createdAt",
  "publishedByActorId" = "createdByActorId"
WHERE "publicId" IS NULL OR "definitionHash" IS NULL OR "publishedAt" IS NULL OR "publishedByActorId" IS NULL;

ALTER TABLE "marketing_form_versions" ENABLE TRIGGER "marketing_form_versions_append_only";

ALTER TABLE "marketing_form_versions"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "definitionHash" SET NOT NULL,
  ALTER COLUMN "publishedAt" SET NOT NULL,
  ALTER COLUMN "publishedByActorId" SET NOT NULL;

CREATE TABLE "marketing_form_receipts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "publicId" UUID NOT NULL,
  "marketingFormId" UUID NOT NULL,
  "marketingFormVersionId" UUID NOT NULL,
  "sessionId" UUID,
  "idempotencyHash" TEXT NOT NULL,
  "status" "MarketingFormReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
  "answers" JSONB NOT NULL,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "utmTerm" TEXT,
  "referrerHost" TEXT,
  "safeErrorCode" TEXT,
  "redirectKind" TEXT,
  "redirectUrl" TEXT,
  "rotationTargetKey" TEXT,
  "rotationAppliedAt" TIMESTAMPTZ(3),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "marketing_form_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_form_receipts_time_check" CHECK ("submittedAt" >= "startedAt")
);

CREATE TABLE "marketing_form_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "marketingFormId" UUID NOT NULL,
  "marketingFormVersionId" UUID NOT NULL,
  "sessionId" UUID,
  "kind" "MarketingFormEventKind" NOT NULL,
  "questionKey" TEXT,
  "optionKey" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "utmTerm" TEXT,
  "referrerHost" TEXT,
  "safeMetadata" JSONB,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_form_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketing_form_rotation_states" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "marketingFormId" UUID NOT NULL,
  "marketingFormVersionId" UUID NOT NULL,
  "nextIndex" INTEGER NOT NULL DEFAULT 0,
  "totalAssignments" BIGINT NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "resetAt" TIMESTAMPTZ(3),
  "resetByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "marketing_form_rotation_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_form_rotation_states_index_check" CHECK ("nextIndex" >= 0),
  CONSTRAINT "marketing_form_rotation_states_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "marketing_form_rotation_states_assignments_check" CHECK ("totalAssignments" >= 0)
);

ALTER TABLE "lead_form_submissions" ADD COLUMN "marketingFormReceiptId" UUID;

CREATE UNIQUE INDEX "marketing_forms_publicSlug_key" ON "marketing_forms"("publicSlug");
CREATE UNIQUE INDEX "marketing_form_versions_publicId_key" ON "marketing_form_versions"("publicId");
CREATE UNIQUE INDEX "marketing_form_versions_workspaceId_publicId_key" ON "marketing_form_versions"("workspaceId", "publicId");
CREATE INDEX "marketing_forms_workspaceId_status_updatedAt_idx" ON "marketing_forms"("workspaceId", "status", "updatedAt");
CREATE INDEX "marketing_forms_workspaceId_publicSlug_idx" ON "marketing_forms"("workspaceId", "publicSlug");

CREATE UNIQUE INDEX "marketing_form_receipts_workspaceId_id_key" ON "marketing_form_receipts"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_form_receipts_workspaceId_publicId_key" ON "marketing_form_receipts"("workspaceId", "publicId");
CREATE UNIQUE INDEX "marketing_form_receipts_workspaceId_version_idempotency_key" ON "marketing_form_receipts"("workspaceId", "marketingFormVersionId", "idempotencyHash");
CREATE INDEX "marketing_form_receipts_workspaceId_form_status_submitted_idx" ON "marketing_form_receipts"("workspaceId", "marketingFormId", "status", "submittedAt");
CREATE INDEX "marketing_form_receipts_workspaceId_version_submitted_idx" ON "marketing_form_receipts"("workspaceId", "marketingFormVersionId", "submittedAt");
CREATE INDEX "marketing_form_receipts_workspaceId_session_submitted_idx" ON "marketing_form_receipts"("workspaceId", "sessionId", "submittedAt");

CREATE UNIQUE INDEX "marketing_form_events_workspaceId_id_key" ON "marketing_form_events"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_form_events_workspaceId_idempotencyKey_key" ON "marketing_form_events"("workspaceId", "idempotencyKey");
CREATE INDEX "marketing_form_events_workspaceId_form_version_kind_occurred_idx" ON "marketing_form_events"("workspaceId", "marketingFormId", "marketingFormVersionId", "kind", "occurredAt");
CREATE INDEX "marketing_form_events_workspaceId_session_occurred_idx" ON "marketing_form_events"("workspaceId", "sessionId", "occurredAt");
CREATE INDEX "marketing_form_events_workspaceId_version_question_option_idx" ON "marketing_form_events"("workspaceId", "marketingFormVersionId", "questionKey", "optionKey");

CREATE UNIQUE INDEX "marketing_form_rotation_states_workspaceId_id_key" ON "marketing_form_rotation_states"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_form_rotation_states_workspaceId_version_key" ON "marketing_form_rotation_states"("workspaceId", "marketingFormVersionId");
CREATE INDEX "marketing_form_rotation_states_workspaceId_form_updated_idx" ON "marketing_form_rotation_states"("workspaceId", "marketingFormId", "updatedAt");

CREATE UNIQUE INDEX "lead_form_submissions_workspaceId_marketingFormReceiptId_key" ON "lead_form_submissions"("workspaceId", "marketingFormReceiptId");
CREATE INDEX "lead_form_submissions_workspaceId_marketingFormReceiptId_idx" ON "lead_form_submissions"("workspaceId", "marketingFormReceiptId");

ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_published_version_fkey"
  FOREIGN KEY ("workspaceId", "publishedVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_versions" ADD CONSTRAINT "marketing_form_versions_published_actor_fkey"
  FOREIGN KEY ("workspaceId", "publishedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "marketing_form_receipts" ADD CONSTRAINT "marketing_form_receipts_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_receipts" ADD CONSTRAINT "marketing_form_receipts_form_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_receipts" ADD CONSTRAINT "marketing_form_receipts_version_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_receipts" ADD CONSTRAINT "marketing_form_receipts_session_fkey"
  FOREIGN KEY ("workspaceId", "sessionId") REFERENCES "marketing_sessions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_receipts" ADD CONSTRAINT "marketing_form_receipts_actor_fkey"
  FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "marketing_form_events" ADD CONSTRAINT "marketing_form_events_form_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_events" ADD CONSTRAINT "marketing_form_events_version_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_events" ADD CONSTRAINT "marketing_form_events_session_fkey"
  FOREIGN KEY ("workspaceId", "sessionId") REFERENCES "marketing_sessions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_events" ADD CONSTRAINT "marketing_form_events_actor_fkey"
  FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "marketing_form_rotation_states" ADD CONSTRAINT "marketing_form_rotation_states_form_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_rotation_states" ADD CONSTRAINT "marketing_form_rotation_states_version_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_rotation_states" ADD CONSTRAINT "marketing_form_rotation_states_reset_actor_fkey"
  FOREIGN KEY ("workspaceId", "resetByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_form_receipt_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormReceiptId") REFERENCES "marketing_form_receipts"("workspaceId", "id") ON DELETE RESTRICT;
