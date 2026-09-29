-- Use a character class for the literal plus sign so the constraint behaves
-- identically with PostgreSQL standard_conforming_strings enabled.
ALTER TABLE "leads"
  DROP CONSTRAINT "leads_phone_e164_check",
  ADD CONSTRAINT "leads_phone_e164_check"
  CHECK ("normalizedPhone" IS NULL OR "normalizedPhone" ~ '^[+][1-9][0-9]{7,14}$');

ALTER TABLE "lead_form_submissions"
  DROP CONSTRAINT "submissions_phone_e164_check",
  ADD CONSTRAINT "submissions_phone_e164_check"
  CHECK ("normalizedPhone" IS NULL OR "normalizedPhone" ~ '^[+][1-9][0-9]{7,14}$');
