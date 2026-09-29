-- CRM-24: auditoria pesquisável e achados determinísticos de saúde do processo.

BEGIN;

CREATE TYPE "AuditOrigin" AS ENUM (
  'API', 'DOMAIN', 'SYSTEM', 'AUTOMATION', 'AI', 'SEED'
);

CREATE TYPE "ProcessViolationType" AS ENUM (
  'LEAD_WITHOUT_OPERATIONAL_OWNER',
  'SLA_VIOLATED',
  'LEAD_WITHOUT_ATTEMPT',
  'PACTO_INCOMPLETE',
  'MEETING_WITHOUT_BRIEFING',
  'OPPORTUNITY_WITHOUT_NEXT_ACTION',
  'LEAD_WITHOUT_NEXT_ACTION',
  'LEAD_STAGNANT',
  'INCOHERENT_STAGE_CHANGE',
  'LOST_OPPORTUNITY_WITHOUT_REASON'
);

CREATE TYPE "ProcessViolationSeverity" AS ENUM (
  'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
);

CREATE TYPE "ProcessViolationStatus" AS ENUM (
  'OPEN', 'ACKNOWLEDGED', 'RESOLVED'
);

ALTER TABLE "audit_logs"
  ADD COLUMN "automationRunId" UUID,
  ADD COLUMN "aiInsightId" UUID,
  ADD COLUMN "origin" "AuditOrigin" NOT NULL DEFAULT 'DOMAIN',
  ADD COLUMN "reason" TEXT;

ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_no_update_or_delete_trigger";

UPDATE "audit_logs"
SET "origin" = CASE
  WHEN "action" LIKE 'automation.%' THEN 'AUTOMATION'::"AuditOrigin"
  WHEN "action" LIKE 'seed.%' THEN 'SEED'::"AuditOrigin"
  WHEN "action" LIKE 'auth.%' OR "action" = 'authorization.denied' THEN 'API'::"AuditOrigin"
  ELSE 'DOMAIN'::"AuditOrigin"
END;

UPDATE "audit_logs"
SET "reason" = COALESCE("metadata" ->> 'reason', "changes" ->> 'reason')
WHERE COALESCE("metadata" ->> 'reason', "changes" ->> 'reason') IS NOT NULL;

UPDATE "audit_logs" audit
SET "automationRunId" = run."id"
FROM "automation_runs" run
WHERE audit."workspaceId" = run."workspaceId"
  AND audit."metadata" ->> 'automationRunId' = run."id"::text;

ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_no_update_or_delete_trigger";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_automation_run_fkey"
    FOREIGN KEY ("workspaceId", "automationRunId")
    REFERENCES "automation_runs"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_logs_ai_insight_fkey"
    FOREIGN KEY ("workspaceId", "aiInsightId")
    REFERENCES "ai_insights"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "audit_logs_workspaceId_origin_occurredAt_idx"
  ON "audit_logs"("workspaceId", "origin", "occurredAt");
CREATE INDEX "audit_logs_workspaceId_automationRunId_occurredAt_idx"
  ON "audit_logs"("workspaceId", "automationRunId", "occurredAt");
CREATE INDEX "audit_logs_workspaceId_aiInsightId_occurredAt_idx"
  ON "audit_logs"("workspaceId", "aiInsightId", "occurredAt");

CREATE TABLE "process_violations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "type" "ProcessViolationType" NOT NULL,
  "severity" "ProcessViolationSeverity" NOT NULL,
  "status" "ProcessViolationStatus" NOT NULL DEFAULT 'OPEN',
  "fingerprint" TEXT NOT NULL,
  "leadId" UUID,
  "meetingId" UUID,
  "opportunityId" UUID,
  "slaCycleId" UUID,
  "stageHistoryId" UUID,
  "title" TEXT NOT NULL,
  "evidenceSummary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "detectedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL,
  "detectedByActorId" UUID NOT NULL,
  "acknowledgedAt" TIMESTAMPTZ(3),
  "acknowledgedByActorId" UUID,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedByActorId" UUID,
  "resolutionReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "process_violations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_violations_target_check" CHECK (
    "leadId" IS NOT NULL OR "meetingId" IS NOT NULL OR "opportunityId" IS NOT NULL
  ),
  CONSTRAINT "process_violations_detection_time_check" CHECK (
    "lastDetectedAt" >= "detectedAt"
  ),
  CONSTRAINT "process_violations_state_check" CHECK (
    ("status" = 'OPEN'
      AND "acknowledgedAt" IS NULL AND "acknowledgedByActorId" IS NULL
      AND "resolvedAt" IS NULL AND "resolvedByActorId" IS NULL
      AND "resolutionReason" IS NULL)
    OR ("status" = 'ACKNOWLEDGED'
      AND "acknowledgedAt" IS NOT NULL AND "acknowledgedByActorId" IS NOT NULL
      AND "resolvedAt" IS NULL AND "resolvedByActorId" IS NULL
      AND "resolutionReason" IS NULL)
    OR ("status" = 'RESOLVED'
      AND "acknowledgedAt" IS NOT NULL AND "acknowledgedByActorId" IS NOT NULL
      AND "resolvedAt" IS NOT NULL AND "resolvedByActorId" IS NOT NULL
      AND COALESCE(length(trim("resolutionReason")), 0) >= 3)
  )
);

CREATE UNIQUE INDEX "process_violations_workspaceId_id_key"
  ON "process_violations"("workspaceId", "id");
CREATE UNIQUE INDEX "process_violations_workspaceId_fingerprint_key"
  ON "process_violations"("workspaceId", "fingerprint");
CREATE INDEX "process_violations_workspaceId_status_severity_detectedAt_idx"
  ON "process_violations"("workspaceId", "status", "severity", "detectedAt");
CREATE INDEX "process_violations_workspaceId_type_status_detectedAt_idx"
  ON "process_violations"("workspaceId", "type", "status", "detectedAt");
CREATE INDEX "process_violations_workspaceId_leadId_status_detectedAt_idx"
  ON "process_violations"("workspaceId", "leadId", "status", "detectedAt");
CREATE INDEX "process_violations_workspaceId_meetingId_status_detectedAt_idx"
  ON "process_violations"("workspaceId", "meetingId", "status", "detectedAt");
CREATE INDEX "process_violations_workspaceId_opportunityId_status_detectedAt_idx"
  ON "process_violations"("workspaceId", "opportunityId", "status", "detectedAt");
CREATE INDEX "process_violations_workspaceId_slaCycleId_idx"
  ON "process_violations"("workspaceId", "slaCycleId");
CREATE INDEX "process_violations_workspaceId_stageHistoryId_idx"
  ON "process_violations"("workspaceId", "stageHistoryId");

ALTER TABLE "process_violations"
  ADD CONSTRAINT "process_violations_workspace_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_lead_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_meeting_fkey"
    FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_opportunity_fkey"
    FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_sla_cycle_fkey"
    FOREIGN KEY ("workspaceId", "slaCycleId") REFERENCES "lead_sla_cycles"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_stage_history_fkey"
    FOREIGN KEY ("workspaceId", "stageHistoryId") REFERENCES "stage_history"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_detected_by_fkey"
    FOREIGN KEY ("workspaceId", "detectedByActorId") REFERENCES "actors"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_acknowledged_by_fkey"
    FOREIGN KEY ("workspaceId", "acknowledgedByActorId") REFERENCES "actors"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_violations_resolved_by_fkey"
    FOREIGN KEY ("workspaceId", "resolvedByActorId") REFERENCES "actors"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_process_violation_fact_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'process violations cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    OLD."workspaceId", OLD."type", OLD."fingerprint", OLD."leadId",
    OLD."meetingId", OLD."opportunityId", OLD."slaCycleId",
    OLD."stageHistoryId", OLD."title", OLD."evidenceSummary", OLD."evidence",
    OLD."detectedAt", OLD."detectedByActorId", OLD."createdAt"
  ) IS DISTINCT FROM ROW(
    NEW."workspaceId", NEW."type", NEW."fingerprint", NEW."leadId",
    NEW."meetingId", NEW."opportunityId", NEW."slaCycleId",
    NEW."stageHistoryId", NEW."title", NEW."evidenceSummary", NEW."evidence",
    NEW."detectedAt", NEW."detectedByActorId", NEW."createdAt"
  ) THEN
    RAISE EXCEPTION 'process violation evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "process_violations_no_fact_rewrite_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "process_violations"
  FOR EACH ROW EXECUTE FUNCTION prevent_process_violation_fact_rewrite();
CREATE TRIGGER "process_violations_no_truncate_trigger"
  BEFORE TRUNCATE ON "process_violations"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_process_violation_fact_rewrite();

INSERT INTO "permissions" ("id", "key", "description", "createdAt")
VALUES
  (gen_random_uuid(), 'audit.read', 'Consultar auditoria e saúde do processo', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'audit.manage', 'Reconhecer, revalidar e resolver achados de processo', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt"
)
SELECT
  gen_random_uuid(), role."workspaceId", role."id", permission."id",
  'WORKSPACE'::"PermissionScope", role."createdByActorId", CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission
  ON permission."key" IN ('audit.read', 'audit.manage')
WHERE role."key" IN ('administrator', 'commercial_manager')
  AND role."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" grant_row
    WHERE grant_row."workspaceId" = role."workspaceId"
      AND grant_row."roleId" = role."id"
      AND grant_row."permissionId" = permission."id"
  );

COMMIT;
