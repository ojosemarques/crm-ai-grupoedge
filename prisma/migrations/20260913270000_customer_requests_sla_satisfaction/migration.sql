-- CRM-53: solicitações do cliente, SLA de atendimento e satisfação.
-- Migration estritamente aditiva; não altera objetos legados.

CREATE TYPE "CustomerRequestChannel" AS ENUM ('MANUAL', 'EMAIL', 'WHATSAPP', 'PHONE', 'MEETING', 'IN_APP', 'OTHER');
CREATE TYPE "CustomerRequestCategory" AS ENUM ('ACTIVATION', 'ADOPTION', 'COMMERCIAL', 'BILLING', 'ADJUSTMENT', 'COMPLAINT', 'DELIVERY', 'RELATIONSHIP');
CREATE TYPE "CustomerRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "CustomerRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "CustomerRequestEventType" AS ENUM ('CREATED', 'ASSIGNED', 'FIRST_RESPONSE', 'NEXT_ACTION_UPDATED', 'STATUS_CHANGED', 'RESOLVED', 'CLOSED', 'REOPENED', 'CORRECTED');
CREATE TYPE "CustomerServiceConfigStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "CustomerSurveyType" AS ENUM ('CSAT', 'NPS');
CREATE TYPE "CustomerSurveyInvitationStatus" AS ENUM ('CREATED', 'RESPONDED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "CustomerServiceBackfillStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "CustomerServiceBackfillOutcome" AS ENUM ('SKIPPED', 'REVIEW_REQUIRED');

CREATE TABLE "customer_service_sla_policies" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currentVersionId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "customer_service_sla_policy_versions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CustomerServiceConfigStatus" NOT NULL DEFAULT 'DRAFT',
  "firstResponseMinutes" INTEGER NOT NULL,
  "resolutionMinutes" INTEGER NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveTo" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_service_sla_version_values_ck" CHECK ("version" > 0 AND "firstResponseMinutes" > 0 AND "resolutionMinutes" >= "firstResponseMinutes"),
  CONSTRAINT "customer_service_sla_version_interval_ck" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "customer_service_sla_published_ck" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL)
);

CREATE TABLE "customer_requests" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "contactId" UUID,
  "channel" "CustomerRequestChannel" NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" "CustomerRequestCategory" NOT NULL,
  "priority" "CustomerRequestPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "CustomerRequestStatus" NOT NULL DEFAULT 'OPEN',
  "ownerMemberId" UUID,
  "queueId" UUID,
  "teamId" UUID,
  "slaPolicyVersionId" UUID NOT NULL,
  "firstResponseDueAt" TIMESTAMPTZ(3) NOT NULL,
  "resolutionDueAt" TIMESTAMPTZ(3) NOT NULL,
  "firstRespondedAt" TIMESTAMPTZ(3),
  "firstResponseSeconds" INTEGER,
  "firstResponseBreached" BOOLEAN,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolutionSeconds" INTEGER,
  "resolutionBreached" BOOLEAN,
  "closedAt" TIMESTAMPTZ(3),
  "nextActionDescription" TEXT NOT NULL,
  "nextActionAt" TIMESTAMPTZ(3) NOT NULL,
  "resolutionNote" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_request_owner_xor_queue_ck" CHECK (("ownerMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL)),
  CONSTRAINT "customer_request_due_order_ck" CHECK ("resolutionDueAt" >= "firstResponseDueAt"),
  CONSTRAINT "customer_request_first_response_ck" CHECK (("firstRespondedAt" IS NULL AND "firstResponseSeconds" IS NULL AND "firstResponseBreached" IS NULL) OR ("firstRespondedAt" IS NOT NULL AND "firstResponseSeconds" >= 0 AND "firstResponseBreached" IS NOT NULL)),
  CONSTRAINT "customer_request_resolution_ck" CHECK (("status" NOT IN ('RESOLVED', 'CLOSED')) OR ("resolvedAt" IS NOT NULL AND "resolutionSeconds" >= 0 AND "resolutionBreached" IS NOT NULL AND length(trim("resolutionNote")) >= 3)),
  CONSTRAINT "customer_request_closed_ck" CHECK ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL),
  CONSTRAINT "customer_request_revision_ck" CHECK ("revision" > 0)
);

CREATE TABLE "customer_request_events" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "CustomerRequestEventType" NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "safeMetadata" JSONB,
  "actorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_request_event_sequence_ck" CHECK ("sequence" > 0)
);

CREATE TABLE "customer_survey_definitions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "CustomerSurveyType" NOT NULL,
  "currentVersionId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "customer_survey_versions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "definitionId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CustomerServiceConfigStatus" NOT NULL DEFAULT 'DRAFT',
  "question" TEXT NOT NULL,
  "minValue" INTEGER NOT NULL,
  "maxValue" INTEGER NOT NULL,
  "labels" JSONB,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveTo" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_survey_version_values_ck" CHECK ("version" > 0 AND "minValue" >= 0 AND "maxValue" <= 10 AND "maxValue" > "minValue"),
  CONSTRAINT "customer_survey_version_interval_ck" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "customer_survey_version_published_ck" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL)
);

CREATE TABLE "customer_survey_invitations" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "requestId" UUID,
  "surveyVersionId" UUID NOT NULL,
  "channel" "CustomerRequestChannel" NOT NULL,
  "status" "CustomerSurveyInvitationStatus" NOT NULL DEFAULT 'CREATED',
  "simulated" BOOLEAN NOT NULL DEFAULT TRUE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "respondedAt" TIMESTAMPTZ(3),
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_survey_invitation_local_ck" CHECK ("simulated" = TRUE),
  CONSTRAINT "customer_survey_invitation_response_ck" CHECK (("status" = 'RESPONDED') = ("respondedAt" IS NOT NULL)),
  CONSTRAINT "customer_survey_invitation_expiry_ck" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "customer_survey_responses" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "invitationId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "surveyVersionId" UUID NOT NULL,
  "value" INTEGER NOT NULL,
  "classification" TEXT NOT NULL,
  "comment" TEXT,
  "channel" "CustomerRequestChannel" NOT NULL,
  "answeredAt" TIMESTAMPTZ(3) NOT NULL,
  "supersedesId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_survey_response_value_ck" CHECK ("value" BETWEEN 0 AND 10)
);

CREATE TABLE "customer_service_backfill_runs" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "CustomerServiceBackfillStatus" NOT NULL DEFAULT 'RUNNING',
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "customer_service_backfill_mode_ck" CHECK ("mode" IN ('DRY_RUN', 'EXECUTE')),
  CONSTRAINT "customer_service_backfill_counts_ck" CHECK ("eligibleCount" >= 0 AND "skippedCount" >= 0 AND "reviewCount" >= 0)
);

CREATE TABLE "customer_service_backfill_items" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "outcome" "CustomerServiceBackfillOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "safeEvidence" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "customer_service_sla_policies_workspace_id_key" ON "customer_service_sla_policies"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_service_sla_policies_workspace_key_key" ON "customer_service_sla_policies"("workspaceId", "key");
CREATE INDEX "customer_service_sla_policies_workspace_active_idx" ON "customer_service_sla_policies"("workspaceId", "active", "deletedAt");
CREATE UNIQUE INDEX "customer_service_sla_versions_workspace_id_key" ON "customer_service_sla_policy_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_service_sla_versions_workspace_policy_version_key" ON "customer_service_sla_policy_versions"("workspaceId", "policyId", "version");
CREATE INDEX "customer_service_sla_versions_workspace_status_idx" ON "customer_service_sla_policy_versions"("workspaceId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "customer_requests_workspace_id_key" ON "customer_requests"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_requests_workspace_idempotency_key" ON "customer_requests"("workspaceId", "idempotencyKey");
CREATE INDEX "customer_requests_workspace_account_status_idx" ON "customer_requests"("workspaceId", "accountId", "status", "createdAt");
CREATE INDEX "customer_requests_workspace_owner_sla_idx" ON "customer_requests"("workspaceId", "ownerMemberId", "status", "firstResponseDueAt");
CREATE INDEX "customer_requests_workspace_queue_sla_idx" ON "customer_requests"("workspaceId", "queueId", "status", "resolutionDueAt");
CREATE INDEX "customer_requests_workspace_category_priority_idx" ON "customer_requests"("workspaceId", "category", "priority", "status");
CREATE INDEX "customer_requests_workspace_channel_created_idx" ON "customer_requests"("workspaceId", "channel", "createdAt");
CREATE INDEX "customer_requests_workspace_policy_created_idx" ON "customer_requests"("workspaceId", "slaPolicyVersionId", "createdAt");
CREATE UNIQUE INDEX "customer_request_events_workspace_id_key" ON "customer_request_events"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_request_events_workspace_idempotency_key" ON "customer_request_events"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "customer_request_events_workspace_sequence_key" ON "customer_request_events"("workspaceId", "requestId", "sequence");
CREATE INDEX "customer_request_events_workspace_account_idx" ON "customer_request_events"("workspaceId", "accountId", "occurredAt");
CREATE UNIQUE INDEX "customer_survey_definitions_workspace_id_key" ON "customer_survey_definitions"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_survey_definitions_workspace_key_key" ON "customer_survey_definitions"("workspaceId", "key");
CREATE INDEX "customer_survey_definitions_workspace_type_idx" ON "customer_survey_definitions"("workspaceId", "type", "active", "deletedAt");
CREATE UNIQUE INDEX "customer_survey_versions_workspace_id_key" ON "customer_survey_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_survey_versions_workspace_definition_version_key" ON "customer_survey_versions"("workspaceId", "definitionId", "version");
CREATE INDEX "customer_survey_versions_workspace_status_idx" ON "customer_survey_versions"("workspaceId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "customer_survey_invitations_workspace_id_key" ON "customer_survey_invitations"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_survey_invitations_workspace_idempotency_key" ON "customer_survey_invitations"("workspaceId", "idempotencyKey");
CREATE INDEX "customer_survey_invitations_workspace_account_idx" ON "customer_survey_invitations"("workspaceId", "accountId", "status", "createdAt");
CREATE INDEX "customer_survey_invitations_workspace_request_idx" ON "customer_survey_invitations"("workspaceId", "requestId", "status");
CREATE INDEX "customer_survey_invitations_workspace_version_idx" ON "customer_survey_invitations"("workspaceId", "surveyVersionId", "createdAt");
CREATE UNIQUE INDEX "customer_survey_responses_workspace_id_key" ON "customer_survey_responses"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_survey_responses_workspace_idempotency_key" ON "customer_survey_responses"("workspaceId", "idempotencyKey");
CREATE INDEX "customer_survey_responses_workspace_account_idx" ON "customer_survey_responses"("workspaceId", "accountId", "answeredAt");
CREATE INDEX "customer_survey_responses_workspace_version_idx" ON "customer_survey_responses"("workspaceId", "surveyVersionId", "answeredAt");
CREATE INDEX "customer_survey_responses_workspace_invitation_idx" ON "customer_survey_responses"("workspaceId", "invitationId", "answeredAt");
CREATE UNIQUE INDEX "customer_service_backfill_runs_workspace_id_key" ON "customer_service_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_service_backfill_runs_workspace_key_key" ON "customer_service_backfill_runs"("workspaceId", "runKey");
CREATE UNIQUE INDEX "customer_service_backfill_items_workspace_id_key" ON "customer_service_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "customer_service_backfill_items_workspace_run_account_key" ON "customer_service_backfill_items"("workspaceId", "runId", "accountId");
CREATE INDEX "customer_service_backfill_items_workspace_outcome_idx" ON "customer_service_backfill_items"("workspaceId", "outcome", "createdAt");

ALTER TABLE "customer_service_sla_policies" ADD CONSTRAINT "customer_service_sla_policy_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_sla_policies" ADD CONSTRAINT "customer_service_sla_policy_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_sla_policies" ADD CONSTRAINT "customer_service_sla_policy_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_sla_policy_versions" ADD CONSTRAINT "customer_service_sla_version_policy_fk" FOREIGN KEY ("workspaceId", "policyId") REFERENCES "customer_service_sla_policies"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_sla_policy_versions" ADD CONSTRAINT "customer_service_sla_version_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_sla_policies" ADD CONSTRAINT "customer_service_sla_policy_current_version_fk" FOREIGN KEY ("workspaceId", "currentVersionId") REFERENCES "customer_service_sla_policy_versions"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_contact_fk" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_owner_fk" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_queue_fk" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_team_fk" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_sla_version_fk" FOREIGN KEY ("workspaceId", "slaPolicyVersionId") REFERENCES "customer_service_sla_policy_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_request_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_request_events" ADD CONSTRAINT "customer_request_event_request_fk" FOREIGN KEY ("workspaceId", "requestId") REFERENCES "customer_requests"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_request_events" ADD CONSTRAINT "customer_request_event_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_request_events" ADD CONSTRAINT "customer_request_event_actor_fk" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "customer_survey_definitions" ADD CONSTRAINT "customer_survey_definition_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_definitions" ADD CONSTRAINT "customer_survey_definition_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_definitions" ADD CONSTRAINT "customer_survey_definition_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_versions" ADD CONSTRAINT "customer_survey_version_definition_fk" FOREIGN KEY ("workspaceId", "definitionId") REFERENCES "customer_survey_definitions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_versions" ADD CONSTRAINT "customer_survey_version_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_definitions" ADD CONSTRAINT "customer_survey_definition_current_version_fk" FOREIGN KEY ("workspaceId", "currentVersionId") REFERENCES "customer_survey_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_invitations" ADD CONSTRAINT "customer_survey_invitation_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_invitations" ADD CONSTRAINT "customer_survey_invitation_request_fk" FOREIGN KEY ("workspaceId", "requestId") REFERENCES "customer_requests"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_invitations" ADD CONSTRAINT "customer_survey_invitation_version_fk" FOREIGN KEY ("workspaceId", "surveyVersionId") REFERENCES "customer_survey_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_invitations" ADD CONSTRAINT "customer_survey_invitation_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_responses" ADD CONSTRAINT "customer_survey_response_invitation_fk" FOREIGN KEY ("workspaceId", "invitationId") REFERENCES "customer_survey_invitations"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_responses" ADD CONSTRAINT "customer_survey_response_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_responses" ADD CONSTRAINT "customer_survey_response_version_fk" FOREIGN KEY ("workspaceId", "surveyVersionId") REFERENCES "customer_survey_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_responses" ADD CONSTRAINT "customer_survey_response_supersedes_fk" FOREIGN KEY ("workspaceId", "supersedesId") REFERENCES "customer_survey_responses"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_survey_responses" ADD CONSTRAINT "customer_survey_response_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "customer_service_backfill_runs" ADD CONSTRAINT "customer_service_backfill_run_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_backfill_runs" ADD CONSTRAINT "customer_service_backfill_run_actor_fk" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_backfill_items" ADD CONSTRAINT "customer_service_backfill_item_run_fk" FOREIGN KEY ("workspaceId", "runId") REFERENCES "customer_service_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_service_backfill_items" ADD CONSTRAINT "customer_service_backfill_item_account_fk" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;

CREATE FUNCTION crm53_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM-53 historical records are append-only';
END;
$$;

CREATE TRIGGER "customer_request_events_append_only" BEFORE UPDATE OR DELETE ON "customer_request_events" FOR EACH ROW EXECUTE FUNCTION crm53_reject_mutation();
CREATE TRIGGER "customer_survey_responses_append_only" BEFORE UPDATE OR DELETE ON "customer_survey_responses" FOR EACH ROW EXECUTE FUNCTION crm53_reject_mutation();
CREATE TRIGGER "customer_service_backfill_items_append_only" BEFORE UPDATE OR DELETE ON "customer_service_backfill_items" FOR EACH ROW EXECUTE FUNCTION crm53_reject_mutation();
