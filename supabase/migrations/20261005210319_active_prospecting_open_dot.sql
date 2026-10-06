SET search_path TO crm, public;

BEGIN;

ALTER TYPE "LeadIntakeChannel" ADD VALUE IF NOT EXISTS 'OPEN_DOT';
ALTER TYPE "TaskKind" ADD VALUE IF NOT EXISTS 'INSTAGRAM_MESSAGE';
ALTER TYPE "TaskKind" ADD VALUE IF NOT EXISTS 'INSTAGRAM_FOLLOW';
ALTER TYPE "CadenceStepAction" ADD VALUE IF NOT EXISTS 'INSTAGRAM_MESSAGE';
ALTER TYPE "CadenceStepAction" ADD VALUE IF NOT EXISTS 'INSTAGRAM_FOLLOW';

CREATE TYPE "ProspectingRole" AS ENUM ('MAYOR', 'COUNCILOR');
CREATE TYPE "ProspectContactScope" AS ENUM ('POLITICIAN', 'ADVISOR', 'OFFICE');
CREATE TYPE "ProspectingBatchStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "ProspectCandidateStatus" AS ENUM ('RECEIVED', 'REVIEW_REQUIRED', 'READY', 'REJECTED', 'PLANNED', 'RELEASED');
CREATE TYPE "ProspectSourceType" AS ENUM ('IBGE', 'TSE', 'CITY_HALL', 'CITY_COUNCIL', 'OFFICIAL_GAZETTE', 'INSTITUTIONAL_PROFILE');
CREATE TYPE "ProspectSourceValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');
CREATE TYPE "ProspectReleaseStatus" AS ENUM ('PLANNED', 'CLAIMED', 'RELEASED', 'DEFERRED', 'REJECTED', 'FAILED');
CREATE TYPE "ProspectingCadenceStatus" AS ENUM ('PENDING_D1', 'ACTIVE', 'PAUSED', 'CONVERSATION_STARTED', 'MEETING_SCHEDULED', 'CLOSED_NO_RESPONSE', 'DISCARDED', 'CANCELLED');
CREATE TYPE "ProspectingStepExecutor" AS ENUM ('SELLER', 'OPEN_DOT', 'CRM_WORKER');
CREATE TYPE "ProspectingStepStatus" AS ENUM ('BLOCKED', 'SCHEDULED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SUPPRESSED', 'EXPIRED', 'FAILED');
CREATE TYPE "ProspectingEmailJobStatus" AS ENUM ('BLOCKED', 'SCHEDULED', 'CLAIMED', 'SENT', 'DELIVERED', 'REPLIED', 'BOUNCED', 'COMPLAINT', 'UNSUBSCRIBED', 'CANCELLED', 'SUPPRESSED', 'EXPIRED', 'FAILED', 'RECONCILIATION_REQUIRED');
CREATE TYPE "OpenDotScope" AS ENUM ('RESEARCH_WRITE', 'RESEARCH_REVIEW', 'RESEARCH_READ', 'EMAIL_CLAIM', 'EMAIL_RECEIPT', 'EMAIL_EVENT_WRITE');

DROP INDEX IF EXISTS "cadence_steps_workspaceId_settingsVersionId_dayOffset_key";

ALTER TABLE "pipeline_stages" ADD COLUMN "stableKey" TEXT;

WITH target AS (
  SELECT "id" FROM "pipelines"
  WHERE "entityType" = 'LEAD'::"PipelineEntityType"
    AND "name" = 'Prospecção Ativa'
    AND "deletedAt" IS NULL
), mapped AS (
  SELECT stage."id", stage."pipelineId", stage."workspaceId", stage."position",
    CASE stage."position"
      WHEN 0 THEN 'active-prospecting.new-lead'
      WHEN 1 THEN 'active-prospecting.initial-outreach'
      WHEN 2 THEN 'active-prospecting.active-cadence'
      WHEN 3 THEN 'active-prospecting.conversation-started'
      WHEN 4 THEN 'active-prospecting.meeting-scheduled'
      WHEN 6 THEN 'active-prospecting.closed-no-response'
      WHEN 7 THEN 'active-prospecting.discarded'
    END AS stable_key,
    CASE stage."position"
      WHEN 0 THEN 'Novo lead'
      WHEN 1 THEN 'Abordagem inicial'
      WHEN 2 THEN 'Cadência ativa'
      WHEN 3 THEN 'Conversa iniciada'
      WHEN 4 THEN 'Reunião marcada'
      WHEN 6 THEN 'Encerrado — sem retorno'
      WHEN 7 THEN 'Descartado'
    END AS stage_name,
    CASE WHEN stage."position" IN (6, 7) THEN 'LOST'::"StageType" ELSE 'OPEN'::"StageType" END AS stage_type,
    CASE stage."position"
      WHEN 0 THEN 'NEW'::"LeadPipelineStageCode"
      WHEN 1 THEN 'TRYING_CONTACT'::"LeadPipelineStageCode"
      WHEN 2 THEN 'CONNECTED'::"LeadPipelineStageCode"
      WHEN 3 THEN 'IN_QUALIFICATION'::"LeadPipelineStageCode"
      WHEN 4 THEN 'MEETING_SCHEDULED'::"LeadPipelineStageCode"
      WHEN 6 THEN 'NURTURING'::"LeadPipelineStageCode"
      WHEN 7 THEN 'DISQUALIFIED'::"LeadPipelineStageCode"
    END AS stage_code,
    CASE WHEN stage."position" > 5 THEN stage."position" - 1 ELSE stage."position" END AS next_position
  FROM "pipeline_stages" stage
  JOIN target ON target."id" = stage."pipelineId"
  WHERE stage."position" IN (0, 1, 2, 3, 4, 6, 7)
)
UPDATE "pipeline_stages" stage
SET "stableKey" = mapped.stable_key,
    "name" = mapped.stage_name,
    "type" = mapped.stage_type,
    "leadStageCode" = mapped.stage_code,
    "position" = mapped.next_position,
    "updatedAt" = CURRENT_TIMESTAMP
FROM mapped
WHERE stage."id" = mapped."id";

WITH target AS (
  SELECT "id" FROM "pipelines"
  WHERE "entityType" = 'LEAD'::"PipelineEntityType"
    AND "name" = 'Prospecção Ativa'
    AND "deletedAt" IS NULL
), obsolete AS (
  SELECT stage."workspaceId", stage."pipelineId", stage."id" AS obsolete_id, replacement."id" AS replacement_id
  FROM "pipeline_stages" stage
  JOIN target ON target."id" = stage."pipelineId"
  JOIN "pipeline_stages" replacement
    ON replacement."workspaceId" = stage."workspaceId"
   AND replacement."pipelineId" = stage."pipelineId"
   AND replacement."stableKey" = 'active-prospecting.meeting-scheduled'
  WHERE stage."position" = 5 AND stage."stableKey" IS NULL
)
UPDATE "leads" lead
SET "currentStageId" = obsolete.replacement_id, "updatedAt" = CURRENT_TIMESTAMP
FROM obsolete
WHERE lead."workspaceId" = obsolete."workspaceId"
  AND lead."pipelineId" = obsolete."pipelineId"
  AND lead."currentStageId" = obsolete.obsolete_id;

UPDATE "pipeline_stages" stage
SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
FROM "pipelines" pipeline
WHERE pipeline."id" = stage."pipelineId"
  AND pipeline."entityType" = 'LEAD'::"PipelineEntityType"
  AND pipeline."name" = 'Prospecção Ativa'
  AND pipeline."deletedAt" IS NULL
  AND stage."position" = 5
  AND stage."stableKey" IS NULL;

CREATE UNIQUE INDEX "pipeline_stages_workspaceId_pipelineId_stableKey_key"
  ON "pipeline_stages"("workspaceId", "pipelineId", "stableKey");

CREATE TABLE "prospecting_research_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL,
  "status" "ProspectingBatchStatus" NOT NULL DEFAULT 'DRAFT', "horizonStart" DATE NOT NULL,
  "horizonEnd" DATE NOT NULL, "sourcePopulationEdition" TEXT NOT NULL, "sourcePopulationHash" TEXT NOT NULL,
  "agentVersion" TEXT NOT NULL, "promptVersion" TEXT NOT NULL, "researchedCount" INTEGER NOT NULL DEFAULT 0,
  "completeCount" INTEGER NOT NULL DEFAULT 0, "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0, "releasedCount" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL, "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_research_batches_horizon_check" CHECK ("horizonEnd" >= "horizonStart"),
  CONSTRAINT "prospecting_research_batches_population_hash_check" CHECK ("sourcePopulationHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "prospecting_research_batches_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_research_batches_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_research_batches_workspace_id_key" ON "prospecting_research_batches"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_research_batches_idempotency_key" ON "prospecting_research_batches"("workspaceId", "idempotencyKey");
CREATE INDEX "prospecting_research_batches_status_idx" ON "prospecting_research_batches"("workspaceId", "status", "horizonEnd");

CREATE TABLE "prospect_candidates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "batchId" UUID NOT NULL,
  "externalIdentityKey" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "status" "ProspectCandidateStatus" NOT NULL DEFAULT 'RECEIVED', "politicianName" TEXT NOT NULL,
  "role" "ProspectingRole" NOT NULL, "mandate" TEXT NOT NULL, "municipalityName" TEXT NOT NULL,
  "municipalityIbgeCode" TEXT NOT NULL, "stateCode" TEXT NOT NULL, "population" INTEGER NOT NULL,
  "populationEdition" TEXT NOT NULL, "phone" TEXT NOT NULL, "normalizedPhone" TEXT NOT NULL,
  "phoneScope" "ProspectContactScope" NOT NULL, "email" TEXT NOT NULL, "normalizedEmail" TEXT NOT NULL,
  "emailScope" "ProspectContactScope" NOT NULL, "instagram" TEXT, "instagramScope" "ProspectContactScope",
  "mandateVerifiedAt" TIMESTAMPTZ(3) NOT NULL, "fingerprint" TEXT NOT NULL,
  "rejectionReasonCode" TEXT, "reviewReasonCode" TEXT, "plannedReleaseDate" DATE,
  "releasedAt" TIMESTAMPTZ(3), "leadId" UUID, "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospect_candidates_population_check" CHECK ("population" >= 0),
  CONSTRAINT "prospect_candidates_state_check" CHECK ("stateCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "prospect_candidates_ibge_check" CHECK ("municipalityIbgeCode" ~ '^[0-9]{7}$'),
  CONSTRAINT "prospect_candidates_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_candidates_batch_fk" FOREIGN KEY ("workspaceId", "batchId") REFERENCES "prospecting_research_batches"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_candidates_lead_fk" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospect_candidates_workspace_id_key" ON "prospect_candidates"("workspaceId", "id");
CREATE UNIQUE INDEX "prospect_candidates_identity_key" ON "prospect_candidates"("workspaceId", "externalIdentityKey");
CREATE UNIQUE INDEX "prospect_candidates_idempotency_key" ON "prospect_candidates"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "prospect_candidates_lead_key" ON "prospect_candidates"("workspaceId", "leadId");
CREATE INDEX "prospect_candidates_batch_status_idx" ON "prospect_candidates"("workspaceId", "batchId", "status");
CREATE INDEX "prospect_candidates_release_idx" ON "prospect_candidates"("workspaceId", "status", "plannedReleaseDate");
CREATE INDEX "prospect_candidates_mandate_idx" ON "prospect_candidates"("workspaceId", "municipalityIbgeCode", "role", "mandate");
CREATE INDEX "prospect_candidates_phone_idx" ON "prospect_candidates"("workspaceId", "normalizedPhone");
CREATE INDEX "prospect_candidates_email_idx" ON "prospect_candidates"("workspaceId", "normalizedEmail");

CREATE TABLE "prospect_candidate_sources" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "candidateId" UUID NOT NULL,
  "field" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL, "canonicalUrl" TEXT NOT NULL, "sourceDomain" TEXT NOT NULL,
  "sourceType" "ProspectSourceType" NOT NULL, "contactScope" "ProspectContactScope",
  "originalValue" TEXT, "normalizedValue" TEXT, "validationMethod" TEXT NOT NULL,
  "validationStatus" "ProspectSourceValidationStatus" NOT NULL DEFAULT 'PENDING', "evidenceHash" TEXT NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL, "agentVersion" TEXT NOT NULL, "promptVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospect_candidate_sources_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_candidate_sources_candidate_fk" FOREIGN KEY ("workspaceId", "candidateId") REFERENCES "prospect_candidates"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospect_candidate_sources_workspace_id_key" ON "prospect_candidate_sources"("workspaceId", "id");
CREATE UNIQUE INDEX "prospect_candidate_sources_evidence_key" ON "prospect_candidate_sources"("workspaceId", "candidateId", "field", "canonicalUrl");
CREATE INDEX "prospect_candidate_sources_validation_idx" ON "prospect_candidate_sources"("workspaceId", "candidateId", "validationStatus");
CREATE INDEX "prospect_candidate_sources_type_idx" ON "prospect_candidate_sources"("workspaceId", "sourceType", "observedAt");

CREATE TABLE "prospect_releases" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "candidateId" UUID NOT NULL,
  "plannedDate" DATE NOT NULL, "plannedMemberId" UUID, "planRevision" INTEGER NOT NULL DEFAULT 1,
  "status" "ProspectReleaseStatus" NOT NULL DEFAULT 'PLANNED', "claimedBy" TEXT, "claimedAt" TIMESTAMPTZ(3),
  "leaseExpiresAt" TIMESTAMPTZ(3), "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3), "lastErrorAt" TIMESTAMPTZ(3), "leadId" UUID, "reasonCode" TEXT, "idempotencyKey" TEXT NOT NULL,
  "releasedAt" TIMESTAMPTZ(3), "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospect_releases_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_releases_candidate_fk" FOREIGN KEY ("workspaceId", "candidateId") REFERENCES "prospect_candidates"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_releases_member_fk" FOREIGN KEY ("workspaceId", "plannedMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_releases_lead_fk" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospect_releases_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospect_releases_workspace_id_key" ON "prospect_releases"("workspaceId", "id");
CREATE UNIQUE INDEX "prospect_releases_candidate_key" ON "prospect_releases"("workspaceId", "candidateId");
CREATE UNIQUE INDEX "prospect_releases_idempotency_key" ON "prospect_releases"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "prospect_releases_lead_key" ON "prospect_releases"("workspaceId", "leadId");
CREATE INDEX "prospect_releases_status_idx" ON "prospect_releases"("workspaceId", "status", "nextAttemptAt", "plannedDate");
CREATE INDEX "prospect_releases_member_idx" ON "prospect_releases"("workspaceId", "plannedMemberId", "plannedDate", "status");

CREATE TABLE "prospecting_cadence_instances" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "leadId" UUID NOT NULL,
  "candidateId" UUID NOT NULL, "ownerMemberId" UUID NOT NULL, "templateVersion" INTEGER NOT NULL,
  "status" "ProspectingCadenceStatus" NOT NULL DEFAULT 'PENDING_D1', "d1Date" DATE NOT NULL,
  "deadlineAt" TIMESTAMPTZ(3) NOT NULL, "d1GateCompletedAt" TIMESTAMPTZ(3), "stoppedAt" TIMESTAMPTZ(3),
  "stopReasonCode" TEXT, "revision" INTEGER NOT NULL DEFAULT 1, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_cadence_instances_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_instances_lead_fk" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_instances_candidate_fk" FOREIGN KEY ("workspaceId", "candidateId") REFERENCES "prospect_candidates"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_instances_member_fk" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_instances_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_cadence_instances_workspace_id_key" ON "prospecting_cadence_instances"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_cadence_instances_lead_key" ON "prospecting_cadence_instances"("workspaceId", "leadId");
CREATE UNIQUE INDEX "prospecting_cadence_instances_candidate_key" ON "prospecting_cadence_instances"("workspaceId", "candidateId");
CREATE INDEX "prospecting_cadence_instances_deadline_idx" ON "prospecting_cadence_instances"("workspaceId", "status", "deadlineAt");
CREATE INDEX "prospecting_cadence_instances_member_idx" ON "prospecting_cadence_instances"("workspaceId", "ownerMemberId", "status");

CREATE TABLE "prospecting_email_template_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "stepKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "subjectTemplate" TEXT NOT NULL, "bodyTemplate" TEXT NOT NULL,
  "allowedVariables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "contentHash" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT FALSE, "publishedAt" TIMESTAMPTZ(3), "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospecting_email_template_versions_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_template_versions_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_email_template_versions_workspace_id_key" ON "prospecting_email_template_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_email_template_versions_step_key" ON "prospecting_email_template_versions"("workspaceId", "stepKey", "version");
CREATE INDEX "prospecting_email_template_versions_published_idx" ON "prospecting_email_template_versions"("workspaceId", "stepKey", "published", "version");

CREATE TABLE "prospecting_email_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "cadenceInstanceId" UUID NOT NULL,
  "leadId" UUID NOT NULL, "stepKey" TEXT NOT NULL, "templateVersionId" UUID, "senderProfileId" UUID,
  "recipientEmail" TEXT NOT NULL, "recipientEmailHash" TEXT NOT NULL, "renderedSubject" TEXT, "renderedBody" TEXT,
  "status" "ProspectingEmailJobStatus" NOT NULL DEFAULT 'BLOCKED', "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "claimedByClientId" TEXT, "claimedAt" TIMESTAMPTZ(3),
  "leaseExpiresAt" TIMESTAMPTZ(3), "lastAuthorizedAt" TIMESTAMPTZ(3), "providerMessageId" TEXT, "providerThreadId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "lastErrorCode" TEXT, "idempotencyKey" TEXT NOT NULL,
  "sentAt" TIMESTAMPTZ(3), "finalizedAt" TIMESTAMPTZ(3), "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_email_jobs_time_check" CHECK ("expiresAt" > "scheduledAt"),
  CONSTRAINT "prospecting_email_jobs_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_jobs_cadence_fk" FOREIGN KEY ("workspaceId", "cadenceInstanceId") REFERENCES "prospecting_cadence_instances"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_jobs_lead_fk" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_jobs_template_fk" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "prospecting_email_template_versions"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_jobs_sender_fk" FOREIGN KEY ("workspaceId", "senderProfileId") REFERENCES "email_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_jobs_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_email_jobs_workspace_id_key" ON "prospecting_email_jobs"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_email_jobs_step_key" ON "prospecting_email_jobs"("workspaceId", "cadenceInstanceId", "stepKey");
CREATE UNIQUE INDEX "prospecting_email_jobs_idempotency_key" ON "prospecting_email_jobs"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "prospecting_email_jobs_provider_key" ON "prospecting_email_jobs"("workspaceId", "providerMessageId");
CREATE INDEX "prospecting_email_jobs_status_idx" ON "prospecting_email_jobs"("workspaceId", "status", "scheduledAt");
CREATE INDEX "prospecting_email_jobs_lead_idx" ON "prospecting_email_jobs"("workspaceId", "leadId", "status");

CREATE TABLE "prospecting_cadence_steps" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "cadenceInstanceId" UUID NOT NULL,
  "leadId" UUID NOT NULL, "stepKey" TEXT NOT NULL, "dayOffset" INTEGER NOT NULL,
  "executor" "ProspectingStepExecutor" NOT NULL, "action" "CadenceStepAction" NOT NULL,
  "status" "ProspectingStepStatus" NOT NULL DEFAULT 'SCHEDULED', "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "taskId" UUID, "emailJobId" UUID, "resultCode" TEXT, "resultReason" TEXT,
  "completedAt" TIMESTAMPTZ(3), "cancelledAt" TIMESTAMPTZ(3), "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_cadence_steps_day_check" CHECK ("dayOffset" BETWEEN 0 AND 30),
  CONSTRAINT "prospecting_cadence_steps_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_steps_cadence_fk" FOREIGN KEY ("workspaceId", "cadenceInstanceId") REFERENCES "prospecting_cadence_instances"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_steps_lead_fk" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_steps_task_fk" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "tasks"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_steps_email_fk" FOREIGN KEY ("workspaceId", "emailJobId") REFERENCES "prospecting_email_jobs"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_cadence_steps_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_cadence_steps_workspace_id_key" ON "prospecting_cadence_steps"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_cadence_steps_step_key" ON "prospecting_cadence_steps"("workspaceId", "cadenceInstanceId", "stepKey");
CREATE UNIQUE INDEX "prospecting_cadence_steps_task_key" ON "prospecting_cadence_steps"("workspaceId", "taskId");
CREATE UNIQUE INDEX "prospecting_cadence_steps_email_key" ON "prospecting_cadence_steps"("workspaceId", "emailJobId");
CREATE INDEX "prospecting_cadence_steps_schedule_idx" ON "prospecting_cadence_steps"("workspaceId", "status", "scheduledAt");
CREATE INDEX "prospecting_cadence_steps_lead_idx" ON "prospecting_cadence_steps"("workspaceId", "leadId", "status");

CREATE TABLE "prospecting_email_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "emailJobId" UUID,
  "externalEventId" TEXT NOT NULL, "eventType" "ProspectingEmailJobStatus" NOT NULL,
  "providerMessageId" TEXT, "payloadHash" TEXT NOT NULL, "safeMetadata" JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL, "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospecting_email_events_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_email_events_job_fk" FOREIGN KEY ("workspaceId", "emailJobId") REFERENCES "prospecting_email_jobs"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_email_events_workspace_id_key" ON "prospecting_email_events"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_email_events_external_key" ON "prospecting_email_events"("workspaceId", "externalEventId");
CREATE INDEX "prospecting_email_events_job_idx" ON "prospecting_email_events"("workspaceId", "emailJobId", "occurredAt");
CREATE INDEX "prospecting_email_events_provider_idx" ON "prospecting_email_events"("workspaceId", "providerMessageId");

CREATE TABLE "prospecting_calendar_holidays" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "localDate" DATE NOT NULL,
  "name" TEXT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospecting_calendar_holidays_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_calendar_holidays_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_calendar_holidays_workspace_id_key" ON "prospecting_calendar_holidays"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_calendar_holidays_date_key" ON "prospecting_calendar_holidays"("workspaceId", "localDate");

CREATE TABLE "prospecting_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL UNIQUE,
  "releaseEnabled" BOOLEAN NOT NULL DEFAULT FALSE, "emailEgressEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "dailyCapacity" INTEGER NOT NULL DEFAULT 75, "reservePercent" INTEGER NOT NULL DEFAULT 10,
  "emailWindowStart" TEXT NOT NULL DEFAULT '09:00', "emailWindowEnd" TEXT NOT NULL DEFAULT '17:00',
  "coverageWarningDays" INTEGER NOT NULL DEFAULT 10, "coverageCriticalDays" INTEGER NOT NULL DEFAULT 5,
  "privacyApprovedAt" TIMESTAMPTZ(3), "canaryApprovedAt" TIMESTAMPTZ(3), "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_settings_capacity_check" CHECK ("dailyCapacity" BETWEEN 1 AND 500 AND "reservePercent" BETWEEN 0 AND 50),
  CONSTRAINT "prospecting_settings_window_check" CHECK ("emailWindowStart" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND "emailWindowEnd" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "prospecting_settings_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_settings_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_settings_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_settings_workspace_id_key" ON "prospecting_settings"("workspaceId", "id");

CREATE TABLE "prospecting_seller_configs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "memberId" UUID NOT NULL, "senderProfileId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT TRUE, "dailyCapacity" INTEGER NOT NULL DEFAULT 75,
  "reservePercent" INTEGER NOT NULL DEFAULT 10, "dailyEmailLimit" INTEGER, "rotationPosition" INTEGER NOT NULL, "pausedReason" TEXT,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_seller_configs_capacity_check" CHECK ("dailyCapacity" BETWEEN 1 AND 500 AND "reservePercent" BETWEEN 0 AND 50 AND ("dailyEmailLimit" IS NULL OR "dailyEmailLimit" BETWEEN 1 AND 500)),
  CONSTRAINT "prospecting_seller_configs_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_seller_configs_member_fk" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_seller_configs_sender_fk" FOREIGN KEY ("workspaceId", "senderProfileId") REFERENCES "email_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_seller_configs_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_seller_configs_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "prospecting_seller_configs_workspace_id_key" ON "prospecting_seller_configs"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_seller_configs_member_key" ON "prospecting_seller_configs"("workspaceId", "memberId");
CREATE UNIQUE INDEX "prospecting_seller_configs_rotation_key" ON "prospecting_seller_configs"("workspaceId", "rotationPosition");
CREATE INDEX "prospecting_seller_configs_active_idx" ON "prospecting_seller_configs"("workspaceId", "active", "rotationPosition");
CREATE INDEX "prospecting_seller_configs_sender_idx" ON "prospecting_seller_configs"("workspaceId", "senderProfileId");

CREATE TABLE "open_dot_request_receipts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "clientId" TEXT NOT NULL,
  "scope" "OpenDotScope" NOT NULL, "endpoint" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "responseStatus" INTEGER NOT NULL,
  "responseBody" JSONB NOT NULL, "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "open_dot_request_receipts_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "open_dot_request_receipts_workspace_id_key" ON "open_dot_request_receipts"("workspaceId", "id");
CREATE UNIQUE INDEX "open_dot_request_receipts_idempotency_key" ON "open_dot_request_receipts"("workspaceId", "clientId", "idempotencyKey");
CREATE UNIQUE INDEX "open_dot_request_receipts_nonce_key" ON "open_dot_request_receipts"("workspaceId", "clientId", "nonceHash");
CREATE INDEX "open_dot_request_receipts_client_idx" ON "open_dot_request_receipts"("workspaceId", "clientId", "receivedAt");

ALTER TABLE "prospecting_research_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospect_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospect_candidate_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospect_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_cadence_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_cadence_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_email_template_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_email_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_email_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_calendar_holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospecting_seller_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_dot_request_receipts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "prospecting_research_batches", "prospect_candidates", "prospect_candidate_sources",
  "prospect_releases", "prospecting_cadence_instances", "prospecting_cadence_steps",
  "prospecting_email_template_versions", "prospecting_email_jobs", "prospecting_email_events",
  "prospecting_calendar_holidays", "prospecting_settings", "prospecting_seller_configs",
  "open_dot_request_receipts" FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
  table_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY[
        'prospecting_research_batches', 'prospect_candidates', 'prospect_candidate_sources',
        'prospect_releases', 'prospecting_cadence_instances', 'prospecting_cadence_steps',
        'prospecting_email_template_versions', 'prospecting_email_jobs', 'prospecting_email_events',
        'prospecting_calendar_holidays', 'prospecting_settings', 'prospecting_seller_configs',
        'open_dot_request_receipts'
      ] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
