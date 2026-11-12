BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "meetings"
  DROP CONSTRAINT "meetings_duration_minutes_check",
  ADD CONSTRAINT "meetings_duration_minutes_check" CHECK ("durationMinutes" IN (30, 40, 60));

COMMIT;
