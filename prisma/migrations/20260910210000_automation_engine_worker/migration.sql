-- CRM-21: motor local de automações, execução idempotente e worker recuperável.

BEGIN;

ALTER TABLE "automation_rules"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "automation_rules_version_check" CHECK ("version" > 0);

ALTER TABLE "automation_runs"
  ADD COLUMN "ruleVersion" INTEGER,
  ADD COLUMN "triggerType" "AutomationTriggerType",
  ADD COLUMN "actionType" "AutomationActionType",
  ADD COLUMN "conditionsSnapshot" JSONB,
  ADD COLUMN "actionConfigSnapshot" JSONB,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3);

UPDATE "automation_runs" run
SET
  "ruleVersion" = rule."version",
  "triggerType" = rule."triggerType",
  "actionType" = rule."actionType",
  "conditionsSnapshot" = rule."conditions",
  "actionConfigSnapshot" = rule."actionConfig"
FROM "automation_rules" rule
WHERE rule."workspaceId" = run."workspaceId"
  AND rule."id" = run."automationRuleId";

ALTER TABLE "automation_runs"
  DROP CONSTRAINT "automation_runs_time_order_check",
  ALTER COLUMN "ruleVersion" SET NOT NULL,
  ALTER COLUMN "triggerType" SET NOT NULL,
  ALTER COLUMN "actionType" SET NOT NULL,
  ALTER COLUMN "conditionsSnapshot" SET NOT NULL,
  ALTER COLUMN "actionConfigSnapshot" SET NOT NULL,
  ADD CONSTRAINT "automation_runs_time_order_check" CHECK (
    ("startedAt" IS NULL OR "startedAt" >= "triggeredAt")
    AND (
      "finishedAt" IS NULL
      OR (
        ("startedAt" IS NOT NULL OR "cancelledAt" IS NOT NULL)
        AND "finishedAt" >= COALESCE("startedAt", "triggeredAt")
      )
    )
  ),
  ADD CONSTRAINT "automation_runs_rule_version_check" CHECK ("ruleVersion" > 0),
  ADD CONSTRAINT "automation_runs_terminal_time_check" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "finishedAt" IS NOT NULL)
    OR ("status" IN ('SUCCEEDED', 'FAILED') AND "finishedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" IN ('PENDING', 'RUNNING') AND "finishedAt" IS NULL AND "cancelledAt" IS NULL)
  );

ALTER TABLE "jobs"
  ADD COLUMN "automationRunId" UUID,
  ADD COLUMN "lockExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "lastAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelRequestedAt" TIMESTAMPTZ(3);

UPDATE "jobs"
SET "lockExpiresAt" = "lockedAt" + INTERVAL '5 minutes'
WHERE "status" = 'RUNNING' AND "lockedAt" IS NOT NULL;

UPDATE "jobs"
SET "lockedAt" = NULL, "lockedBy" = NULL, "lockExpiresAt" = NULL
WHERE "status" <> 'RUNNING';

ALTER TABLE "jobs"
  DROP CONSTRAINT "jobs_attempts_check",
  ADD CONSTRAINT "jobs_attempts_check" CHECK (
    "attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 25 AND "attempts" <= "maxAttempts"
  ),
  ADD CONSTRAINT "jobs_lock_state_check" CHECK (
    ("status" = 'RUNNING' AND "lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL AND "lockExpiresAt" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "lockedAt" IS NULL AND "lockedBy" IS NULL AND "lockExpiresAt" IS NULL)
  ),
  ADD CONSTRAINT "jobs_terminal_time_check" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "finishedAt" IS NOT NULL)
    OR ("status" IN ('SUCCEEDED', 'FAILED') AND "finishedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" IN ('PENDING', 'RUNNING') AND "finishedAt" IS NULL AND "cancelledAt" IS NULL)
  ),
  ADD CONSTRAINT "jobs_automation_run_fkey"
    FOREIGN KEY ("workspaceId", "automationRunId")
    REFERENCES "automation_runs"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "jobs_workspaceId_automationRunId_key"
  ON "jobs"("workspaceId", "automationRunId");
CREATE INDEX "jobs_type_status_runAt_priority_idx"
  ON "jobs"("type", "status", "runAt", "priority" DESC);
DROP INDEX "jobs_workspaceId_lockedAt_idx";
CREATE INDEX "jobs_workspaceId_lockedAt_lockExpiresAt_idx"
  ON "jobs"("workspaceId", "lockedAt", "lockExpiresAt");

CREATE TABLE "automation_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "automationRunId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "workerId" TEXT NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3),
  "outputPayload" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_attempts_number_check" CHECK ("attemptNumber" > 0),
  CONSTRAINT "automation_attempts_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "automation_attempts_time_check" CHECK (
    ("status" = 'RUNNING' AND "finishedAt" IS NULL)
    OR ("status" <> 'RUNNING' AND "finishedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "automation_attempts_workspaceId_id_key"
  ON "automation_attempts"("workspaceId", "id");
CREATE UNIQUE INDEX "automation_attempts_workspaceId_jobId_attemptNumber_key"
  ON "automation_attempts"("workspaceId", "jobId", "attemptNumber");
CREATE INDEX "automation_attempts_workspaceId_automationRunId_attemptNumber_idx"
  ON "automation_attempts"("workspaceId", "automationRunId", "attemptNumber");
CREATE INDEX "automation_attempts_workspaceId_status_startedAt_idx"
  ON "automation_attempts"("workspaceId", "status", "startedAt");

ALTER TABLE "automation_attempts"
  ADD CONSTRAINT "automation_attempts_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_attempts_run_fkey"
    FOREIGN KEY ("workspaceId", "automationRunId")
    REFERENCES "automation_runs"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_attempts_job_fkey"
    FOREIGN KEY ("workspaceId", "jobId") REFERENCES "jobs"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "automation_effects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "automationRunId" UUID NOT NULL,
  "attemptId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actionType" "AutomationActionType" NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "inputPayload" JSONB NOT NULL,
  "outputPayload" JSONB,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_effects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_effects_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED')),
  CONSTRAINT "automation_effects_time_check" CHECK (
    ("status" = 'RUNNING' AND "finishedAt" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "finishedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "automation_effects_workspaceId_id_key"
  ON "automation_effects"("workspaceId", "id");
CREATE UNIQUE INDEX "automation_effects_workspaceId_idempotencyKey_key"
  ON "automation_effects"("workspaceId", "idempotencyKey");
CREATE INDEX "automation_effects_workspaceId_automationRunId_status_createdAt_idx"
  ON "automation_effects"("workspaceId", "automationRunId", "status", "createdAt");

ALTER TABLE "automation_effects"
  ADD CONSTRAINT "automation_effects_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_effects_run_fkey"
    FOREIGN KEY ("workspaceId", "automationRunId")
    REFERENCES "automation_runs"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_effects_attempt_fkey"
    FOREIGN KEY ("workspaceId", "attemptId")
    REFERENCES "automation_attempts"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_automation_execution_history_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'automation execution history cannot be deleted'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "automation_attempts_no_delete_trigger"
  BEFORE DELETE ON "automation_attempts"
  FOR EACH ROW EXECUTE FUNCTION prevent_automation_execution_history_delete();
CREATE TRIGGER "automation_attempts_no_truncate_trigger"
  BEFORE TRUNCATE ON "automation_attempts"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_automation_execution_history_delete();
CREATE TRIGGER "automation_effects_no_delete_trigger"
  BEFORE DELETE ON "automation_effects"
  FOR EACH ROW EXECUTE FUNCTION prevent_automation_execution_history_delete();
CREATE TRIGGER "automation_effects_no_truncate_trigger"
  BEFORE TRUNCATE ON "automation_effects"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_automation_execution_history_delete();

COMMIT;
