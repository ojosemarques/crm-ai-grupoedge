-- Ensure a form can only point at one of its own immutable published versions.
CREATE UNIQUE INDEX "marketing_form_versions_workspaceId_marketingFormId_id_key"
  ON "marketing_form_versions"("workspaceId", "marketingFormId", "id");

ALTER TABLE "marketing_forms"
  DROP CONSTRAINT "marketing_forms_published_version_fkey",
  ADD CONSTRAINT "marketing_forms_published_version_fkey"
    FOREIGN KEY ("workspaceId", "id", "publishedVersionId")
    REFERENCES "marketing_form_versions"("workspaceId", "marketingFormId", "id")
    ON DELETE RESTRICT;
