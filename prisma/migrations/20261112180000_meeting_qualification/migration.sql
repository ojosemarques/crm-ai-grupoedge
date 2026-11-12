BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TYPE "MeetingQualification" AS ENUM ('TIER_A', 'TIER_B', 'TIER_C');

ALTER TABLE "meetings" ADD COLUMN "qualification" "MeetingQualification";

COMMIT;
