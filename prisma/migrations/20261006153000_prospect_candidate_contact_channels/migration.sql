-- Preserve every verified contact channel collected by Politizai Pesquisa.
-- The existing phone/e-mail pair remains the required office contact.
ALTER TABLE "prospect_candidates"
  ADD COLUMN "advisorPhone" TEXT,
  ADD COLUMN "normalizedAdvisorPhone" TEXT,
  ADD COLUMN "advisorEmail" TEXT,
  ADD COLUMN "normalizedAdvisorEmail" TEXT,
  ADD COLUMN "whatsapp" TEXT,
  ADD COLUMN "normalizedWhatsapp" TEXT,
  ADD COLUMN "whatsappScope" "ProspectContactScope";

CREATE INDEX "prospect_candidates_workspaceId_normalizedAdvisorPhone_idx"
  ON "prospect_candidates"("workspaceId", "normalizedAdvisorPhone");

CREATE INDEX "prospect_candidates_workspaceId_normalizedAdvisorEmail_idx"
  ON "prospect_candidates"("workspaceId", "normalizedAdvisorEmail");

CREATE INDEX "prospect_candidates_workspaceId_normalizedWhatsapp_idx"
  ON "prospect_candidates"("workspaceId", "normalizedWhatsapp");
