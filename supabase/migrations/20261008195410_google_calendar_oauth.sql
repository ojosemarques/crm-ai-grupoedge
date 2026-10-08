-- Google Calendar OAuth credentials are private server-side records.
-- Meetings remain authoritative in the CRM; jobs project revisions to Google.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'GOOGLE_CALENDAR_SYNC';

CREATE TYPE "GoogleCalendarConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED');

CREATE TABLE "google_calendar_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "googleSubject" TEXT NOT NULL,
  "googleEmail" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL DEFAULT 'primary',
  "accessTokenCiphertext" TEXT NOT NULL,
  "refreshTokenCiphertext" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "grantedScopes" TEXT[] NOT NULL,
  "status" "GoogleCalendarConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "lastSyncAt" TIMESTAMPTZ(3),
  "lastErrorAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "disconnectedAt" TIMESTAMPTZ(3),
  CONSTRAINT "google_calendar_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "google_calendar_accounts_workspaceId_id_key" UNIQUE ("workspaceId", "id"),
  CONSTRAINT "google_calendar_accounts_workspaceId_memberId_key" UNIQUE ("workspaceId", "memberId"),
  CONSTRAINT "google_calendar_accounts_workspaceId_googleSubject_key" UNIQUE ("workspaceId", "googleSubject"),
  CONSTRAINT "google_calendar_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_accounts_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_accounts_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_accounts_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "google_calendar_accounts_workspaceId_status_updatedAt_idx"
  ON "google_calendar_accounts"("workspaceId", "status", "updatedAt");

CREATE TABLE "google_calendar_oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "stateHash" TEXT NOT NULL,
  "codeVerifierCiphertext" TEXT NOT NULL,
  "returnPath" TEXT NOT NULL DEFAULT '/integracoes/calendario',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_calendar_oauth_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "google_calendar_oauth_states_stateHash_key" UNIQUE ("stateHash"),
  CONSTRAINT "google_calendar_oauth_states_workspaceId_id_key" UNIQUE ("workspaceId", "id"),
  CONSTRAINT "google_calendar_oauth_states_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_oauth_states_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "google_calendar_oauth_states_workspaceId_memberId_expiresAt_idx"
  ON "google_calendar_oauth_states"("workspaceId", "memberId", "expiresAt");

CREATE TABLE "google_calendar_event_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "externalHtmlLink" TEXT,
  "conferenceUrl" TEXT,
  "syncState" "CalendarSyncState" NOT NULL DEFAULT 'PENDING_PUSH',
  "syncedRevision" INTEGER,
  "externalEtag" TEXT,
  "lastPushedAt" TIMESTAMPTZ(3),
  "lastErrorAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "google_calendar_event_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "google_calendar_event_links_workspaceId_id_key" UNIQUE ("workspaceId", "id"),
  CONSTRAINT "google_calendar_event_links_workspaceId_meetingId_key" UNIQUE ("workspaceId", "meetingId"),
  CONSTRAINT "google_calendar_event_links_workspaceId_accountId_externalEventId_key" UNIQUE ("workspaceId", "accountId", "externalEventId"),
  CONSTRAINT "google_calendar_event_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_event_links_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_event_links_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "google_calendar_event_links_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "google_calendar_accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "google_calendar_event_links_workspaceId_memberId_syncState_updatedAt_idx"
  ON "google_calendar_event_links"("workspaceId", "memberId", "syncState", "updatedAt");

REVOKE ALL ON TABLE "google_calendar_accounts" FROM PUBLIC;
REVOKE ALL ON TABLE "google_calendar_oauth_states" FROM PUBLIC;
REVOKE ALL ON TABLE "google_calendar_event_links" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "google_calendar_accounts", "google_calendar_oauth_states", "google_calendar_event_links" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "google_calendar_accounts", "google_calendar_oauth_states", "google_calendar_event_links" FROM authenticated';
  END IF;
END $$;
