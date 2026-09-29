-- CreateEnum
CREATE TYPE "IntegrationEnvironment" AS ENUM ('LOCAL', 'SANDBOX', 'HOMOLOGATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "IntegrationCapabilityLevel" AS ENUM ('IMPLEMENTED', 'VALIDATED_LOCALLY', 'SANDBOX', 'CONNECTED', 'HOMOLOGATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('DRAFT', 'AWAITING_CREDENTIAL', 'READY_FOR_LOCAL_TEST', 'ACTIVE_LOCAL', 'DEGRADED', 'PAUSED', 'CONFIG_ERROR');

-- CreateEnum
CREATE TYPE "IntegrationCapability" AS ENUM ('WEBHOOK_RECEIVE', 'SYNC_PULL', 'SYNC_PUSH', 'OBJECT_MAPPING');

-- CreateEnum
CREATE TYPE "IntegrationErrorClass" AS ENUM ('TRANSIENT', 'PERMANENT', 'AUTHENTICATION', 'RATE_LIMIT', 'CONFIGURATION', 'PRIVACY_BLOCKED');

-- CreateEnum
CREATE TYPE "WebhookInboxStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'RETRY_PENDING', 'DEAD_LETTER', 'REJECTED');

-- CreateEnum
CREATE TYPE "WebhookSignatureStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'INVALID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED_LOCAL', 'RETRY_PENDING', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PULL', 'PUSH', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationMappingStatus" AS ENUM ('ACTIVE', 'REVIEW_REQUIRED', 'CONFLICT', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MappingConflictStatus" AS ENUM ('OPEN', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IntegrationDataClass" AS ENUM ('METADATA', 'OPERATIONAL', 'CONTACT_DATA', 'SENSITIVE_REVIEW');

-- CreateEnum
CREATE TYPE "IntegrationDeliveryKind" AS ENUM ('INBOX', 'OUTBOX', 'SYNC');

-- CreateEnum
CREATE TYPE "IntegrationInternalEntityType" AS ENUM ('CONTACT', 'ACCOUNT', 'LEAD', 'OPPORTUNITY', 'MEETING', 'MESSAGE');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "environment" "IntegrationEnvironment" NOT NULL DEFAULT 'LOCAL',
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "capabilityLevel" "IntegrationCapabilityLevel" NOT NULL DEFAULT 'IMPLEMENTED',
    "currentConfigVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMPTZ(3),
    "lastSucceededAt" TIMESTAMPTZ(3),
    "lastErroredAt" TIMESTAMPTZ(3),
    "currentErrorClass" "IntegrationErrorClass",
    "currentErrorCode" TEXT,
    "currentErrorMessage" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_secret_references" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "createdByActorId" UUID NOT NULL,
    "rotatedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMPTZ(3),
    "disabledAt" TIMESTAMPTZ(3),

    CONSTRAINT "integration_secret_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connection_config_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_connection_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connection_capabilities" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "capability" "IntegrationCapability" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_connection_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_inbox" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "payloadSizeBytes" INTEGER NOT NULL,
    "payload" JSONB,
    "dataClass" "IntegrationDataClass" NOT NULL DEFAULT 'METADATA',
    "signatureStatus" "WebhookSignatureStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "externalOccurredAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "WebhookInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMPTZ(3),
    "nextRetryAt" TIMESTAMPTZ(3),
    "errorClass" "IntegrationErrorClass",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "mappingId" UUID,
    "processedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID,
    "eventType" TEXT NOT NULL,
    "eventVersion" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "dataClass" "IntegrationDataClass" NOT NULL DEFAULT 'OPERATIONAL',
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMPTZ(3),
    "nextRetryAt" TIMESTAMPTZ(3),
    "errorClass" "IntegrationErrorClass",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "deliveredLocallyAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_delivery_attempts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" "IntegrationDeliveryKind" NOT NULL,
    "inboxId" UUID,
    "outboxId" UUID,
    "syncRunId" UUID,
    "attemptNumber" INTEGER NOT NULL,
    "status" "IntegrationAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "errorClass" "IntegrationErrorClass",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryAfterSeconds" INTEGER,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "resultMetadata" JSONB,

    CONSTRAINT "integration_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "objectType" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'PENDING',
    "previousCursor" TEXT,
    "candidateCursor" TEXT,
    "windowStart" TIMESTAMPTZ(3),
    "windowEnd" TIMESTAMPTZ(3),
    "watermark" TIMESTAMPTZ(3),
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorClass" "IntegrationErrorClass",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lockExpiresAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "correlationId" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "requestedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_cursors" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "objectType" TEXT NOT NULL,
    "cursor" TEXT,
    "watermark" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastSyncRunId" UUID,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_object_mappings" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalObjectType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalEntityType" "IntegrationInternalEntityType" NOT NULL,
    "internalEntityId" TEXT NOT NULL,
    "externalVersion" TEXT,
    "externalHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "IntegrationMappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstRecognizedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastRecognizedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_object_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_mapping_conflicts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalObjectType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "proposedInternalType" "IntegrationInternalEntityType",
    "proposedInternalId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "evidence" JSONB,
    "status" "MappingConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByActorId" UUID,
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "external_mapping_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_field_mapping_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "objectType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "precedence" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_field_mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_workspaceId_status_enabled_idx" ON "integration_connections"("workspaceId", "status", "enabled");

-- CreateIndex
CREATE INDEX "integration_connections_workspaceId_capabilityLevel_lastErr_idx" ON "integration_connections"("workspaceId", "capabilityLevel", "lastErroredAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspaceId_id_key" ON "integration_connections"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspaceId_key_key" ON "integration_connections"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "integration_secret_references_workspaceId_connectionId_disa_idx" ON "integration_secret_references"("workspaceId", "connectionId", "disabledAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_secret_references_workspaceId_id_key" ON "integration_secret_references"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_secret_references_workspaceId_connectionId_alia_key" ON "integration_secret_references"("workspaceId", "connectionId", "alias", "version");

-- CreateIndex
CREATE INDEX "integration_connection_config_versions_workspaceId_connecti_idx" ON "integration_connection_config_versions"("workspaceId", "connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_config_versions_workspaceId_id_key" ON "integration_connection_config_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_config_versions_workspaceId_connecti_key" ON "integration_connection_config_versions"("workspaceId", "connectionId", "version");

-- CreateIndex
CREATE INDEX "integration_connection_capabilities_workspaceId_capability__idx" ON "integration_connection_capabilities"("workspaceId", "capability", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_capabilities_workspaceId_id_key" ON "integration_connection_capabilities"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_capabilities_workspaceId_connectionI_key" ON "integration_connection_capabilities"("workspaceId", "connectionId", "capability");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspaceId_connectionId_status_receivedAt_idx" ON "webhook_inbox"("workspaceId", "connectionId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspaceId_status_nextRetryAt_idx" ON "webhook_inbox"("workspaceId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspaceId_payloadHash_idx" ON "webhook_inbox"("workspaceId", "payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_workspaceId_id_key" ON "webhook_inbox"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_workspaceId_connectionId_providerEventId_key" ON "webhook_inbox"("workspaceId", "connectionId", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_workspaceId_connectionId_nonceHash_key" ON "webhook_inbox"("workspaceId", "connectionId", "nonceHash");

-- CreateIndex
CREATE INDEX "outbox_events_workspaceId_status_availableAt_idx" ON "outbox_events"("workspaceId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_events_workspaceId_connectionId_status_createdAt_idx" ON "outbox_events"("workspaceId", "connectionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_workspaceId_aggregateType_aggregateId_created_idx" ON "outbox_events"("workspaceId", "aggregateType", "aggregateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_workspaceId_id_key" ON "outbox_events"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_workspaceId_idempotencyKey_key" ON "outbox_events"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "integration_delivery_attempts_workspaceId_status_startedAt_idx" ON "integration_delivery_attempts"("workspaceId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_attempts_workspaceId_id_key" ON "integration_delivery_attempts"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_delivery_attempts_workspaceId_kind_inboxId_outb_key" ON "integration_delivery_attempts"("workspaceId", "kind", "inboxId", "outboxId", "syncRunId", "attemptNumber");

-- CreateIndex
CREATE INDEX "integration_sync_runs_workspaceId_connectionId_status_creat_idx" ON "integration_sync_runs"("workspaceId", "connectionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "integration_sync_runs_workspaceId_status_lockExpiresAt_idx" ON "integration_sync_runs"("workspaceId", "status", "lockExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_runs_workspaceId_id_key" ON "integration_sync_runs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_runs_workspaceId_connectionId_direction_ob_key" ON "integration_sync_runs"("workspaceId", "connectionId", "direction", "objectType", "correlationId");

-- CreateIndex
CREATE INDEX "integration_sync_cursors_workspaceId_connectionId_updatedAt_idx" ON "integration_sync_cursors"("workspaceId", "connectionId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_cursors_workspaceId_id_key" ON "integration_sync_cursors"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_cursors_workspaceId_connectionId_direction_key" ON "integration_sync_cursors"("workspaceId", "connectionId", "direction", "objectType");

-- CreateIndex
CREATE INDEX "external_object_mappings_workspaceId_internalEntityType_int_idx" ON "external_object_mappings"("workspaceId", "internalEntityType", "internalEntityId", "status");

-- CreateIndex
CREATE INDEX "external_object_mappings_workspaceId_connectionId_status_up_idx" ON "external_object_mappings"("workspaceId", "connectionId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_object_mappings_workspaceId_id_key" ON "external_object_mappings"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "external_object_mappings_workspaceId_connectionId_externalO_key" ON "external_object_mappings"("workspaceId", "connectionId", "externalObjectType", "externalId");

-- CreateIndex
CREATE INDEX "external_mapping_conflicts_workspaceId_connectionId_status__idx" ON "external_mapping_conflicts"("workspaceId", "connectionId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_mapping_conflicts_workspaceId_id_key" ON "external_mapping_conflicts"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "external_mapping_conflicts_workspaceId_connectionId_externa_key" ON "external_mapping_conflicts"("workspaceId", "connectionId", "externalObjectType", "externalId", "reasonCode");

-- CreateIndex
CREATE INDEX "integration_field_mapping_versions_workspaceId_connectionId_idx" ON "integration_field_mapping_versions"("workspaceId", "connectionId", "objectType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "integration_field_mapping_versions_workspaceId_id_key" ON "integration_field_mapping_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_field_mapping_versions_workspaceId_connectionId_key" ON "integration_field_mapping_versions"("workspaceId", "connectionId", "objectType", "version");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_secret_references" ADD CONSTRAINT "integration_secret_references_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_secret_references" ADD CONSTRAINT "integration_secret_references_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection_config_versions" ADD CONSTRAINT "integration_connection_config_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection_config_versions" ADD CONSTRAINT "integration_connection_config_versions_workspaceId_connect_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection_capabilities" ADD CONSTRAINT "integration_connection_capabilities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection_capabilities" ADD CONSTRAINT "integration_connection_capabilities_workspaceId_connection_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_delivery_attempts" ADD CONSTRAINT "integration_delivery_attempts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_delivery_attempts" ADD CONSTRAINT "integration_delivery_attempts_workspaceId_inboxId_fkey" FOREIGN KEY ("workspaceId", "inboxId") REFERENCES "webhook_inbox"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_delivery_attempts" ADD CONSTRAINT "integration_delivery_attempts_workspaceId_outboxId_fkey" FOREIGN KEY ("workspaceId", "outboxId") REFERENCES "outbox_events"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_delivery_attempts" ADD CONSTRAINT "integration_delivery_attempts_workspaceId_syncRunId_fkey" FOREIGN KEY ("workspaceId", "syncRunId") REFERENCES "integration_sync_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_cursors" ADD CONSTRAINT "integration_sync_cursors_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_cursors" ADD CONSTRAINT "integration_sync_cursors_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_object_mappings" ADD CONSTRAINT "external_object_mappings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_object_mappings" ADD CONSTRAINT "external_object_mappings_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_mapping_conflicts" ADD CONSTRAINT "external_mapping_conflicts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_mapping_conflicts" ADD CONSTRAINT "external_mapping_conflicts_workspaceId_connectionId_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_field_mapping_versions" ADD CONSTRAINT "integration_field_mapping_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_field_mapping_versions" ADD CONSTRAINT "integration_field_mapping_versions_workspaceId_connectionI_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_revision_check" CHECK ("revision" > 0 AND "currentConfigVersion" > 0);
ALTER TABLE "integration_secret_references" ADD CONSTRAINT "integration_secret_references_version_check" CHECK ("version" > 0 AND char_length("referenceKey") BETWEEN 3 AND 160);
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_counts_check" CHECK ("payloadSizeBytes" >= 0 AND "attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 20);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_counts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 20);
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_counts_check" CHECK ("attempts" >= 0 AND "readCount" >= 0 AND "createdCount" >= 0 AND "updatedCount" >= 0 AND "ignoredCount" >= 0 AND "conflictCount" >= 0 AND "failedCount" >= 0);
ALTER TABLE "integration_sync_cursors" ADD CONSTRAINT "integration_sync_cursors_version_check" CHECK ("version" > 0);
ALTER TABLE "integration_delivery_attempts" ADD CONSTRAINT "integration_delivery_attempts_target_check" CHECK (
  ("kind" = 'INBOX' AND "inboxId" IS NOT NULL AND "outboxId" IS NULL AND "syncRunId" IS NULL) OR
  ("kind" = 'OUTBOX' AND "inboxId" IS NULL AND "outboxId" IS NOT NULL AND "syncRunId" IS NULL) OR
  ("kind" = 'SYNC' AND "inboxId" IS NULL AND "outboxId" IS NULL AND "syncRunId" IS NOT NULL)
);

-- Immutable evidence/configuration versions
CREATE OR REPLACE FUNCTION reject_integration_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'integration evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER integration_delivery_attempts_append_only
BEFORE UPDATE OR DELETE ON "integration_delivery_attempts"
FOR EACH ROW EXECUTE FUNCTION reject_integration_evidence_mutation();

CREATE TRIGGER integration_config_versions_append_only
BEFORE UPDATE OR DELETE ON "integration_connection_config_versions"
FOR EACH ROW EXECUTE FUNCTION reject_integration_evidence_mutation();

CREATE TRIGGER integration_field_mapping_versions_append_only
BEFORE UPDATE OR DELETE ON "integration_field_mapping_versions"
FOR EACH ROW EXECUTE FUNCTION reject_integration_evidence_mutation();
