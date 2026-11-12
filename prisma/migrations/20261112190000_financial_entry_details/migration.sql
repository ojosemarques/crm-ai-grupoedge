BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "financial_entries"
  ADD COLUMN "counterpartyType" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "notes" TEXT,
  ADD CONSTRAINT "financial_entry_counterparty_type_ck" CHECK ("counterpartyType" IN ('CUSTOMER', 'SUPPLIER', 'OTHER')),
  ADD CONSTRAINT "financial_entry_tags_count_ck" CHECK (cardinality("tags") <= 12),
  ADD CONSTRAINT "financial_entry_notes_length_ck" CHECK (char_length("notes") <= 2000);

COMMIT;
