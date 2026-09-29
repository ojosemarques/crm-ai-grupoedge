-- Correct the PostgreSQL regular-expression escaping used by the CRM-46
-- E.164 checks. With standard_conforming_strings enabled, one backslash is
-- sufficient to make the leading plus literal.
ALTER TABLE "phone_calls"
  DROP CONSTRAINT "phone_calls_caller_e164_check",
  DROP CONSTRAINT "phone_calls_callee_e164_check",
  ADD CONSTRAINT "phone_calls_caller_e164_check"
    CHECK ("callerPhoneE164" IS NULL OR "callerPhoneE164" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "phone_calls_callee_e164_check"
    CHECK ("calleePhoneE164" IS NULL OR "calleePhoneE164" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "phone_call_legs"
  DROP CONSTRAINT "phone_call_legs_phone_e164_check",
  ADD CONSTRAINT "phone_call_legs_phone_e164_check"
    CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "telephony_suppressions"
  DROP CONSTRAINT "telephony_suppressions_phone_e164_check",
  ADD CONSTRAINT "telephony_suppressions_phone_e164_check"
    CHECK ("normalizedPhone" IS NULL OR "normalizedPhone" ~ '^\+[1-9][0-9]{7,14}$');
