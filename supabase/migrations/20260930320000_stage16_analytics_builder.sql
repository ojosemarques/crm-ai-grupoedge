CREATE TYPE "AnalyticsWidgetType" AS ENUM ('LINE', 'AREA', 'BAR', 'PIE', 'DONUT', 'FUNNEL', 'TABLE', 'NUMBER', 'KPI');
CREATE TYPE "AnalyticsAggregation" AS ENUM ('SUM', 'AVERAGE', 'COUNT', 'RATE', 'LATEST');

CREATE TABLE "analytics_dashboards" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '', "revision" INTEGER NOT NULL DEFAULT 1, "creationKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL, "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "analytics_dashboards_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_dashboards_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_dashboards_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_dashboards_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "analytics_dashboards_creationKey_check" CHECK (char_length("creationKey") BETWEEN 8 AND 160)
);
CREATE UNIQUE INDEX "analytics_dashboards_workspaceId_id_key" ON "analytics_dashboards"("workspaceId", "id");
CREATE UNIQUE INDEX "analytics_dashboards_workspaceId_creationKey_key" ON "analytics_dashboards"("workspaceId", "creationKey");
CREATE INDEX "analytics_dashboards_workspaceId_archivedAt_updatedAt_idx" ON "analytics_dashboards"("workspaceId", "archivedAt", "updatedAt");

CREATE TABLE "analytics_widgets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "dashboardId" UUID NOT NULL,
  "title" TEXT NOT NULL, "metricId" TEXT NOT NULL, "metricVersion" INTEGER NOT NULL,
  "visualization" "AnalyticsWidgetType" NOT NULL, "aggregation" "AnalyticsAggregation" NOT NULL,
  "periodPreset" TEXT NOT NULL, "fromDate" TEXT, "toDate" TEXT, "asOf" TIMESTAMPTZ(3),
  "dateField" TEXT NOT NULL, "dimension" TEXT, "filters" JSONB NOT NULL DEFAULT '{}', "position" JSONB NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 1, "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "deletedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "analytics_widgets_workspaceId_dashboardId_fkey" FOREIGN KEY ("workspaceId", "dashboardId") REFERENCES "analytics_dashboards"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_widgets_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_widgets_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_widgets_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "analytics_widgets_metricId_check" CHECK (char_length("metricId") BETWEEN 3 AND 100),
  CONSTRAINT "analytics_widgets_periodPreset_check" CHECK ("periodPreset" IN ('TODAY', 'YESTERDAY', 'WEEK', 'MONTH', 'CUSTOM')),
  CONSTRAINT "analytics_widgets_custom_period_check" CHECK (("periodPreset" = 'CUSTOM' AND "fromDate" IS NOT NULL AND "toDate" IS NOT NULL AND "fromDate" <= "toDate") OR ("periodPreset" <> 'CUSTOM' AND "fromDate" IS NULL AND "toDate" IS NULL)),
  CONSTRAINT "analytics_widgets_dimension_check" CHECK ("dimension" IS NULL OR char_length("dimension") BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "analytics_widgets_workspaceId_id_key" ON "analytics_widgets"("workspaceId", "id");
CREATE INDEX "analytics_widgets_workspaceId_dashboardId_deletedAt_idx" ON "analytics_widgets"("workspaceId", "dashboardId", "deletedAt");
CREATE INDEX "analytics_widgets_workspaceId_metricId_idx" ON "analytics_widgets"("workspaceId", "metricId");

CREATE TABLE "analytics_mutation_receipts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "operation" TEXT NOT NULL, "entityId" UUID NOT NULL, "response" JSONB NOT NULL, "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_mutation_receipts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "analytics_mutation_receipts_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_mutation_receipts_workspaceId_idempotencyKey_key" ON "analytics_mutation_receipts"("workspaceId", "idempotencyKey");
CREATE INDEX "analytics_mutation_receipts_workspaceId_entityId_createdAt_idx" ON "analytics_mutation_receipts"("workspaceId", "entityId", "createdAt");

ALTER TABLE "analytics_dashboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_widgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_mutation_receipts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "analytics_dashboards", "analytics_widgets", "analytics_mutation_receipts" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE "analytics_dashboards", "analytics_widgets", "analytics_mutation_receipts" TO service_role;
