-- CRM-22: cinco automações de entrada, correlação tipada e mensagens simuladas.

BEGIN;

ALTER TYPE "OperationalAlertType" ADD VALUE IF NOT EXISTS 'P1_PRIORITY';
ALTER TYPE "OperationalAlertType" ADD VALUE IF NOT EXISTS 'SLA_ATTENTION';
ALTER TYPE "OperationalAlertType" ADD VALUE IF NOT EXISTS 'SLA_CRITICAL';
ALTER TYPE "AutomationActionType" ADD VALUE IF NOT EXISTS 'APPLY_ENTRY_AUTOMATION';

ALTER TABLE "automation_rules"
  ADD COLUMN "key" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "isPredefined" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "automation_rules_workspaceId_key_key"
  ON "automation_rules"("workspaceId", "key");

ALTER TABLE "automation_runs"
  ADD COLUMN "leadId" UUID;

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_lead_fkey"
    FOREIGN KEY ("workspaceId", "leadId")
    REFERENCES "leads"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "automation_runs_workspaceId_leadId_status_triggeredAt_idx"
  ON "automation_runs"("workspaceId", "leadId", "status", "triggeredAt");

ALTER TABLE "messages"
  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "simulationLabel" TEXT,
  ADD CONSTRAINT "messages_simulation_label_check" CHECK (
    ("isSimulated" = true AND "simulationLabel" IS NOT NULL)
    OR ("isSimulated" = false AND "simulationLabel" IS NULL)
  );

COMMIT;
