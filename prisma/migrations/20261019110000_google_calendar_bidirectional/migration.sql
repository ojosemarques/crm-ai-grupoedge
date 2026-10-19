-- Pull Google Calendar changes incrementally and expose external events in the CRM Agenda.
-- Provider cursors are encrypted by the application and remain server-only.
ALTER TABLE "google_calendar_accounts"
  ADD COLUMN "lastPullAt" TIMESTAMPTZ(3),
  ADD COLUMN "nextPullAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "pullSyncTokenCiphertext" TEXT,
  ADD COLUMN "pullPageTokenCiphertext" TEXT,
  ADD COLUMN "pullStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "pullLockedAt" TIMESTAMPTZ(3),
  ADD COLUMN "pullLockedBy" TEXT,
  ADD COLUMN "pullLockExpiresAt" TIMESTAMPTZ(3);

CREATE INDEX "google_calendar_accounts_status_nextPullAt_pullLockExpiresAt_idx"
  ON "google_calendar_accounts"("status", "nextPullAt", "pullLockExpiresAt");

ALTER TABLE "google_calendar_event_links"
  ADD COLUMN "lastPulledAt" TIMESTAMPTZ(3);

CREATE TABLE "google_calendar_imported_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "externalEtag" TEXT,
  "title" TEXT NOT NULL,
  "location" TEXT,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "timeZone" TEXT NOT NULL,
  "externalStatus" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "externalHtmlLink" TEXT,
  "conferenceUrl" TEXT,
  "creatorName" TEXT,
  "creatorEmail" TEXT,
  "sourceUpdatedAt" TIMESTAMPTZ(3),
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "google_calendar_imported_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "google_calendar_imported_events_workspaceId_id_key" UNIQUE ("workspaceId", "id"),
  CONSTRAINT "google_calendar_imported_events_workspaceId_accountId_externalEventId_key" UNIQUE ("workspaceId", "accountId", "externalEventId"),
  CONSTRAINT "google_calendar_imported_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_imported_events_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "google_calendar_accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_imported_events_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "google_calendar_imported_events_workspaceId_memberId_startsAt_endsAt_idx"
  ON "google_calendar_imported_events"("workspaceId", "memberId", "startsAt", "endsAt");

CREATE INDEX "google_calendar_imported_events_workspaceId_accountId_deletedAt_updatedAt_idx"
  ON "google_calendar_imported_events"("workspaceId", "accountId", "deletedAt", "updatedAt");

REVOKE ALL ON TABLE "google_calendar_imported_events" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "google_calendar_imported_events" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "google_calendar_imported_events" FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "google_calendar_imported_events" TO crm_politizai_runtime;
  END IF;
END $$;
