BEGIN;

CREATE TABLE "marketing_form_partial_responses" (
  "id" UUID NOT NULL,
  "publicId" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "marketingFormId" UUID NOT NULL,
  "marketingFormVersionId" UUID NOT NULL,
  "sessionPublicId" UUID NOT NULL,
  "receiptId" UUID,
  "answers" JSONB NOT NULL,
  "respondentName" TEXT,
  "respondentEmail" TEXT,
  "respondentPhone" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "utmTerm" TEXT,
  "referrerHost" TEXT,
  "firstAnsweredAt" TIMESTAMPTZ(3) NOT NULL,
  "lastAnsweredAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "marketing_form_partial_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_form_partial_responses_time_check" CHECK ("lastAnsweredAt" >= "firstAnsweredAt")
);

CREATE UNIQUE INDEX "marketing_form_partial_responses_workspaceId_id_key"
  ON "marketing_form_partial_responses"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_form_partial_responses_workspaceId_publicId_key"
  ON "marketing_form_partial_responses"("workspaceId", "publicId");
CREATE UNIQUE INDEX "marketing_form_partial_responses_workspaceId_version_session_key"
  ON "marketing_form_partial_responses"("workspaceId", "marketingFormVersionId", "sessionPublicId");
CREATE INDEX "marketing_form_partial_responses_workspaceId_form_active_last_idx"
  ON "marketing_form_partial_responses"("workspaceId", "marketingFormId", "completedAt", "deletedAt", "lastAnsweredAt");
CREATE INDEX "marketing_form_partial_responses_workspaceId_version_last_idx"
  ON "marketing_form_partial_responses"("workspaceId", "marketingFormVersionId", "lastAnsweredAt");
CREATE INDEX "marketing_form_partial_responses_workspaceId_receipt_idx"
  ON "marketing_form_partial_responses"("workspaceId", "receiptId");

ALTER TABLE "marketing_form_partial_responses" ADD CONSTRAINT "marketing_form_partial_responses_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_partial_responses" ADD CONSTRAINT "marketing_form_partial_responses_form_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormId") REFERENCES "marketing_forms"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_partial_responses" ADD CONSTRAINT "marketing_form_partial_responses_version_fkey"
  FOREIGN KEY ("workspaceId", "marketingFormVersionId") REFERENCES "marketing_form_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_partial_responses" ADD CONSTRAINT "marketing_form_partial_responses_receipt_fkey"
  FOREIGN KEY ("workspaceId", "receiptId") REFERENCES "marketing_form_receipts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "marketing_form_partial_responses" ADD CONSTRAINT "marketing_form_partial_responses_actor_fkey"
  FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

REVOKE ALL ON TABLE "marketing_form_partial_responses" FROM PUBLIC;

DO $migration$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'marketing_form_partial_responses', role_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON "marketing_form_partial_responses" TO crm_politizai_runtime;
  END IF;
END
$migration$;

COMMIT;
