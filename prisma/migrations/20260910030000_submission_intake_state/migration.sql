-- AlterTable
ALTER TABLE "lead_form_submissions" ALTER COLUMN "leadId" DROP NOT NULL;

-- A submission can be persisted before normalization/deduplication. Once it is
-- marked LINKED, the consolidated lead becomes mandatory.
ALTER TABLE "lead_form_submissions"
  ADD CONSTRAINT "submissions_link_state_check"
  CHECK (
    ("status" = 'LINKED' AND "leadId" IS NOT NULL)
    OR ("status" <> 'LINKED' AND "leadId" IS NULL)
  );
