-- CRM-12: qualificação PACTO relacional, validada e historicamente reproduzível.

BEGIN;

ALTER TYPE "QualificationCriterionStatus" ADD VALUE 'DISQUALIFYING';

CREATE TYPE "PactoDimension" AS ENUM (
  'POLITICAL_CONTEXT',
  'AFFLICTION',
  'CAPACITY',
  'DECISION',
  'OPPORTUNITY_NOW'
);

CREATE TYPE "QualificationEvidenceOrigin" AS ENUM (
  'FORM',
  'SDR',
  'CLOSER',
  'AI'
);

CREATE TYPE "QualificationRevisionKind" AS ENUM (
  'DRAFT_SAVED',
  'VALIDATED'
);

ALTER TABLE "workspaces"
  ADD COLUMN "pactoMinimumInvestigatedDimensions" INTEGER NOT NULL DEFAULT 5,
  ADD CONSTRAINT "workspaces_pacto_minimum_dimensions_check"
    CHECK ("pactoMinimumInvestigatedDimensions" BETWEEN 1 AND 5);

ALTER TABLE "lead_qualifications"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minimumRequiredDimensions" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "validatedAt" TIMESTAMPTZ(3),
  ADD COLUMN "validatedByActorId" UUID,
  ADD CONSTRAINT "lead_qualifications_revision_check" CHECK ("revision" >= 0),
  ADD CONSTRAINT "lead_qualifications_minimum_dimensions_check"
    CHECK ("minimumRequiredDimensions" BETWEEN 1 AND 5),
  ADD CONSTRAINT "lead_qualifications_validation_pair_check"
    CHECK (
      ("validatedAt" IS NULL AND "validatedByActorId" IS NULL)
      OR
      ("validatedAt" IS NOT NULL AND "validatedByActorId" IS NOT NULL)
    );

CREATE UNIQUE INDEX "lead_qualifications_workspaceId_leadId_id_key"
  ON "lead_qualifications"("workspaceId", "leadId", "id");

ALTER TABLE "lead_qualifications"
  ADD CONSTRAINT "lead_qualifications_workspaceId_validatedByActorId_fkey"
  FOREIGN KEY ("workspaceId", "validatedByActorId")
  REFERENCES "actors"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pacto_assessments" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "qualificationId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "dimension" "PactoDimension" NOT NULL,
  "status" "QualificationCriterionStatus" NOT NULL DEFAULT 'UNKNOWN',
  "note" TEXT,
  "evidence" TEXT,
  "origin" "QualificationEvidenceOrigin",
  "recordedAt" TIMESTAMPTZ(3),
  "recordedByActorId" UUID,
  "validatedAt" TIMESTAMPTZ(3),
  "validatedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "pacto_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pacto_assessments_recording_pair_check" CHECK (
    ("origin" IS NULL AND "recordedAt" IS NULL AND "recordedByActorId" IS NULL)
    OR
    ("origin" IS NOT NULL AND "recordedAt" IS NOT NULL AND "recordedByActorId" IS NOT NULL)
  ),
  CONSTRAINT "pacto_assessments_evidence_check" CHECK (
    "status" = 'UNKNOWN'
    OR ("evidence" IS NOT NULL AND length(trim("evidence")) >= 2 AND "origin" IS NOT NULL)
  ),
  CONSTRAINT "pacto_assessments_validation_pair_check" CHECK (
    ("validatedAt" IS NULL AND "validatedByActorId" IS NULL)
    OR
    ("validatedAt" IS NOT NULL AND "validatedByActorId" IS NOT NULL AND "status" <> 'UNKNOWN')
  )
);

CREATE TABLE "pacto_revisions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "qualificationId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "kind" "QualificationRevisionKind" NOT NULL,
  "qualificationStatus" "QualificationStatus" NOT NULL,
  "minimumRequiredDimensions" INTEGER NOT NULL,
  "investigatedDimensions" INTEGER NOT NULL,
  "hasDisqualifyingDimension" BOOLEAN NOT NULL,
  "isQualificationReady" BOOLEAN NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pacto_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pacto_revisions_number_check" CHECK ("revisionNumber" > 0),
  CONSTRAINT "pacto_revisions_counts_check" CHECK (
    "minimumRequiredDimensions" BETWEEN 1 AND 5
    AND "investigatedDimensions" BETWEEN 0 AND 5
  )
);

CREATE TABLE "pacto_revision_dimensions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "dimension" "PactoDimension" NOT NULL,
  "status" "QualificationCriterionStatus" NOT NULL,
  "note" TEXT,
  "evidence" TEXT,
  "origin" "QualificationEvidenceOrigin",
  "recordedAt" TIMESTAMPTZ(3),
  "recordedByActorId" UUID,
  "validatedAt" TIMESTAMPTZ(3),
  "validatedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pacto_revision_dimensions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pacto_suggestions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "submissionId" UUID,
  "dimension" "PactoDimension" NOT NULL,
  "status" "QualificationCriterionStatus" NOT NULL,
  "note" TEXT,
  "evidence" TEXT NOT NULL,
  "origin" "QualificationEvidenceOrigin" NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pacto_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pacto_suggestions_source_check" CHECK ("origin" IN ('FORM', 'AI')),
  CONSTRAINT "pacto_suggestions_status_check" CHECK ("status" <> 'UNKNOWN'),
  CONSTRAINT "pacto_suggestions_evidence_check" CHECK (length(trim("evidence")) >= 2),
  CONSTRAINT "pacto_suggestions_submission_check" CHECK (
    ("origin" = 'FORM' AND "submissionId" IS NOT NULL)
    OR
    ("origin" = 'AI' AND "submissionId" IS NULL)
  )
);

CREATE UNIQUE INDEX "pacto_assessments_workspaceId_id_key"
  ON "pacto_assessments"("workspaceId", "id");
CREATE UNIQUE INDEX "pacto_assessments_workspaceId_qualificationId_dimension_key"
  ON "pacto_assessments"("workspaceId", "qualificationId", "dimension");
CREATE UNIQUE INDEX "pacto_assessments_workspaceId_leadId_dimension_key"
  ON "pacto_assessments"("workspaceId", "leadId", "dimension");
CREATE INDEX "pacto_assessments_workspaceId_dimension_status_idx"
  ON "pacto_assessments"("workspaceId", "dimension", "status");
CREATE INDEX "pacto_assessments_workspaceId_leadId_validatedAt_idx"
  ON "pacto_assessments"("workspaceId", "leadId", "validatedAt");

CREATE UNIQUE INDEX "pacto_revisions_workspaceId_id_key"
  ON "pacto_revisions"("workspaceId", "id");
CREATE UNIQUE INDEX "pacto_revisions_workspaceId_qualificationId_revisionNumber_key"
  ON "pacto_revisions"("workspaceId", "qualificationId", "revisionNumber");
CREATE INDEX "pacto_revisions_workspaceId_leadId_revisionNumber_idx"
  ON "pacto_revisions"("workspaceId", "leadId", "revisionNumber");
CREATE INDEX "pacto_revisions_workspaceId_kind_createdAt_idx"
  ON "pacto_revisions"("workspaceId", "kind", "createdAt");

CREATE UNIQUE INDEX "pacto_revision_dimensions_workspaceId_id_key"
  ON "pacto_revision_dimensions"("workspaceId", "id");
CREATE UNIQUE INDEX "pacto_revision_dimensions_workspaceId_revisionId_dimension_key"
  ON "pacto_revision_dimensions"("workspaceId", "revisionId", "dimension");
CREATE INDEX "pacto_revision_dimensions_workspaceId_dimension_status_createdAt_idx"
  ON "pacto_revision_dimensions"("workspaceId", "dimension", "status", "createdAt");

CREATE UNIQUE INDEX "pacto_suggestions_workspaceId_id_key"
  ON "pacto_suggestions"("workspaceId", "id");
CREATE INDEX "pacto_suggestions_workspaceId_leadId_origin_createdAt_idx"
  ON "pacto_suggestions"("workspaceId", "leadId", "origin", "createdAt");
CREATE INDEX "pacto_suggestions_workspaceId_dimension_status_createdAt_idx"
  ON "pacto_suggestions"("workspaceId", "dimension", "status", "createdAt");

ALTER TABLE "pacto_assessments"
  ADD CONSTRAINT "pacto_assessments_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_assessments_qualification_fkey"
    FOREIGN KEY ("workspaceId", "leadId", "qualificationId")
    REFERENCES "lead_qualifications"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_assessments_lead_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_assessments_recordedBy_fkey"
    FOREIGN KEY ("workspaceId", "recordedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_assessments_validatedBy_fkey"
    FOREIGN KEY ("workspaceId", "validatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pacto_revisions"
  ADD CONSTRAINT "pacto_revisions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_revisions_qualification_fkey"
    FOREIGN KEY ("workspaceId", "leadId", "qualificationId")
    REFERENCES "lead_qualifications"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_revisions_lead_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_revisions_createdBy_fkey"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pacto_revision_dimensions"
  ADD CONSTRAINT "pacto_revision_dimensions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_revision_dimensions_revision_fkey"
    FOREIGN KEY ("workspaceId", "revisionId") REFERENCES "pacto_revisions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_revision_dimensions_recordedBy_fkey"
    FOREIGN KEY ("workspaceId", "recordedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_revision_dimensions_validatedBy_fkey"
    FOREIGN KEY ("workspaceId", "validatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pacto_suggestions"
  ADD CONSTRAINT "pacto_suggestions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_suggestions_lead_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_suggestions_submission_fkey"
    FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pacto_suggestions_createdBy_fkey"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_pacto_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pacto history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pacto_revisions_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "pacto_revisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_pacto_history_mutation();
CREATE TRIGGER "pacto_revisions_no_truncate_trigger"
  BEFORE TRUNCATE ON "pacto_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_pacto_history_mutation();
CREATE TRIGGER "pacto_revision_dimensions_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "pacto_revision_dimensions"
  FOR EACH ROW EXECUTE FUNCTION prevent_pacto_history_mutation();
CREATE TRIGGER "pacto_revision_dimensions_no_truncate_trigger"
  BEFORE TRUNCATE ON "pacto_revision_dimensions"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_pacto_history_mutation();
CREATE TRIGGER "pacto_suggestions_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "pacto_suggestions"
  FOR EACH ROW EXECUTE FUNCTION prevent_pacto_history_mutation();
CREATE TRIGGER "pacto_suggestions_no_truncate_trigger"
  BEFORE TRUNCATE ON "pacto_suggestions"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_pacto_history_mutation();

COMMIT;
