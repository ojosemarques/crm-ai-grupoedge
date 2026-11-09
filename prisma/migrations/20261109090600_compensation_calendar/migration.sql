ALTER TABLE "commercial_compensation_policies"
  ADD COLUMN "calendarVerifiedThrough" DATE,
  ADD COLUMN "calendarHolidays" DATE[] NOT NULL DEFAULT ARRAY[]::DATE[],
  ADD COLUMN "calendarEvidence" TEXT,
  ADD CONSTRAINT "commercial_compensation_calendar_evidence" CHECK (
    ("calendarVerifiedThrough" IS NULL AND "calendarEvidence" IS NULL AND cardinality("calendarHolidays") = 0)
    OR ("calendarVerifiedThrough" IS NOT NULL
      AND "calendarVerifiedThrough" >= "effectiveDate"
      AND "calendarEvidence" IS NOT NULL AND length(trim("calendarEvidence")) > 0
      AND array_position("calendarHolidays", NULL) IS NULL
      AND "calendarVerifiedThrough" >= ALL ("calendarHolidays"))
  );
