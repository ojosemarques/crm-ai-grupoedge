-- CRM-62: observabilidade, segurança e privacidade operacional.
-- Estritamente aditiva: nenhum dado comercial é removido ou reescrito.

CREATE TYPE "TelemetryKind" AS ENUM ('LOG', 'METRIC', 'TRACE', 'SECURITY');
CREATE TYPE "TelemetryOutcome" AS ENUM ('SUCCESS', 'ERROR', 'DENIED', 'BLOCKED');
CREATE TYPE "SloMetricDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');
CREATE TYPE "ObservabilityAlertSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "ObservabilityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED');
CREATE TYPE "IncidentEventKind" AS ENUM ('CREATED', 'ACKNOWLEDGED', 'STATUS_CHANGED', 'NOTE_ADDED', 'RESOLVED');
CREATE TYPE "DataSubjectRequestEventKind" AS ENUM ('CREATED', 'IDENTITY_VERIFIED', 'STATUS_CHANGED', 'REVIEW_RECORDED', 'EXPORT_GENERATED', 'CORRECTION_RECORDED', 'RESTRICTION_RECORDED', 'DESTRUCTION_PREVIEWED', 'COMPLETED');
ALTER TYPE "DataSubjectRequestType" ADD VALUE IF NOT EXISTS 'RESTRICTION';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'PRIVACY_RETENTION_CHECKPOINT';

ALTER TABLE "data_subject_requests" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "data_subject_requests_workspaceId_idempotencyKey_key" ON "data_subject_requests"("workspaceId", "idempotencyKey");

CREATE TABLE "telemetry_records" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "contractVersion" TEXT NOT NULL DEFAULT 'telemetry.v1',
  "kind" "TelemetryKind" NOT NULL,
  "operation" TEXT NOT NULL,
  "outcome" "TelemetryOutcome" NOT NULL,
  "durationMs" INTEGER,
  "value" DECIMAL(18,6),
  "unit" TEXT,
  "correlationId" TEXT NOT NULL,
  "requestId" TEXT,
  "jobId" UUID,
  "outboxEventId" UUID,
  "actorId" UUID,
  "labels" JSONB NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telemetry_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "telemetry_duration_non_negative" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);
CREATE UNIQUE INDEX "telemetry_records_workspaceId_id_key" ON "telemetry_records"("workspaceId", "id");
CREATE INDEX "telemetry_records_workspaceId_kind_operation_occurredAt_idx" ON "telemetry_records"("workspaceId", "kind", "operation", "occurredAt");
CREATE INDEX "telemetry_records_workspaceId_correlationId_occurredAt_idx" ON "telemetry_records"("workspaceId", "correlationId", "occurredAt");
CREATE INDEX "telemetry_records_workspaceId_outcome_occurredAt_idx" ON "telemetry_records"("workspaceId", "outcome", "occurredAt");

CREATE TABLE "slo_definition_versions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "direction" "SloMetricDirection" NOT NULL,
  "targetBasisPoints" INTEGER NOT NULL,
  "windowMinutes" INTEGER NOT NULL,
  "owner" TEXT NOT NULL,
  "runbookKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "slo_definition_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "slo_target_check" CHECK ("targetBasisPoints" > 0 AND "targetBasisPoints" <= 10000),
  CONSTRAINT "slo_window_check" CHECK ("windowMinutes" > 0)
);
CREATE UNIQUE INDEX "slo_definition_versions_workspaceId_id_key" ON "slo_definition_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "slo_definition_versions_workspaceId_key_version_key" ON "slo_definition_versions"("workspaceId", "key", "version");
CREATE INDEX "slo_definition_versions_workspaceId_active_key_idx" ON "slo_definition_versions"("workspaceId", "active", "key");

CREATE TABLE "observability_rule_versions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "comparator" TEXT NOT NULL,
  "threshold" DECIMAL(18,6) NOT NULL,
  "severity" "ObservabilityAlertSeverity" NOT NULL,
  "cooldownSeconds" INTEGER NOT NULL,
  "owner" TEXT NOT NULL,
  "queueId" UUID,
  "runbookKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "observability_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observability_rule_cooldown_check" CHECK ("cooldownSeconds" >= 0),
  CONSTRAINT "observability_rule_comparator_check" CHECK ("comparator" IN ('GT', 'GTE', 'LT', 'LTE'))
);
CREATE UNIQUE INDEX "observability_rule_versions_workspaceId_id_key" ON "observability_rule_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "observability_rule_versions_workspaceId_key_version_key" ON "observability_rule_versions"("workspaceId", "key", "version");
CREATE INDEX "observability_rule_versions_workspaceId_active_metricKey_idx" ON "observability_rule_versions"("workspaceId", "active", "metricKey");

CREATE TABLE "observability_alerts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "status" "ObservabilityAlertStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "ObservabilityAlertSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "queueId" UUID,
  "evidence" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "firstDetectedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL,
  "acknowledgedAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "observability_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "observability_alerts_workspaceId_id_key" ON "observability_alerts"("workspaceId", "id");
CREATE UNIQUE INDEX "observability_alerts_workspaceId_dedupKey_key" ON "observability_alerts"("workspaceId", "dedupKey");
CREATE INDEX "observability_alerts_workspaceId_status_severity_lastDetectedAt_idx" ON "observability_alerts"("workspaceId", "status", "severity", "lastDetectedAt");

CREATE TABLE "observability_alert_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "alertId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "actorId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "observability_alert_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "observability_alert_events_workspaceId_id_key" ON "observability_alert_events"("workspaceId", "id");
CREATE INDEX "observability_alert_events_workspaceId_alertId_occurredAt_idx" ON "observability_alert_events"("workspaceId", "alertId", "occurredAt");

CREATE TABLE "operational_incidents" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "ObservabilityAlertSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "impact" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "queueId" UUID,
  "runbookKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "mitigatedAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "operational_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operational_incidents_workspaceId_id_key" ON "operational_incidents"("workspaceId", "id");
CREATE UNIQUE INDEX "operational_incidents_workspaceId_idempotencyKey_key" ON "operational_incidents"("workspaceId", "idempotencyKey");
CREATE INDEX "operational_incidents_workspaceId_status_severity_startedAt_idx" ON "operational_incidents"("workspaceId", "status", "severity", "startedAt");

CREATE TABLE "operational_incident_alerts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "alertId" UUID NOT NULL,
  "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_incident_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operational_incident_alerts_workspaceId_id_key" ON "operational_incident_alerts"("workspaceId", "id");
CREATE UNIQUE INDEX "operational_incident_alerts_workspaceId_incidentId_alertId_key" ON "operational_incident_alerts"("workspaceId", "incidentId", "alertId");
CREATE INDEX "operational_incident_alerts_workspaceId_alertId_idx" ON "operational_incident_alerts"("workspaceId", "alertId");

CREATE TABLE "operational_incident_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "kind" "IncidentEventKind" NOT NULL,
  "fromStatus" "IncidentStatus",
  "toStatus" "IncidentStatus",
  "note" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "actorId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_incident_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operational_incident_events_workspaceId_id_key" ON "operational_incident_events"("workspaceId", "id");
CREATE INDEX "operational_incident_events_workspaceId_incidentId_occurredAt_idx" ON "operational_incident_events"("workspaceId", "incidentId", "occurredAt");

CREATE TABLE "data_subject_request_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "kind" "DataSubjectRequestEventKind" NOT NULL,
  "fromStatus" "DataSubjectRequestStatus",
  "toStatus" "DataSubjectRequestStatus",
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "result" JSONB,
  "actorId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_subject_request_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "data_subject_request_events_workspaceId_id_key" ON "data_subject_request_events"("workspaceId", "id");
CREATE INDEX "data_subject_request_events_workspaceId_requestId_occurredAt_idx" ON "data_subject_request_events"("workspaceId", "requestId", "occurredAt");

ALTER TABLE "telemetry_records" ADD CONSTRAINT "telemetry_records_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "slo_definition_versions" ADD CONSTRAINT "slo_definition_versions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "observability_rule_versions" ADD CONSTRAINT "observability_rule_versions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "observability_alerts" ADD CONSTRAINT "observability_alerts_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "observability_alerts" ADD CONSTRAINT "observability_alerts_rule_fkey" FOREIGN KEY ("workspaceId", "ruleVersionId") REFERENCES "observability_rule_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "observability_alert_events" ADD CONSTRAINT "observability_alert_events_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "observability_alert_events" ADD CONSTRAINT "observability_alert_events_alert_fkey" FOREIGN KEY ("workspaceId", "alertId") REFERENCES "observability_alerts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "operational_incidents" ADD CONSTRAINT "operational_incidents_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "operational_incident_alerts" ADD CONSTRAINT "operational_incident_alerts_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "operational_incident_alerts" ADD CONSTRAINT "operational_incident_alerts_incident_fkey" FOREIGN KEY ("workspaceId", "incidentId") REFERENCES "operational_incidents"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "operational_incident_alerts" ADD CONSTRAINT "operational_incident_alerts_alert_fkey" FOREIGN KEY ("workspaceId", "alertId") REFERENCES "observability_alerts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "operational_incident_events" ADD CONSTRAINT "operational_incident_events_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "operational_incident_events" ADD CONSTRAINT "operational_incident_events_incident_fkey" FOREIGN KEY ("workspaceId", "incidentId") REFERENCES "operational_incidents"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "data_subject_request_events" ADD CONSTRAINT "data_subject_request_events_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "data_subject_request_events" ADD CONSTRAINT "data_subject_request_events_request_fkey" FOREIGN KEY ("workspaceId", "requestId") REFERENCES "data_subject_requests"("workspaceId", "id") ON DELETE RESTRICT;

CREATE FUNCTION crm62_reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CRM-62 operational history is append-only'; END $$;
CREATE TRIGGER "telemetry_records_append_only" BEFORE UPDATE OR DELETE ON "telemetry_records" FOR EACH ROW EXECUTE FUNCTION crm62_reject_append_only_mutation();
CREATE TRIGGER "slo_definition_versions_append_only" BEFORE UPDATE OR DELETE ON "slo_definition_versions" FOR EACH ROW EXECUTE FUNCTION crm62_reject_append_only_mutation();
CREATE TRIGGER "observability_rule_versions_append_only" BEFORE UPDATE OR DELETE ON "observability_rule_versions" FOR EACH ROW EXECUTE FUNCTION crm62_reject_append_only_mutation();
CREATE TRIGGER "observability_alert_events_append_only" BEFORE UPDATE OR DELETE ON "observability_alert_events" FOR EACH ROW EXECUTE FUNCTION crm62_reject_append_only_mutation();
CREATE TRIGGER "operational_incident_events_append_only" BEFORE UPDATE OR DELETE ON "operational_incident_events" FOR EACH ROW EXECUTE FUNCTION crm62_reject_append_only_mutation();
CREATE TRIGGER "data_subject_request_events_append_only" BEFORE UPDATE OR DELETE ON "data_subject_request_events" FOR EACH ROW EXECUTE FUNCTION crm62_reject_append_only_mutation();

INSERT INTO "permissions" ("id", "key", "description", "createdAt") VALUES
  (md5('permission:operations.read')::uuid, 'operations.read', 'Consultar observabilidade operacional e SLOs', CURRENT_TIMESTAMP),
  (md5('permission:operations.manage')::uuid, 'operations.manage', 'Reconhecer alertas e conduzir incidentes', CURRENT_TIMESTAMP),
  (md5('permission:security.monitor.read')::uuid, 'security.monitor.read', 'Consultar sinais agregados de segurança', CURRENT_TIMESTAMP),
  (md5('permission:privacy.operations.manage')::uuid, 'privacy.operations.manage', 'Conduzir solicitações e retenção governada', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt")
SELECT md5(w.id::text || ':' || r.id::text || ':' || p.key)::uuid, w.id, r.id, p.id, 'WORKSPACE'::"PermissionScope", a.id, CURRENT_TIMESTAMP
FROM "workspaces" w
JOIN "roles" r ON r."workspaceId" = w.id AND r.key IN ('administrator', 'commercial_manager') AND r."deletedAt" IS NULL
JOIN "actors" a ON a."workspaceId" = w.id AND a.key = 'system'
JOIN "permissions" p ON p.key IN ('operations.read', 'operations.manage', 'security.monitor.read', 'privacy.operations.manage')
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;
