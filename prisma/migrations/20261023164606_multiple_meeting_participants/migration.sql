BEGIN;

CREATE TABLE "meeting_participants" (
  "workspaceId" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "responseStatus" "MeetingParticipantResponseStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
  "responseUpdatedAt" TIMESTAMPTZ(3),
  CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("workspaceId", "meetingId", "email"),
  CONSTRAINT "meeting_participants_meeting_fk" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "meeting_participants_email_check" CHECK (
    char_length("email") BETWEEN 3 AND 320 AND "email" = lower(btrim("email"))
    AND "email" !~ '[[:space:][:cntrl:]]'
  ),
  CONSTRAINT "meeting_participants_position_check" CHECK ("position" BETWEEN 0 AND 19)
);

INSERT INTO "meeting_participants" ("workspaceId", "meetingId", "email", "position", "responseStatus", "responseUpdatedAt")
SELECT "workspaceId", "id", "participantEmail", 0, "participantResponseStatus", "participantResponseUpdatedAt"
FROM "meetings" WHERE "participantEmail" IS NOT NULL;

-- Private CRM sessions and server-side authorization; never expose guest addresses to the Data API.
ALTER TABLE "meeting_participants" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF current_schema() = 'crm' THEN
    REVOKE ALL ON "meeting_participants" FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "meeting_participants" TO crm_politizai_runtime;
    CREATE POLICY "meeting_participants_runtime" ON "meeting_participants" TO crm_politizai_runtime USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
