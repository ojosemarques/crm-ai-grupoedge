ALTER TYPE "IntegrationConnectionStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';
ALTER TYPE "IntegrationConnectionStatus" ADD VALUE IF NOT EXISTS 'SYNCING';
ALTER TYPE "IntegrationConnectionStatus" ADD VALUE IF NOT EXISTS 'STALE';
ALTER TYPE "IntegrationConnectionStatus" ADD VALUE IF NOT EXISTS 'NEEDS_ATTENTION';

ALTER TYPE "IntegrationErrorClass" ADD VALUE IF NOT EXISTS 'PERMISSION';
ALTER TYPE "IntegrationErrorClass" ADD VALUE IF NOT EXISTS 'ACCOUNT_INACCESSIBLE';
ALTER TYPE "IntegrationErrorClass" ADD VALUE IF NOT EXISTS 'INVALID_PAYLOAD';
ALTER TYPE "IntegrationErrorClass" ADD VALUE IF NOT EXISTS 'INTERNAL';

ALTER TYPE "IntegrationInternalEntityType" ADD VALUE IF NOT EXISTS 'MARKETING_AD_ACCOUNT';
ALTER TYPE "IntegrationInternalEntityType" ADD VALUE IF NOT EXISTS 'MARKETING_CAMPAIGN';
ALTER TYPE "IntegrationInternalEntityType" ADD VALUE IF NOT EXISTS 'MARKETING_AD_GROUP';
ALTER TYPE "IntegrationInternalEntityType" ADD VALUE IF NOT EXISTS 'MARKETING_AD';
ALTER TYPE "IntegrationInternalEntityType" ADD VALUE IF NOT EXISTS 'MARKETING_CREATIVE';

CREATE TYPE "MarketingProviderActionClassification" AS ENUM ('RECOGNIZED', 'UNKNOWN');

ALTER TABLE "marketing_performance_facts"
  ALTER COLUMN "importRunId" DROP NOT NULL,
  ADD COLUMN "integrationSyncRunId" UUID,
  ADD COLUMN "sourceProvider" TEXT NOT NULL DEFAULT 'LOCAL_CSV',
  ADD COLUMN "providerApiVersion" TEXT,
  ADD COLUMN "providerExternalId" TEXT,
  ADD COLUMN "availableMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "missingMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "collectedAt" TIMESTAMPTZ(3);

CREATE TABLE "marketing_provider_action_facts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "performanceFactId" UUID NOT NULL,
  "actionType" TEXT NOT NULL,
  "classification" "MarketingProviderActionClassification" NOT NULL,
  "value" BIGINT NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_provider_action_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_provider_action_facts_workspaceId_id_key"
  ON "marketing_provider_action_facts"("workspaceId", "id");
CREATE UNIQUE INDEX "marketing_provider_action_facts_workspaceId_fact_action_key"
  ON "marketing_provider_action_facts"("workspaceId", "performanceFactId", "actionType");
CREATE INDEX "marketing_provider_action_facts_workspace_classification_idx"
  ON "marketing_provider_action_facts"("workspaceId", "classification", "actionType");
CREATE INDEX "marketing_performance_facts_workspace_sync_run_idx"
  ON "marketing_performance_facts"("workspaceId", "integrationSyncRunId");
CREATE INDEX "marketing_performance_facts_workspace_provider_period_idx"
  ON "marketing_performance_facts"("workspaceId", "sourceProvider", "periodStart");

ALTER TABLE "marketing_performance_facts"
  ADD CONSTRAINT "marketing_performance_facts_workspace_sync_run_fkey"
  FOREIGN KEY ("workspaceId", "integrationSyncRunId")
  REFERENCES "integration_sync_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "marketing_provider_action_facts"
  ADD CONSTRAINT "marketing_provider_action_facts_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_provider_action_facts"
  ADD CONSTRAINT "marketing_provider_action_facts_workspace_fact_fkey"
  FOREIGN KEY ("workspaceId", "performanceFactId")
  REFERENCES "marketing_performance_facts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
