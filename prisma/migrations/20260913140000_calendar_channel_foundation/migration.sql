-- CRM-47 — calendário bidirecional em sandbox estritamente local.

CREATE TYPE "CalendarOperatingMode" AS ENUM ('LOCAL_SANDBOX', 'EXTERNAL_DISABLED', 'PAUSED');
CREATE TYPE "CalendarSyncState" AS ENUM ('PENDING_PUSH', 'PENDING_PULL', 'SYNCED', 'CONFLICT', 'FAILED', 'CANCELLED');
CREATE TYPE "CalendarEventDirection" AS ENUM ('PUSH', 'PULL');
CREATE TYPE "CalendarEventOperation" AS ENUM ('CREATE', 'UPDATE', 'RESCHEDULE', 'CANCEL');
CREATE TYPE "CalendarEventOrigin" AS ENUM ('CRM', 'LOCAL_SANDBOX', 'REPLAY');
CREATE TYPE "CalendarEventStatus" AS ENUM ('ACCEPTED', 'APPLIED', 'DUPLICATE', 'IGNORED', 'CONFLICT', 'RETRY_PENDING', 'FAILED_PERMANENT');
CREATE TYPE "CalendarConflictType" AS ENUM ('CONCURRENT_MEETING_CHANGE', 'TIME_CONFLICT', 'UNKNOWN_EXTERNAL_EVENT', 'INVALID_IDENTITY', 'INVALID_TRANSITION', 'STALE_EXTERNAL_VERSION');
CREATE TYPE "CalendarConflictStatus" AS ENUM ('OPEN', 'RESOLVED_KEEP_CRM', 'RESOLVED_APPLY_EXTERNAL', 'DISMISSED');
CREATE TYPE "CalendarBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');
CREATE TYPE "CalendarBackfillStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TYPE "JobType" ADD VALUE 'CALENDAR_SYNC';

CREATE TABLE "calendar_connection_profiles" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "operatingMode" "CalendarOperatingMode" NOT NULL DEFAULT 'EXTERNAL_DISABLED',
  "providerKey" TEXT NOT NULL DEFAULT 'CALENDAR_LOCAL_SANDBOX',
  "adapterVersion" TEXT NOT NULL DEFAULT 'calendar-channel/1.0',
  "externalCalendarId" TEXT NOT NULL DEFAULT 'politizai-local-primary',
  "displayName" TEXT NOT NULL DEFAULT 'Agenda Politizai · sandbox local',
  "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "syncPastDays" INTEGER NOT NULL DEFAULT 30,
  "syncFutureDays" INTEGER NOT NULL DEFAULT 180,
  "maxItemsPerRun" INTEGER NOT NULL DEFAULT 200,
  "configuredAt" TIMESTAMPTZ(3),
  "lastSyncAt" TIMESTAMPTZ(3),
  "lastSuccessAt" TIMESTAMPTZ(3),
  "lastErrorAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "pausedReason" TEXT,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calendar_connection_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_profiles_window_check" CHECK (
    "syncPastDays" BETWEEN 0 AND 365
    AND "syncFutureDays" BETWEEN 1 AND 730
    AND "maxItemsPerRun" BETWEEN 1 AND 500
  ),
  CONSTRAINT "calendar_profiles_local_identity_check" CHECK (
    "operatingMode" <> 'LOCAL_SANDBOX'
    OR ("providerKey" = 'CALENDAR_LOCAL_SANDBOX' AND "timeZone" = 'America/Sao_Paulo')
  )
);

CREATE TABLE "calendar_event_links" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "providerKey" TEXT NOT NULL,
  "externalCalendarId" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "syncState" "CalendarSyncState" NOT NULL DEFAULT 'PENDING_PUSH',
  "externalVersion" INTEGER NOT NULL DEFAULT 0,
  "externalEtag" TEXT,
  "externalHash" TEXT,
  "lastMeetingRevision" INTEGER NOT NULL,
  "lastPushedMeetingRevision" INTEGER,
  "lastPulledExternalVersion" INTEGER,
  "lastPushedAt" TIMESTAMPTZ(3),
  "lastPulledAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_event_links_version_check" CHECK (
    "externalVersion" >= 0
    AND "lastMeetingRevision" > 0
    AND ("lastPushedMeetingRevision" IS NULL OR "lastPushedMeetingRevision" > 0)
    AND ("lastPulledExternalVersion" IS NULL OR "lastPulledExternalVersion" >= 0)
  )
);

CREATE TABLE "calendar_sync_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "linkId" UUID,
  "meetingId" UUID,
  "webhookInboxId" UUID,
  "outboxId" UUID,
  "syncRunId" UUID,
  "eventKey" TEXT NOT NULL,
  "direction" "CalendarEventDirection" NOT NULL,
  "operation" "CalendarEventOperation" NOT NULL,
  "origin" "CalendarEventOrigin" NOT NULL,
  "status" "CalendarEventStatus" NOT NULL DEFAULT 'ACCEPTED',
  "correlationId" TEXT NOT NULL,
  "causationId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "baseMeetingRevision" INTEGER,
  "appliedMeetingRevision" INTEGER,
  "externalVersion" INTEGER,
  "externalEtag" TEXT,
  "payloadHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3),
  "errorCode" TEXT,
  "safeMetadata" JSONB,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_sync_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_sync_events_direction_transport_check" CHECK (
    ("direction" = 'PUSH' AND "outboxId" IS NOT NULL AND "webhookInboxId" IS NULL)
    OR ("direction" = 'PULL' AND "webhookInboxId" IS NOT NULL AND "outboxId" IS NULL)
  ),
  CONSTRAINT "calendar_sync_events_revision_check" CHECK (
    ("baseMeetingRevision" IS NULL OR "baseMeetingRevision" > 0)
    AND ("appliedMeetingRevision" IS NULL OR "appliedMeetingRevision" > 0)
    AND ("externalVersion" IS NULL OR "externalVersion" >= 0)
  )
);

CREATE TABLE "calendar_sync_conflicts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "linkId" UUID,
  "meetingId" UUID,
  "webhookInboxId" UUID,
  "eventKey" TEXT NOT NULL,
  "type" "CalendarConflictType" NOT NULL,
  "status" "CalendarConflictStatus" NOT NULL DEFAULT 'OPEN',
  "baseMeetingRevision" INTEGER,
  "currentMeetingRevision" INTEGER,
  "externalVersion" INTEGER,
  "crmSnapshot" JSONB NOT NULL,
  "externalSnapshot" JSONB NOT NULL,
  "evidence" JSONB,
  "resolutionReason" TEXT,
  "createdByActorId" UUID NOT NULL,
  "resolvedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "calendar_sync_conflicts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_sync_conflicts_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolvedByActorId" IS NULL AND "resolvedAt" IS NULL AND "resolutionReason" IS NULL)
    OR (
      "status" <> 'OPEN'
      AND "resolvedByActorId" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
      AND length(btrim(coalesce("resolutionReason", ''))) >= 8
    )
  ),
  CONSTRAINT "calendar_sync_conflicts_version_check" CHECK (
    ("baseMeetingRevision" IS NULL OR "baseMeetingRevision" > 0)
    AND ("currentMeetingRevision" IS NULL OR "currentMeetingRevision" > 0)
    AND ("externalVersion" IS NULL OR "externalVersion" >= 0)
  )
);

CREATE TABLE "calendar_backfill_runs" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" "CalendarBackfillMode" NOT NULL,
  "status" "CalendarBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "totalEligible" INTEGER NOT NULL DEFAULT 0,
  "linkedCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "existingCount" INTEGER NOT NULL DEFAULT 0,
  "fingerprint" TEXT NOT NULL,
  "requestedByActorId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_backfill_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_backfill_runs_counts_check" CHECK (
    "totalEligible" >= 0 AND "linkedCount" >= 0 AND "reviewCount" >= 0 AND "existingCount" >= 0
  ),
  CONSTRAINT "calendar_backfill_runs_finished_check" CHECK (
    ("status" = 'RUNNING' AND "finishedAt" IS NULL)
    OR ("status" <> 'RUNNING' AND "finishedAt" IS NOT NULL)
  )
);

CREATE TABLE "calendar_backfill_items" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "linkId" UUID,
  "outcome" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_backfill_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calendar_connection_profiles_workspaceId_operatingMode_upda_idx" ON "calendar_connection_profiles"("workspaceId", "operatingMode", "updatedAt");
CREATE UNIQUE INDEX "calendar_connection_profiles_workspaceId_id_key" ON "calendar_connection_profiles"("workspaceId", "id");
CREATE UNIQUE INDEX "calendar_connection_profiles_workspaceId_connectionId_key" ON "calendar_connection_profiles"("workspaceId", "connectionId");
CREATE UNIQUE INDEX "calendar_connection_profiles_workspaceId_providerKey_extern_key" ON "calendar_connection_profiles"("workspaceId", "providerKey", "externalCalendarId");

CREATE INDEX "calendar_event_links_workspaceId_syncState_updatedAt_idx" ON "calendar_event_links"("workspaceId", "syncState", "updatedAt");
CREATE INDEX "calendar_event_links_workspaceId_meetingId_syncState_idx" ON "calendar_event_links"("workspaceId", "meetingId", "syncState");
CREATE UNIQUE INDEX "calendar_event_links_workspaceId_id_key" ON "calendar_event_links"("workspaceId", "id");
CREATE UNIQUE INDEX "calendar_event_links_workspaceId_profileId_meetingId_key" ON "calendar_event_links"("workspaceId", "profileId", "meetingId");
CREATE UNIQUE INDEX "calendar_event_links_workspaceId_providerKey_externalCalend_key" ON "calendar_event_links"("workspaceId", "providerKey", "externalCalendarId", "externalEventId");

CREATE INDEX "calendar_sync_events_workspaceId_profileId_direction_status_idx" ON "calendar_sync_events"("workspaceId", "profileId", "direction", "status", "occurredAt");
CREATE INDEX "calendar_sync_events_workspaceId_meetingId_occurredAt_idx" ON "calendar_sync_events"("workspaceId", "meetingId", "occurredAt");
CREATE INDEX "calendar_sync_events_workspaceId_correlationId_createdAt_idx" ON "calendar_sync_events"("workspaceId", "correlationId", "createdAt");
CREATE INDEX "calendar_sync_events_workspaceId_webhookInboxId_idx" ON "calendar_sync_events"("workspaceId", "webhookInboxId");
CREATE INDEX "calendar_sync_events_workspaceId_outboxId_idx" ON "calendar_sync_events"("workspaceId", "outboxId");
CREATE UNIQUE INDEX "calendar_sync_events_workspaceId_id_key" ON "calendar_sync_events"("workspaceId", "id");
CREATE UNIQUE INDEX "calendar_sync_events_workspaceId_profileId_eventKey_key" ON "calendar_sync_events"("workspaceId", "profileId", "eventKey");
CREATE UNIQUE INDEX "calendar_sync_events_workspaceId_idempotencyKey_key" ON "calendar_sync_events"("workspaceId", "idempotencyKey");

CREATE INDEX "calendar_sync_conflicts_workspaceId_status_createdAt_idx" ON "calendar_sync_conflicts"("workspaceId", "status", "createdAt");
CREATE INDEX "calendar_sync_conflicts_workspaceId_meetingId_status_idx" ON "calendar_sync_conflicts"("workspaceId", "meetingId", "status");
CREATE INDEX "calendar_sync_conflicts_workspaceId_webhookInboxId_idx" ON "calendar_sync_conflicts"("workspaceId", "webhookInboxId");
CREATE UNIQUE INDEX "calendar_sync_conflicts_workspaceId_id_key" ON "calendar_sync_conflicts"("workspaceId", "id");
CREATE UNIQUE INDEX "calendar_sync_conflicts_workspaceId_profileId_eventKey_type_key" ON "calendar_sync_conflicts"("workspaceId", "profileId", "eventKey", "type");

CREATE INDEX "calendar_backfill_runs_workspaceId_status_createdAt_idx" ON "calendar_backfill_runs"("workspaceId", "status", "createdAt");
CREATE UNIQUE INDEX "calendar_backfill_runs_workspaceId_id_key" ON "calendar_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "calendar_backfill_runs_workspaceId_runKey_key" ON "calendar_backfill_runs"("workspaceId", "runKey");

CREATE INDEX "calendar_backfill_items_workspaceId_runId_outcome_idx" ON "calendar_backfill_items"("workspaceId", "runId", "outcome");
CREATE UNIQUE INDEX "calendar_backfill_items_workspaceId_id_key" ON "calendar_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "calendar_backfill_items_workspaceId_idempotencyKey_key" ON "calendar_backfill_items"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "calendar_backfill_items_workspaceId_runId_meetingId_key" ON "calendar_backfill_items"("workspaceId", "runId", "meetingId");

ALTER TABLE "calendar_connection_profiles" ADD CONSTRAINT "calendar_connection_profiles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_connection_profiles" ADD CONSTRAINT "calendar_connection_profiles_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_connection_profiles" ADD CONSTRAINT "calendar_connection_profiles_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_connection_profiles" ADD CONSTRAINT "calendar_connection_profiles_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "calendar_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "calendar_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_linkId_fkey" FOREIGN KEY ("workspaceId", "linkId") REFERENCES "calendar_event_links"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_webhookInboxId_fkey" FOREIGN KEY ("workspaceId", "webhookInboxId") REFERENCES "webhook_inbox"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_outboxId_fkey" FOREIGN KEY ("workspaceId", "outboxId") REFERENCES "outbox_events"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_syncRunId_fkey" FOREIGN KEY ("workspaceId", "syncRunId") REFERENCES "integration_sync_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_events" ADD CONSTRAINT "calendar_sync_events_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "calendar_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_linkId_fkey" FOREIGN KEY ("workspaceId", "linkId") REFERENCES "calendar_event_links"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_webhookInboxId_fkey" FOREIGN KEY ("workspaceId", "webhookInboxId") REFERENCES "webhook_inbox"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_backfill_runs" ADD CONSTRAINT "calendar_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_backfill_runs" ADD CONSTRAINT "calendar_backfill_runs_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "calendar_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_backfill_runs" ADD CONSTRAINT "calendar_backfill_runs_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calendar_backfill_items" ADD CONSTRAINT "calendar_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_backfill_items" ADD CONSTRAINT "calendar_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "calendar_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_backfill_items" ADD CONSTRAINT "calendar_backfill_items_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_backfill_items" ADD CONSTRAINT "calendar_backfill_items_workspaceId_linkId_fkey" FOREIGN KEY ("workspaceId", "linkId") REFERENCES "calendar_event_links"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Eventos guardam fatos de integração. Somente o resultado operacional pode evoluir;
-- identidade, causalidade e payload são imutáveis. DELETE é sempre rejeitado.
CREATE OR REPLACE FUNCTION protect_calendar_sync_event_fact()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
     OR NEW."profileId" IS DISTINCT FROM OLD."profileId"
     OR NEW."eventKey" IS DISTINCT FROM OLD."eventKey"
     OR NEW."direction" IS DISTINCT FROM OLD."direction"
     OR NEW."operation" IS DISTINCT FROM OLD."operation"
     OR NEW."origin" IS DISTINCT FROM OLD."origin"
     OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
     OR NEW."causationId" IS DISTINCT FROM OLD."causationId"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."baseMeetingRevision" IS DISTINCT FROM OLD."baseMeetingRevision"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
     OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'CRM-47 immutable calendar sync fact cannot be rewritten' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_sync_events_fact_protection"
BEFORE UPDATE OR DELETE ON "calendar_sync_events"
FOR EACH ROW EXECUTE FUNCTION protect_calendar_sync_event_fact();

CREATE OR REPLACE FUNCTION protect_calendar_conflict_fact()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
     OR NEW."profileId" IS DISTINCT FROM OLD."profileId"
     OR NEW."linkId" IS DISTINCT FROM OLD."linkId"
     OR NEW."meetingId" IS DISTINCT FROM OLD."meetingId"
     OR NEW."webhookInboxId" IS DISTINCT FROM OLD."webhookInboxId"
     OR NEW."eventKey" IS DISTINCT FROM OLD."eventKey"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."baseMeetingRevision" IS DISTINCT FROM OLD."baseMeetingRevision"
     OR NEW."currentMeetingRevision" IS DISTINCT FROM OLD."currentMeetingRevision"
     OR NEW."externalVersion" IS DISTINCT FROM OLD."externalVersion"
     OR NEW."crmSnapshot" IS DISTINCT FROM OLD."crmSnapshot"
     OR NEW."externalSnapshot" IS DISTINCT FROM OLD."externalSnapshot"
     OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
     OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'CRM-47 immutable calendar conflict fact cannot be rewritten' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_sync_conflicts_fact_protection"
BEFORE UPDATE OR DELETE ON "calendar_sync_conflicts"
FOR EACH ROW EXECUTE FUNCTION protect_calendar_conflict_fact();

CREATE TRIGGER "calendar_backfill_items_append_only"
BEFORE UPDATE OR DELETE ON "calendar_backfill_items"
FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();
