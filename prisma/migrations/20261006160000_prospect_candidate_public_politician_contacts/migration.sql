-- Keep public politician/campaign contacts separate from the mandatory office pair.
ALTER TABLE "prospect_candidates"
  ADD COLUMN "politicianPhone" TEXT,
  ADD COLUMN "normalizedPoliticianPhone" TEXT,
  ADD COLUMN "politicianEmail" TEXT,
  ADD COLUMN "normalizedPoliticianEmail" TEXT;

CREATE INDEX "prospect_candidates_workspaceId_normalizedPoliticianPhone_idx"
  ON "prospect_candidates"("workspaceId", "normalizedPoliticianPhone");

CREATE INDEX "prospect_candidates_workspaceId_normalizedPoliticianEmail_idx"
  ON "prospect_candidates"("workspaceId", "normalizedPoliticianEmail");
