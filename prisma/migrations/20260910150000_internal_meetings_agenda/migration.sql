-- CRM-15: agenda interna, ciclo de vida de reuniões e histórico append-only.

ALTER TYPE "StageTransitionOrigin" ADD VALUE IF NOT EXISTS 'MEETING';
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';

-- PostgreSQL exige que novos valores de enum sejam confirmados antes de serem
-- usados nas constraints criadas abaixo.
BEGIN;

CREATE TYPE "MeetingHistoryAction" AS ENUM (
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
  'CANCELLED',
  'ATTENDED',
  'NO_SHOW'
);

ALTER TABLE "meetings"
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "observation" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "completedAt" TIMESTAMPTZ(3),
  ADD COLUMN "noShowAt" TIMESTAMPTZ(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "meetings" meeting
SET
  "durationMinutes" = extract(epoch FROM (meeting."endsAt" - meeting."startsAt"))::integer / 60,
  "timeZone" = workspace."timeZone"
FROM "workspaces" workspace
WHERE workspace."id" = meeting."workspaceId";

ALTER TABLE "meetings"
  ALTER COLUMN "durationMinutes" SET NOT NULL,
  ALTER COLUMN "timeZone" SET NOT NULL,
  ADD CONSTRAINT "meetings_duration_minutes_check"
    CHECK ("durationMinutes" IN (30, 40)),
  ADD CONSTRAINT "meetings_duration_interval_check"
    CHECK ("endsAt" = "startsAt" + make_interval(mins => "durationMinutes")),
  ADD CONSTRAINT "meetings_timezone_check"
    CHECK (length(trim("timeZone")) > 0),
  ADD CONSTRAINT "meetings_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "meetings_status_timestamps_check"
    CHECK (
      ("status" = 'SCHEDULED' AND "cancelledAt" IS NULL AND "completedAt" IS NULL AND "noShowAt" IS NULL)
      OR ("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "completedAt" IS NULL AND "noShowAt" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "completedAt" IS NULL AND "noShowAt" IS NULL)
      OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "noShowAt" IS NULL)
      OR ("status" = 'NO_SHOW' AND "noShowAt" IS NOT NULL AND "cancelledAt" IS NULL AND "completedAt" IS NULL)
    );

CREATE TABLE "meeting_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL,
  "meetingRevision" INTEGER NOT NULL,
  "action" "MeetingHistoryAction" NOT NULL,
  "previousStatus" "MeetingStatus",
  "newStatus" "MeetingStatus" NOT NULL,
  "previousStartsAt" TIMESTAMPTZ(3),
  "previousEndsAt" TIMESTAMPTZ(3),
  "newStartsAt" TIMESTAMPTZ(3) NOT NULL,
  "newEndsAt" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT,
  "outcome" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meeting_history_revision_check" CHECK ("meetingRevision" > 0),
  CONSTRAINT "meeting_history_interval_check" CHECK ("newEndsAt" > "newStartsAt"),
  CONSTRAINT "meeting_history_reason_check" CHECK ("reason" IS NULL OR length(trim("reason")) >= 3)
);

CREATE UNIQUE INDEX "meeting_history_workspaceId_id_key" ON "meeting_history"("workspaceId", "id");
CREATE UNIQUE INDEX "meeting_history_workspaceId_meetingId_meetingRevision_key" ON "meeting_history"("workspaceId", "meetingId", "meetingRevision");
CREATE INDEX "meeting_history_workspaceId_meetingId_meetingRevision_idx" ON "meeting_history"("workspaceId", "meetingId", "meetingRevision");
CREATE INDEX "meeting_history_workspaceId_leadId_occurredAt_idx" ON "meeting_history"("workspaceId", "leadId", "occurredAt");
CREATE INDEX "meeting_history_workspaceId_ownerMemberId_occurredAt_idx" ON "meeting_history"("workspaceId", "ownerMemberId", "occurredAt");
CREATE INDEX "meetings_workspaceId_ownerMemberId_startsAt_endsAt_status_idx" ON "meetings"("workspaceId", "ownerMemberId", "startsAt", "endsAt", "status");

ALTER TABLE "meeting_history"
  ADD CONSTRAINT "meeting_history_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "meeting_history_workspaceId_meetingId_fkey"
    FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "meeting_history_workspaceId_leadId_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "meeting_history_workspaceId_ownerMemberId_fkey"
    FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "meeting_history_workspaceId_recordedByActorId_fkey"
    FOREIGN KEY ("workspaceId", "recordedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_meeting_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'meeting history is append-only'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meeting_history_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "meeting_history"
  FOR EACH ROW EXECUTE FUNCTION prevent_meeting_history_mutation();
CREATE TRIGGER "meeting_history_no_truncate_trigger"
  BEFORE TRUNCATE ON "meeting_history"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_meeting_history_mutation();

COMMIT;
