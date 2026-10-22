BEGIN;

CREATE TYPE "MeetingParticipantResponseStatus" AS ENUM (
  'NEEDS_ACTION',
  'ACCEPTED',
  'TENTATIVE',
  'DECLINED',
  'UNKNOWN'
);

ALTER TABLE "meetings"
  ADD COLUMN "participantEmail" TEXT,
  ADD COLUMN "participantResponseStatus" "MeetingParticipantResponseStatus",
  ADD COLUMN "participantResponseUpdatedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "meetings_participant_email_check" CHECK (
    "participantEmail" IS NULL
    OR (
      char_length("participantEmail") BETWEEN 3 AND 320
      AND "participantEmail" = lower(btrim("participantEmail"))
      AND "participantEmail" !~ '[[:space:][:cntrl:]]'
    )
  ),
  ADD CONSTRAINT "meetings_participant_response_check" CHECK (
    ("participantEmail" IS NULL AND "participantResponseStatus" IS NULL AND "participantResponseUpdatedAt" IS NULL)
    OR ("participantEmail" IS NOT NULL AND "participantResponseStatus" IS NOT NULL)
  );

CREATE INDEX "meetings_workspaceId_participantEmail_startsAt_idx"
  ON "meetings"("workspaceId", "participantEmail", "startsAt");

COMMIT;
