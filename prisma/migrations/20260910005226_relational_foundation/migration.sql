-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'SYSTEM', 'AUTOMATION', 'AI_AGENT');

-- CreateEnum
CREATE TYPE "TeamFunction" AS ENUM ('SDR', 'CLOSER', 'MANAGER', 'ADMINISTRATOR', 'SUPPORT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('MANUAL', 'FORM', 'IMPORT', 'WEBHOOK', 'REFERRAL', 'ORGANIC', 'PAID_MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('RECEIVED', 'NORMALIZED', 'LINKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PipelineEntityType" AS ENUM ('LEAD', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "QualificationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QualificationCriterionStatus" AS ENUM ('UNKNOWN', 'NEGATIVE', 'PARTIAL', 'POSITIVE');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('BRL');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'NOTE', 'TASK', 'STAGE_CHANGE', 'STATUS_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('INTERNAL', 'WHATSAPP', 'INSTAGRAM', 'PHONE', 'EMAIL', 'SMS', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('LEAD_CREATED', 'LEAD_UPDATED', 'SLA_APPROACHING', 'SLA_BREACHED', 'TASK_DUE', 'MEETING_DUE', 'PROPOSAL_DUE', 'OPPORTUNITY_STALE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('ASSIGN_QUEUE', 'ASSIGN_MEMBER', 'CREATE_TASK', 'CREATE_NOTIFICATION', 'CREATE_AI_INSIGHT', 'UPDATE_PRIORITY');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SLA_WARNING', 'SLA_BREACH', 'TASK_DUE', 'MEETING_REMINDER', 'AUTOMATION_RESULT', 'AI_INSIGHT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InsightEngine" AS ENUM ('RULE_ENGINE', 'LLM');

-- CreateEnum
CREATE TYPE "AIInsightStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "InsightTargetType" AS ENUM ('WORKSPACE', 'LEAD', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SavedViewEntityType" AS ENUM ('LEAD', 'TASK', 'MEETING', 'OPPORTUNITY', 'AUTOMATION_RUN', 'AUDIT_LOG');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('AUTOMATION', 'IMPORT', 'WEBHOOK', 'AI_INSIGHT', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actors" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" "ActorType" NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "workspaceMemberId" UUID NOT NULL,
    "function" "TeamFunction" NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LeadSourceType" NOT NULL,
    "externalRef" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_campaigns" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "externalRef" TEXT,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "acquisition_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_creatives" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "externalRef" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "acquisition_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isGeneral" BOOLEAN NOT NULL DEFAULT false,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "campaignId" UUID,
    "creativeId" UUID,
    "pipelineId" UUID NOT NULL,
    "currentStageId" UUID NOT NULL,
    "ownerMemberId" UUID,
    "queueId" UUID,
    "fullName" TEXT NOT NULL,
    "normalizedEmail" TEXT,
    "normalizedPhone" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "slaStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "slaDueAt" TIMESTAMPTZ(3) NOT NULL,
    "firstRespondedAt" TIMESTAMPTZ(3),
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL,
    "nextActionAt" TIMESTAMPTZ(3) NOT NULL,
    "nextActionDescription" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_form_submissions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "campaignId" UUID,
    "creativeId" UUID,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "formIdentifier" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "normalizedEmail" TEXT,
    "normalizedPhone" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_qualifications" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "status" "QualificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "problemStatus" "QualificationCriterionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "problemEvidence" JSONB,
    "authorityStatus" "QualificationCriterionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "authorityEvidence" JSONB,
    "consequenceStatus" "QualificationCriterionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consequenceEvidence" JSONB,
    "timingStatus" "QualificationCriterionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "timingEvidence" JSONB,
    "objectiveStatus" "QualificationCriterionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "objectiveEvidence" JSONB,
    "assessedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_scores" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "modelKey" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "calculatedByActorId" UUID NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" "PipelineEntityType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "StageType" NOT NULL DEFAULT 'OPEN',
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_history" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "leadId" UUID,
    "opportunityId" UUID,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL,
    "exitedAt" TIMESTAMPTZ(3),
    "enteredByActorId" UUID NOT NULL,
    "exitedByActorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "currentStageId" UUID NOT NULL,
    "ownerMemberId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "amountCents" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "probabilityBps" INTEGER NOT NULL,
    "expectedCloseAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "outcomeReasonCode" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "listPriceCents" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" BIGINT NOT NULL,
    "discountCents" BIGINT NOT NULL DEFAULT 0,
    "totalCents" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "validUntil" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "opportunityId" UUID,
    "ownerMemberId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "outcome" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "opportunityId" UUID,
    "meetingId" UUID,
    "type" "ActivityType" NOT NULL,
    "direction" "ActivityDirection" NOT NULL DEFAULT 'INTERNAL',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSeconds" INTEGER,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "opportunityId" UUID,
    "meetingId" UUID,
    "assigneeMemberId" UUID,
    "queueId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "opportunityId" UUID,
    "body" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "assigneeMemberId" UUID,
    "queueId" UUID,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "externalThreadId" TEXT,
    "lastMessageAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderActorId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),
    "deletedByActorId" UUID,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),
    "removedByActorId" UUID,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AutomationRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "AutomationTriggerType" NOT NULL,
    "actionType" "AutomationActionType" NOT NULL,
    "conditions" JSONB NOT NULL,
    "actionConfig" JSONB NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "automationRuleId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "triggeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "inputPayload" JSONB,
    "outputPayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "recipientMemberId" UUID NOT NULL,
    "leadId" UUID,
    "opportunityId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "opportunityId" UUID,
    "targetType" "InsightTargetType" NOT NULL,
    "engine" "InsightEngine" NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "status" "AIInsightStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "inferences" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "evidence" JSONB,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "createdByActorId" UUID NOT NULL,
    "confirmedByActorId" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "changes" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "succeededRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "inputMetadata" JSONB,
    "resultMetadata" JSONB,
    "errorMessage" TEXT,
    "createdByActorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdByActorId" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_handoffs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "opportunityId" UUID,
    "fromMemberId" UUID NOT NULL,
    "toMemberId" UUID,
    "toQueueId" UUID,
    "status" "HandoffStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ownerMemberId" UUID NOT NULL,
    "entityType" "SavedViewEntityType" NOT NULL,
    "name" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB NOT NULL,
    "sorting" JSONB,
    "columns" JSONB,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "lastError" TEXT,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_normalizedEmail_key" ON "users"("normalizedEmail");

-- CreateIndex
CREATE INDEX "users_status_deletedAt_idx" ON "users"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "actors_workspaceId_type_idx" ON "actors"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "actors_userId_idx" ON "actors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "actors_workspaceId_id_key" ON "actors"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "actors_workspaceId_key_key" ON "actors"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "roles_workspaceId_key_deletedAt_idx" ON "roles"("workspaceId", "key", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_workspaceId_id_key" ON "roles"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_workspaceId_roleId_permissionId_key" ON "role_permissions"("workspaceId", "roleId", "permissionId");

-- CreateIndex
CREATE INDEX "workspace_members_workspaceId_roleId_status_deletedAt_idx" ON "workspace_members"("workspaceId", "roleId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_id_key" ON "workspace_members"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "teams_workspaceId_name_deletedAt_idx" ON "teams"("workspaceId", "name", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "teams_workspaceId_id_key" ON "teams"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "team_members_workspaceId_workspaceMemberId_function_deleted_idx" ON "team_members"("workspaceId", "workspaceMemberId", "function", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_workspaceId_teamId_workspaceMemberId_key" ON "team_members"("workspaceId", "teamId", "workspaceMemberId");

-- CreateIndex
CREATE INDEX "lead_sources_workspaceId_key_deletedAt_idx" ON "lead_sources"("workspaceId", "key", "deletedAt");

-- CreateIndex
CREATE INDEX "lead_sources_workspaceId_type_deletedAt_idx" ON "lead_sources"("workspaceId", "type", "deletedAt");

-- CreateIndex
CREATE INDEX "lead_sources_workspaceId_externalRef_idx" ON "lead_sources"("workspaceId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_workspaceId_id_key" ON "lead_sources"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "acquisition_campaigns_workspaceId_externalRef_idx" ON "acquisition_campaigns"("workspaceId", "externalRef");

-- CreateIndex
CREATE INDEX "acquisition_campaigns_workspaceId_startsAt_endsAt_idx" ON "acquisition_campaigns"("workspaceId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "acquisition_campaigns_workspaceId_deletedAt_idx" ON "acquisition_campaigns"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "acquisition_campaigns_workspaceId_id_key" ON "acquisition_campaigns"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "acquisition_creatives_workspaceId_campaignId_externalRef_de_idx" ON "acquisition_creatives"("workspaceId", "campaignId", "externalRef", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "acquisition_creatives_workspaceId_id_key" ON "acquisition_creatives"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "acquisition_creatives_workspaceId_campaignId_id_key" ON "acquisition_creatives"("workspaceId", "campaignId", "id");

-- CreateIndex
CREATE INDEX "queues_workspaceId_key_deletedAt_idx" ON "queues"("workspaceId", "key", "deletedAt");

-- CreateIndex
CREATE INDEX "queues_workspaceId_isGeneral_deletedAt_idx" ON "queues"("workspaceId", "isGeneral", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "queues_workspaceId_id_key" ON "queues"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "leads_workspaceId_ownerMemberId_status_deletedAt_idx" ON "leads"("workspaceId", "ownerMemberId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_queueId_status_deletedAt_idx" ON "leads"("workspaceId", "queueId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_pipelineId_currentStageId_status_deletedA_idx" ON "leads"("workspaceId", "pipelineId", "currentStageId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_priority_slaDueAt_deletedAt_idx" ON "leads"("workspaceId", "priority", "slaDueAt", "deletedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_sourceId_createdAt_idx" ON "leads"("workspaceId", "sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_campaignId_createdAt_idx" ON "leads"("workspaceId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_campaignId_creativeId_createdAt_idx" ON "leads"("workspaceId", "campaignId", "creativeId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_lastActivityAt_idx" ON "leads"("workspaceId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_nextActionAt_idx" ON "leads"("workspaceId", "nextActionAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_createdAt_idx" ON "leads"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_workspaceId_id_key" ON "leads"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_workspaceId_pipelineId_id_key" ON "leads"("workspaceId", "pipelineId", "id");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_leadId_submittedAt_idx" ON "lead_form_submissions"("workspaceId", "leadId", "submittedAt");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_sourceId_submittedAt_idx" ON "lead_form_submissions"("workspaceId", "sourceId", "submittedAt");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_campaignId_submittedAt_idx" ON "lead_form_submissions"("workspaceId", "campaignId", "submittedAt");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_campaignId_creativeId_sub_idx" ON "lead_form_submissions"("workspaceId", "campaignId", "creativeId", "submittedAt");

-- CreateIndex
CREATE INDEX "lead_form_submissions_workspaceId_status_createdAt_idx" ON "lead_form_submissions"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_form_submissions_workspaceId_id_key" ON "lead_form_submissions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_form_submissions_workspaceId_idempotencyKey_key" ON "lead_form_submissions"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "lead_qualifications_workspaceId_status_assessedAt_idx" ON "lead_qualifications"("workspaceId", "status", "assessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_qualifications_workspaceId_id_key" ON "lead_qualifications"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_qualifications_workspaceId_leadId_key" ON "lead_qualifications"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "lead_scores_workspaceId_leadId_calculatedAt_idx" ON "lead_scores"("workspaceId", "leadId", "calculatedAt");

-- CreateIndex
CREATE INDEX "lead_scores_workspaceId_score_calculatedAt_idx" ON "lead_scores"("workspaceId", "score", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_scores_workspaceId_id_key" ON "lead_scores"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "pipelines_workspaceId_entityType_isDefault_deletedAt_idx" ON "pipelines"("workspaceId", "entityType", "isDefault", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_workspaceId_id_key" ON "pipelines"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "pipeline_stages_workspaceId_pipelineId_position_deletedAt_idx" ON "pipeline_stages"("workspaceId", "pipelineId", "position", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_workspaceId_id_key" ON "pipeline_stages"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_workspaceId_pipelineId_id_key" ON "pipeline_stages"("workspaceId", "pipelineId", "id");

-- CreateIndex
CREATE INDEX "stage_history_workspaceId_leadId_enteredAt_idx" ON "stage_history"("workspaceId", "leadId", "enteredAt");

-- CreateIndex
CREATE INDEX "stage_history_workspaceId_opportunityId_enteredAt_idx" ON "stage_history"("workspaceId", "opportunityId", "enteredAt");

-- CreateIndex
CREATE INDEX "stage_history_workspaceId_pipelineId_stageId_enteredAt_idx" ON "stage_history"("workspaceId", "pipelineId", "stageId", "enteredAt");

-- CreateIndex
CREATE INDEX "stage_history_workspaceId_exitedAt_idx" ON "stage_history"("workspaceId", "exitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "stage_history_workspaceId_id_key" ON "stage_history"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_ownerMemberId_status_deletedAt_idx" ON "opportunities"("workspaceId", "ownerMemberId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_pipelineId_currentStageId_status__idx" ON "opportunities"("workspaceId", "pipelineId", "currentStageId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_status_expectedCloseAt_idx" ON "opportunities"("workspaceId", "status", "expectedCloseAt");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_leadId_createdAt_idx" ON "opportunities"("workspaceId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_createdAt_idx" ON "opportunities"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_workspaceId_id_key" ON "opportunities"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_workspaceId_pipelineId_id_key" ON "opportunities"("workspaceId", "pipelineId", "id");

-- CreateIndex
CREATE INDEX "products_workspaceId_sku_deletedAt_idx" ON "products"("workspaceId", "sku", "deletedAt");

-- CreateIndex
CREATE INDEX "products_workspaceId_active_deletedAt_idx" ON "products"("workspaceId", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "products_workspaceId_id_key" ON "products"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "offers_workspaceId_opportunityId_createdAt_idx" ON "offers"("workspaceId", "opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "offers_workspaceId_productId_createdAt_idx" ON "offers"("workspaceId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "offers_workspaceId_validUntil_idx" ON "offers"("workspaceId", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "offers_workspaceId_id_key" ON "offers"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "meetings_workspaceId_ownerMemberId_status_startsAt_idx" ON "meetings"("workspaceId", "ownerMemberId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_workspaceId_leadId_startsAt_idx" ON "meetings"("workspaceId", "leadId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_workspaceId_opportunityId_startsAt_idx" ON "meetings"("workspaceId", "opportunityId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_workspaceId_createdAt_idx" ON "meetings"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_workspaceId_id_key" ON "meetings"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "activities_workspaceId_leadId_occurredAt_idx" ON "activities"("workspaceId", "leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "activities_workspaceId_opportunityId_occurredAt_idx" ON "activities"("workspaceId", "opportunityId", "occurredAt");

-- CreateIndex
CREATE INDEX "activities_workspaceId_meetingId_idx" ON "activities"("workspaceId", "meetingId");

-- CreateIndex
CREATE INDEX "activities_workspaceId_type_occurredAt_idx" ON "activities"("workspaceId", "type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "activities_workspaceId_id_key" ON "activities"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_assigneeMemberId_status_dueAt_deletedAt_idx" ON "tasks"("workspaceId", "assigneeMemberId", "status", "dueAt", "deletedAt");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_queueId_status_dueAt_deletedAt_idx" ON "tasks"("workspaceId", "queueId", "status", "dueAt", "deletedAt");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_leadId_status_dueAt_idx" ON "tasks"("workspaceId", "leadId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_opportunityId_status_dueAt_idx" ON "tasks"("workspaceId", "opportunityId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_priority_dueAt_idx" ON "tasks"("workspaceId", "priority", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workspaceId_id_key" ON "tasks"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "notes_workspaceId_leadId_createdAt_idx" ON "notes"("workspaceId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "notes_workspaceId_opportunityId_createdAt_idx" ON "notes"("workspaceId", "opportunityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notes_workspaceId_id_key" ON "notes"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_assigneeMemberId_status_lastMessa_idx" ON "conversations"("workspaceId", "assigneeMemberId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_queueId_status_lastMessageAt_idx" ON "conversations"("workspaceId", "queueId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_leadId_lastMessageAt_idx" ON "conversations"("workspaceId", "leadId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_channel_externalThreadId_idx" ON "conversations"("workspaceId", "channel", "externalThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_workspaceId_id_key" ON "conversations"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "messages_workspaceId_conversationId_createdAt_idx" ON "messages"("workspaceId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_workspaceId_status_createdAt_idx" ON "messages"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "messages_workspaceId_externalMessageId_idx" ON "messages"("workspaceId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_workspaceId_id_key" ON "messages"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "tags_workspaceId_name_deletedAt_idx" ON "tags"("workspaceId", "name", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspaceId_id_key" ON "tags"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "lead_tags_workspaceId_leadId_removedAt_idx" ON "lead_tags"("workspaceId", "leadId", "removedAt");

-- CreateIndex
CREATE INDEX "lead_tags_workspaceId_tagId_removedAt_idx" ON "lead_tags"("workspaceId", "tagId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_tags_workspaceId_id_key" ON "lead_tags"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "automation_rules_workspaceId_status_triggerType_deletedAt_idx" ON "automation_rules"("workspaceId", "status", "triggerType", "deletedAt");

-- CreateIndex
CREATE INDEX "automation_rules_workspaceId_actionType_deletedAt_idx" ON "automation_rules"("workspaceId", "actionType", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_workspaceId_id_key" ON "automation_rules"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "automation_runs_workspaceId_automationRuleId_status_trigger_idx" ON "automation_runs"("workspaceId", "automationRuleId", "status", "triggeredAt");

-- CreateIndex
CREATE INDEX "automation_runs_workspaceId_status_createdAt_idx" ON "automation_runs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_workspaceId_id_key" ON "automation_runs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_workspaceId_idempotencyKey_key" ON "automation_runs"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "notifications_workspaceId_recipientMemberId_readAt_createdA_idx" ON "notifications"("workspaceId", "recipientMemberId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_workspaceId_leadId_createdAt_idx" ON "notifications"("workspaceId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_workspaceId_opportunityId_createdAt_idx" ON "notifications"("workspaceId", "opportunityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_workspaceId_id_key" ON "notifications"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "ai_insights_workspaceId_targetType_status_createdAt_idx" ON "ai_insights"("workspaceId", "targetType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_insights_workspaceId_leadId_status_createdAt_idx" ON "ai_insights"("workspaceId", "leadId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_insights_workspaceId_opportunityId_status_createdAt_idx" ON "ai_insights"("workspaceId", "opportunityId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_insights_workspaceId_requiresConfirmation_status_idx" ON "ai_insights"("workspaceId", "requiresConfirmation", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_workspaceId_id_key" ON "ai_insights"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_entityType_entityId_occurredAt_idx" ON "audit_logs"("workspaceId", "entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_actorId_occurredAt_idx" ON "audit_logs"("workspaceId", "actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_action_occurredAt_idx" ON "audit_logs"("workspaceId", "action", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_workspaceId_id_key" ON "audit_logs"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "import_jobs_workspaceId_status_createdAt_idx" ON "import_jobs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_workspaceId_id_key" ON "import_jobs"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "webhook_events_workspaceId_status_receivedAt_idx" ON "webhook_events"("workspaceId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "webhook_events_workspaceId_eventType_receivedAt_idx" ON "webhook_events"("workspaceId", "eventType", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_workspaceId_id_key" ON "webhook_events"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_workspaceId_provider_externalEventId_key" ON "webhook_events"("workspaceId", "provider", "externalEventId");

-- CreateIndex
CREATE INDEX "customer_handoffs_workspaceId_fromMemberId_status_requested_idx" ON "customer_handoffs"("workspaceId", "fromMemberId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "customer_handoffs_workspaceId_toMemberId_status_requestedAt_idx" ON "customer_handoffs"("workspaceId", "toMemberId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "customer_handoffs_workspaceId_toQueueId_status_requestedAt_idx" ON "customer_handoffs"("workspaceId", "toQueueId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "customer_handoffs_workspaceId_leadId_requestedAt_idx" ON "customer_handoffs"("workspaceId", "leadId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_handoffs_workspaceId_id_key" ON "customer_handoffs"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "saved_views_workspaceId_ownerMemberId_entityType_deletedAt_idx" ON "saved_views"("workspaceId", "ownerMemberId", "entityType", "deletedAt");

-- CreateIndex
CREATE INDEX "saved_views_workspaceId_isShared_entityType_deletedAt_idx" ON "saved_views"("workspaceId", "isShared", "entityType", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_workspaceId_id_key" ON "saved_views"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "jobs_workspaceId_status_runAt_priority_idx" ON "jobs"("workspaceId", "status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "jobs_workspaceId_lockedAt_idx" ON "jobs"("workspaceId", "lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_workspaceId_id_key" ON "jobs"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_workspaceId_idempotencyKey_key" ON "jobs"("workspaceId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "actors" ADD CONSTRAINT "actors_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actors" ADD CONSTRAINT "actors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_workspaceId_roleId_fkey" FOREIGN KEY ("workspaceId", "roleId") REFERENCES "roles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_roleId_fkey" FOREIGN KEY ("workspaceId", "roleId") REFERENCES "roles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspaceId_teamId_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspaceId_workspaceMemberId_fkey" FOREIGN KEY ("workspaceId", "workspaceMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_campaigns" ADD CONSTRAINT "acquisition_campaigns_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_campaigns" ADD CONSTRAINT "acquisition_campaigns_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_campaigns" ADD CONSTRAINT "acquisition_campaigns_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_creatives" ADD CONSTRAINT "acquisition_creatives_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_creatives" ADD CONSTRAINT "acquisition_creatives_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "acquisition_campaigns"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_creatives" ADD CONSTRAINT "acquisition_creatives_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_creatives" ADD CONSTRAINT "acquisition_creatives_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_sourceId_fkey" FOREIGN KEY ("workspaceId", "sourceId") REFERENCES "lead_sources"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "acquisition_campaigns"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_campaignId_creativeId_fkey" FOREIGN KEY ("workspaceId", "campaignId", "creativeId") REFERENCES "acquisition_creatives"("workspaceId", "campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_pipelineId_currentStageId_fkey" FOREIGN KEY ("workspaceId", "pipelineId", "currentStageId") REFERENCES "pipeline_stages"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_sourceId_fkey" FOREIGN KEY ("workspaceId", "sourceId") REFERENCES "lead_sources"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "acquisition_campaigns"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_campaignId_creativeId_fkey" FOREIGN KEY ("workspaceId", "campaignId", "creativeId") REFERENCES "acquisition_creatives"("workspaceId", "campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_workspaceId_calculatedByActorId_fkey" FOREIGN KEY ("workspaceId", "calculatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_pipelineId_stageId_fkey" FOREIGN KEY ("workspaceId", "pipelineId", "stageId") REFERENCES "pipeline_stages"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_pipelineId_leadId_fkey" FOREIGN KEY ("workspaceId", "pipelineId", "leadId") REFERENCES "leads"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_pipelineId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "pipelineId", "opportunityId") REFERENCES "opportunities"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_enteredByActorId_fkey" FOREIGN KEY ("workspaceId", "enteredByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_workspaceId_exitedByActorId_fkey" FOREIGN KEY ("workspaceId", "exitedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_pipelineId_currentStageId_fkey" FOREIGN KEY ("workspaceId", "pipelineId", "currentStageId") REFERENCES "pipeline_stages"("workspaceId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspaceId_productId_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_assigneeMemberId_fkey" FOREIGN KEY ("workspaceId", "assigneeMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_assigneeMemberId_fkey" FOREIGN KEY ("workspaceId", "assigneeMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "conversations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_senderActorId_fkey" FOREIGN KEY ("workspaceId", "senderActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_deletedByActorId_fkey" FOREIGN KEY ("workspaceId", "deletedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspaceId_tagId_fkey" FOREIGN KEY ("workspaceId", "tagId") REFERENCES "tags"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspaceId_removedByActorId_fkey" FOREIGN KEY ("workspaceId", "removedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspaceId_automationRuleId_fkey" FOREIGN KEY ("workspaceId", "automationRuleId") REFERENCES "automation_rules"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_recipientMemberId_fkey" FOREIGN KEY ("workspaceId", "recipientMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspaceId_confirmedByActorId_fkey" FOREIGN KEY ("workspaceId", "confirmedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_fromMemberId_fkey" FOREIGN KEY ("workspaceId", "fromMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_toMemberId_fkey" FOREIGN KEY ("workspaceId", "toMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_toQueueId_fkey" FOREIGN KEY ("workspaceId", "toQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
