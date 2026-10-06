-- A prospect is actionable with a public phone/WhatsApp or a validated public
-- Instagram profile. E-mail remains optional and is never sufficient alone.
ALTER TABLE "prospect_candidates"
  ALTER COLUMN "phone" DROP NOT NULL,
  ALTER COLUMN "normalizedPhone" DROP NOT NULL,
  ALTER COLUMN "phoneScope" DROP NOT NULL,
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "normalizedEmail" DROP NOT NULL,
  ALTER COLUMN "emailScope" DROP NOT NULL;
