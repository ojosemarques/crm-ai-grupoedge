CREATE TYPE "TaskContext" AS ENUM ('COMMERCIAL', 'POST_SALE');
CREATE TYPE "CommissionTrigger" AS ENUM ('SALE', 'RECEIPT');

ALTER TABLE "tasks"
  ADD COLUMN "context" "TaskContext" NOT NULL DEFAULT 'COMMERCIAL',
  ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "tasks_workspaceId_sourceKey_key"
  ON "tasks"("workspaceId", "sourceKey");
CREATE INDEX "tasks_workspaceId_context_status_dueAt_idx"
  ON "tasks"("workspaceId", "context", "status", "dueAt");

ALTER TABLE "commission_rules"
  ADD COLUMN "trigger" "CommissionTrigger" NOT NULL DEFAULT 'SALE';

ALTER TABLE "commissions"
  ADD COLUMN "paymentId" UUID;

DROP INDEX "commissions_workspace_opportunity_rule_key";

CREATE UNIQUE INDEX "commissions_sale_rule_key"
  ON "commissions"("workspaceId", "opportunityId", "ruleId")
  WHERE "paymentId" IS NULL;

CREATE UNIQUE INDEX "commissions_workspaceId_ruleId_paymentId_key"
  ON "commissions"("workspaceId", "ruleId", "paymentId");
CREATE INDEX "commissions_workspaceId_opportunityId_ruleId_idx"
  ON "commissions"("workspaceId", "opportunityId", "ruleId");

ALTER TABLE "commissions"
  ADD CONSTRAINT "commissions_workspaceId_paymentId_fkey"
  FOREIGN KEY ("workspaceId", "paymentId")
  REFERENCES "payments"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
