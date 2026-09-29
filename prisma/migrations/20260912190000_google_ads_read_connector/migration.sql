-- CRM-41: Google Ads read-only account hierarchy and exact provider metrics.

CREATE TABLE "integration_external_account_links" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "parentExternalCustomerId" TEXT NOT NULL,
  "childExternalCustomerId" TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "manager" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "discoveredAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "integration_external_account_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_external_account_links_workspaceId_id_key"
  ON "integration_external_account_links"("workspaceId", "id");
CREATE UNIQUE INDEX "integration_external_account_links_identity_key"
  ON "integration_external_account_links"("workspaceId", "connectionId", "parentExternalCustomerId", "childExternalCustomerId");
CREATE INDEX "integration_external_account_links_lookup_idx"
  ON "integration_external_account_links"("workspaceId", "connectionId", "manager", "status");

ALTER TABLE "integration_external_account_links"
  ADD CONSTRAINT "integration_external_account_links_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_external_account_links"
  ADD CONSTRAINT "integration_external_account_links_connection_fkey"
  FOREIGN KEY ("workspaceId", "connectionId") REFERENCES "integration_connections"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_external_account_links"
  ADD CONSTRAINT "integration_external_account_links_customer_id_check"
  CHECK ("parentExternalCustomerId" ~ '^[0-9]{10}$' AND "childExternalCustomerId" ~ '^[0-9]{10}$' AND "level" >= 0);

ALTER TABLE "marketing_performance_facts"
  ADD COLUMN "sourceCostMicros" BIGINT,
  ADD COLUMN "providerInteractions" BIGINT,
  ADD COLUMN "providerConversionsMicros" BIGINT,
  ADD COLUMN "providerConversionsValueMicros" BIGINT,
  ADD COLUMN "providerAllConversionsMicros" BIGINT,
  ADD COLUMN "providerAllConversionsValueMicros" BIGINT,
  ADD COLUMN "providerCtrMicros" BIGINT,
  ADD COLUMN "providerAverageCpcMicros" BIGINT,
  ADD COLUMN "providerAverageCpmMicros" BIGINT,
  ADD COLUMN "queryTemplateVersion" TEXT,
  ADD COLUMN "providerRequestId" TEXT;

CREATE INDEX "marketing_performance_facts_google_provider_idx"
  ON "marketing_performance_facts"("workspaceId", "sourceProvider", "providerExternalId", "periodStart");
