-- CRM-42: canonical geographic observations, versioned territories and local-only analytics.

CREATE TYPE "GeographicPrecision" AS ENUM ('COUNTRY','STATE','CITY','POSTAL_PREFIX','APPROXIMATE_POINT','EXACT_POINT');
CREATE TYPE "GeographicSourceType" AS ENUM ('FORM_DECLARED','MANUAL_CONFIRMED','ACCOUNT_DECLARED','LEAD_LEGACY','TOUCHPOINT_EXPLICIT','LOCAL_IMPORT','GEOCODER_FUTURE','IP_COARSE_FUTURE','COMMERCIAL_INFERENCE');
CREATE TYPE "GeographicEvidenceClass" AS ENUM ('FACT','INFERENCE','USER_CONFIRMED');
CREATE TYPE "GeographicTargetType" AS ENUM ('CONTACT','ACCOUNT','LEAD','TOUCHPOINT','CONVERSION');
CREATE TYPE "GeographicVerificationStatus" AS ENUM ('UNVERIFIED','VERIFIED','NEEDS_REVIEW','REJECTED');
CREATE TYPE "GeographicIssueStatus" AS ENUM ('OPEN','RESOLVED','DISMISSED');
CREATE TYPE "TerritoryType" AS ENUM ('COUNTRY','REGION','STATE','CITY','POSTAL_PREFIX','POLYGON');
CREATE TYPE "TerritoryStatus" AS ENUM ('DRAFT','ACTIVE','INACTIVE');
CREATE TYPE "TerritoryMatchType" AS ENUM ('COUNTRY','STATE','CITY','POSTAL_PREFIX','POLYGON','MANUAL_OVERRIDE');
CREATE TYPE "GeographicBackfillMode" AS ENUM ('DRY_RUN','EXECUTE');
CREATE TYPE "GeographicBackfillStatus" AS ENUM ('RUNNING','SUCCEEDED','FAILED');

CREATE TABLE "geographic_locations" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "countryCode" TEXT NOT NULL,
  "stateCode" TEXT,
  "city" TEXT,
  "normalizedCity" TEXT,
  "officialCityCode" TEXT,
  "postalPrefix" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "precision" "GeographicPrecision" NOT NULL,
  "sourceType" "GeographicSourceType" NOT NULL,
  "confidenceBps" INTEGER NOT NULL,
  "verificationStatus" "GeographicVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "canonicalKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "geographic_locations_confidence_check" CHECK ("confidenceBps" BETWEEN 0 AND 10000),
  CONSTRAINT "geographic_locations_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL) OR
    ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  ),
  CONSTRAINT "geographic_locations_exact_check" CHECK ("precision" <> 'EXACT_POINT' OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "verificationStatus" = 'VERIFIED')),
  CONSTRAINT "geographic_locations_country_check" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "geographic_locations_state_check" CHECK ("stateCode" IS NULL OR "stateCode" ~ '^[A-Z0-9-]{2,8}$'),
  CONSTRAINT "geographic_locations_postal_check" CHECK ("postalPrefix" IS NULL OR "postalPrefix" ~ '^[0-9A-Z-]{3,12}$')
);
CREATE UNIQUE INDEX "geographic_locations_workspace_id_key" ON "geographic_locations"("workspaceId","id");
CREATE UNIQUE INDEX "geographic_locations_canonical_version_key" ON "geographic_locations"("workspaceId","canonicalKey","version");
CREATE INDEX "geographic_locations_place_idx" ON "geographic_locations"("workspaceId","countryCode","stateCode","normalizedCity");
CREATE INDEX "geographic_locations_quality_idx" ON "geographic_locations"("workspaceId","precision","verificationStatus");

CREATE TABLE "geographic_observations" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "targetType" "GeographicTargetType" NOT NULL, "targetId" UUID NOT NULL,
  "locationId" UUID NOT NULL, "sourceType" "GeographicSourceType" NOT NULL, "sourceRecordId" TEXT,
  "evidenceClass" "GeographicEvidenceClass" NOT NULL, "confidenceBps" INTEGER NOT NULL, "precision" "GeographicPrecision" NOT NULL,
  "verificationStatus" "GeographicVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED', "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "ingestedAt" TIMESTAMPTZ(3) NOT NULL, "validFrom" TIMESTAMPTZ(3) NOT NULL, "validTo" TIMESTAMPTZ(3),
  "supersedesObservationId" UUID, "evidence" JSONB, "idempotencyKey" TEXT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "geographic_observations_confidence_check" CHECK ("confidenceBps" BETWEEN 0 AND 10000),
  CONSTRAINT "geographic_observations_validity_check" CHECK ("validTo" IS NULL OR "validTo" > "validFrom")
);
CREATE UNIQUE INDEX "geographic_observations_workspace_id_key" ON "geographic_observations"("workspaceId","id");
CREATE UNIQUE INDEX "geographic_observations_idempotency_key" ON "geographic_observations"("workspaceId","idempotencyKey");
CREATE INDEX "geographic_observations_target_idx" ON "geographic_observations"("workspaceId","targetType","targetId","validFrom");
CREATE INDEX "geographic_observations_quality_idx" ON "geographic_observations"("workspaceId","sourceType","evidenceClass","precision");
CREATE INDEX "geographic_observations_location_idx" ON "geographic_observations"("workspaceId","locationId","observedAt");

CREATE TABLE "geographic_profiles" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "targetType" "GeographicTargetType" NOT NULL, "targetId" UUID NOT NULL,
  "currentObservationId" UUID NOT NULL, "locationId" UUID NOT NULL, "evidenceClass" "GeographicEvidenceClass" NOT NULL,
  "precision" "GeographicPrecision" NOT NULL, "confidenceBps" INTEGER NOT NULL, "verificationStatus" "GeographicVerificationStatus" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "geographic_profiles_confidence_check" CHECK ("confidenceBps" BETWEEN 0 AND 10000),
  CONSTRAINT "geographic_profiles_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "geographic_profiles_workspace_id_key" ON "geographic_profiles"("workspaceId","id");
CREATE UNIQUE INDEX "geographic_profiles_target_key" ON "geographic_profiles"("workspaceId","targetType","targetId");
CREATE INDEX "geographic_profiles_location_idx" ON "geographic_profiles"("workspaceId","locationId","evidenceClass","verificationStatus");

CREATE TABLE "geographic_data_issues" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "targetType" "GeographicTargetType" NOT NULL, "targetId" UUID NOT NULL,
  "issueCode" TEXT NOT NULL, "status" "GeographicIssueStatus" NOT NULL DEFAULT 'OPEN', "severity" TEXT NOT NULL,
  "observationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[], "safeEvidence" JSONB, "resolvedAt" TIMESTAMPTZ(3),
  "resolvedByActorId" UUID, "resolutionReason" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "geographic_data_issues_workspace_id_key" ON "geographic_data_issues"("workspaceId","id");
CREATE INDEX "geographic_data_issues_status_idx" ON "geographic_data_issues"("workspaceId","status","severity","createdAt");
CREATE INDEX "geographic_data_issues_target_idx" ON "geographic_data_issues"("workspaceId","targetType","targetId","status");

CREATE TABLE "territories" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "type" "TerritoryType" NOT NULL,
  "status" "TerritoryStatus" NOT NULL DEFAULT 'DRAFT', "version" INTEGER NOT NULL, "priority" INTEGER NOT NULL,
  "countryCode" TEXT, "stateCode" TEXT, "normalizedCity" TEXT, "postalPrefix" TEXT, "polygon" JSONB, "polygonVertexCount" INTEGER,
  "ownerTeamId" UUID, "timeZone" TEXT, "effectiveFrom" TIMESTAMPTZ(3) NOT NULL, "effectiveTo" TIMESTAMPTZ(3),
  "ruleHash" TEXT NOT NULL, "reason" TEXT NOT NULL, "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "territories_version_priority_check" CHECK ("version" > 0 AND "priority" BETWEEN 0 AND 10000),
  CONSTRAINT "territories_validity_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "territories_polygon_size_check" CHECK ("polygonVertexCount" IS NULL OR "polygonVertexCount" BETWEEN 4 AND 1000)
);
CREATE UNIQUE INDEX "territories_workspace_id_key" ON "territories"("workspaceId","id");
CREATE UNIQUE INDEX "territories_code_version_key" ON "territories"("workspaceId","code","version");
CREATE INDEX "territories_status_validity_idx" ON "territories"("workspaceId","status","effectiveFrom","effectiveTo");
CREATE INDEX "territories_type_priority_idx" ON "territories"("workspaceId","type","priority");

CREATE TABLE "territory_memberships" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "targetType" "GeographicTargetType" NOT NULL, "targetId" UUID NOT NULL,
  "locationId" UUID NOT NULL, "territoryId" UUID NOT NULL, "territoryVersion" INTEGER NOT NULL, "matchType" "TerritoryMatchType" NOT NULL,
  "confidenceBps" INTEGER NOT NULL, "verificationStatus" "GeographicVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "validFrom" TIMESTAMPTZ(3) NOT NULL, "validTo" TIMESTAMPTZ(3), "ruleHash" TEXT NOT NULL, "evidence" JSONB,
  "overrideReason" TEXT, "idempotencyKey" TEXT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "territory_memberships_confidence_check" CHECK ("confidenceBps" BETWEEN 0 AND 10000),
  CONSTRAINT "territory_memberships_validity_check" CHECK ("validTo" IS NULL OR "validTo" > "validFrom")
);
CREATE UNIQUE INDEX "territory_memberships_workspace_id_key" ON "territory_memberships"("workspaceId","id");
CREATE UNIQUE INDEX "territory_memberships_idempotency_key" ON "territory_memberships"("workspaceId","idempotencyKey");
CREATE INDEX "territory_memberships_target_idx" ON "territory_memberships"("workspaceId","targetType","targetId","validFrom");
CREATE INDEX "territory_memberships_territory_idx" ON "territory_memberships"("workspaceId","territoryId","validFrom","validTo");

CREATE TABLE "geographic_backfill_runs" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "mode" "GeographicBackfillMode" NOT NULL,
  "status" "GeographicBackfillStatus" NOT NULL DEFAULT 'RUNNING', "ruleVersion" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0, "validCount" INTEGER NOT NULL DEFAULT 0, "incompleteCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0, "createdCount" INTEGER NOT NULL DEFAULT 0, "existingCount" INTEGER NOT NULL DEFAULT 0,
  "noLocationCount" INTEGER NOT NULL DEFAULT 0, "requestedByActorId" UUID NOT NULL, "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "geographic_backfill_runs_workspace_id_key" ON "geographic_backfill_runs"("workspaceId","id");
CREATE UNIQUE INDEX "geographic_backfill_runs_idempotency_key" ON "geographic_backfill_runs"("workspaceId","idempotencyKey");
CREATE INDEX "geographic_backfill_runs_status_idx" ON "geographic_backfill_runs"("workspaceId","status","createdAt");

CREATE TABLE "geographic_backfill_items" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "runId" UUID NOT NULL, "leadId" UUID NOT NULL,
  "outcome" TEXT NOT NULL, "reasonCode" TEXT NOT NULL, "locationId" UUID, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "geographic_backfill_items_workspace_id_key" ON "geographic_backfill_items"("workspaceId","id");
CREATE UNIQUE INDEX "geographic_backfill_items_run_lead_key" ON "geographic_backfill_items"("workspaceId","runId","leadId");
CREATE INDEX "geographic_backfill_items_outcome_idx" ON "geographic_backfill_items"("workspaceId","outcome","reasonCode");

ALTER TABLE "geographic_locations" ADD CONSTRAINT "geographic_locations_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_observations" ADD CONSTRAINT "geographic_observations_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_observations" ADD CONSTRAINT "geographic_observations_location_fkey" FOREIGN KEY ("workspaceId","locationId") REFERENCES "geographic_locations"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_profiles" ADD CONSTRAINT "geographic_profiles_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_profiles" ADD CONSTRAINT "geographic_profiles_location_fkey" FOREIGN KEY ("workspaceId","locationId") REFERENCES "geographic_locations"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_profiles" ADD CONSTRAINT "geographic_profiles_observation_fkey" FOREIGN KEY ("workspaceId","currentObservationId") REFERENCES "geographic_observations"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_data_issues" ADD CONSTRAINT "geographic_data_issues_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "territories" ADD CONSTRAINT "territories_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "territories" ADD CONSTRAINT "territories_team_fkey" FOREIGN KEY ("workspaceId","ownerTeamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "territory_memberships" ADD CONSTRAINT "territory_memberships_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "territory_memberships" ADD CONSTRAINT "territory_memberships_location_fkey" FOREIGN KEY ("workspaceId","locationId") REFERENCES "geographic_locations"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "territory_memberships" ADD CONSTRAINT "territory_memberships_territory_fkey" FOREIGN KEY ("workspaceId","territoryId") REFERENCES "territories"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_backfill_runs" ADD CONSTRAINT "geographic_backfill_runs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_backfill_items" ADD CONSTRAINT "geographic_backfill_items_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_backfill_items" ADD CONSTRAINT "geographic_backfill_items_run_fkey" FOREIGN KEY ("workspaceId","runId") REFERENCES "geographic_backfill_runs"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geographic_backfill_items" ADD CONSTRAINT "geographic_backfill_items_lead_fkey" FOREIGN KEY ("workspaceId","leadId") REFERENCES "leads"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_geographic_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'geographic facts are append-only'; END $$;
CREATE TRIGGER geographic_observations_append_only BEFORE UPDATE OR DELETE ON "geographic_observations" FOR EACH ROW EXECUTE FUNCTION prevent_geographic_fact_mutation();
CREATE TRIGGER territory_memberships_append_only BEFORE UPDATE OR DELETE ON "territory_memberships" FOR EACH ROW EXECUTE FUNCTION prevent_geographic_fact_mutation();
