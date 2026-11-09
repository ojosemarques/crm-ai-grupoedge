ALTER TABLE "invoices"
  ADD COLUMN "revisedUpfrontCents" BIGINT,
  ADD CONSTRAINT "invoices_revised_upfront_values" CHECK (
    "revisedUpfrontCents" IS NULL OR "revisedUpfrontCents" BETWEEN 0 AND "totalCents"
  );
