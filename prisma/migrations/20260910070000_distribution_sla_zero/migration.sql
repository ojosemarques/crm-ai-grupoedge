-- CRM-06: distribuição operacional, round-robin e SLA imediato por entrada.

BEGIN;

CREATE TYPE "TaskKind" AS ENUM ('GENERAL', 'IMMEDIATE_CALL');
CREATE TYPE "LeadAssignmentType" AS ENUM ('AUTOMATIC_ROUND_ROBIN', 'GENERAL_QUEUE_FALLBACK', 'MANUAL', 'REDISTRIBUTION');
CREATE TYPE "OperationalAlertType" AS ENUM ('GENERAL_QUEUE_ASSIGNMENT');
CREATE TYPE "OperationalAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

ALTER TABLE "leads" ADD COLUMN "routingQueueId" UUID;

ALTER TABLE "sla_policies"
  ADD COLUMN "attentionMaxSeconds" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "healthyMaxSeconds" INTEGER NOT NULL DEFAULT 60;

-- A constraint da CRM-04 exigia prazo estritamente positivo. A política desta
-- entrega é zero; substituímos a regra antes de atualizar qualquer configuração.
ALTER TABLE "sla_policies" DROP CONSTRAINT "sla_policies_values_check";
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_values_check"
  CHECK (
    "firstResponseMinutes" >= 0
    AND "warningMinutesBeforeDue" >= 0
    AND "warningMinutesBeforeDue" <= "firstResponseMinutes"
    AND "healthyMaxSeconds" >= 0
    AND "attentionMaxSeconds" > "healthyMaxSeconds"
  );

ALTER TABLE "tasks"
  ADD COLUMN "kind" "TaskKind" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "slaCycleId" UUID;

ALTER TABLE "workspace_members"
  ADD COLUMN "leadReceivingPauseReason" TEXT,
  ADD COLUMN "leadReceivingPausedAt" TIMESTAMPTZ(3),
  ADD COLUMN "leadReceivingPausedByActorId" UUID;

CREATE TABLE "round_robin_states" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "queueId" UUID NOT NULL,
  "lastAssignedTeamMemberId" UUID,
  "assignmentSequence" BIGINT NOT NULL DEFAULT 0,
  "lastAssignedAt" TIMESTAMPTZ(3),
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "round_robin_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_sla_cycles" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "priorityBandId" UUID NOT NULL,
  "assignedMemberId" UUID,
  "assignedQueueId" UUID,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL,
  "assignedAt" TIMESTAMPTZ(3) NOT NULL,
  "automaticAcknowledgedAt" TIMESTAMPTZ(3) NOT NULL,
  "firstHumanAttemptAt" TIMESTAMPTZ(3),
  "firstConnectedAt" TIMESTAMPTZ(3),
  "firstResponseTimeSeconds" INTEGER,
  "firstHumanAttemptSeconds" INTEGER,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_sla_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_assignments" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "fromMemberId" UUID,
  "fromQueueId" UUID,
  "toMemberId" UUID,
  "toQueueId" UUID,
  "type" "LeadAssignmentType" NOT NULL,
  "reason" TEXT,
  "assignedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_alerts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "queueId" UUID NOT NULL,
  "type" "OperationalAlertType" NOT NULL,
  "status" "OperationalAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "resolvedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "round_robin_states_queueId_key" ON "round_robin_states"("queueId");
CREATE INDEX "round_robin_states_workspaceId_lastAssignedAt_idx" ON "round_robin_states"("workspaceId", "lastAssignedAt");
CREATE UNIQUE INDEX "round_robin_states_workspaceId_id_key" ON "round_robin_states"("workspaceId", "id");
CREATE UNIQUE INDEX "round_robin_states_workspaceId_queueId_key" ON "round_robin_states"("workspaceId", "queueId");

CREATE UNIQUE INDEX "lead_sla_cycles_submissionId_key" ON "lead_sla_cycles"("submissionId");
CREATE INDEX "lead_sla_cycles_workspaceId_leadId_receivedAt_idx" ON "lead_sla_cycles"("workspaceId", "leadId", "receivedAt");
CREATE INDEX "lead_sla_cycles_workspaceId_assignedMemberId_firstHumanAtte_idx" ON "lead_sla_cycles"("workspaceId", "assignedMemberId", "firstHumanAttemptAt", "receivedAt");
CREATE INDEX "lead_sla_cycles_workspaceId_assignedQueueId_firstHumanAttem_idx" ON "lead_sla_cycles"("workspaceId", "assignedQueueId", "firstHumanAttemptAt", "receivedAt");
CREATE INDEX "lead_sla_cycles_workspaceId_priorityBandId_receivedAt_idx" ON "lead_sla_cycles"("workspaceId", "priorityBandId", "receivedAt");
CREATE UNIQUE INDEX "lead_sla_cycles_workspaceId_id_key" ON "lead_sla_cycles"("workspaceId", "id");
CREATE UNIQUE INDEX "lead_sla_cycles_workspaceId_submissionId_key" ON "lead_sla_cycles"("workspaceId", "submissionId");

CREATE INDEX "lead_assignments_workspaceId_leadId_assignedAt_idx" ON "lead_assignments"("workspaceId", "leadId", "assignedAt");
CREATE INDEX "lead_assignments_workspaceId_toMemberId_assignedAt_idx" ON "lead_assignments"("workspaceId", "toMemberId", "assignedAt");
CREATE INDEX "lead_assignments_workspaceId_toQueueId_assignedAt_idx" ON "lead_assignments"("workspaceId", "toQueueId", "assignedAt");
CREATE UNIQUE INDEX "lead_assignments_workspaceId_id_key" ON "lead_assignments"("workspaceId", "id");

CREATE INDEX "operational_alerts_workspaceId_status_createdAt_idx" ON "operational_alerts"("workspaceId", "status", "createdAt");
CREATE INDEX "operational_alerts_workspaceId_queueId_status_createdAt_idx" ON "operational_alerts"("workspaceId", "queueId", "status", "createdAt");
CREATE INDEX "operational_alerts_workspaceId_leadId_status_createdAt_idx" ON "operational_alerts"("workspaceId", "leadId", "status", "createdAt");
CREATE UNIQUE INDEX "operational_alerts_workspaceId_id_key" ON "operational_alerts"("workspaceId", "id");
CREATE UNIQUE INDEX "operational_alerts_one_open_per_lead_type" ON "operational_alerts"("workspaceId", "leadId", "type") WHERE "status" = 'OPEN';

CREATE INDEX "leads_workspaceId_routingQueueId_status_deletedAt_idx" ON "leads"("workspaceId", "routingQueueId", "status", "deletedAt");
CREATE UNIQUE INDEX "tasks_slaCycleId_key" ON "tasks"("slaCycleId");
CREATE INDEX "tasks_workspaceId_kind_status_dueAt_idx" ON "tasks"("workspaceId", "kind", "status", "dueAt");
CREATE UNIQUE INDEX "tasks_workspaceId_slaCycleId_key" ON "tasks"("workspaceId", "slaCycleId");
CREATE UNIQUE INDEX "team_members_workspaceId_id_key" ON "team_members"("workspaceId", "id");
CREATE INDEX "workspace_members_workspaceId_status_leadReceivingPausedAt__idx" ON "workspace_members"("workspaceId", "status", "leadReceivingPausedAt", "deletedAt");

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_leadReceivingPausedByActorId_fkey" FOREIGN KEY ("workspaceId", "leadReceivingPausedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_routingQueueId_fkey" FOREIGN KEY ("workspaceId", "routingQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "round_robin_states" ADD CONSTRAINT "round_robin_states_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "round_robin_states" ADD CONSTRAINT "round_robin_states_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "round_robin_states" ADD CONSTRAINT "round_robin_states_workspaceId_lastAssignedTeamMemberId_fkey" FOREIGN KEY ("workspaceId", "lastAssignedTeamMemberId") REFERENCES "team_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "round_robin_states" ADD CONSTRAINT "round_robin_states_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_submissionId_fkey" FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_priorityBandId_fkey" FOREIGN KEY ("workspaceId", "priorityBandId") REFERENCES "lead_priority_bands"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_assignedMemberId_fkey" FOREIGN KEY ("workspaceId", "assignedMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_assignedQueueId_fkey" FOREIGN KEY ("workspaceId", "assignedQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_fromMemberId_fkey" FOREIGN KEY ("workspaceId", "fromMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_fromQueueId_fkey" FOREIGN KEY ("workspaceId", "fromQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_toMemberId_fkey" FOREIGN KEY ("workspaceId", "toMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_toQueueId_fkey" FOREIGN KEY ("workspaceId", "toQueueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_workspaceId_queueId_fkey" FOREIGN KEY ("workspaceId", "queueId") REFERENCES "queues"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_workspaceId_resolvedByActorId_fkey" FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_slaCycleId_fkey" FOREIGN KEY ("workspaceId", "slaCycleId") REFERENCES "lead_sla_cycles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_receiving_pause_complete_check"
  CHECK (("leadReceivingPausedAt" IS NULL AND "leadReceivingPauseReason" IS NULL AND "leadReceivingPausedByActorId" IS NULL)
    OR ("leadReceivingPausedAt" IS NOT NULL AND length(trim("leadReceivingPauseReason")) > 0 AND "leadReceivingPausedByActorId" IS NOT NULL));
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_owner_xor_check"
  CHECK (("assignedMemberId" IS NOT NULL AND "assignedQueueId" IS NULL) OR ("assignedMemberId" IS NULL AND "assignedQueueId" IS NOT NULL));
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_time_order_check"
  CHECK ("assignedAt" >= "receivedAt" AND "automaticAcknowledgedAt" >= "receivedAt" AND
    ("firstHumanAttemptAt" IS NULL OR "firstHumanAttemptAt" >= "receivedAt") AND
    ("firstConnectedAt" IS NULL OR ("firstConnectedAt" >= "receivedAt" AND ("firstHumanAttemptAt" IS NULL OR "firstConnectedAt" >= "firstHumanAttemptAt"))));
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_attempt_seconds_check"
  CHECK (("firstHumanAttemptAt" IS NULL AND "firstHumanAttemptSeconds" IS NULL) OR
    ("firstHumanAttemptAt" IS NOT NULL AND "firstHumanAttemptSeconds" = floor(extract(epoch FROM ("firstHumanAttemptAt" - "receivedAt")))::integer AND "firstHumanAttemptSeconds" >= 0));
ALTER TABLE "lead_sla_cycles" ADD CONSTRAINT "lead_sla_cycles_response_seconds_check"
  CHECK (("firstConnectedAt" IS NULL AND "firstResponseTimeSeconds" IS NULL) OR
    ("firstConnectedAt" IS NOT NULL AND "firstResponseTimeSeconds" = floor(extract(epoch FROM ("firstConnectedAt" - "receivedAt")))::integer AND "firstResponseTimeSeconds" >= 0));
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_from_owner_check"
  CHECK (NOT ("fromMemberId" IS NOT NULL AND "fromQueueId" IS NOT NULL));
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_to_owner_xor_check"
  CHECK (("toMemberId" IS NOT NULL AND "toQueueId" IS NULL) OR ("toMemberId" IS NULL AND "toQueueId" IS NOT NULL));
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_resolution_check"
  CHECK (("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedByActorId" IS NULL) OR
    ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedByActorId" IS NOT NULL));

CREATE OR REPLACE FUNCTION prevent_lead_assignment_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lead_assignments is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_assignments_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON "lead_assignments"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_lead_assignment_history_mutation();

-- A fila usada pela CRM-05 passa a ser também a fila de roteamento persistida.
UPDATE "leads" SET "routingQueueId" = "queueId" WHERE "routingQueueId" IS NULL AND "queueId" IS NOT NULL;

-- Ajuste estritamente limitado ao seed local conhecido; configurações de outros workspaces não são sobrescritas.
UPDATE "sla_policies" AS policy
SET "name" = 'SLA imediato — 0 minutos',
    "firstResponseMinutes" = 0,
    "warningMinutesBeforeDue" = 0,
    "healthyMaxSeconds" = 60,
    "attentionMaxSeconds" = 180,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "workspaces" AS workspace
WHERE policy."workspaceId" = workspace."id"
  AND workspace."slug" = 'politizai'
  AND policy."key" IN ('p1-immediate', 'p2-priority', 'p3-standard')
  AND policy."deletedAt" IS NULL;

COMMIT;
