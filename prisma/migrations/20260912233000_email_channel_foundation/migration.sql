ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'DEFERRED';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'SOFT_BOUNCE';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'HARD_BOUNCE';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'COMPLAINT';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'UNSUBSCRIBED';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN_REVIEW';

CREATE TYPE "EmailOperatingMode" AS ENUM ('LOCAL_SINK', 'EXTERNAL_DISABLED', 'EXTERNAL_READY', 'PAUSED');
CREATE TYPE "EmailDomainStatus" AS ENUM ('UNKNOWN', 'PENDING_EXTERNAL', 'VERIFIED_EXTERNAL', 'FAILED_EXTERNAL');
CREATE TYPE "EmailRecipientType" AS ENUM ('TO', 'CC', 'BCC');
CREATE TYPE "EmailSuppressionAction" AS ENUM ('APPLIED', 'RELEASED');
CREATE TYPE "EmailEventReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

CREATE TABLE "email_connection_profiles" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "operatingMode" "EmailOperatingMode" NOT NULL DEFAULT 'EXTERNAL_DISABLED',
  "adapterVersion" TEXT NOT NULL DEFAULT 'email-channel/1.0',
  "senderAddress" TEXT NOT NULL, "senderAddressNormalized" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, "envelopeFrom" TEXT NOT NULL, "replyTo" TEXT,
  "domain" TEXT NOT NULL, "smtpHost" TEXT, "smtpPort" INTEGER, "region" TEXT,
  "spfStatus" "EmailDomainStatus" NOT NULL DEFAULT 'PENDING_EXTERNAL',
  "dkimStatus" "EmailDomainStatus" NOT NULL DEFAULT 'PENDING_EXTERNAL',
  "dmarcStatus" "EmailDomainStatus" NOT NULL DEFAULT 'PENDING_EXTERNAL',
  "domainStatusProvenance" TEXT NOT NULL DEFAULT 'LOCAL_DECLARATION',
  "capabilitySnapshotVersion" TEXT NOT NULL DEFAULT 'email-channel/1.0',
  "configuredAt" TIMESTAMPTZ(3), "validatedAt" TIMESTAMPTZ(3), "lastSuccessAt" TIMESTAMPTZ(3),
  "pausedReason" TEXT, "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "email_connection_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_profile_sender_format" CHECK ("senderAddressNormalized" ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  CONSTRAINT "email_profile_domain_format" CHECK ("domain" ~ '^[a-z0-9.-]+$'),
  CONSTRAINT "email_profile_smtp_port" CHECK ("smtpPort" IS NULL OR "smtpPort" IN (465, 587)),
  CONSTRAINT "email_external_ready_requires_external_observation" CHECK ("operatingMode" <> 'EXTERNAL_READY' OR ("spfStatus" = 'VERIFIED_EXTERNAL' AND "dkimStatus" = 'VERIFIED_EXTERNAL' AND "dmarcStatus" = 'VERIFIED_EXTERNAL'))
);

CREATE TABLE "email_message_profiles" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "profileId" UUID NOT NULL, "messageId" UUID NOT NULL,
  "messageIdHeader" TEXT NOT NULL, "inReplyToHeader" TEXT, "referencesHeaders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "providerMessageId" TEXT, "providerThreadId" TEXT, "textBodyHash" TEXT NOT NULL, "htmlBodyHash" TEXT,
  "hasSanitizedHtml" BOOLEAN NOT NULL DEFAULT false, "listUnsubscribeToken" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_message_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_message_id_header_format" CHECK ("messageIdHeader" ~ '^<[^<>[:space:]@]+@[^<>[:space:]@]+>$'),
  CONSTRAINT "email_references_limit" CHECK (cardinality("referencesHeaders") <= 20)
);

CREATE TABLE "email_recipients" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "emailMessageId" UUID NOT NULL,
  "type" "EmailRecipientType" NOT NULL, "normalizedAddress" TEXT NOT NULL, "maskedAddress" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_recipient_address_format" CHECK ("normalizedAddress" ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);

CREATE TABLE "email_domain_observations" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "profileId" UUID NOT NULL, "domain" TEXT NOT NULL,
  "spfStatus" "EmailDomainStatus" NOT NULL, "dkimStatus" "EmailDomainStatus" NOT NULL,
  "dmarcStatus" "EmailDomainStatus" NOT NULL, "alignmentStatus" "EmailDomainStatus" NOT NULL,
  "provenance" TEXT NOT NULL, "evidence" JSONB, "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_domain_observations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_suppressions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "contactPointId" UUID, "normalizedEmail" TEXT NOT NULL,
  "purposeKey" TEXT NOT NULL, "action" "EmailSuppressionAction" NOT NULL, "reasonCode" TEXT NOT NULL,
  "source" TEXT NOT NULL, "externalEventId" TEXT, "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_suppression_address_format" CHECK ("normalizedEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);

CREATE TABLE "email_event_reviews" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "profileId" UUID NOT NULL, "emailMessageId" UUID,
  "messageId" UUID, "status" "EmailEventReviewStatus" NOT NULL DEFAULT 'OPEN', "eventKey" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL, "evidence" JSONB, "createdByActorId" UUID NOT NULL, "resolvedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "email_event_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_connection_profiles_workspaceId_id_key" ON "email_connection_profiles"("workspaceId", "id");
CREATE UNIQUE INDEX "email_connection_profiles_workspaceId_connectionId_key" ON "email_connection_profiles"("workspaceId", "connectionId");
CREATE INDEX "email_connection_profiles_workspaceId_operatingMode_domain_idx" ON "email_connection_profiles"("workspaceId", "operatingMode", "domain");
CREATE UNIQUE INDEX "email_message_profiles_workspaceId_id_key" ON "email_message_profiles"("workspaceId", "id");
CREATE UNIQUE INDEX "email_message_profiles_workspaceId_messageId_key" ON "email_message_profiles"("workspaceId", "messageId");
CREATE UNIQUE INDEX "email_message_profiles_workspaceId_profileId_messageIdHeader_key" ON "email_message_profiles"("workspaceId", "profileId", "messageIdHeader");
CREATE INDEX "email_message_profiles_workspaceId_providerMessageId_idx" ON "email_message_profiles"("workspaceId", "providerMessageId");
CREATE INDEX "email_message_profiles_workspaceId_inReplyToHeader_idx" ON "email_message_profiles"("workspaceId", "inReplyToHeader");
CREATE UNIQUE INDEX "email_recipients_workspaceId_id_key" ON "email_recipients"("workspaceId", "id");
CREATE UNIQUE INDEX "email_recipients_workspaceId_emailMessageId_type_normalizedAddress_key" ON "email_recipients"("workspaceId", "emailMessageId", "type", "normalizedAddress");
CREATE INDEX "email_recipients_workspaceId_normalizedAddress_type_idx" ON "email_recipients"("workspaceId", "normalizedAddress", "type");
CREATE UNIQUE INDEX "email_domain_observations_workspaceId_id_key" ON "email_domain_observations"("workspaceId", "id");
CREATE INDEX "email_domain_observations_workspaceId_profileId_observedAt_idx" ON "email_domain_observations"("workspaceId", "profileId", "observedAt");
CREATE INDEX "email_domain_observations_workspaceId_domain_observedAt_idx" ON "email_domain_observations"("workspaceId", "domain", "observedAt");
CREATE UNIQUE INDEX "email_suppressions_workspaceId_id_key" ON "email_suppressions"("workspaceId", "id");
CREATE UNIQUE INDEX "email_suppressions_workspaceId_purposeKey_normalizedEmail_externalEventId_key" ON "email_suppressions"("workspaceId", "purposeKey", "normalizedEmail", "externalEventId");
CREATE INDEX "email_suppressions_workspaceId_normalizedEmail_purposeKey_effectiveAt_idx" ON "email_suppressions"("workspaceId", "normalizedEmail", "purposeKey", "effectiveAt");
CREATE INDEX "email_suppressions_workspaceId_action_reasonCode_effectiveAt_idx" ON "email_suppressions"("workspaceId", "action", "reasonCode", "effectiveAt");
CREATE UNIQUE INDEX "email_event_reviews_workspaceId_id_key" ON "email_event_reviews"("workspaceId", "id");
CREATE UNIQUE INDEX "email_event_reviews_workspaceId_profileId_eventKey_reasonCode_key" ON "email_event_reviews"("workspaceId", "profileId", "eventKey", "reasonCode");
CREATE INDEX "email_event_reviews_workspaceId_status_createdAt_idx" ON "email_event_reviews"("workspaceId", "status", "createdAt");
CREATE INDEX "email_event_reviews_workspaceId_profileId_status_createdAt_idx" ON "email_event_reviews"("workspaceId", "profileId", "status", "createdAt");

ALTER TABLE "email_connection_profiles" ADD CONSTRAINT "email_profiles_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "email_connection_profiles" ADD CONSTRAINT "email_profiles_connection_fkey" FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_connection_profiles" ADD CONSTRAINT "email_profiles_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_connection_profiles" ADD CONSTRAINT "email_profiles_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_message_profiles" ADD CONSTRAINT "email_message_profiles_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "email_message_profiles" ADD CONSTRAINT "email_message_profiles_profile_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "email_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_message_profiles" ADD CONSTRAINT "email_message_profiles_message_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_message_fkey" FOREIGN KEY ("workspaceId", "emailMessageId") REFERENCES "email_message_profiles"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_domain_observations" ADD CONSTRAINT "email_domain_observations_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "email_domain_observations" ADD CONSTRAINT "email_domain_observations_profile_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "email_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_domain_observations" ADD CONSTRAINT "email_domain_observations_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_contact_point_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "contact_points"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_event_reviews" ADD CONSTRAINT "email_event_reviews_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "email_event_reviews" ADD CONSTRAINT "email_event_reviews_profile_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "email_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_event_reviews" ADD CONSTRAINT "email_event_reviews_email_message_fkey" FOREIGN KEY ("workspaceId", "emailMessageId") REFERENCES "email_message_profiles"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_event_reviews" ADD CONSTRAINT "email_event_reviews_message_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "messages"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_event_reviews" ADD CONSTRAINT "email_event_reviews_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "email_event_reviews" ADD CONSTRAINT "email_event_reviews_resolved_actor_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

CREATE TRIGGER email_domain_observations_append_only BEFORE UPDATE OR DELETE ON "email_domain_observations" FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();
CREATE TRIGGER email_suppressions_append_only BEFORE UPDATE OR DELETE ON "email_suppressions" FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();
