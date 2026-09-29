-- CreateEnum
CREATE TYPE "TelephonyOperatingMode" AS ENUM ('LOCAL_SIMULATOR', 'EXTERNAL_DISABLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "TelephonyCallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TelephonyCallStatus" AS ENUM ('QUEUED', 'INITIATED', 'RINGING', 'ANSWERED', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'CANCELLED', 'FAILED', 'VOICEMAIL', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "TelephonyDisposition" AS ENUM ('CONNECTED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'VOICEMAIL', 'CALLBACK_REQUESTED', 'MEETING_SCHEDULED', 'NO_INTEREST', 'OTHER');

-- CreateEnum
CREATE TYPE "TelephonyLegRole" AS ENUM ('CALLER', 'CALLEE', 'AGENT', 'CUSTOMER', 'TRANSFER_SOURCE', 'TRANSFER_TARGET');

-- CreateEnum
CREATE TYPE "TelephonyEventSource" AS ENUM ('INTERNAL', 'LOCAL_SIMULATOR', 'PROVIDER', 'REPLAY');

-- CreateEnum
CREATE TYPE "TelephonyAttemptStatus" AS ENUM ('RUNNING', 'ACCEPTED_LOCAL', 'SUCCEEDED', 'RETRY_PENDING', 'FAILED_PERMANENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TelephonyEventReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TelephonySuppressionAction" AS ENUM ('APPLIED', 'RELEASED');

-- CreateEnum
CREATE TYPE "TelephonyBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "TelephonyBackfillStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'TELEPHONY_CALL';

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "phoneCallId" UUID;

-- CreateTable
CREATE TABLE "telephony_connection_profiles" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "operatingMode" "TelephonyOperatingMode" NOT NULL DEFAULT 'EXTERNAL_DISABLED',
    "adapterVersion" TEXT NOT NULL DEFAULT 'telephony-channel/1.0',
    "originatorLabel" TEXT NOT NULL DEFAULT 'Politizai CRM local',
    "originatorPhoneE164" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "contactWindowStartMinute" INTEGER NOT NULL DEFAULT 540,
    "contactWindowEndMinute" INTEGER NOT NULL DEFAULT 1080,
    "contactWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transcriptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "capabilitySnapshotVersion" TEXT NOT NULL DEFAULT 'telephony-channel/1.0',
    "configuredAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "pausedReason" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "telephony_connection_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_calls" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "contactId" UUID,
    "contactPointId" UUID,
    "accountId" UUID,
    "leadId" UUID,
    "opportunityId" UUID,
    "meetingId" UUID,
    "campaignId" UUID,
    "ownerMemberId" UUID,
    "teamId" UUID,
    "queueId" UUID,
    "parentCallId" UUID,
    "direction" "TelephonyCallDirection" NOT NULL,
    "status" "TelephonyCallStatus" NOT NULL DEFAULT 'QUEUED',
    "disposition" "TelephonyDisposition",
    "dispositionNote" TEXT,
    "callerPhoneE164" TEXT,
    "calleePhoneE164" TEXT,
    "remotePhoneHash" TEXT NOT NULL,
    "remotePhoneMasked" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT 'TELEPHONY_LOCAL_SIMULATOR',
    "externalCallId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "privacyDecisionId" UUID,
    "purposeVersionId" UUID,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "simulationLabel" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "blockedReason" TEXT,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "statusSequence" INTEGER NOT NULL DEFAULT 1,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL,
    "initiatedAt" TIMESTAMPTZ(3),
    "ringingAt" TIMESTAMPTZ(3),
    "answeredAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "durationSeconds" INTEGER,
    "talkDurationSeconds" INTEGER,
    "recordingReference" TEXT,
    "transcriptionReference" TEXT,
    "dispositionedAt" TIMESTAMPTZ(3),
    "dispositionedByActorId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "phone_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_call_legs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "parentLegId" UUID,
    "role" "TelephonyLegRole" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "TelephonyCallStatus" NOT NULL,
    "phoneE164" TEXT,
    "phoneMasked" TEXT NOT NULL,
    "externalLegId" TEXT,
    "initiatedAt" TIMESTAMPTZ(3),
    "ringingAt" TIMESTAMPTZ(3),
    "answeredAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "durationSeconds" INTEGER,
    "talkDurationSeconds" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_call_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_call_attempts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "outboxId" UUID,
    "jobId" UUID,
    "attemptNumber" INTEGER NOT NULL,
    "status" "TelephonyAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "scenario" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorClassification" "IntegrationErrorClass",
    "requestId" TEXT,
    "nextRetryAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_call_status_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "legId" UUID,
    "status" "TelephonyCallStatus" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "source" "TelephonyEventSource" NOT NULL,
    "providerReported" BOOLEAN NOT NULL DEFAULT false,
    "providerKey" TEXT,
    "externalEventId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reasonCode" TEXT,
    "safeMetadata" JSONB,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_call_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_event_reviews" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "callId" UUID,
    "webhookInboxId" UUID,
    "status" "TelephonyEventReviewStatus" NOT NULL DEFAULT 'OPEN',
    "eventKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "evidence" JSONB,
    "createdByActorId" UUID NOT NULL,
    "resolvedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "telephony_event_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_suppressions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactPointId" UUID,
    "normalizedPhone" TEXT,
    "phoneHash" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "purposeKey" TEXT NOT NULL,
    "action" "TelephonySuppressionAction" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalEventId" TEXT,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telephony_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_backfill_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runKey" TEXT NOT NULL,
    "mode" "TelephonyBackfillMode" NOT NULL,
    "status" "TelephonyBackfillStatus" NOT NULL DEFAULT 'RUNNING',
    "totalEligible" INTEGER NOT NULL DEFAULT 0,
    "migratedCount" INTEGER NOT NULL DEFAULT 0,
    "existingCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL,
    "requestedByActorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telephony_backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_backfill_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "callId" UUID,
    "outcome" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telephony_backfill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telephony_connection_profiles_workspaceId_operatingMode_upd_idx" ON "telephony_connection_profiles"("workspaceId", "operatingMode", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_connection_profiles_workspaceId_id_key" ON "telephony_connection_profiles"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_connection_profiles_workspaceId_connectionId_key" ON "telephony_connection_profiles"("workspaceId", "connectionId");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_ownerMemberId_status_queuedAt_idx" ON "phone_calls"("workspaceId", "ownerMemberId", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_teamId_status_queuedAt_idx" ON "phone_calls"("workspaceId", "teamId", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_queueId_status_queuedAt_idx" ON "phone_calls"("workspaceId", "queueId", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_leadId_queuedAt_idx" ON "phone_calls"("workspaceId", "leadId", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_accountId_queuedAt_idx" ON "phone_calls"("workspaceId", "accountId", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_opportunityId_queuedAt_idx" ON "phone_calls"("workspaceId", "opportunityId", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_campaignId_queuedAt_idx" ON "phone_calls"("workspaceId", "campaignId", "queuedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_disposition_completedAt_idx" ON "phone_calls"("workspaceId", "disposition", "completedAt");

-- CreateIndex
CREATE INDEX "phone_calls_workspaceId_reviewRequired_updatedAt_idx" ON "phone_calls"("workspaceId", "reviewRequired", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "phone_calls_workspaceId_id_key" ON "phone_calls"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_calls_workspaceId_messageId_key" ON "phone_calls"("workspaceId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "phone_calls_workspaceId_idempotencyKey_key" ON "phone_calls"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "phone_calls_workspaceId_providerKey_externalCallId_key" ON "phone_calls"("workspaceId", "providerKey", "externalCallId");

-- CreateIndex
CREATE INDEX "phone_call_legs_workspaceId_callId_status_idx" ON "phone_call_legs"("workspaceId", "callId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_legs_workspaceId_id_key" ON "phone_call_legs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_legs_workspaceId_callId_sequence_key" ON "phone_call_legs"("workspaceId", "callId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_legs_workspaceId_callId_externalLegId_key" ON "phone_call_legs"("workspaceId", "callId", "externalLegId");

-- CreateIndex
CREATE INDEX "phone_call_attempts_workspaceId_status_nextRetryAt_idx" ON "phone_call_attempts"("workspaceId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "phone_call_attempts_workspaceId_jobId_idx" ON "phone_call_attempts"("workspaceId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_attempts_workspaceId_id_key" ON "phone_call_attempts"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_attempts_workspaceId_callId_attemptNumber_key" ON "phone_call_attempts"("workspaceId", "callId", "attemptNumber");

-- CreateIndex
CREATE INDEX "phone_call_status_events_workspaceId_callId_occurredAt_inge_idx" ON "phone_call_status_events"("workspaceId", "callId", "occurredAt", "ingestedAt");

-- CreateIndex
CREATE INDEX "phone_call_status_events_workspaceId_status_occurredAt_idx" ON "phone_call_status_events"("workspaceId", "status", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_status_events_workspaceId_id_key" ON "phone_call_status_events"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_status_events_workspaceId_callId_sequence_key" ON "phone_call_status_events"("workspaceId", "callId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "phone_call_status_events_workspaceId_providerKey_externalEv_key" ON "phone_call_status_events"("workspaceId", "providerKey", "externalEventId");

-- CreateIndex
CREATE INDEX "telephony_event_reviews_workspaceId_status_createdAt_idx" ON "telephony_event_reviews"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "telephony_event_reviews_workspaceId_callId_createdAt_idx" ON "telephony_event_reviews"("workspaceId", "callId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_event_reviews_workspaceId_id_key" ON "telephony_event_reviews"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_event_reviews_workspaceId_profileId_eventKey_reas_key" ON "telephony_event_reviews"("workspaceId", "profileId", "eventKey", "reasonCode");

-- CreateIndex
CREATE INDEX "telephony_suppressions_workspaceId_phoneHash_purposeKey_eff_idx" ON "telephony_suppressions"("workspaceId", "phoneHash", "purposeKey", "effectiveAt");

-- CreateIndex
CREATE INDEX "telephony_suppressions_workspaceId_action_reasonCode_effect_idx" ON "telephony_suppressions"("workspaceId", "action", "reasonCode", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_suppressions_workspaceId_id_key" ON "telephony_suppressions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_suppressions_workspaceId_purposeKey_phoneHash_ext_key" ON "telephony_suppressions"("workspaceId", "purposeKey", "phoneHash", "externalEventId");

-- CreateIndex
CREATE INDEX "telephony_backfill_runs_workspaceId_status_createdAt_idx" ON "telephony_backfill_runs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_backfill_runs_workspaceId_id_key" ON "telephony_backfill_runs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_backfill_runs_workspaceId_runKey_key" ON "telephony_backfill_runs"("workspaceId", "runKey");

-- CreateIndex
CREATE INDEX "telephony_backfill_items_workspaceId_runId_outcome_idx" ON "telephony_backfill_items"("workspaceId", "runId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_backfill_items_workspaceId_id_key" ON "telephony_backfill_items"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_backfill_items_workspaceId_idempotencyKey_key" ON "telephony_backfill_items"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "activities_workspaceId_phoneCallId_key" ON "activities"("workspaceId", "phoneCallId");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_phoneCallId_fkey" FOREIGN KEY ("workspaceId", "phoneCallId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_connection_profiles" ADD CONSTRAINT "telephony_connection_profiles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_connection_profiles" ADD CONSTRAINT "telephony_connection_profiles_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_connection_profiles" ADD CONSTRAINT "telephony_connection_profiles_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_connection_profiles" ADD CONSTRAINT "telephony_connection_profiles_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "telephony_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "acquisition_campaigns"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_teamId_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_parentCallId_fkey" FOREIGN KEY ("workspaceId", "parentCallId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_privacyDecisionId_fkey" FOREIGN KEY ("workspaceId", "privacyDecisionId") REFERENCES "privacy_decisions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_purposeVersionId_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_workspaceId_dispositionedByActorId_fkey" FOREIGN KEY ("workspaceId", "dispositionedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_legs" ADD CONSTRAINT "phone_call_legs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_legs" ADD CONSTRAINT "phone_call_legs_workspaceId_callId_fkey" FOREIGN KEY ("workspaceId", "callId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_legs" ADD CONSTRAINT "phone_call_legs_workspaceId_parentLegId_fkey" FOREIGN KEY ("workspaceId", "parentLegId") REFERENCES "phone_call_legs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_attempts" ADD CONSTRAINT "phone_call_attempts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_attempts" ADD CONSTRAINT "phone_call_attempts_workspaceId_callId_fkey" FOREIGN KEY ("workspaceId", "callId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_attempts" ADD CONSTRAINT "phone_call_attempts_workspaceId_outboxId_fkey" FOREIGN KEY ("workspaceId", "outboxId") REFERENCES "outbox_events"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_attempts" ADD CONSTRAINT "phone_call_attempts_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "jobs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_status_events" ADD CONSTRAINT "phone_call_status_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_status_events" ADD CONSTRAINT "phone_call_status_events_workspaceId_callId_fkey" FOREIGN KEY ("workspaceId", "callId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_status_events" ADD CONSTRAINT "phone_call_status_events_workspaceId_legId_fkey" FOREIGN KEY ("workspaceId", "legId") REFERENCES "phone_call_legs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_call_status_events" ADD CONSTRAINT "phone_call_status_events_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_event_reviews" ADD CONSTRAINT "telephony_event_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_event_reviews" ADD CONSTRAINT "telephony_event_reviews_workspaceId_profileId_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "telephony_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_event_reviews" ADD CONSTRAINT "telephony_event_reviews_workspaceId_callId_fkey" FOREIGN KEY ("workspaceId", "callId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_event_reviews" ADD CONSTRAINT "telephony_event_reviews_workspaceId_webhookInboxId_fkey" FOREIGN KEY ("workspaceId", "webhookInboxId") REFERENCES "webhook_inbox"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_event_reviews" ADD CONSTRAINT "telephony_event_reviews_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_event_reviews" ADD CONSTRAINT "telephony_event_reviews_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_suppressions" ADD CONSTRAINT "telephony_suppressions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_suppressions" ADD CONSTRAINT "telephony_suppressions_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_suppressions" ADD CONSTRAINT "telephony_suppressions_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_runs" ADD CONSTRAINT "telephony_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_runs" ADD CONSTRAINT "telephony_backfill_runs_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_items" ADD CONSTRAINT "telephony_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_items" ADD CONSTRAINT "telephony_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "telephony_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_items" ADD CONSTRAINT "telephony_backfill_items_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_items" ADD CONSTRAINT "telephony_backfill_items_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_backfill_items" ADD CONSTRAINT "telephony_backfill_items_workspaceId_callId_fkey" FOREIGN KEY ("workspaceId", "callId") REFERENCES "phone_calls"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Local telephony safety and factual-integrity constraints.
ALTER TABLE "telephony_connection_profiles"
  ADD CONSTRAINT "telephony_profiles_contact_window_check"
    CHECK (
      "contactWindowStartMinute" BETWEEN 0 AND 1439
      AND "contactWindowEndMinute" BETWEEN 1 AND 1440
      AND "contactWindowStartMinute" < "contactWindowEndMinute"
      AND cardinality("contactWeekdays") > 0
      AND "contactWeekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[]
    ),
  ADD CONSTRAINT "telephony_profiles_local_capture_disabled_check"
    CHECK (
      "operatingMode" <> 'LOCAL_SIMULATOR'
      OR (NOT "recordingEnabled" AND NOT "transcriptionEnabled")
    );

ALTER TABLE "phone_calls"
  ADD CONSTRAINT "phone_calls_explicit_owner_or_queue_check"
    CHECK (("ownerMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL)),
  ADD CONSTRAINT "phone_calls_local_simulation_check"
    CHECK (
      NOT "isSimulated"
      OR (
        "providerKey" = 'TELEPHONY_LOCAL_SIMULATOR'
        AND "recordingReference" IS NULL
        AND "transcriptionReference" IS NULL
      )
    ),
  ADD CONSTRAINT "phone_calls_caller_e164_check"
    CHECK ("callerPhoneE164" IS NULL OR "callerPhoneE164" ~ '^\\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "phone_calls_callee_e164_check"
    CHECK ("calleePhoneE164" IS NULL OR "calleePhoneE164" ~ '^\\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "phone_calls_durations_check"
    CHECK (
      ("durationSeconds" IS NULL OR "durationSeconds" >= 0)
      AND ("talkDurationSeconds" IS NULL OR "talkDurationSeconds" >= 0)
      AND (
        "durationSeconds" IS NULL
        OR "talkDurationSeconds" IS NULL
        OR "talkDurationSeconds" <= "durationSeconds"
      )
    ),
  ADD CONSTRAINT "phone_calls_disposition_facts_check"
    CHECK (
      ("disposition" IS NULL AND "dispositionedAt" IS NULL AND "dispositionedByActorId" IS NULL)
      OR ("disposition" IS NOT NULL AND "dispositionedAt" IS NOT NULL AND "dispositionedByActorId" IS NOT NULL)
    ),
  ADD CONSTRAINT "phone_calls_other_disposition_note_check"
    CHECK ("disposition" <> 'OTHER' OR length(btrim(coalesce("dispositionNote", ''))) > 0),
  ADD CONSTRAINT "phone_calls_factual_time_order_check"
    CHECK (
      ("initiatedAt" IS NULL OR "initiatedAt" >= "queuedAt")
      AND ("ringingAt" IS NULL OR "ringingAt" >= coalesce("initiatedAt", "queuedAt"))
      AND ("answeredAt" IS NULL OR "answeredAt" >= coalesce("ringingAt", "initiatedAt", "queuedAt"))
      AND ("completedAt" IS NULL OR "completedAt" >= coalesce("answeredAt", "ringingAt", "initiatedAt", "queuedAt"))
      AND ("cancelledAt" IS NULL OR "cancelledAt" >= "queuedAt")
    );

ALTER TABLE "phone_call_legs"
  ADD CONSTRAINT "phone_call_legs_sequence_check" CHECK ("sequence" > 0),
  ADD CONSTRAINT "phone_call_legs_durations_check"
    CHECK (
      ("durationSeconds" IS NULL OR "durationSeconds" >= 0)
      AND ("talkDurationSeconds" IS NULL OR "talkDurationSeconds" >= 0)
      AND ("durationSeconds" IS NULL OR "talkDurationSeconds" IS NULL OR "talkDurationSeconds" <= "durationSeconds")
    ),
  ADD CONSTRAINT "phone_call_legs_phone_e164_check"
    CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\\+[1-9][0-9]{7,14}$');

ALTER TABLE "phone_call_attempts"
  ADD CONSTRAINT "phone_call_attempts_number_check" CHECK ("attemptNumber" > 0);

ALTER TABLE "phone_call_status_events"
  ADD CONSTRAINT "phone_call_status_events_sequence_check" CHECK ("sequence" > 0);

ALTER TABLE "telephony_suppressions"
  ADD CONSTRAINT "telephony_suppressions_phone_e164_check"
    CHECK ("normalizedPhone" IS NULL OR "normalizedPhone" ~ '^\\+[1-9][0-9]{7,14}$');

CREATE OR REPLACE FUNCTION protect_telephony_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'telephony fact tables are append-only';
END;
$$;

CREATE TRIGGER "phone_call_status_events_append_only"
BEFORE UPDATE OR DELETE ON "phone_call_status_events"
FOR EACH ROW EXECUTE FUNCTION protect_telephony_append_only();

CREATE TRIGGER "telephony_suppressions_append_only"
BEFORE UPDATE OR DELETE ON "telephony_suppressions"
FOR EACH ROW EXECUTE FUNCTION protect_telephony_append_only();

CREATE TRIGGER "telephony_backfill_items_append_only"
BEFORE UPDATE OR DELETE ON "telephony_backfill_items"
FOR EACH ROW EXECUTE FUNCTION protect_telephony_append_only();
