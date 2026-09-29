-- CRM-08: histórico operacional, tarefas e próxima ação confiável.

BEGIN;

ALTER TYPE "ActivityType" ADD VALUE 'CALL_CONNECTED';
ALTER TYPE "ActivityType" ADD VALUE 'CALL_UNANSWERED';
ALTER TYPE "ActivityType" ADD VALUE 'MESSAGE_SENT';
ALTER TYPE "ActivityType" ADD VALUE 'MESSAGE_RECEIVED';
ALTER TYPE "ActivityType" ADD VALUE 'AUDIO';
ALTER TYPE "ActivityType" ADD VALUE 'RESPONSIBLE_CHANGE';
ALTER TYPE "ActivityType" ADD VALUE 'AUTOMATION';
ALTER TYPE "ActivityType" ADD VALUE 'AI_ACTION';
ALTER TYPE "ActivityType" ADD VALUE 'PROPOSAL';
ALTER TYPE "ActivityType" ADD VALUE 'WON';
ALTER TYPE "ActivityType" ADD VALUE 'LOST';

CREATE TYPE "ActivityResult" AS ENUM (
  'CONNECTED',
  'NOT_CONNECTED',
  'SENT',
  'RECEIVED',
  'COMPLETED',
  'CANCELLED',
  'SCHEDULED',
  'NO_SHOW',
  'WON',
  'LOST',
  'INFORMATION',
  'CORRECTED',
  'OTHER'
);

ALTER TYPE "TaskKind" ADD VALUE 'CALL';
ALTER TYPE "TaskKind" ADD VALUE 'MESSAGE';
ALTER TYPE "TaskKind" ADD VALUE 'EMAIL';
ALTER TYPE "TaskKind" ADD VALUE 'MEETING';
ALTER TYPE "TaskKind" ADD VALUE 'FOLLOW_UP';

ALTER TABLE "activities"
  ADD COLUMN "result" "ActivityResult",
  ADD COLUMN "nextActionAt" TIMESTAMPTZ(3),
  ADD COLUMN "nextActionDescription" TEXT,
  ADD COLUMN "previousValues" JSONB,
  ADD COLUMN "newValues" JSONB,
  ADD COLUMN "correctsActivityId" UUID;

ALTER TABLE "tasks" ADD COLUMN "result" TEXT;

ALTER TABLE "leads"
  ADD COLUMN "lastInboundResponseAt" TIMESTAMPTZ(3),
  ADD COLUMN "awaitingHumanResponse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextActionTaskId" UUID,
  ALTER COLUMN "nextActionAt" DROP NOT NULL,
  ALTER COLUMN "nextActionDescription" DROP NOT NULL;

-- Vincula a projeção herdada à tarefa ativa que já representava a próxima ação.
WITH ranked_tasks AS (
  SELECT task."workspaceId", task."leadId", task."id", task."dueAt", task."title",
         row_number() OVER (
           PARTITION BY task."workspaceId", task."leadId"
           ORDER BY task."dueAt" ASC, task."createdAt" ASC, task."id" ASC
         ) AS position
  FROM "tasks" AS task
  WHERE task."status" IN ('OPEN', 'IN_PROGRESS')
    AND task."deletedAt" IS NULL
)
UPDATE "leads" AS lead
SET "nextActionTaskId" = candidate."id",
    "nextActionAt" = candidate."dueAt",
    "nextActionDescription" = candidate."title"
FROM ranked_tasks AS candidate
WHERE candidate."workspaceId" = lead."workspaceId"
  AND candidate."leadId" = lead."id"
  AND candidate.position = 1;

UPDATE "leads" AS lead
SET "nextActionAt" = NULL,
    "nextActionDescription" = NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM "tasks" AS task
  WHERE task."workspaceId" = lead."workspaceId"
    AND task."leadId" = lead."id"
    AND task."status" IN ('OPEN', 'IN_PROGRESS')
    AND task."deletedAt" IS NULL
);

-- Registros concluídos pela CRM-06 ganham resultado explícito sem mudar o fato.
UPDATE "tasks"
SET "result" = 'Primeira tentativa humana registrada.'
WHERE "status" = 'COMPLETED' AND "result" IS NULL;

CREATE UNIQUE INDEX "tasks_workspaceId_leadId_id_key"
  ON "tasks"("workspaceId", "leadId", "id");
CREATE INDEX "activities_workspaceId_result_occurredAt_idx"
  ON "activities"("workspaceId", "result", "occurredAt");
CREATE INDEX "activities_workspaceId_correctsActivityId_idx"
  ON "activities"("workspaceId", "correctsActivityId");
CREATE INDEX "leads_workspaceId_awaitingHumanResponse_lastInboundResp_idx"
  ON "leads"("workspaceId", "awaitingHumanResponse", "lastInboundResponseAt");
CREATE INDEX "leads_workspaceId_nextActionTaskId_idx"
  ON "leads"("workspaceId", "nextActionTaskId");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_workspaceId_correctsActivityId_fkey"
  FOREIGN KEY ("workspaceId", "correctsActivityId")
  REFERENCES "activities"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_workspaceId_id_nextActionTaskId_fkey"
  FOREIGN KEY ("workspaceId", "id", "nextActionTaskId")
  REFERENCES "tasks"("workspaceId", "leadId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activities" ADD CONSTRAINT "activities_next_action_pair_check"
  CHECK (
    ("nextActionAt" IS NULL AND "nextActionDescription" IS NULL)
    OR
    ("nextActionAt" IS NOT NULL AND length(trim("nextActionDescription")) > 0)
  );

ALTER TABLE "activities" ADD CONSTRAINT "activities_correction_not_self_check"
  CHECK ("correctsActivityId" IS NULL OR "correctsActivityId" <> "id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completion_result_check"
  CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND length(trim("result")) > 0)
    OR
    ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  );

ALTER TABLE "leads" ADD CONSTRAINT "leads_next_action_projection_check"
  CHECK (
    ("nextActionTaskId" IS NULL AND "nextActionAt" IS NULL AND "nextActionDescription" IS NULL)
    OR
    ("nextActionTaskId" IS NOT NULL AND "nextActionAt" IS NOT NULL AND length(trim("nextActionDescription")) > 0)
  );

CREATE OR REPLACE FUNCTION prevent_activity_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activities is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "activities_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "activities"
  FOR EACH ROW EXECUTE FUNCTION prevent_activity_history_mutation();

CREATE TRIGGER "activities_no_truncate_trigger"
  BEFORE TRUNCATE ON "activities"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_activity_history_mutation();

COMMIT;
