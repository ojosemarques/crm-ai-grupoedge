CREATE TYPE "FinancialApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');
CREATE TYPE "FinancialRecurrenceFrequency" AS ENUM ('MONTHLY');
CREATE TYPE "CommissionBasis" AS ENUM ('TCV', 'SALE_AMOUNT', 'MRR');

CREATE TABLE "financial_cost_centers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE, "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "financial_cost_centers_workspace_id_key" ON "financial_cost_centers"("workspaceId", "id");
CREATE UNIQUE INDEX "financial_cost_centers_workspace_key_key" ON "financial_cost_centers"("workspaceId", "key");
CREATE INDEX "financial_cost_centers_workspace_active_name_idx" ON "financial_cost_centers"("workspaceId", "active", "name");

CREATE TABLE "financial_recurrences" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "categoryId" UUID NOT NULL, "financialAccountId" UUID NOT NULL,
  "costCenterId" UUID, "direction" "FinancialEntryDirection" NOT NULL, "description" TEXT NOT NULL, "counterparty" TEXT,
  "amountCents" BIGINT NOT NULL, "frequency" "FinancialRecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY', "installmentCount" INTEGER NOT NULL,
  "firstDueAt" TIMESTAMPTZ(3) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT TRUE, "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "financial_recurrences_values_ck" CHECK ("amountCents" > 0 AND "installmentCount" BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX "financial_recurrences_workspace_id_key" ON "financial_recurrences"("workspaceId", "id");
CREATE INDEX "financial_recurrences_workspace_active_due_idx" ON "financial_recurrences"("workspaceId", "active", "firstDueAt");

CREATE TABLE "bank_statement_imports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "financialAccountId" UUID NOT NULL, "fileName" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL, "importedRows" INTEGER NOT NULL, "matchedRows" INTEGER NOT NULL DEFAULT 0, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bank_statement_imports_workspace_id_key" ON "bank_statement_imports"("workspaceId", "id");
CREATE UNIQUE INDEX "bank_statement_imports_workspace_hash_key" ON "bank_statement_imports"("workspaceId", "contentHash");
CREATE INDEX "bank_statement_imports_workspace_created_idx" ON "bank_statement_imports"("workspaceId", "createdAt");

CREATE TABLE "bank_statement_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "importId" UUID NOT NULL, "financialEntryId" UUID,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL, "description" TEXT NOT NULL, "amountCents" BIGINT NOT NULL,
  "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED', "rawData" JSONB NOT NULL, "matchedAt" TIMESTAMPTZ(3), "matchedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "bank_statement_lines_amount_ck" CHECK ("amountCents" <> 0)
);
CREATE UNIQUE INDEX "bank_statement_lines_workspace_id_key" ON "bank_statement_lines"("workspaceId", "id");
CREATE INDEX "bank_statement_lines_workspace_status_at_idx" ON "bank_statement_lines"("workspaceId", "status", "occurredAt");
CREATE INDEX "bank_statement_lines_workspace_import_idx" ON "bank_statement_lines"("workspaceId", "importId");

CREATE TABLE "financial_attachments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "financialEntryId" UUID NOT NULL, "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "contentHash" TEXT NOT NULL, "content" BYTEA NOT NULL,
  "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_attachments_size_ck" CHECK ("sizeBytes" BETWEEN 0 AND 10485760)
);
CREATE UNIQUE INDEX "financial_attachments_workspace_id_key" ON "financial_attachments"("workspaceId", "id");
CREATE INDEX "financial_attachments_workspace_entry_idx" ON "financial_attachments"("workspaceId", "financialEntryId", "createdAt");

ALTER TABLE "financial_entries" ADD COLUMN "costCenterId" UUID, ADD COLUMN "recurrenceId" UUID, ADD COLUMN "installmentNumber" INTEGER,
  ADD COLUMN "approvalStatus" "FinancialApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED', ADD COLUMN "approvalReason" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMPTZ(3), ADD COLUMN "approvedByActorId" UUID;
ALTER TABLE "commission_rules" ADD COLUMN "basis" "CommissionBasis" NOT NULL DEFAULT 'TCV';

ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_approval_state_ck" CHECK (
  ("approvalStatus" IN ('NOT_REQUIRED', 'PENDING') AND "approvedAt" IS NULL AND "approvedByActorId" IS NULL)
  OR ("approvalStatus" IN ('APPROVED', 'REJECTED') AND "approvedAt" IS NOT NULL AND "approvedByActorId" IS NOT NULL AND length(trim("approvalReason")) >= 3)
);

ALTER TABLE "financial_cost_centers" ADD CONSTRAINT "financial_cost_centers_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_cost_centers" ADD CONSTRAINT "financial_cost_centers_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_cost_centers" ADD CONSTRAINT "financial_cost_centers_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_recurrences" ADD CONSTRAINT "financial_recurrences_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_recurrences" ADD CONSTRAINT "financial_recurrences_category_fk" FOREIGN KEY ("workspaceId", "categoryId") REFERENCES "financial_categories"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_recurrences" ADD CONSTRAINT "financial_recurrences_account_fk" FOREIGN KEY ("workspaceId", "financialAccountId") REFERENCES "financial_accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_recurrences" ADD CONSTRAINT "financial_recurrences_cost_center_fk" FOREIGN KEY ("workspaceId", "costCenterId") REFERENCES "financial_cost_centers"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_recurrences" ADD CONSTRAINT "financial_recurrences_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_recurrences" ADD CONSTRAINT "financial_recurrences_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_account_fk" FOREIGN KEY ("workspaceId", "financialAccountId") REFERENCES "financial_accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_fk" FOREIGN KEY ("workspaceId", "importId") REFERENCES "bank_statement_imports"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_entry_fk" FOREIGN KEY ("workspaceId", "financialEntryId") REFERENCES "financial_entries"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_attachments" ADD CONSTRAINT "financial_attachments_entry_fk" FOREIGN KEY ("workspaceId", "financialEntryId") REFERENCES "financial_entries"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_attachments" ADD CONSTRAINT "financial_attachments_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_attachments" ADD CONSTRAINT "financial_attachments_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_approved_actor_fk" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_cost_center_fk" FOREIGN KEY ("workspaceId", "costCenterId") REFERENCES "financial_cost_centers"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_recurrence_fk" FOREIGN KEY ("workspaceId", "recurrenceId") REFERENCES "financial_recurrences"("workspaceId", "id") ON DELETE RESTRICT;
CREATE INDEX "financial_entries_workspace_approval_idx" ON "financial_entries"("workspaceId", "approvalStatus", "dueAt");
CREATE INDEX "financial_entries_workspace_cost_center_idx" ON "financial_entries"("workspaceId", "costCenterId", "competenceAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON "financial_cost_centers", "financial_recurrences", "bank_statement_imports", "bank_statement_lines", "financial_attachments" TO crm_politizai_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON "financial_cost_centers", "financial_recurrences", "bank_statement_imports", "bank_statement_lines", "financial_attachments" TO service_role;
  END IF;
END $$;
