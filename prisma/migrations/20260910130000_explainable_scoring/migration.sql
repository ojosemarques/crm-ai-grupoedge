-- CRM-13: scoring versionado, explicável e com projeção vigente explícita.

BEGIN;

CREATE TYPE "LeadScoreSource" AS ENUM (
  'FORM_PROVISIONAL',
  'SDR_VALIDATED',
  'AI_SUGGESTED',
  'HUMAN_OVERRIDE'
);

CREATE TYPE "LeadScoreFactor" AS ENUM (
  'PAIN',
  'CAPACITY',
  'DECISION',
  'INTENT',
  'CONTEXT',
  'NO_CAPACITY',
  'NO_PAIN',
  'CURIOSITY',
  'INVALID_CONTACT',
  'NO_DECISION_ACCESS',
  'HUMAN_OVERRIDE',
  'AI_SUGGESTION'
);

CREATE TABLE "scoring_rule_versions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "algorithmKey" TEXT NOT NULL,
  "painMaxPoints" INTEGER NOT NULL DEFAULT 25,
  "capacityMaxPoints" INTEGER NOT NULL DEFAULT 30,
  "decisionMaxPoints" INTEGER NOT NULL DEFAULT 15,
  "intentMaxPoints" INTEGER NOT NULL DEFAULT 20,
  "contextMaxPoints" INTEGER NOT NULL DEFAULT 10,
  "partialFactorBasisPoints" INTEGER NOT NULL DEFAULT 5000,
  "noCapacityPenalty" INTEGER NOT NULL DEFAULT 30,
  "noPainPenalty" INTEGER NOT NULL DEFAULT 25,
  "curiosityPenalty" INTEGER NOT NULL DEFAULT 10,
  "invalidContactPenalty" INTEGER NOT NULL DEFAULT 100,
  "noDecisionAccessPenalty" INTEGER NOT NULL DEFAULT 15,
  "capacityFullThresholdCents" BIGINT NOT NULL DEFAULT 500000,
  "p1Minimum" INTEGER NOT NULL DEFAULT 70,
  "p2Minimum" INTEGER NOT NULL DEFAULT 40,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "scoring_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scoring_rule_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "scoring_rule_versions_points_check" CHECK (
    "painMaxPoints" >= 0 AND "capacityMaxPoints" >= 0
    AND "decisionMaxPoints" >= 0 AND "intentMaxPoints" >= 0
    AND "contextMaxPoints" >= 0
    AND "painMaxPoints" + "capacityMaxPoints" + "decisionMaxPoints"
      + "intentMaxPoints" + "contextMaxPoints" = 100
  ),
  CONSTRAINT "scoring_rule_versions_partial_check"
    CHECK ("partialFactorBasisPoints" BETWEEN 0 AND 10000),
  CONSTRAINT "scoring_rule_versions_penalties_check" CHECK (
    "noCapacityPenalty" BETWEEN 0 AND 100
    AND "noPainPenalty" BETWEEN 0 AND 100
    AND "curiosityPenalty" BETWEEN 0 AND 100
    AND "invalidContactPenalty" BETWEEN 0 AND 100
    AND "noDecisionAccessPenalty" BETWEEN 0 AND 100
  ),
  CONSTRAINT "scoring_rule_versions_capacity_check"
    CHECK ("capacityFullThresholdCents" >= 0),
  CONSTRAINT "scoring_rule_versions_bands_check"
    CHECK ("p2Minimum" BETWEEN 1 AND 99 AND "p1Minimum" BETWEEN 1 AND 100 AND "p2Minimum" < "p1Minimum")
);

CREATE UNIQUE INDEX "scoring_rule_versions_workspaceId_id_key"
  ON "scoring_rule_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "scoring_rule_versions_workspaceId_key_version_key"
  ON "scoring_rule_versions"("workspaceId", "key", "version");
CREATE UNIQUE INDEX "scoring_rule_versions_one_active_key"
  ON "scoring_rule_versions"("workspaceId", "key") WHERE "active" = TRUE;
CREATE INDEX "scoring_rule_versions_workspaceId_key_active_version_idx"
  ON "scoring_rule_versions"("workspaceId", "key", "active", "version");

ALTER TABLE "scoring_rule_versions"
  ADD CONSTRAINT "scoring_rule_versions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "scoring_rule_versions_createdBy_fkey"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_scores"
  ADD COLUMN "scoringRuleVersionId" UUID,
  ADD COLUMN "submissionId" UUID,
  ADD COLUMN "pactoRevisionId" UUID,
  ADD COLUMN "source" "LeadScoreSource",
  ADD COLUMN "priorityBandCode" "PriorityBandCode",
  ADD COLUMN "currentRevision" INTEGER,
  ADD COLUMN "overrideReason" TEXT,
  ADD COLUMN "inputSnapshot" JSONB;

UPDATE "lead_scores"
SET
  "source" = 'FORM_PROVISIONAL',
  "priorityBandCode" = CASE
    WHEN "score" >= 70 THEN 'P1'::"PriorityBandCode"
    WHEN "score" >= 40 THEN 'P2'::"PriorityBandCode"
    ELSE 'P3'::"PriorityBandCode"
  END,
  "inputSnapshot" = jsonb_build_object('legacy', TRUE, 'modelKey', "modelKey", 'modelVersion', "modelVersion");

WITH latest AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "workspaceId", "leadId"
    ORDER BY "calculatedAt" DESC, "id" DESC
  ) AS position
  FROM "lead_scores"
)
UPDATE "lead_scores" score
SET "currentRevision" = 1
FROM latest
WHERE latest."id" = score."id" AND latest.position = 1;

ALTER TABLE "lead_scores"
  ALTER COLUMN "source" SET NOT NULL,
  ALTER COLUMN "priorityBandCode" SET NOT NULL,
  ALTER COLUMN "inputSnapshot" SET NOT NULL,
  ADD CONSTRAINT "lead_scores_current_revision_check"
    CHECK ("currentRevision" IS NULL OR "currentRevision" > 0),
  ADD CONSTRAINT "lead_scores_override_reason_check"
    CHECK ("source" <> 'HUMAN_OVERRIDE' OR length(trim("overrideReason")) >= 3);

CREATE UNIQUE INDEX "lead_scores_workspaceId_leadId_id_key"
  ON "lead_scores"("workspaceId", "leadId", "id");
CREATE UNIQUE INDEX "lead_scores_workspaceId_leadId_currentRevision_key"
  ON "lead_scores"("workspaceId", "leadId", "currentRevision");
CREATE INDEX "lead_scores_workspaceId_source_calculatedAt_idx"
  ON "lead_scores"("workspaceId", "source", "calculatedAt");
CREATE INDEX "lead_scores_workspaceId_priority_score_calculatedAt_idx"
  ON "lead_scores"("workspaceId", "priorityBandCode", "score", "calculatedAt");

ALTER TABLE "lead_scores"
  ADD CONSTRAINT "lead_scores_scoringRuleVersion_fkey"
    FOREIGN KEY ("workspaceId", "scoringRuleVersionId") REFERENCES "scoring_rule_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_scores_submission_fkey"
    FOREIGN KEY ("workspaceId", "submissionId") REFERENCES "lead_form_submissions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_scores_pactoRevision_fkey"
    FOREIGN KEY ("workspaceId", "pactoRevisionId") REFERENCES "pacto_revisions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lead_score_components" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadScoreId" UUID NOT NULL,
  "factor" "LeadScoreFactor" NOT NULL,
  "points" INTEGER NOT NULL,
  "maxPoints" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "missingData" BOOLEAN NOT NULL DEFAULT FALSE,
  "evidence" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_score_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_score_components_points_check" CHECK ("points" BETWEEN -100 AND 100),
  CONSTRAINT "lead_score_components_max_check" CHECK ("maxPoints" BETWEEN 0 AND 100),
  CONSTRAINT "lead_score_components_reason_check" CHECK (length(trim("reason")) >= 2)
);

CREATE UNIQUE INDEX "lead_score_components_workspaceId_id_key"
  ON "lead_score_components"("workspaceId", "id");
CREATE UNIQUE INDEX "lead_score_components_workspaceId_score_factor_key"
  ON "lead_score_components"("workspaceId", "leadScoreId", "factor");
CREATE INDEX "lead_score_components_workspaceId_factor_points_createdAt_idx"
  ON "lead_score_components"("workspaceId", "factor", "points", "createdAt");

ALTER TABLE "lead_score_components"
  ADD CONSTRAINT "lead_score_components_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_score_components_leadScore_fkey"
    FOREIGN KEY ("workspaceId", "leadScoreId") REFERENCES "lead_scores"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "lead_score_components" (
  "id", "workspaceId", "leadScoreId", "factor", "points", "maxPoints", "reason", "missingData", "evidence", "createdAt"
)
SELECT
  gen_random_uuid(), "workspaceId", "id", 'HUMAN_OVERRIDE', "score", 100,
  'Registro legado preservado; componentes originais não estavam disponíveis.', FALSE,
  jsonb_build_object('legacy', TRUE), "calculatedAt"
FROM "lead_scores";

CREATE TABLE "lead_current_scores" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "leadScoreId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "lead_current_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_current_scores_revision_check" CHECK ("revision" > 0)
);

INSERT INTO "lead_current_scores" (
  "id", "workspaceId", "leadId", "leadScoreId", "revision", "updatedByActorId", "updatedAt"
)
SELECT gen_random_uuid(), "workspaceId", "leadId", "id", 1, "calculatedByActorId", "calculatedAt"
FROM "lead_scores"
WHERE "currentRevision" = 1;

CREATE UNIQUE INDEX "lead_current_scores_workspaceId_id_key"
  ON "lead_current_scores"("workspaceId", "id");
CREATE UNIQUE INDEX "lead_current_scores_leadId_key" ON "lead_current_scores"("leadId");
CREATE UNIQUE INDEX "lead_current_scores_leadScoreId_key" ON "lead_current_scores"("leadScoreId");
CREATE UNIQUE INDEX "lead_current_scores_workspaceId_leadId_key"
  ON "lead_current_scores"("workspaceId", "leadId");
CREATE UNIQUE INDEX "lead_current_scores_workspaceId_leadScoreId_key"
  ON "lead_current_scores"("workspaceId", "leadScoreId");
CREATE UNIQUE INDEX "lead_current_scores_workspaceId_leadId_leadScoreId_key"
  ON "lead_current_scores"("workspaceId", "leadId", "leadScoreId");
CREATE INDEX "lead_current_scores_workspaceId_revision_updatedAt_idx"
  ON "lead_current_scores"("workspaceId", "revision", "updatedAt");

ALTER TABLE "lead_current_scores"
  ADD CONSTRAINT "lead_current_scores_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_current_scores_lead_fkey"
    FOREIGN KEY ("workspaceId", "leadId") REFERENCES "leads"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_current_scores_score_fkey"
    FOREIGN KEY ("workspaceId", "leadId", "leadScoreId") REFERENCES "lead_scores"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_current_scores_updatedBy_fkey"
    FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Harmoniza apenas a configuração estrutural antiga, sem tocar em scores históricos.
UPDATE "lead_priority_bands"
SET "scoreMin" = 70, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'P1' AND "scoreMin" = 80 AND "scoreMax" = 100;
UPDATE "lead_priority_bands"
SET "scoreMin" = 40, "scoreMax" = 69, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'P2' AND "scoreMin" = 50 AND "scoreMax" = 79;
UPDATE "lead_priority_bands"
SET "scoreMax" = 39, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'P3' AND "scoreMin" = 0 AND "scoreMax" = 49;

CREATE OR REPLACE FUNCTION prevent_scoring_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'scoring history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "lead_scores_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "lead_scores"
  FOR EACH ROW EXECUTE FUNCTION prevent_scoring_history_mutation();
CREATE TRIGGER "lead_scores_no_truncate_trigger"
  BEFORE TRUNCATE ON "lead_scores"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_scoring_history_mutation();
CREATE TRIGGER "lead_score_components_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "lead_score_components"
  FOR EACH ROW EXECUTE FUNCTION prevent_scoring_history_mutation();
CREATE TRIGGER "lead_score_components_no_truncate_trigger"
  BEFORE TRUNCATE ON "lead_score_components"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_scoring_history_mutation();

CREATE OR REPLACE FUNCTION prevent_scoring_rule_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'active') = (to_jsonb(OLD) - 'active') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'scoring rule versions are immutable; create a new version' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "scoring_rule_versions_no_rewrite_trigger"
  BEFORE UPDATE OR DELETE ON "scoring_rule_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_scoring_rule_rewrite();
CREATE TRIGGER "scoring_rule_versions_no_truncate_trigger"
  BEFORE TRUNCATE ON "scoring_rule_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_scoring_history_mutation();

COMMIT;
