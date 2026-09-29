-- CreateEnum
CREATE TYPE "ConversationParticipantRole" AS ENUM ('CONTACT', 'INTERNAL_USER', 'TEAM', 'BOT_SYSTEM', 'UNKNOWN_EXTERNAL');

-- CreateEnum
CREATE TYPE "OmnichannelMessageType" AS ENUM ('TEXT', 'TEMPLATE', 'MEDIA_REFERENCE', 'EMAIL_HTML_REFERENCE', 'CALL_EVENT');

-- CreateEnum
CREATE TYPE "MessageStatusSource" AS ENUM ('INTERNAL', 'LOCAL_SIMULATOR', 'PROVIDER', 'HUMAN_CORRECTION', 'BACKFILL');

-- CreateEnum
CREATE TYPE "MessageDeliveryAttemptStatus" AS ENUM ('RUNNING', 'ACCEPTED_INTERNAL', 'SUCCEEDED', 'RETRY_PENDING', 'FAILED_PERMANENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageIdentityReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MessageIdentityReviewReason" AS ENUM ('CONTACT_NOT_FOUND', 'MULTIPLE_CONTACT_MATCHES', 'CONTACT_WITHOUT_LEAD', 'INVALID_ADDRESS');

-- CreateEnum
CREATE TYPE "MessageTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE_LOCAL', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ChannelSupportStatus" AS ENUM ('LOCAL_ONLY', 'EXTERNAL_DEFERRED', 'FUTURE');

-- CreateEnum
CREATE TYPE "OmnichannelBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "OmnichannelBackfillStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "OmnichannelBackfillOutcome" AS ENUM ('MIGRATED', 'ALREADY_MIGRATED', 'REVIEW_REQUIRED', 'SKIPPED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConversationChannel" ADD VALUE 'INTERNAL_SIMULATOR';
ALTER TYPE "ConversationChannel" ADD VALUE 'INSTAGRAM_MESSAGING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConversationStatus" ADD VALUE 'PENDING_INTERNAL';
ALTER TYPE "ConversationStatus" ADD VALUE 'WAITING_CUSTOMER';
ALTER TYPE "ConversationStatus" ADD VALUE 'RESOLVED';

-- AlterEnum
ALTER TYPE "MessageDirection" ADD VALUE 'SYSTEM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageStatus" ADD VALUE 'DRAFT';
ALTER TYPE "MessageStatus" ADD VALUE 'BLOCKED_BY_POLICY';
ALTER TYPE "MessageStatus" ADD VALUE 'ACCEPTED_INTERNAL';
ALTER TYPE "MessageStatus" ADD VALUE 'PROVIDER_ACCEPTED';
ALTER TYPE "MessageStatus" ADD VALUE 'REPLIED';
ALTER TYPE "MessageStatus" ADD VALUE 'FAILED_TRANSIENT';
ALTER TYPE "MessageStatus" ADD VALUE 'FAILED_PERMANENT';
ALTER TYPE "MessageStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "MessageStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'OMNICHANNEL_MESSAGE';

-- DropIndex
DROP INDEX "conversations_workspaceId_channel_externalThreadId_idx";

-- DropIndex
DROP INDEX "messages_workspaceId_conversationId_createdAt_idx";

-- DropIndex
DROP INDEX "messages_workspaceId_status_createdAt_idx";

-- DropIndex
DROP INDEX "messages_workspaceId_externalMessageId_idx";

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "messageId" UUID;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "accountId" UUID,
ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "connectionId" UUID,
ADD COLUMN     "contactId" UUID,
ADD COLUMN     "contactPointId" UUID,
ADD COLUMN     "firstHumanResponseAt" TIMESTAMPTZ(3),
ADD COLUMN     "firstInboundAt" TIMESTAMPTZ(3),
ADD COLUMN     "firstResponseSeconds" INTEGER,
ADD COLUMN     "meetingId" UUID,
ADD COLUMN     "nextActionAt" TIMESTAMPTZ(3),
ADD COLUMN     "nextActionType" TEXT,
ADD COLUMN     "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "opportunityId" UUID,
ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "resolvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revenueLifecycleId" UUID,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitingSince" TIMESTAMPTZ(3),
ALTER COLUMN "leadId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "bodyHash" TEXT,
ADD COLUMN     "clientCorrelationId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "privacyDecisionId" UUID,
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "purposeVersionId" UUID,
ADD COLUMN     "recipientParticipantId" UUID,
ADD COLUMN     "redactedAt" TIMESTAMPTZ(3),
ADD COLUMN     "redactedByActorId" UUID,
ADD COLUMN     "replyToMessageId" UUID,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "senderParticipantId" UUID,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "type" "OmnichannelMessageType" NOT NULL DEFAULT 'TEXT',
ALTER COLUMN "body" DROP NOT NULL;

-- AlterTable
ALTER TABLE "webhook_inbox" ADD COLUMN     "messageId" UUID;

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "messageId" UUID;

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "ConversationParticipantRole" NOT NULL,
    "contactId" UUID,
    "contactPointId" UUID,
    "userId" UUID,
    "actorId" UUID,
    "identifierKey" TEXT NOT NULL,
    "externalAddressMasked" TEXT,
    "activeFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_status_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "source" "MessageStatusSource" NOT NULL,
    "providerReported" BOOLEAN NOT NULL DEFAULT false,
    "providerKey" TEXT,
    "externalEventId" TEXT,
    "providerOccurredAt" TIMESTAMPTZ(3),
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reasonCode" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_delivery_attempts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "outboxId" UUID,
    "jobId" UUID,
    "attemptNumber" INTEGER NOT NULL,
    "status" "MessageDeliveryAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorClassification" "IntegrationErrorClass",
    "providerRequestId" TEXT,
    "nextRetryAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignment_history" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "previousOwnerMemberId" UUID,
    "previousQueueId" UUID,
    "newOwnerMemberId" UUID,
    "newQueueId" UUID,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_identity_reviews" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID,
    "messageId" UUID,
    "contactId" UUID,
    "contactPointId" UUID,
    "reason" "MessageIdentityReviewReason" NOT NULL,
    "normalizedAddressHash" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "MessageIdentityReviewStatus" NOT NULL DEFAULT 'OPEN',
    "evidence" JSONB,
    "resolution" TEXT,
    "createdByActorId" UUID NOT NULL,
    "resolvedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "message_identity_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment_references" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "opaqueReference" TEXT NOT NULL,
    "fileName" TEXT,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "purposeVersionId" UUID,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "category" TEXT NOT NULL,
    "status" "MessageTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "subjectTemplate" TEXT,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentHash" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omnichannel_backfill_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runKey" TEXT NOT NULL,
    "mode" "OmnichannelBackfillMode" NOT NULL,
    "status" "OmnichannelBackfillStatus" NOT NULL DEFAULT 'RUNNING',
    "totalEligible" INTEGER NOT NULL DEFAULT 0,
    "migratedCount" INTEGER NOT NULL DEFAULT 0,
    "existingCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL,
    "requestedByActorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "omnichannel_backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omnichannel_backfill_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID,
    "outcome" "OmnichannelBackfillOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "omnichannel_backfill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_participants_workspaceId_contactId_activeUntil_idx" ON "conversation_participants"("workspaceId", "contactId", "activeUntil");

-- CreateIndex
CREATE INDEX "conversation_participants_workspaceId_contactPointId_active_idx" ON "conversation_participants"("workspaceId", "contactPointId", "activeUntil");

-- CreateIndex
CREATE INDEX "conversation_participants_workspaceId_conversationId_role_a_idx" ON "conversation_participants"("workspaceId", "conversationId", "role", "activeUntil");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_workspaceId_id_key" ON "conversation_participants"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_workspaceId_conversationId_identi_key" ON "conversation_participants"("workspaceId", "conversationId", "identifierKey");

-- CreateIndex
CREATE INDEX "message_status_events_workspaceId_messageId_providerOccurre_idx" ON "message_status_events"("workspaceId", "messageId", "providerOccurredAt", "ingestedAt");

-- CreateIndex
CREATE INDEX "message_status_events_workspaceId_status_ingestedAt_idx" ON "message_status_events"("workspaceId", "status", "ingestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_status_events_workspaceId_id_key" ON "message_status_events"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_status_events_workspaceId_messageId_sequence_key" ON "message_status_events"("workspaceId", "messageId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "message_status_events_workspaceId_providerKey_externalEvent_key" ON "message_status_events"("workspaceId", "providerKey", "externalEventId");

-- CreateIndex
CREATE INDEX "message_delivery_attempts_workspaceId_status_startedAt_idx" ON "message_delivery_attempts"("workspaceId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "message_delivery_attempts_workspaceId_nextRetryAt_status_idx" ON "message_delivery_attempts"("workspaceId", "nextRetryAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_delivery_attempts_workspaceId_id_key" ON "message_delivery_attempts"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_delivery_attempts_workspaceId_messageId_attemptNumb_key" ON "message_delivery_attempts"("workspaceId", "messageId", "attemptNumber");

-- CreateIndex
CREATE INDEX "conversation_assignment_history_workspaceId_conversationId__idx" ON "conversation_assignment_history"("workspaceId", "conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "conversation_assignment_history_workspaceId_newOwnerMemberI_idx" ON "conversation_assignment_history"("workspaceId", "newOwnerMemberId", "occurredAt");

-- CreateIndex
CREATE INDEX "conversation_assignment_history_workspaceId_newQueueId_occu_idx" ON "conversation_assignment_history"("workspaceId", "newQueueId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_assignment_history_workspaceId_id_key" ON "conversation_assignment_history"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "message_identity_reviews_workspaceId_status_createdAt_idx" ON "message_identity_reviews"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "message_identity_reviews_workspaceId_normalizedAddressHash__idx" ON "message_identity_reviews"("workspaceId", "normalizedAddressHash", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_identity_reviews_workspaceId_id_key" ON "message_identity_reviews"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "attachment_references_workspaceId_messageId_createdAt_idx" ON "attachment_references"("workspaceId", "messageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_references_workspaceId_id_key" ON "attachment_references"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_references_workspaceId_opaqueReference_key" ON "attachment_references"("workspaceId", "opaqueReference");

-- CreateIndex
CREATE INDEX "message_templates_workspaceId_channel_status_idx" ON "message_templates"("workspaceId", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspaceId_id_key" ON "message_templates"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspaceId_key_key" ON "message_templates"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "message_template_versions_workspaceId_templateId_createdAt_idx" ON "message_template_versions"("workspaceId", "templateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_workspaceId_id_key" ON "message_template_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_workspaceId_templateId_version_key" ON "message_template_versions"("workspaceId", "templateId", "version");

-- CreateIndex
CREATE INDEX "omnichannel_backfill_runs_workspaceId_status_createdAt_idx" ON "omnichannel_backfill_runs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "omnichannel_backfill_runs_workspaceId_id_key" ON "omnichannel_backfill_runs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "omnichannel_backfill_runs_workspaceId_runKey_key" ON "omnichannel_backfill_runs"("workspaceId", "runKey");

-- CreateIndex
CREATE INDEX "omnichannel_backfill_items_workspaceId_runId_outcome_idx" ON "omnichannel_backfill_items"("workspaceId", "runId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "omnichannel_backfill_items_workspaceId_id_key" ON "omnichannel_backfill_items"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "omnichannel_backfill_items_workspaceId_idempotencyKey_key" ON "omnichannel_backfill_items"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "omnichannel_backfill_items_workspaceId_runId_conversationId_key" ON "omnichannel_backfill_items"("workspaceId", "runId", "conversationId", "messageId");

-- CreateIndex
CREATE INDEX "activities_workspaceId_messageId_idx" ON "activities"("workspaceId", "messageId");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_contactId_status_lastMessageAt_idx" ON "conversations"("workspaceId", "contactId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_accountId_status_lastMessageAt_idx" ON "conversations"("workspaceId", "accountId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_opportunityId_lastMessageAt_idx" ON "conversations"("workspaceId", "opportunityId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_channel_status_lastMessageAt_idx" ON "conversations"("workspaceId", "channel", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_connectionId_externalThreadId_idx" ON "conversations"("workspaceId", "connectionId", "externalThreadId");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_unreadCount_lastMessageAt_idx" ON "conversations"("workspaceId", "unreadCount", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_nextActionAt_status_idx" ON "conversations"("workspaceId", "nextActionAt", "status");

-- CreateIndex
CREATE INDEX "messages_workspaceId_conversationId_occurredAt_idx" ON "messages"("workspaceId", "conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "messages_workspaceId_status_occurredAt_idx" ON "messages"("workspaceId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "messages_workspaceId_providerKey_externalMessageId_idx" ON "messages"("workspaceId", "providerKey", "externalMessageId");

-- CreateIndex
CREATE INDEX "messages_workspaceId_privacyDecisionId_idx" ON "messages"("workspaceId", "privacyDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_workspaceId_idempotencyKey_key" ON "messages"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspaceId_messageId_idx" ON "webhook_inbox"("workspaceId", "messageId");

-- CreateIndex
CREATE INDEX "outbox_events_workspaceId_messageId_idx" ON "outbox_events"("workspaceId", "messageId");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_accountId_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_revenueLifecycleId_fkey" FOREIGN KEY ("workspaceId", "revenueLifecycleId") REFERENCES "revenue_lifecycles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_senderParticipantId_fkey" FOREIGN KEY ("workspaceId", "senderParticipantId") REFERENCES "conversation_participants"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_recipientParticipantId_fkey" FOREIGN KEY ("workspaceId", "recipientParticipantId") REFERENCES "conversation_participants"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_replyToMessageId_fkey" FOREIGN KEY ("workspaceId", "replyToMessageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_privacyDecisionId_fkey" FOREIGN KEY ("workspaceId", "privacyDecisionId") REFERENCES "privacy_decisions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_purposeVersionId_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_redactedByActorId_fkey" FOREIGN KEY ("workspaceId", "redactedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_workspaceId_outboxId_fkey" FOREIGN KEY ("workspaceId", "outboxId") REFERENCES "outbox_events"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "jobs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_previousOwnerM_fkey" FOREIGN KEY ("workspaceId", "previousOwnerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_previousQueueI_fkey" FOREIGN KEY ("workspaceId", "previousQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_newOwnerMember_fkey" FOREIGN KEY ("workspaceId", "newOwnerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_newQueueId_fkey" FOREIGN KEY ("workspaceId", "newQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignment_history" ADD CONSTRAINT "conversation_assignment_history_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_identity_reviews" ADD CONSTRAINT "message_identity_reviews_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_references" ADD CONSTRAINT "attachment_references_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_references" ADD CONSTRAINT "attachment_references_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_references" ADD CONSTRAINT "attachment_references_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspaceId_purposeVersionId_fkey" FOREIGN KEY ("workspaceId", "purposeVersionId") REFERENCES "purpose_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_workspaceId_templateId_fkey" FOREIGN KEY ("workspaceId", "templateId") REFERENCES "message_templates"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omnichannel_backfill_runs" ADD CONSTRAINT "omnichannel_backfill_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omnichannel_backfill_runs" ADD CONSTRAINT "omnichannel_backfill_runs_workspaceId_requestedByActorId_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omnichannel_backfill_items" ADD CONSTRAINT "omnichannel_backfill_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omnichannel_backfill_items" ADD CONSTRAINT "omnichannel_backfill_items_workspaceId_runId_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "omnichannel_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omnichannel_backfill_items" ADD CONSTRAINT "omnichannel_backfill_items_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omnichannel_backfill_items" ADD CONSTRAINT "omnichannel_backfill_items_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants: an actionable conversation always has an explicit owner or queue.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_operational_owner_check"
  CHECK (
    "status" IN ('RESOLVED', 'CLOSED', 'ARCHIVED')
    OR "assigneeMemberId" IS NOT NULL
    OR "queueId" IS NOT NULL
  );

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_unread_nonnegative_check"
  CHECK ("unreadCount" >= 0);

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_first_response_nonnegative_check"
  CHECK ("firstResponseSeconds" IS NULL OR "firstResponseSeconds" >= 0);

ALTER TABLE "message_delivery_attempts"
  ADD CONSTRAINT "message_delivery_attempt_number_check"
  CHECK ("attemptNumber" > 0);

ALTER TABLE "attachment_references"
  ADD CONSTRAINT "attachment_reference_safe_metadata_check"
  CHECK (
    "sizeBytes" >= 0
    AND "mimeType" IN ('image/png', 'image/jpeg', 'application/pdf', 'audio/mpeg', 'audio/ogg')
  );

-- Facts are append-only. Corrections append a new fact instead of rewriting history.
CREATE OR REPLACE FUNCTION crm43_reject_append_only_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CRM-43 append-only record cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_status_events_append_only
BEFORE UPDATE OR DELETE ON "message_status_events"
FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();

CREATE TRIGGER conversation_assignment_history_append_only
BEFORE UPDATE OR DELETE ON "conversation_assignment_history"
FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();

CREATE TRIGGER omnichannel_backfill_items_append_only
BEFORE UPDATE OR DELETE ON "omnichannel_backfill_items"
FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();

CREATE OR REPLACE FUNCTION crm43_protect_message_fact()
RETURNS trigger AS $$
BEGIN
  IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."conversationId" IS DISTINCT FROM OLD."conversationId"
    OR NEW."senderActorId" IS DISTINCT FROM OLD."senderActorId"
    OR NEW."direction" IS DISTINCT FROM OLD."direction"
    OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."subject" IS DISTINCT FROM OLD."subject"
    OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
    OR NEW."providerKey" IS DISTINCT FROM OLD."providerKey"
    OR NEW."externalMessageId" IS DISTINCT FROM OLD."externalMessageId"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (
      NEW."body" IS DISTINCT FROM OLD."body"
      AND NOT (NEW."body" IS NULL AND NEW."redactedAt" IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'CRM-43 immutable message fact cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_protect_fact
BEFORE UPDATE ON "messages"
FOR EACH ROW EXECUTE FUNCTION crm43_protect_message_fact();
