ALTER TABLE "automation_rules"
  ADD COLUMN "draftDefinition" JSONB,
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "publishedVersionId" UUID;

CREATE TABLE "automation_rule_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "automationRuleId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "graphDefinition" JSONB NOT NULL,
  "graphHash" TEXT NOT NULL,
  "validationSnapshot" JSONB NOT NULL,
  "rollbackOfVersionId" UUID,
  "publishedByActorId" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_rule_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "automation_rule_versions_schema_check" CHECK ("graphDefinition"->>'schema' = 'automation.graph/v1')
);
CREATE UNIQUE INDEX "automation_rule_versions_workspaceId_id_key" ON "automation_rule_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "automation_rule_versions_workspaceId_rule_version_key" ON "automation_rule_versions"("workspaceId", "automationRuleId", "version");
CREATE INDEX "automation_rule_versions_workspaceId_rule_published_idx" ON "automation_rule_versions"("workspaceId", "automationRuleId", "publishedAt");

ALTER TABLE "automation_rule_versions"
  ADD CONSTRAINT "automation_rule_versions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_rule_versions_rule_fkey" FOREIGN KEY ("workspaceId", "automationRuleId") REFERENCES "automation_rules"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_rule_versions_rollback_fkey" FOREIGN KEY ("workspaceId", "rollbackOfVersionId") REFERENCES "automation_rule_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_rule_versions_actor_fkey" FOREIGN KEY ("workspaceId", "publishedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_published_version_fkey" FOREIGN KEY ("workspaceId", "publishedVersionId") REFERENCES "automation_rule_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_runs"
  ADD COLUMN "automationRuleVersionId" UUID,
  ADD COLUMN "graphSnapshot" JSONB,
  ADD COLUMN "currentNodeId" TEXT,
  ADD COLUMN "executionPolicy" TEXT NOT NULL DEFAULT 'LEGACY_SINGLE_ACTION';
ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_version_fkey" FOREIGN KEY ("workspaceId", "automationRuleVersionId") REFERENCES "automation_rule_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "automation_runs_workspaceId_version_status_idx" ON "automation_runs"("workspaceId", "automationRuleVersionId", "status");

CREATE TABLE "automation_node_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "automationRunId" UUID NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeType" TEXT NOT NULL,
  "visit" INTEGER NOT NULL DEFAULT 1,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "idempotencyKey" TEXT NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "outputSnapshot" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_node_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_node_runs_visit_check" CHECK ("visit" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "automation_node_runs_workspaceId_id_key" ON "automation_node_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "automation_node_runs_workspaceId_idempotencyKey_key" ON "automation_node_runs"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "automation_node_runs_workspaceId_run_node_visit_key" ON "automation_node_runs"("workspaceId", "automationRunId", "nodeId", "visit");
CREATE INDEX "automation_node_runs_workspaceId_run_status_started_idx" ON "automation_node_runs"("workspaceId", "automationRunId", "status", "startedAt");
ALTER TABLE "automation_node_runs"
  ADD CONSTRAINT "automation_node_runs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_node_runs_run_fkey" FOREIGN KEY ("workspaceId", "automationRunId") REFERENCES "automation_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_automation_rule_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'automation rule versions are immutable';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog;
CREATE TRIGGER automation_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON "automation_rule_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_automation_rule_version_mutation();
