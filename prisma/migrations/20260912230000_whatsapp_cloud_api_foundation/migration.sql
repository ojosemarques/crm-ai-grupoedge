CREATE TYPE "WhatsAppOperatingMode" AS ENUM ('LOCAL_SIMULATOR', 'EXTERNAL_DISABLED', 'PAUSED');
CREATE TYPE "WhatsAppPolicyEligibility" AS ENUM ('PENDING_POLICY_REVIEW', 'ELIGIBLE', 'INELIGIBLE');
CREATE TYPE "WhatsAppTemplateProviderStatus" AS ENUM ('LOCAL_ONLY', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'UNKNOWN');
CREATE TYPE "WhatsAppMediaAvailability" AS ENUM ('REFERENCE_ONLY', 'AVAILABLE', 'UNAVAILABLE', 'EXPIRED', 'REVIEW_REQUIRED');
CREATE TYPE "WhatsAppEventReviewKind" AS ENUM ('UNKNOWN_EVENT', 'STATUS_REGRESSION', 'IDENTITY_AMBIGUOUS', 'PAYLOAD_INVALID', 'TEMPLATE_STATUS_UNKNOWN');
CREATE TYPE "WhatsAppEventReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

ALTER TABLE "conversations"
  ADD COLUMN "lastCustomerInboundAt" TIMESTAMPTZ(3),
  ADD COLUMN "serviceWindowExpiresAt" TIMESTAMPTZ(3);

ALTER TABLE "messages"
  ADD COLUMN "providerAcceptedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "readAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastProviderStatusAt" TIMESTAMPTZ(3);

ALTER TABLE "attachment_references"
  ADD COLUMN "providerKey" TEXT,
  ADD COLUMN "providerMediaId" TEXT,
  ADD COLUMN "providerMimeType" TEXT,
  ADD COLUMN "observedMimeType" TEXT,
  ADD COLUMN "providerSizeBytes" INTEGER,
  ADD COLUMN "mediaAvailability" "WhatsAppMediaAvailability" NOT NULL DEFAULT 'REFERENCE_ONLY',
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "attachment_references_provider_size_non_negative" CHECK ("providerSizeBytes" IS NULL OR "providerSizeBytes" >= 0);

ALTER TABLE "message_templates"
  ADD COLUMN "providerTemplateId" TEXT,
  ADD COLUMN "providerStatus" "WhatsAppTemplateProviderStatus" NOT NULL DEFAULT 'LOCAL_ONLY',
  ADD COLUMN "providerStatusObservedAt" TIMESTAMPTZ(3);

ALTER TABLE "message_template_versions"
  ADD COLUMN "headerTemplate" TEXT,
  ADD COLUMN "footerTemplate" TEXT,
  ADD COLUMN "buttonDefinitions" JSONB;

CREATE TABLE "whatsapp_connection_profiles" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "webhookKey" TEXT NOT NULL,
  "phoneNumberId" TEXT,
  "businessAccountId" TEXT,
  "businessPortfolioId" TEXT,
  "displayPhoneMasked" TEXT,
  "graphApiVersion" TEXT NOT NULL DEFAULT 'v26.0',
  "operatingMode" "WhatsAppOperatingMode" NOT NULL DEFAULT 'EXTERNAL_DISABLED',
  "policyEligibility" "WhatsAppPolicyEligibility" NOT NULL DEFAULT 'PENDING_POLICY_REVIEW',
  "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "locale" TEXT NOT NULL DEFAULT 'pt-BR',
  "capabilitySnapshotVersion" TEXT NOT NULL DEFAULT 'whatsapp-cloud-api/1.0',
  "lastInboundAt" TIMESTAMPTZ(3),
  "lastStatusAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "whatsapp_connection_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_profiles_graph_version_allowlist" CHECK ("graphApiVersion" IN ('v25.0', 'v26.0')),
  CONSTRAINT "whatsapp_profiles_phone_id_format" CHECK ("phoneNumberId" IS NULL OR "phoneNumberId" ~ '^[0-9]{5,40}$'),
  CONSTRAINT "whatsapp_profiles_waba_id_format" CHECK ("businessAccountId" IS NULL OR "businessAccountId" ~ '^[0-9]{5,40}$')
);

CREATE TABLE "whatsapp_event_reviews" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "webhookInboxId" UUID,
  "messageId" UUID,
  "kind" "WhatsAppEventReviewKind" NOT NULL,
  "status" "WhatsAppEventReviewStatus" NOT NULL DEFAULT 'OPEN',
  "eventKey" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "evidence" JSONB,
  "createdByActorId" UUID NOT NULL,
  "resolvedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "whatsapp_event_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_connection_profiles_webhookKey_key" ON "whatsapp_connection_profiles"("webhookKey");
CREATE UNIQUE INDEX "whatsapp_connection_profiles_workspaceId_id_key" ON "whatsapp_connection_profiles"("workspaceId", "id");
CREATE UNIQUE INDEX "whatsapp_connection_profiles_workspaceId_connectionId_key" ON "whatsapp_connection_profiles"("workspaceId", "connectionId");
CREATE UNIQUE INDEX "whatsapp_connection_profiles_workspaceId_phoneNumberId_key" ON "whatsapp_connection_profiles"("workspaceId", "phoneNumberId");
CREATE INDEX "whatsapp_connection_profiles_workspaceId_operatingMode_policyEligibility_idx" ON "whatsapp_connection_profiles"("workspaceId", "operatingMode", "policyEligibility");
CREATE INDEX "whatsapp_connection_profiles_workspaceId_businessAccountId_phoneNumberId_idx" ON "whatsapp_connection_profiles"("workspaceId", "businessAccountId", "phoneNumberId");
CREATE UNIQUE INDEX "whatsapp_event_reviews_workspaceId_id_key" ON "whatsapp_event_reviews"("workspaceId", "id");
CREATE UNIQUE INDEX "whatsapp_event_reviews_workspaceId_profileId_eventKey_kind_key" ON "whatsapp_event_reviews"("workspaceId", "profileId", "eventKey", "kind");
CREATE INDEX "whatsapp_event_reviews_workspaceId_status_createdAt_idx" ON "whatsapp_event_reviews"("workspaceId", "status", "createdAt");
CREATE INDEX "whatsapp_event_reviews_workspaceId_profileId_status_createdAt_idx" ON "whatsapp_event_reviews"("workspaceId", "profileId", "status", "createdAt");
CREATE INDEX "attachment_references_workspaceId_providerKey_providerMediaId_idx" ON "attachment_references"("workspaceId", "providerKey", "providerMediaId");
CREATE INDEX "message_templates_workspaceId_channel_providerStatus_idx" ON "message_templates"("workspaceId", "channel", "providerStatus");
CREATE UNIQUE INDEX "messages_workspace_provider_external_id_unique" ON "messages"("workspaceId", "providerKey", "externalMessageId") WHERE "providerKey" IS NOT NULL AND "externalMessageId" IS NOT NULL;
CREATE INDEX "conversations_whatsapp_window_idx" ON "conversations"("workspaceId", "channel", "serviceWindowExpiresAt");

ALTER TABLE "whatsapp_connection_profiles" ADD CONSTRAINT "whatsapp_profiles_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_connection_profiles" ADD CONSTRAINT "whatsapp_profiles_connection_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_connection_profiles" ADD CONSTRAINT "whatsapp_profiles_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_connection_profiles" ADD CONSTRAINT "whatsapp_profiles_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_event_reviews" ADD CONSTRAINT "whatsapp_reviews_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_event_reviews" ADD CONSTRAINT "whatsapp_reviews_profile_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "whatsapp_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_event_reviews" ADD CONSTRAINT "whatsapp_reviews_webhook_fkey" FOREIGN KEY ("workspaceId", "webhookInboxId") REFERENCES "webhook_inbox"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_event_reviews" ADD CONSTRAINT "whatsapp_reviews_message_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_event_reviews" ADD CONSTRAINT "whatsapp_reviews_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "whatsapp_event_reviews" ADD CONSTRAINT "whatsapp_reviews_resolved_actor_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
