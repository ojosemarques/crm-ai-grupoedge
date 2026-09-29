-- CRM-25: provedores desacoplados, prompts versionados e rastreabilidade de IA.

BEGIN;

CREATE TYPE "AIAgentType" AS ENUM (
  'QUALIFICATION',
  'CALL_PREPARATION',
  'CONVERSATION_EXTRACTION',
  'NEXT_BEST_ACTION',
  'MANAGER_COPILOT',
  'AUDIT_AGENT'
);

CREATE TYPE "AIExecutionMode" AS ENUM (
  'LOCAL_DETERMINISTIC',
  'EXTERNAL',
  'FALLBACK_LOCAL'
);

ALTER TABLE "ai_insights"
  ADD COLUMN "agentType" "AIAgentType",
  ADD COLUMN "requestedProviderKey" TEXT,
  ADD COLUMN "providerKey" TEXT,
  ADD COLUMN "providerMode" "AIExecutionMode",
  ADD COLUMN "providerModel" TEXT,
  ADD COLUMN "promptKey" TEXT,
  ADD COLUMN "promptVersion" INTEGER,
  ADD COLUMN "requestFingerprint" CHAR(64),
  ADD COLUMN "confidenceBps" INTEGER,
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "providerFailureCode" TEXT,
  ADD COLUMN "requestedByActorId" UUID;

-- Registros anteriores, se existirem, continuam consultáveis e recebem uma
-- proveniência explícita de legado sem inferir capacidades que não existiam.
UPDATE "ai_insights"
SET
  "agentType" = 'NEXT_BEST_ACTION'::"AIAgentType",
  "requestedProviderKey" = CASE
    WHEN "engine" = 'LLM' THEN 'legacy-external'
    ELSE 'legacy-rule-engine'
  END,
  "providerKey" = CASE
    WHEN "engine" = 'LLM' THEN 'legacy-external'
    ELSE 'legacy-rule-engine'
  END,
  "providerMode" = CASE
    WHEN "engine" = 'LLM' THEN 'EXTERNAL'::"AIExecutionMode"
    ELSE 'LOCAL_DETERMINISTIC'::"AIExecutionMode"
  END,
  "promptKey" = 'legacy.unversioned',
  "promptVersion" = 1,
  "requestFingerprint" = repeat(md5("id"::text || ':' || "createdAt"::text), 2),
  "confidenceBps" = 0,
  "durationMs" = 0,
  "requestedByActorId" = "createdByActorId";

ALTER TABLE "ai_insights"
  ALTER COLUMN "agentType" SET NOT NULL,
  ALTER COLUMN "requestedProviderKey" SET NOT NULL,
  ALTER COLUMN "providerKey" SET NOT NULL,
  ALTER COLUMN "providerMode" SET NOT NULL,
  ALTER COLUMN "promptKey" SET NOT NULL,
  ALTER COLUMN "promptVersion" SET NOT NULL,
  ALTER COLUMN "requestFingerprint" SET NOT NULL,
  ALTER COLUMN "confidenceBps" SET NOT NULL,
  ALTER COLUMN "durationMs" SET NOT NULL,
  ALTER COLUMN "requestedByActorId" SET NOT NULL;

ALTER TABLE "ai_insights"
  ADD CONSTRAINT "ai_insights_requested_by_fkey"
    FOREIGN KEY ("workspaceId", "requestedByActorId")
    REFERENCES "actors"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_insights_prompt_version_check"
    CHECK ("promptVersion" > 0),
  ADD CONSTRAINT "ai_insights_confidence_check"
    CHECK ("confidenceBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "ai_insights_duration_check"
    CHECK ("durationMs" >= 0),
  ADD CONSTRAINT "ai_insights_provider_trace_check"
    CHECK (
      length(trim("requestedProviderKey")) > 0
      AND length(trim("providerKey")) > 0
      AND length(trim("promptKey")) > 0
      AND (
        ("providerMode" = 'EXTERNAL' AND "engine" = 'LLM')
        OR ("providerMode" IN ('LOCAL_DETERMINISTIC', 'FALLBACK_LOCAL') AND "engine" = 'RULE_ENGINE')
      )
    );

CREATE INDEX "ai_insights_workspaceId_agentType_createdAt_idx"
  ON "ai_insights"("workspaceId", "agentType", "createdAt");
CREATE INDEX "ai_insights_workspaceId_promptKey_promptVersion_createdAt_idx"
  ON "ai_insights"("workspaceId", "promptKey", "promptVersion", "createdAt");
CREATE INDEX "ai_insights_workspaceId_providerKey_providerMode_createdAt_idx"
  ON "ai_insights"("workspaceId", "providerKey", "providerMode", "createdAt");
CREATE INDEX "ai_insights_workspaceId_requestedByActorId_createdAt_idx"
  ON "ai_insights"("workspaceId", "requestedByActorId", "createdAt");

CREATE FUNCTION prevent_ai_insight_fact_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ai insight evidence cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF ROW(
    OLD."workspaceId", OLD."leadId", OLD."opportunityId", OLD."targetType",
    OLD."agentType", OLD."engine", OLD."engineVersion",
    OLD."requestedProviderKey", OLD."providerKey", OLD."providerMode",
    OLD."providerModel", OLD."promptKey", OLD."promptVersion",
    OLD."requestFingerprint", OLD."confidenceBps", OLD."durationMs",
    OLD."providerFailureCode", OLD."title", OLD."recommendation",
    OLD."explanation", OLD."facts", OLD."inferences", OLD."missingData",
    OLD."evidence", OLD."requiresConfirmation", OLD."requestedByActorId",
    OLD."createdByActorId", OLD."createdAt"
  ) IS DISTINCT FROM ROW(
    NEW."workspaceId", NEW."leadId", NEW."opportunityId", NEW."targetType",
    NEW."agentType", NEW."engine", NEW."engineVersion",
    NEW."requestedProviderKey", NEW."providerKey", NEW."providerMode",
    NEW."providerModel", NEW."promptKey", NEW."promptVersion",
    NEW."requestFingerprint", NEW."confidenceBps", NEW."durationMs",
    NEW."providerFailureCode", NEW."title", NEW."recommendation",
    NEW."explanation", NEW."facts", NEW."inferences", NEW."missingData",
    NEW."evidence", NEW."requiresConfirmation", NEW."requestedByActorId",
    NEW."createdByActorId", NEW."createdAt"
  ) THEN
    RAISE EXCEPTION 'ai insight provenance and evidence are immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_insights_no_fact_rewrite_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "ai_insights"
  FOR EACH ROW EXECUTE FUNCTION prevent_ai_insight_fact_rewrite();
CREATE TRIGGER "ai_insights_no_truncate_trigger"
  BEFORE TRUNCATE ON "ai_insights"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_ai_insight_fact_rewrite();

INSERT INTO "permissions" ("id", "key", "description", "createdAt")
VALUES (
  gen_random_uuid(),
  'ai.use',
  'Solicitar recomendações explicáveis de IA',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope",
  "createdByActorId", "createdAt"
)
SELECT
  gen_random_uuid(),
  role."workspaceId",
  role."id",
  permission."id",
  CASE
    WHEN role."key" = 'administrator' THEN 'WORKSPACE'::"PermissionScope"
    WHEN role."key" = 'commercial_manager' THEN 'TEAM'::"PermissionScope"
    ELSE 'OWN'::"PermissionScope"
  END,
  role."createdByActorId",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."key" = 'ai.use'
WHERE role."key" IN ('administrator', 'commercial_manager', 'sdr', 'closer')
  AND role."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" existing
    WHERE existing."workspaceId" = role."workspaceId"
      AND existing."roleId" = role."id"
      AND existing."permissionId" = permission."id"
  );

COMMIT;
