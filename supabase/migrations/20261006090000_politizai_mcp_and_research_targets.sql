SET search_path TO crm, public;

BEGIN;

CREATE TYPE "ProspectingResearchTargetStatus" AS ENUM (
  'PENDING', 'CLAIMED', 'INGESTED', 'REVIEW_REQUIRED', 'SKIPPED', 'FAILED'
);

CREATE TABLE "prospecting_research_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "externalIdentityKey" TEXT NOT NULL,
  "tseCandidateId" TEXT NOT NULL,
  "role" "ProspectingRole" NOT NULL,
  "politicianName" TEXT NOT NULL,
  "ballotName" TEXT,
  "municipalityName" TEXT NOT NULL,
  "municipalityIbgeCode" TEXT NOT NULL,
  "stateCode" TEXT NOT NULL,
  "population" INTEGER NOT NULL,
  "status" "ProspectingResearchTargetStatus" NOT NULL DEFAULT 'PENDING',
  "candidateId" UUID,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastReasonCode" TEXT,
  "lastEvidence" JSONB,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospecting_research_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prospecting_research_targets_population_check" CHECK ("population" >= 30000),
  CONSTRAINT "prospecting_research_targets_state_check" CHECK ("stateCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "prospecting_research_targets_ibge_check" CHECK ("municipalityIbgeCode" ~ '^[0-9]{7}$'),
  CONSTRAINT "prospecting_research_targets_attempt_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "prospecting_research_targets_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_research_targets_batch_fk" FOREIGN KEY ("workspaceId", "batchId") REFERENCES "prospecting_research_batches"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_research_targets_candidate_fk" FOREIGN KEY ("workspaceId", "candidateId") REFERENCES "prospect_candidates"("workspaceId", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "prospecting_research_targets_workspace_id_key" ON "prospecting_research_targets"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_research_targets_identity_key" ON "prospecting_research_targets"("workspaceId", "externalIdentityKey");
CREATE INDEX "prospecting_research_targets_claim_idx" ON "prospecting_research_targets"("workspaceId", "batchId", "status", "leaseExpiresAt");
CREATE INDEX "prospecting_research_targets_municipality_idx" ON "prospecting_research_targets"("workspaceId", "municipalityIbgeCode", "role");
CREATE INDEX "prospecting_research_targets_candidate_idx" ON "prospecting_research_targets"("workspaceId", "candidateId");

CREATE TABLE "mcp_oauth_authorization_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workspaceMemberId" UUID NOT NULL,
  "authorizingActorId" UUID NOT NULL,
  "clientId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_authorization_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_oauth_authorization_codes_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_authorization_codes_user_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_authorization_codes_member_fk" FOREIGN KEY ("workspaceId", "userId", "workspaceMemberId") REFERENCES "workspace_members"("workspaceId", "userId", "id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_authorization_codes_actor_fk" FOREIGN KEY ("workspaceId", "authorizingActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_hash_key" ON "mcp_oauth_authorization_codes"("codeHash");
CREATE INDEX "mcp_oauth_authorization_codes_workspace_idx" ON "mcp_oauth_authorization_codes"("workspaceId", "expiresAt", "consumedAt");
CREATE INDEX "mcp_oauth_authorization_codes_client_idx" ON "mcp_oauth_authorization_codes"("clientId", "expiresAt", "consumedAt");

CREATE TABLE "mcp_oauth_refresh_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workspaceMemberId" UUID NOT NULL,
  "authorizingActorId" UUID NOT NULL,
  "clientId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastUsedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "rotatedToId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_refresh_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_oauth_refresh_tokens_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_refresh_tokens_user_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_refresh_tokens_member_fk" FOREIGN KEY ("workspaceId", "userId", "workspaceMemberId") REFERENCES "workspace_members"("workspaceId", "userId", "id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_refresh_tokens_actor_fk" FOREIGN KEY ("workspaceId", "authorizingActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "mcp_oauth_refresh_tokens_rotated_fk" FOREIGN KEY ("rotatedToId") REFERENCES "mcp_oauth_refresh_tokens"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "mcp_oauth_refresh_tokens_hash_key" ON "mcp_oauth_refresh_tokens"("tokenHash");
CREATE INDEX "mcp_oauth_refresh_tokens_workspace_idx" ON "mcp_oauth_refresh_tokens"("workspaceId", "expiresAt", "revokedAt");
CREATE INDEX "mcp_oauth_refresh_tokens_client_idx" ON "mcp_oauth_refresh_tokens"("clientId", "expiresAt", "revokedAt");

ALTER TABLE "prospecting_research_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_oauth_refresh_tokens" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "prospecting_research_targets", "mcp_oauth_authorization_codes", "mcp_oauth_refresh_tokens" FROM PUBLIC;

DO $migration$
DECLARE
  target_schema TEXT := current_schema();
  target_table TEXT;
  active_workspace TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "prospecting_research_targets", "mcp_oauth_authorization_codes", "mcp_oauth_refresh_tokens" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "prospecting_research_targets", "mcp_oauth_authorization_codes", "mcp_oauth_refresh_tokens" FROM authenticated;
  END IF;

  active_workspace := format('"workspaceId" IN (SELECT id FROM %I.workspaces WHERE status = ''ACTIVE'' AND "deletedAt" IS NULL)', target_schema);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "prospecting_research_targets", "mcp_oauth_authorization_codes", "mcp_oauth_refresh_tokens"
      TO crm_politizai_runtime;
    FOREACH target_table IN ARRAY ARRAY[
      'prospecting_research_targets', 'mcp_oauth_authorization_codes', 'mcp_oauth_refresh_tokens'
    ] LOOP
      EXECUTE format('CREATE POLICY company_runtime_select ON %I.%I FOR SELECT TO crm_politizai_runtime USING (%s)', target_schema, target_table, active_workspace);
      EXECUTE format('CREATE POLICY company_runtime_insert ON %I.%I FOR INSERT TO crm_politizai_runtime WITH CHECK (%s)', target_schema, target_table, active_workspace);
      EXECUTE format('CREATE POLICY company_runtime_update ON %I.%I FOR UPDATE TO crm_politizai_runtime USING (%s) WITH CHECK (%s)', target_schema, target_table, active_workspace, active_workspace);
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "prospecting_research_targets", "mcp_oauth_authorization_codes", "mcp_oauth_refresh_tokens"
      TO service_role;
  END IF;
END
$migration$;

COMMIT;
