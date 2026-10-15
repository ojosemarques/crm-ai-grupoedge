SET search_path TO crm, public;

DO $$
BEGIN
  CREATE TYPE "ProspectingGender" AS ENUM ('MALE', 'FEMALE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "prospecting_research_targets"
ADD COLUMN IF NOT EXISTS "gender" "ProspectingGender";

CREATE INDEX IF NOT EXISTS "prospecting_targets_workspace_gender_candidate_idx"
ON "prospecting_research_targets" ("workspaceId", "gender", "candidateId");
